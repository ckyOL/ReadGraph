// 单条抓取测试（opac-enrichment 规格 §12 enrich-service.test.ts；UI 里程碑补）。
// 候选判定、超时/网络错误 → failed 回写（含 providerId）且实体不变、重试退避、
// not_found 回写、成功零实体/零状态写入、幂等跳过。批量编排已删除（§1）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReadGraphDB } from '@/db/db'
import { closeTestDB, createTestDB, makeBook, makeCatalog, makeSource } from '@/db/test-helpers'
import { defaultOpacRegistry, type OpacProvider } from '@/enrich/opac-provider'
import {
  enrichOneRecord,
  isEnrichmentCandidate,
} from '@/enrich/enrich-service'
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

  it('metaId 字符串 "0"（导入形态）排除，不放行抓取（与数值 0 同语义）', () => {
    // metaIdKey='0' 非空仍不满足：metaId 为 '0' 视为无效反查键（R4 缺陷回归）
    expect(isEnrichmentCandidate(szRecord({ metaId: '0' }), book, source)).toBe(false)
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

  it('已 fetched 不排除（可重新抓取，opac-enrichment §6 修订）', () => {
    const fetched = szRecord({
      opacEnrichment: {
        providerId: 'szlib',
        status: 'fetched',
        fetchedAt: now(),
        sourceUrl: 'https://example.test/',
      },
    })
    expect(isEnrichmentCandidate(fetched, book, source)).toBe(true)
  })

  it('占位 Book（needsReview=true 且占位书名）排除（§7.1）', () => {
    expect(
      isEnrichmentCandidate(record, szBook({ needsReview: true, title: '福田图书馆读者自选图书' }), source),
    ).toBe(false)
    // 书名正常但待审（套装候选等）→ 仍可补全
    expect(isEnrichmentCandidate(record, szBook({ needsReview: true }), source)).toBe(true)
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

  it('OPAC 响应含 HTML 实体 → 解码后与库中已解码值一致，不误判 conflict', async () => {
    // 库中标题为导入管线解码后的形态（szlib parser 已解 `&apos;`）；OPAC 响应为
    // 未解码原文——补全路径必须复用同一 decodeHtmlEntities，否则同值误判 conflict。
    const decodedBook = szBook({
      title: "The Book Lovers' Miscellany",
      isbn13: '9787521748239',
    })
    stubFetchText(
      JSON.stringify({
        ...sample,
        title: 'The Book Lovers&apos; Miscellany',
        author: 'Tom &amp; Jerry 著',
      }),
    )
    const outcome = await enrichOneRecord(db, record, decodedBook, source, { backoffMs: 1 })
    expect(outcome.kind).toBe('success')
    if (outcome.kind !== 'success') return
    // title 解码后与库中一致 → 不产出 title change（无乱套）；authors 建议值已解码
    // （`&amp;` → `&`；parseTitle 视 `&` 为责任者分隔符拆开，属其既有语义）。
    expect(outcome.context.changes.find((c) => c.field === 'title')).toBeUndefined()
    const authorChange = outcome.context.changes.find((c) => c.field === 'authors')
    expect(authorChange?.kind).toBe('conflict')
    expect(authorChange?.proposed).toEqual(['Tom', '&', 'Jerry'])
    expect(JSON.stringify(outcome.context)).not.toContain('&apos;')
    expect(JSON.stringify(outcome.context)).not.toContain('&amp;')
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

  it('状态回写失败（Dexie 写抛错）→ 返回 { kind: "failed" } 且不抛异常（不逸出契约）', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const putSpy = vi.spyOn(db.catalogRecords, 'put').mockRejectedValue(new Error('dexie write failed'))
    try {
      await expect(enrichOneRecord(db, record, book, source, { backoffMs: 1 })).resolves.toEqual({
        kind: 'failed',
      })
      // 写失败未落库：实体与 opacEnrichment 均未变更
      expect((await db.catalogRecords.get('cr-1'))?.opacEnrichment).toBeNull()
    } finally {
      putSpy.mockRestore()
    }
  })

  it('not_found 状态回写失败 → 不抛异常，返回 { kind: "failed" }（不逸出契约）', async () => {
    stubFetchText(JSON.stringify(EMPTY_PAYLOAD))
    const putSpy = vi.spyOn(db.catalogRecords, 'put').mockRejectedValue(new Error('dexie write failed'))
    try {
      await expect(enrichOneRecord(db, record, book, source, { backoffMs: 1 })).resolves.toEqual({
        kind: 'failed',
      })
      expect((await db.catalogRecords.get('cr-1'))?.opacEnrichment).toBeNull()
    } finally {
      putSpy.mockRestore()
    }
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

  it('fetched 记录重抓失败 → 状态不降级（保留已应用事实，§6）', async () => {
    const fetched = szRecord({
      opacEnrichment: {
        providerId: 'szlib',
        status: 'fetched',
        fetchedAt: now(),
        sourceUrl: 'https://example.test/',
      },
    })
    await db.catalogRecords.put(fetched)
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const outcome = await enrichOneRecord(db, fetched, book, source, { backoffMs: 1 })
    expect(outcome).toEqual({ kind: 'failed' })
    const after = await db.catalogRecords.get('cr-1')
    expect(after?.opacEnrichment).toEqual({
      providerId: 'szlib',
      status: 'fetched',
      fetchedAt: now(),
      sourceUrl: 'https://example.test/',
    })
  })

  it('套装 Book（≥2 卷结构化）抓取 → isSetBook 派生，价格建议用套价（metaid=6560072 形态）', async () => {
    const crA = szRecord({ id: 'cr-a', volume: '3' })
    const crB = szRecord({ id: 'cr-b', volume: '4' })
    await db.catalogRecords.bulkPut([crA, crB])
    stubFetchText(JSON.stringify({ ...sample, price: 'CNY27.00(套CNY80.00)' }))
    const outcome = await enrichOneRecord(db, crA, book, source, { backoffMs: 1 })
    expect(outcome.kind).toBe('success')
    if (outcome.kind !== 'success') return
    expect(outcome.context.changes.find((c) => c.field === 'price')).toEqual({
      field: 'price',
      kind: 'fill',
      current: null,
      proposed: { amount: 80, currency: 'CNY' },
    })
  })

  it('非套装单编目抓取 → 价格建议用主价（卷价）', async () => {
    stubFetchText(JSON.stringify({ ...sample, price: 'CNY27.00(套CNY80.00)' }))
    const outcome = await enrichOneRecord(db, record, book, source, { backoffMs: 1 })
    expect(outcome.kind).toBe('success')
    if (outcome.kind !== 'success') return
    expect(outcome.context.changes.find((c) => c.field === 'price')?.proposed).toEqual({
      amount: 27,
      currency: 'CNY',
    })
  })
})
