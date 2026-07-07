import { describe, it, expect } from 'vitest'

import type { Book, CatalogRecord } from '@/types/entities'
import { dedupeCatalogsAndBooks, dedupeBorrowCycles } from './dedupe'
import { szlibParser } from './szlib'

type DedupeState = {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: never[]
}

function mkBook(p: Partial<Book>): Book {
  return {
    id: 'bk-existing',
    isbn13: null,
    isbn10: null,
    title: '',
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
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    needsReview: false,
    sourceIds: [],
    parallelTitles: [],
    ...p,
  } as Book
}

function mkCatalog(p: Partial<CatalogRecord>): CatalogRecord {
  return {
    id: 'cr-existing',
    bookId: 'bk-existing',
    sourceId: 'szlib',
    metaId: null,
    metaIdKey: null,
    barcodes: [],
    classifications: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...p,
  } as CatalogRecord
}

describe('dedupeCatalogsAndBooks', () => {
  it('编目级 sourceId+barcode 命中：沿用 existing bookId', () => {
    const existing: DedupeState = {
      books: [mkBook({ id: 'bk-A', isbn13: '97877521748239' })],
      catalogRecords: [mkCatalog({ id: 'cr-A', bookId: 'bk-A', barcodes: ['B1'] })],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'szlib', barcodes: ['B1'], metaIdKey: null },
          bookPartial: { isbn13: '97877521748239', title: 'A', sourceIds: ['szlib'] },
          isPlaceholder: false,
        },
      ],
      ['B1'],
      existing,
      szlibParser,
    )
    expect(r.bookIdByBarcode.get('B1')).toBe('bk-A')
    expect(r.warnings).toEqual([])
  })

  it('ISBN 命中：新 CatalogRecord 挂到 existing Book', () => {
    const existing: DedupeState = {
      books: [mkBook({ id: 'bk-ISBN', isbn13: '97877116000009' })],
      catalogRecords: [],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'szlib', barcodes: ['B9'], metaIdKey: '7000001' },
          bookPartial: { isbn13: '97877116000009', title: '合成编程指南', sourceIds: ['szlib'] },
          isPlaceholder: false,
        },
      ],
      ['B9'],
      existing,
      szlibParser,
    )
    expect(r.bookIdByBarcode.get('B9')).toBe('bk-ISBN')
  })

  it('无 ISBN 模糊命中（title+author）置 needsReview 并记 duplicate 警告', () => {
    const existing: DedupeState = {
      books: [
        mkBook({ id: 'bk-fuzzy', isbn13: null, title: '合成图解手册', authors: ['合成作者乙'] }),
      ],
      catalogRecords: [],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'szlib', barcodes: ['BX'], metaIdKey: '42' },
          bookPartial: { isbn13: null, title: '合成图解手册', authors: ['合成作者乙'], sourceIds: ['szlib'] },
          isPlaceholder: false,
        },
      ],
      ['BX'],
      existing,
      szlibParser,
    )
    expect(r.bookIdByBarcode.get('BX')).toBe('bk-fuzzy')
    expect(r.warnings.some((w) => w.type === 'duplicate')).toBe(true)
  })

  it('选书帮分支：各 barcode 独立、不与 existing 合并（含其它选书帮 Book）', () => {
    const existing: DedupeState = {
      books: [mkBook({ id: 'bk-ph-old', needsReview: true, title: '福田图书馆读者自选图书' })],
      catalogRecords: [],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        { partial: { sourceId: 'szlib', barcodes: ['PH1'] }, bookPartial: { title: '福田图书馆读者自选图书', needsReview: true, isbn13: null }, isPlaceholder: true },
        { partial: { sourceId: 'szlib', barcodes: ['PH2'] }, bookPartial: { title: '福田图书馆读者自选图书', needsReview: true, isbn13: null }, isPlaceholder: true },
      ],
      ['PH1', 'PH2'],
      existing,
      szlibParser,
    )
    expect(r.bookIdByBarcode.get('PH1')).not.toBe('bk-ph-old')
    expect(r.bookIdByBarcode.get('PH2')).not.toBe('bk-ph-old')
    expect(r.bookIdByBarcode.get('PH1')).not.toBe(r.bookIdByBarcode.get('PH2'))
  })
})

describe('dedupeBorrowCycles', () => {
  const t = new Date('2026-05-01T01:00:00.000Z')
  const t2 = new Date('2026-06-01T02:00:00.000Z')

  it('精确重复（sourceId+barcode+borrowedAt）跳过，记 duplicate 警告', () => {
    const existing = [{ id: 'cy-1', bookId: 'bk', catalogRecordId: 'cr', sourceId: 'szlib', barcode: 'B1', borrowedAt: t, returnedAt: t2, status: 'returned' as const, borrowLocation: null, returnLocation: null, rawRecordIds: ['r1'], createdAt: t, updatedAt: t }]
    const r = dedupeBorrowCycles(
      [{ sourceId: 'szlib', barcode: 'B1', borrowedAt: t, returnedAt: t2, status: 'returned', borrowLocation: null, returnLocation: null, rawRecordIds: ['r2'] }],
      existing,
    )
    expect(r.skippedFlags).toEqual([true])
    expect(r.cycles.length).toBe(1)
    expect(r.warnings.some((w) => w.type === 'duplicate')).toBe(true)
  })

  it('时间重叠（同 barcode 同 borrowedAt 但 status 返回）记 unpaired_record', () => {
    const existing = [{ id: 'cy-1', bookId: 'bk', catalogRecordId: 'cr', sourceId: 'szlib', barcode: 'B1', borrowedAt: t, returnedAt: t2, status: 'returned' as const, borrowLocation: null, returnLocation: null, rawRecordIds: ['r1'], createdAt: t, updatedAt: t }]
    const tMid = new Date('2026-05-15T01:00:00.000Z')
    const r = dedupeBorrowCycles(
      [{ sourceId: 'szlib', barcode: 'B1', borrowedAt: tMid, returnedAt: null, status: 'borrowed', borrowLocation: null, returnLocation: null, rawRecordIds: ['r3'] }],
      existing,
    )
    expect(r.skippedFlags).toEqual([false])
    expect(r.warnings.some((w) => w.type === 'unpaired_record')).toBe(true)
  })
})
