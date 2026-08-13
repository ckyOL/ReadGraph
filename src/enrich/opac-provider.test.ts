// OPAC Provider 注册表与 szlibProvider 契约测试（opac-enrichment §12）。
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createOpacProviderRegistry, getProvider } from '@/enrich/opac-provider'
import { szlibProvider } from '@/enrich/providers/szlib'
import type { Book, CatalogRecord } from '@/types/entities'
import sample from '@/tests/fixtures/opac-detail-sample.json'

const book = (over: Partial<Book> = {}): Book => ({
  id: 'bk-1',
  isbn13: null,
  isbn10: null,
  title: '合成绘本甲',
  subtitle: null,
  authors: [],
  translators: [],
  publisher: null,
  publishDate: null,
  edition: null,
  pages: null,
  price: null,
  subjects: [],
  tags: [],
  coverUrl: null,
  description: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  needsReview: false,
  materialType: 'book',
  sourceIds: ['src-1'],
  parallelTitles: [],
  ...over,
})

const record = (over: Partial<CatalogRecord> = {}): CatalogRecord => ({
  id: 'cr-1',
  bookId: 'bk-1',
  sourceId: 'src-1',
  metaId: 6092919,
  metaIdKey: '6092919',
  barcodes: ['D1200000001'],
  classifications: [],
  volume: null,
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  opacEnrichment: null,
  ...over,
})

describe('OpacProvider 注册表', () => {
  it('getProvider("szlib") 命中默认注册的 szlibProvider', () => {
    expect(getProvider('szlib')).toBe(szlibProvider)
  })

  it('未注册 id（libby/manual 等）→ null，不抛', () => {
    expect(getProvider('libby')).toBeNull()
    expect(getProvider('manual')).toBeNull()
    expect(() => getProvider('no-such-parser')).not.toThrow()
  })

  it('隔离注册表：空表 miss，register/unregister 生效', () => {
    const reg = createOpacProviderRegistry()
    expect(reg.getProvider('szlib')).toBeNull()
    reg.register(szlibProvider)
    expect(reg.getProvider('szlib')).toBe(szlibProvider)
    expect(reg.size()).toBe(1)
    reg.unregister('szlib')
    expect(reg.getProvider('szlib')).toBeNull()
    expect(reg.size()).toBe(0)
  })
})

describe('szlibProvider 契约', () => {
  it('id/lookupKey/displayName/shortName 声明正确', () => {
    expect(szlibProvider.id).toBe('szlib')
    expect(szlibProvider.lookupKey).toBe('metaId')
    expect(szlibProvider.displayName.length).toBeGreaterThan(0)
    expect(szlibProvider.shortName?.length).toBeGreaterThan(0)
  })

  it('detailUrl 含 metaid 与 tablename=bibliosm（§3.1）', () => {
    expect(szlibProvider.detailUrl(record(), book())).toBe(
      'https://www.szlib.org.cn/opac/searchDetail?tablename=bibliosm&recordid=6092919',
    )
  })

  it('detailUrl：metaId 空/0 → null', () => {
    expect(szlibProvider.detailUrl(record({ metaId: null, metaIdKey: null }), book())).toBeNull()
    expect(szlibProvider.detailUrl(record({ metaId: 0, metaIdKey: null }), book())).toBeNull()
  })
})

describe('szlibProvider.fetchDetail', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('URL 构造（metaTable/client_id）+ 响应解析 + sourceUrl（§3.2）', async () => {
    const fetchMock = vi.fn(async (_url: string) => ({ text: async () => JSON.stringify(sample) }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await szlibProvider.fetchDetail(record(), book(), { timeoutMs: 10_000 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toBe(
      'https://www.szlib.org.cn/api/opacservice/getBookDetail?metaTable=bibliosm&metaId=6092919&client_id=t1',
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.sourceUrl).toBe(url)
      expect(r.detail.title).toBe('合成绘本甲=Synthetic story')
      expect(r.detail.isbn).toBe('978-7-5217-4823-9')
    }
  })

  it('metaId 空/0 → not_found，不发请求', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(
      await szlibProvider.fetchDetail(record({ metaId: null, metaIdKey: null }), book(), {
        timeoutMs: 10_000,
      }),
    ).toEqual({ ok: false, reason: 'not_found' })
    expect(
      await szlibProvider.fetchDetail(record({ metaId: 0, metaIdKey: null }), book(), {
        timeoutMs: 10_000,
      }),
    ).toEqual({ ok: false, reason: 'not_found' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('空负载 → not_found；非法 JSON → parse_error（经传输基元转发）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ text: async () => JSON.stringify({ title: '', isbn: '', districtList: [] }) })),
    )
    expect(await szlibProvider.fetchDetail(record(), book(), { timeoutMs: 10_000 })).toEqual({
      ok: false,
      reason: 'not_found',
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => '{{{' })))
    expect(await szlibProvider.fetchDetail(record(), book(), { timeoutMs: 10_000 })).toEqual({
      ok: false,
      reason: 'parse_error',
    })
  })
})
