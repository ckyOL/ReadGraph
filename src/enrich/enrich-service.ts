// OPAC 补全抓取编排（opac-enrichment 规格 §7）。
// 两阶段模型之「抓取」：按 provider 分派（getProvider(source.parserId)）、整体并发上限、
// 超时 + 失败指数退避重试（最多 2 次）；not_found/failed 仅回写状态（含 providerId），
// 成功项产出建议改动上下文（会话内存，零实体写入、零状态写入）。
// 应用阶段（用户驱动、复用统一编辑表单）见 routes/library/-edit-dialog.tsx。
import { z } from 'zod'

import type { ReadGraphDB } from '@/db/db'
import { catalogRecordSchema } from '@/db/schemas'
import { parseTitle } from '@/lib/title'
import type { Book, CatalogRecord, ParseWarning, Source } from '@/types/entities'
import { mapOpacDetail, type EnrichmentChange } from '@/lib/opac-mapping'
import { OpacFetchError } from './opac-client'
import { getProvider, type OpacDetailResult, type OpacProvider } from './opac-provider'

/** 整体并发上限（规格 §7）。 */
export const ENRICH_CONCURRENCY = 4
/** 单请求超时（规格 §7）。 */
export const ENRICH_TIMEOUT_MS = 10_000
/** 失败指数退避基数；最多重试 2 次（共 3 次尝试）。 */
const ENRICH_BACKOFF_MS = 200
const ENRICH_MAX_RETRIES = 2

/** 候选集条目：一条 CatalogRecord + 其 Book + Source。 */
export interface EnrichCandidate {
  record: CatalogRecord
  book: Book
  source: Source
}

/** 建议改动上下文（会话内存，不落 URL、不落库）：抓取结果 → 编辑表单预填。 */
export interface EnrichmentContext {
  recordId: string
  providerId: string
  sourceUrl: string
  changes: EnrichmentChange[]
  warnings: ParseWarning[]
}

export interface EnrichSuccess {
  record: CatalogRecord
  book: Book
  context: EnrichmentContext
}

export interface EnrichSummary {
  successes: EnrichSuccess[]
  notFound: CatalogRecord[]
  failed: CatalogRecord[]
}

export interface EnrichOptions {
  concurrency?: number
  timeoutMs?: number
  backoffMs?: number
  signal?: AbortSignal
  /** 受控进度：done/total 递增回调（批量进度条用，不逐条触发 setState）。 */
  onProgress?: (done: number, total: number) => void
}

export interface ProviderCandidateGroup {
  provider: OpacProvider
  candidates: EnrichCandidate[]
}

/** lookupKey 对应字段是否满足（§7 候选集第 2 条）：'metaId' → metaIdKey 非空且 metaId≠0；'isbn13' → Book.isbn13 非空。 */
export function hasLookupKey(record: CatalogRecord, book: Book, provider: OpacProvider): boolean {
  if (provider.lookupKey === 'metaId') {
    return record.metaIdKey != null && record.metaIdKey !== '' && record.metaId !== 0
  }
  return book.isbn13 != null && book.isbn13 !== ''
}

/**
 * 候选集判定（规格 §7）：provider 注册表命中；lookupKey 对应字段满足；
 * 已 fetched 排除（幂等）；占位 Book（needsReview=true 且占位书名）排除（§7.1）。
 */
export function isEnrichmentCandidate(record: CatalogRecord, book: Book, source: Source): boolean {
  const provider = getProvider(source.parserId)
  if (!provider) return false
  if (record.opacEnrichment?.status === 'fetched') return false
  if (book.needsReview && parseTitle(book.title).isPlaceholder) return false
  return hasLookupKey(record, book, provider)
}

/** 占位 Book 记录计数（§7.1：入口置灰并单独说明，不计入候选）。 */
export function countPlaceholderExcluded(
  books: Book[],
  catalogRecords: CatalogRecord[],
  sources: Source[],
): number {
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const bookById = new Map(books.map((b) => [b.id, b]))
  let count = 0
  for (const record of catalogRecords) {
    const source = sourceById.get(record.sourceId)
    const book = bookById.get(record.bookId)
    if (!source || !book) continue
    const provider = getProvider(source.parserId)
    if (!provider) continue
    if (book.needsReview && parseTitle(book.title).isPlaceholder && hasLookupKey(record, book, provider)) {
      count++
    }
  }
  return count
}

/** 全库候选集：跨 book/record/source 组装（书库列表 / 导入完成页批量入口用）。 */
export function collectCandidates(
  books: Book[],
  catalogRecords: CatalogRecord[],
  sources: Source[],
): EnrichCandidate[] {
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const bookById = new Map(books.map((b) => [b.id, b]))
  const out: EnrichCandidate[] = []
  for (const record of catalogRecords) {
    const source = sourceById.get(record.sourceId)
    const book = bookById.get(record.bookId)
    if (!source || !book) continue
    if (isEnrichmentCandidate(record, book, source)) out.push({ record, book, source })
  }
  return out
}

/** 按 provider 分组（批量入口「从 {displayName} 补全 (N)」按组显示计数）。 */
export function groupCandidatesByProvider(candidates: EnrichCandidate[]): ProviderCandidateGroup[] {
  const byProvider = new Map<string, ProviderCandidateGroup>()
  for (const c of candidates) {
    const provider = getProvider(c.source.parserId)
    if (!provider) continue
    let group = byProvider.get(provider.id)
    if (!group) {
      group = { provider, candidates: [] }
      byProvider.set(provider.id, group)
    }
    group.candidates.push(c)
  }
  return Array.from(byProvider.values())
}

function validated<S extends z.ZodType>(schema: S, value: z.input<S>): z.output<S> {
  const r = schema.safeParse(value)
  if (!r.success) throw r.error
  return r.data
}

/** 回写抓取状态（规格 §7）：not_found/failed 仅回写 opacEnrichment，不触碰实体。 */
export async function writeEnrichmentStatus(
  db: ReadGraphDB,
  record: CatalogRecord,
  status: 'not_found' | 'failed',
  providerId: string,
): Promise<void> {
  const current = await db.catalogRecords.get(record.id)
  if (!current) return
  await db.catalogRecords.put(
    validated(catalogRecordSchema, {
      ...current,
      opacEnrichment: { providerId, status, fetchedAt: null, sourceUrl: null },
      updatedAt: new Date(),
    }),
  )
}

/** 抓取 + 失败指数退避重试（最多 2 次）；aborted 立即上抛不重试。 */
async function fetchDetailWithRetry(
  provider: OpacProvider,
  record: CatalogRecord,
  book: Book,
  opts: { timeoutMs: number; backoffMs: number; signal?: AbortSignal },
): Promise<OpacDetailResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await provider.fetchDetail(record, book, {
        timeoutMs: opts.timeoutMs,
        signal: opts.signal,
      })
      // 成功或未找到（确定判定）→ 不重试；parse_error 属瞬态 → 落入重试分支。
      if (result.ok || result.reason === 'not_found') return result
    } catch (e) {
      if (!(e instanceof OpacFetchError) || e.reason === 'aborted') throw e
    }
    if (attempt >= ENRICH_MAX_RETRIES) {
      throw new OpacFetchError(
        'network',
        `enrich fetch failed after ${attempt + 1} attempts (record ${record.id})`,
      )
    }
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, opts.backoffMs * 2 ** attempt)
    await promise
  }
}

export type SingleEnrichOutcome =
  | { kind: 'success'; context: EnrichmentContext }
  | { kind: 'not_found' }
  | { kind: 'failed' }

/**
 * 单条抓取（单条入口与批量编排共用）：成功 → 建议改动上下文（零写入）；
 * not_found/failed → 回写状态（含 providerId）并返回对应 kind；aborted 不回写。
 */
export async function enrichOneRecord(
  db: ReadGraphDB,
  record: CatalogRecord,
  book: Book,
  source: Source,
  opts: EnrichOptions = {},
): Promise<SingleEnrichOutcome> {
  const provider = getProvider(source.parserId)
  if (!provider) return { kind: 'failed' }
  const timeoutMs = opts.timeoutMs ?? ENRICH_TIMEOUT_MS
  const backoffMs = opts.backoffMs ?? ENRICH_BACKOFF_MS
  try {
    const result = await fetchDetailWithRetry(provider, record, book, {
      timeoutMs,
      backoffMs,
      signal: opts.signal,
    })
    if (!result.ok) {
      const status = result.reason === 'not_found' ? 'not_found' : 'failed'
      await writeEnrichmentStatus(db, record, status, provider.id)
      return { kind: status }
    }
    const { changes, warnings } = mapOpacDetail(result.detail, { book, record, source })
    return {
      kind: 'success',
      context: {
        recordId: record.id,
        providerId: provider.id,
        sourceUrl: result.sourceUrl,
        changes,
        warnings,
      },
    }
  } catch (e) {
    if (!(e instanceof OpacFetchError) || e.reason !== 'aborted') {
      await writeEnrichmentStatus(db, record, 'failed', provider.id)
    }
    return { kind: 'failed' }
  }
}

/**
 * 批量抓取编排（规格 §7）：并发上限（默认 4）、单请求超时（默认 10s）、
 * 失败指数退避重试（最多 2 次）；成功项产出 changes 队列（会话内存，不落库、
 * 不写状态）；not_found/failed 立即回写状态（含 providerId）、不触碰实体。
 */
export async function enrichCatalogRecords(
  db: ReadGraphDB,
  candidates: EnrichCandidate[],
  opts: EnrichOptions = {},
): Promise<EnrichSummary> {
  const summary: EnrichSummary = { successes: [], notFound: [], failed: [] }
  const concurrency = Math.max(1, opts.concurrency ?? ENRICH_CONCURRENCY)
  let done = 0
  const total = candidates.length
  let cursor = 0

  const runOne = async (candidate: EnrichCandidate): Promise<void> => {
    try {
      const outcome = await enrichOneRecord(db, candidate.record, candidate.book, candidate.source, opts)
      if (outcome.kind === 'success') {
        summary.successes.push({ record: candidate.record, book: candidate.book, context: outcome.context })
      } else if (outcome.kind === 'not_found') {
        summary.notFound.push(candidate.record)
      } else {
        summary.failed.push(candidate.record)
      }
    } catch {
      // 防御：enrichOneRecord 已捕获常规失败；这里兜底（如状态写库异常）。
      summary.failed.push(candidate.record)
    } finally {
      done++
      opts.onProgress?.(done, total)
    }
  }

  const worker = async (): Promise<void> => {
    while (cursor < candidates.length) {
      if (opts.signal?.aborted) return
      const candidate = candidates[cursor++]!
      await runOne(candidate)
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, () => worker()),
  )
  return summary
}
