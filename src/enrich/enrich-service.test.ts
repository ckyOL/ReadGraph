// 抓取编排测试（opac-enrichment 规格 §12 enrich-service.test.ts；UI 里程碑补）。
// 候选集过滤、并发上限、超时/网络错误 → failed 回写（含 providerId）且实体不变、
// 重试退避、not_found 回写、成功项零实体/零状态写入、幂等跳过。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReadGraphDB } from '@/db/db'
import { closeTestDB, createTestDB, makeBook, makeCatalog, makeSource } from '@/db/test-helpers'
import { defaultOpacRegistry, type OpacProvider } from '@/enrich/opac-provider'
import {
  collectCandidates,
  enrichCatalogRecords,
  enrichOneRecord,
  groupCandidatesByProvider,
  isEnrichmentCandidate,
} from '@/enrich/enrich-service'
import { setPendingEnrichment, takePendingEnrichment } from '@/enrich/enrich-session'
import type { Book, CatalogRecord, Source } from '@/types/entities'
import sample from '@/tests/fixtures/opac-detail-sample.json'

let db: ReadGraphDB
beforeEach(() => {
  db = createTestDB()
})
afterEach(() => {
  closeTestDB(db)
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const now = () => new Date('2026-01-01T00:00:00Z')

const szSource = (over: Partial<Source> = {}): Source => ({
  ...makeSource('src-szlib'),
  parserId: 'szlib',
  name: '深圳图书馆',
  ...over,
})

const szBook = (over: Partial<Book> = {}): Book => ({
  ...makeBook('bk-1', null, '合成绘本甲'),
  sourceIds: ['src-szlib'],
  ...over,
})

const szRecord = (over: Partial<CatalogRecord> = {}): CatalogRecord => ({
  ...makeCatalog('cr-1', 'bk-1', 'src-szlib', 'BC1', 6092919),
  ...over,
})

const source = szSource()
const book = szBook()
const record = szRecord()

/** 空负载（§3.4 未找到形态）。 */
const EMPTY_PAYLOAD = {
  title: '',
  author: '',
  publish: '',
  page: '',
  price: '',
  subject: '',
  classno: '',
  abstract: '',
  abstracts: '',
  isPreloan: false,
  isbn: '',
  img: '',
  districtList: [],
  CanLoanBook: [],
  OnlyReadBook: [],
  BorrowedBook: [],
}

function stubFetchText(text: string) {
  const fn = vi.fn(async () => ({ text: async () => text }))
  vi.stubGlobal('fetch', fn)
  return fn
}

/** 隔离测试用 isbn13 键 provider（未来 OpenLibrary 形态，仅本文件注册）。 */
const isbn13Provider: OpacProvider = {
  id: 'openlib-ol',
  displayName: 'OpenLibrary',
  lookupKey: 'isbn13',
  detailUrl: () => null,
  fetchDetail: () => Promise.reject(new Error('unused')),
}

describe('候选集过滤（§7 候选集 + §7.1 占位）', () => {
  it('provider 未注册来源（manual/libby）排除', () => {
    expect(isEnrichmentCandidate(szRecord(), szBook(), szSource({ parserId: 'manual' }))).toBe(false)
  })

  it('metaId 键：metaIdKey 空或 metaId=0 排除；有效 metaid 命中', () => {
    expect(isEnrichmentCandidate(szRecord({ metaIdKey: null, metaId: null }), book, source)).toBe(false)
    expect(isEnrichmentCandidate(szRecord({ metaIdKey: '', metaId: 123 }), book, source)).toBe(false)
    expect(isEnrichmentCandidate(szRecord({ metaId: 0, metaIdKey: '0' }), book, source)).toBe(false)
    expect(isEnrichmentCandidate(record, book, source)).toBe(true)
  })

  it('isbn13 键 provider（如未来 OpenLibrary）按 Book.isbn13 过滤', () => {
    defaultOpacRegistry.register(isbn13Provider)
    try {
      const ol = szSource({ parserId: 'openlib-ol' })
      expect(
        isEnrichmentCandidate(
          szRecord({ metaIdKey: null, metaId: null }),
          szBook({ isbn13: '9787521748239' }),
          ol,
        ),
      ).toBe(true)
      expect(isEnrichmentCandidate(szRecord(), szBook({ isbn13: null }), ol)).toBe(false)
    } finally {
      defaultOpacRegistry.unregister('openlib-ol')
    }
  })

  it('已 fetched 排除（幂等跳过）', () => {
    const fetched = szRecord({
      opacEnrichment: {
        providerId: 'szlib',
        status: 'fetched',
        fetchedAt: now(),
        sourceUrl: 'https://example.test/',
      },
    })
    expect(isEnrichmentCandidate(fetched, book, source)).toBe(false)
  })

  it('占位 Book（needsReview=true 且占位书名）排除（§7.1）', () => {
    expect(
      isEnrichmentCandidate(record, szBook({ needsReview: true, title: '福田图书馆读者自选图书' }), source),
    ).toBe(false)
    // 书名正常但待审（套装候选等）→ 仍可补全
    expect(isEnrichmentCandidate(record, szBook({ needsReview: true }), source)).toBe(true)
  })

  it('collectCandidates 跨表组装；groupCandidatesByProvider 按 provider 分组', () => {
    const libbySource = szSource({ id: 'src-libby', parserId: 'libby', name: 'Libby' })
    const libbyBook = szBook({ id: 'bk-2', title: '合成电子书' })
    const libbyRecord = szRecord({ id: 'cr-2', bookId: 'bk-2', sourceId: libbySource.id })
    const candidates = collectCandidates(
      [book, libbyBook],
      [record, libbyRecord],
      [source, libbySource],
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0]!.record.id).toBe('cr-1')
    const groups = groupCandidatesByProvider(candidates)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.provider.id).toBe('szlib')
    expect(groups[0]!.candidates).toHaveLength(1)
  })
})

describe('单条抓取 enrichOneRecord', () => {
  beforeEach(async () => {
    await db.catalogRecords.put(record)
  })

  it('成功 → 建议改动上下文（changes 非空），零实体/零状态写入', async () => {
    stubFetchText(JSON.stringify(sample))
    const outcome = await enrichOneRecord(db, record, book, source, { backoffMs: 1 })
    expect(outcome.kind).toBe('success')
    if (outcome.kind !== 'success') return
    expect(outcome.context.providerId).toBe('szlib')
    expect(outcome.context.recordId).toBe('cr-1')
    expect(outcome.context.sourceUrl).toContain('/api/opacservice/getBookDetail')
    expect(outcome.context.changes.length).toBeGreaterThan(0)
    // 夹具书 title 已与 OPAC 一致 → 不产出 title change（相同不产出，§5.2）；
    // parallelTitles（fill）与 authors（conflict）应存在。
    expect(outcome.context.changes.map((c) => c.field)).toContain('parallelTitles')
    expect(outcome.context.changes.map((c) => c.field)).toContain('authors')
    expect(outcome.context.changes.find((c) => c.field === 'authors')?.kind).toBe('conflict')
    expect(outcome.context.warnings).toEqual([])
    const after = await db.catalogRecords.get('cr-1')
    expect(after?.opacEnrichment).toBeNull()
    expect(after?.barcodes).toEqual(['BC1'])
  })

  it('not_found → 回写 status=not_found（含 providerId），实体不变，不重试', async () => {
    const fn = stubFetchText(JSON.stringify(EMPTY_PAYLOAD))
    const outcome = await enrichOneRecord(db, record, book, source, { backoffMs: 1 })
    expect(outcome).toEqual({ kind: 'not_found' })
    expect(fn).toHaveBeenCalledTimes(1)
    const after = await db.catalogRecords.get('cr-1')
    expect(after?.opacEnrichment).toEqual({
      providerId: 'szlib',
      status: 'not_found',
      fetchedAt: null,
      sourceUrl: null,
    })
    expect(after?.barcodes).toEqual(['BC1'])
  })

  it('网络/CORS 失败 → 重试退避（3 次尝试）后 failed 回写；aborted 不回写', async () => {
    const fn = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fn)
    const outcome = await enrichOneRecord(db, record, book, source, { backoffMs: 1 })
    expect(outcome).toEqual({ kind: 'failed' })
    expect(fn).toHaveBeenCalledTimes(3)
    const after = await db.catalogRecords.get('cr-1')
    expect(after?.opacEnrichment).toEqual({
      providerId: 'szlib',
      status: 'failed',
      fetchedAt: null,
      sourceUrl: null,
    })
    // aborted：用户取消，不回写状态
    const ctrl = new AbortController()
    const fn2 = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')))
    vi.stubGlobal('fetch', fn2)
    ctrl.abort()
    const cr2 = szRecord({ id: 'cr-2' })
    await db.catalogRecords.put(cr2)
    const outcome2 = await enrichOneRecord(db, cr2, book, source, {
      backoffMs: 1,
      signal: ctrl.signal,
    })
    expect(outcome2).toEqual({ kind: 'failed' })
    expect((await db.catalogRecords.get('cr-2'))?.opacEnrichment).toBeNull()
  })

  it('失败两次后成功 → 第 3 次尝试成功，不写状态', async () => {
    let calls = 0
    const fn = vi.fn(async () => {
      calls++
      if (calls <= 2) throw new TypeError('Failed to fetch')
      return { text: async () => JSON.stringify(sample) }
    })
    vi.stubGlobal('fetch', fn)
    const outcome = await enrichOneRecord(db, record, book, source, { backoffMs: 1 })
    expect(outcome.kind).toBe('success')
    expect(calls).toBe(3)
    expect((await db.catalogRecords.get('cr-1'))?.opacEnrichment).toBeNull()
  })

  it('parse_error（非法 JSON）→ 重试后 failed 回写', async () => {
    const fn = stubFetchText('{{{')
    const outcome = await enrichOneRecord(db, record, book, source, { backoffMs: 1 })
    expect(outcome).toEqual({ kind: 'failed' })
    expect(fn).toHaveBeenCalledTimes(3)
    expect((await db.catalogRecords.get('cr-1'))?.opacEnrichment?.status).toBe('failed')
  })
})

describe('批量编排 enrichCatalogRecords', () => {
  it('并发上限 4 生效；成功/未找到/失败计数正确；进度回调受控递增', async () => {
    let active = 0
    let maxActive = 0
    const gates: Array<{ promise: Promise<void>; resolve: () => void }> = []
    const texts = new Map<string, string>([
      ['1', JSON.stringify(sample)],
      ['2', JSON.stringify(sample)],
      ['3', JSON.stringify(sample)],
      ['4', JSON.stringify(EMPTY_PAYLOAD)],
    ])
    // cr-5/cr-6 立即失败（触发退避重试）；cr-1..4 挂起直到测试释放门闩——
    // 门闩驱动并发断言（确定性，不依赖真实时钟）。
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        active++
        maxActive = Math.max(maxActive, active)
        const id = /metaId=(\d+)/.exec(url)?.[1] ?? ''
        if (id === '5' || id === '6') {
          active--
          return Promise.reject(new TypeError('Failed to fetch'))
        }
        const { promise, resolve } = Promise.withResolvers<void>()
        gates.push({ promise, resolve })
        return promise.then(() => {
          active--
          return { text: async () => texts.get(id) ?? JSON.stringify(sample) }
        })
      }),
    )
    const records = [1, 2, 3, 4, 5, 6].map((n) =>
      szRecord({ id: `cr-${n}`, metaId: n, metaIdKey: String(n) }),
    )
    await db.catalogRecords.bulkPut(records)
    const progress: number[] = []
    const pending = enrichCatalogRecords(
      db,
      records.map((r) => ({ record: r, book, source })),
      { backoffMs: 1, onProgress: (done, total) => progress.push(done / total) },
    )
    // 第一波：并发上限内恰好起 4 个请求，第 5/6 个必须排队等待。
    await vi.waitFor(() => expect(gates.length).toBe(4))
    expect(active).toBe(4)
    // 释放第一波（3 成功 + 1 未找到）→ 剩余 2 个候选（失败路径）随后完成。
    for (const g of gates.splice(0)) g.resolve()
    const summary = await pending
    expect(maxActive).toBeLessThanOrEqual(4)
    expect(summary.successes).toHaveLength(3)
    expect(summary.notFound).toHaveLength(1)
    expect(summary.failed).toHaveLength(2)
    expect(progress).toEqual([1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6, 1])
    expect((await db.catalogRecords.get('cr-4'))?.opacEnrichment?.status).toBe('not_found')
    expect((await db.catalogRecords.get('cr-5'))?.opacEnrichment?.status).toBe('failed')
    expect((await db.catalogRecords.get('cr-1'))?.opacEnrichment).toBeNull()
  })

  it('空候选集 → 空摘要，不发请求', async () => {
    const fn = vi.fn()
    vi.stubGlobal('fetch', fn)
    const summary = await enrichCatalogRecords(db, [], { backoffMs: 1 })
    expect(summary).toEqual({ successes: [], notFound: [], failed: [] })
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('enrich-session 会话传递', () => {
  it('set 后 take 读取并清空；未设置 → null', () => {
    expect(takePendingEnrichment()).toBeNull()
    setPendingEnrichment({
      recordId: 'cr-1',
      providerId: 'szlib',
      sourceUrl: 'https://example.test/',
      changes: [],
      warnings: [],
    })
    expect(takePendingEnrichment()?.recordId).toBe('cr-1')
    expect(takePendingEnrichment()).toBeNull()
  })
})
