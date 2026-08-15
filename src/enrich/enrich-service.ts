// OPAC 补全单条抓取（opac-enrichment 规格 §7，2026-08 详情页逐本工作流）。
// 批量编排与候选集聚合（enrichCatalogRecords/collectCandidates/groupCandidatesByProvider/
// countPlaceholderExcluded）已随批量入口删除——补全唯一路径是详情页单条（enrichOneRecord），
// 成功产出建议改动上下文（零写入），not_found/failed 仅回写状态（含 providerId）。
// 应用阶段（用户驱动、复用统一编辑表单）见 routes/library/-edit-dialog.tsx。
import { z } from 'zod'

import type { ReadGraphDB } from '@/db/db'
import { catalogRecordSchema } from '@/db/schemas'
import { parseTitle } from '@/lib/title'
import { reviewBadgeOf } from '@/lib/book-status'
import type { Book, CatalogRecord, ParseWarning, Source } from '@/types/entities'
import { mapOpacDetail, type EnrichmentChange } from '@/lib/opac-mapping'
import { OpacFetchError } from './opac-client'
import { getProvider, type OpacDetailResult, type OpacProvider } from './opac-provider'
import { metaIdIsEmpty } from './providers/szlib'

/** 单请求超时（规格 §7）。 */
export const ENRICH_TIMEOUT_MS = 10_000
/** 失败指数退避基数；最多重试 2 次（共 3 次尝试）。 */
const ENRICH_BACKOFF_MS = 200
const ENRICH_MAX_RETRIES = 2

/** 建议改动上下文（详情页组件态，不落 URL、不落库）：抓取结果 → 编辑表单预填。 */
export interface EnrichmentContext {
  recordId: string
  providerId: string
  sourceUrl: string
  changes: EnrichmentChange[]
  warnings: ParseWarning[]
}

export interface EnrichOptions {
  timeoutMs?: number
  backoffMs?: number
  signal?: AbortSignal
}

/** lookupKey 对应字段是否满足（§7 候选集第 2 条）：'metaId' → metaIdKey 非空且 metaId≠0；'isbn13' → Book.isbn13 非空。 */
export function hasLookupKey(record: CatalogRecord, book: Book, provider: OpacProvider): boolean {
  if (provider.lookupKey === 'metaId') {
    return record.metaIdKey != null && record.metaIdKey !== '' && !metaIdIsEmpty(record.metaId)
  }
  return book.isbn13 != null && book.isbn13 !== ''
}

/**
 * 候选判定（规格 §7，详情页按钮可见性）：provider 注册表命中；lookupKey 对应字段满足；
 * 占位 Book（needsReview=true 且占位书名）排除（§7.1）。
 * 已 fetched **不排除**（§6 修订）：可重新抓取（纠错/解析规则升级后重拉）；not_found/failed 可重试。
 */
export function isEnrichmentCandidate(record: CatalogRecord, book: Book, source: Source): boolean {
  const provider = getProvider(source.parserId)
  if (!provider) return false
  if (book.needsReview && parseTitle(book.title).isPlaceholder) return false
  return hasLookupKey(record, book, provider)
}

function validated<S extends z.ZodType>(schema: S, value: z.input<S>): z.output<S> {
  const r = schema.safeParse(value)
  if (!r.success) throw r.error
  return r.data
}

/** 回写抓取状态（规格 §7）：not_found/failed 仅回写 opacEnrichment，不触碰实体。
 *  已 fetched 记录不降级（§6）：重抓失败/未找到保留已应用事实，避免误覆盖补全审计。 */
export async function writeEnrichmentStatus(
  db: ReadGraphDB,
  record: CatalogRecord,
  status: 'not_found' | 'failed',
  providerId: string,
): Promise<void> {
  const current = await db.catalogRecords.get(record.id)
  if (!current) return
  if (current.opacEnrichment?.status === 'fetched') return
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
 * 单条抓取（详情页唯一路径）：成功 → 建议改动上下文（零写入，落详情页组件态）；
 * not_found/failed → 回写状态（含 providerId）并返回对应 kind；aborted 不回写。
 * 状态回写失败不逸出：记日志后仍返回 failed（enrichOneRecord 不抛错契约）。
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
    // §5.2 套价规则：按该书全部编目派生 isSetBook（套装候选或 ≥2 卷结构化，book-editing §10.2）。
    const records = await db.catalogRecords.where('bookId').equals(book.id).toArray()
    const isSetBook = reviewBadgeOf(book, book.id, records) === 'set'
    const { changes, warnings } = mapOpacDetail(result.detail, { book, record, source, isSetBook })
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
      try {
        await writeEnrichmentStatus(db, record, 'failed', provider.id)
      } catch (writeErr) {
        // 状态回写失败不逸出（enrichOneRecord 不抛错契约）：记日志，仍返回 failed。
        // eslint-disable-next-line no-console
        console.error('[enrich] failed to write enrichment status:', writeErr)
      }
    }
    return { kind: 'failed' }
  }
}
