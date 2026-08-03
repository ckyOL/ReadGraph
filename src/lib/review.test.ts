// review 规格 §2/§4/§8：待审派生模型单测。
import { describe, it, expect } from 'vitest'

import type { Book, BorrowCycle, CatalogRecord, RawRecord } from '@/types/entities'
import {
  buildReviewRows,
  catalogTitleByRecord,
  filterReviewRows,
  isSetBook,
  reviewKindOf,
} from './review'

function mkBook(over: Partial<Book>): Book {
  return {
    id: 'bk-1',
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
    ...over,
  }
}

function mkCr(over: Partial<CatalogRecord>): CatalogRecord {
  return {
    id: 'cr-1',
    bookId: 'bk-1',
    sourceId: 'szlib',
    metaId: null,
    metaIdKey: null,
    barcodes: [],
    classifications: [],
    volume: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...over,
  }
}

function mkCycle(over: Partial<BorrowCycle>): BorrowCycle {
  return {
    id: 'cy-1',
    bookId: 'bk-1',
    catalogRecordId: 'cr-1',
    sourceId: 'szlib',
    borrowedAt: new Date('2026-05-01T00:00:00.000Z'),
    returnedAt: null,
    status: 'borrowed',
    borrowLocation: null,
    returnLocation: null,
    rawRecordIds: [],
    barcode: null,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
    updatedAt: new Date('2026-05-01T00:00:00.000Z'),
    ...over,
  }
}

describe('reviewKindOf — 待审类型判定（派生不落库）', () => {
  it('needsReview=false → null（无论 ISBN）', () => {
    expect(reviewKindOf({ needsReview: false, isbn13: null })).toBeNull()
    expect(reviewKindOf({ needsReview: false, isbn13: '9780000000001' })).toBeNull()
  })
  it('needsReview=true && isbn13===null → placeholder（选书帮占位）', () => {
    expect(reviewKindOf({ needsReview: true, isbn13: null })).toBe('placeholder')
  })
  it('needsReview=true && isbn13!==null → set（套装候选）', () => {
    expect(reviewKindOf({ needsReview: true, isbn13: '9787574012745' })).toBe('set')
  })
})

describe('buildReviewRows — 列表聚合', () => {
  const placeholder = mkBook({ id: 'bk-ph', needsReview: true, isbn13: null, title: '福田图书馆读者自选图书' })
  const setBook = mkBook({ id: 'bk-set', needsReview: true, isbn13: '9787574012745', title: '合成书目052' })
  const reviewed = mkBook({ id: 'bk-done', needsReview: false, isbn13: '9780000000001', title: '已审' })
  const crs = [
    mkCr({ id: 'cr-ph1', bookId: 'bk-ph' }),
    mkCr({ id: 'cr-ph2', bookId: 'bk-ph' }),
    mkCr({ id: 'cr-set1', bookId: 'bk-set' }),
    mkCr({ id: 'cr-set2', bookId: 'bk-set' }),
  ]
  const cycles = [
    mkCycle({ id: 'cy-ph1', bookId: 'bk-ph', borrowedAt: new Date('2026-04-01T00:00:00.000Z') }),
    mkCycle({ id: 'cy-ph2', bookId: 'bk-ph', borrowedAt: new Date('2026-06-01T00:00:00.000Z') }),
    mkCycle({ id: 'cy-set1', bookId: 'bk-set', borrowedAt: new Date('2026-05-01T00:00:00.000Z') }),
  ]

  it('只聚合待审 Book，带编目数/借阅数/最近借阅', () => {
    const rows = buildReviewRows([placeholder, setBook, reviewed], crs, cycles)
    expect(rows).toHaveLength(2)
    const ph = rows.find((r) => r.book.id === 'bk-ph')!
    expect(ph.kind).toBe('placeholder')
    expect(ph.catalogCount).toBe(2)
    expect(ph.borrowCount).toBe(2)
    expect(ph.lastBorrowedAt!.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    const set = rows.find((r) => r.book.id === 'bk-set')!
    expect(set.kind).toBe('set')
    expect(set.borrowCount).toBe(1)
  })

  it('排序：占位在前；同类型按借阅次数降序', () => {
    const a = mkBook({ id: 'ph-a', needsReview: true, isbn13: null, title: 'A占位' })
    const b = mkBook({ id: 'ph-b', needsReview: true, isbn13: null, title: 'B占位' })
    const s1 = mkBook({ id: 'set-1', needsReview: true, isbn13: '9780000000001', title: 'S1' })
    const s2 = mkBook({ id: 'set-2', needsReview: true, isbn13: '9780000000002', title: 'S2' })
    const cycles2 = [
      mkCycle({ id: 'c1', bookId: 'ph-a' }),
      mkCycle({ id: 'c2', bookId: 'ph-a' }),
      mkCycle({ id: 'c3', bookId: 'set-2' }),
      mkCycle({ id: 'c4', bookId: 'set-2' }),
      mkCycle({ id: 'c5', bookId: 'set-2' }),
    ]
    const rows = buildReviewRows([s2, b, s1, a], [], cycles2)
    expect(rows.map((r) => r.book.id)).toEqual(['ph-a', 'ph-b', 'set-2', 'set-1'])
  })

  it('无待审 → 空数组', () => {
    expect(buildReviewRows([reviewed], crs, cycles)).toEqual([])
  })
})

describe('isSetBook — 套装判定（≥2 个 volume 非空编目）', () => {
  it('≥2 volume 编目 → true', () => {
    const crs = [
      mkCr({ bookId: 'bk-set', volume: '3' }),
      mkCr({ bookId: 'bk-set', volume: '4' }),
    ]
    expect(isSetBook('bk-set', crs)).toBe(true)
  })
  it('单卷/无卷 → false', () => {
    expect(isSetBook('bk-set', [mkCr({ bookId: 'bk-set', volume: '3' })])).toBe(false)
    expect(isSetBook('bk-set', [mkCr({ bookId: 'bk-set', volume: null })])).toBe(false)
    expect(isSetBook('bk-set', [mkCr({ bookId: 'bk-set', volume: '' })])).toBe(false)
  })
  it('volume 缺失（undefined，历史数据）按 null 处理 → false', () => {
    const legacy = mkCr({ bookId: 'bk-set' })
    delete (legacy as { volume?: unknown }).volume
    expect(isSetBook('bk-set', [legacy, legacy])).toBe(false)
  })
})

describe('filterReviewRows — Tabs 分流与搜索', () => {
  const ph = mkBook({ id: 'ph', needsReview: true, isbn13: null, title: '福田图书馆读者自选图书' })
  const set1 = mkBook({ id: 'set1', needsReview: true, isbn13: '9787574012745', title: '合成书目052' })
  const rows = buildReviewRows([set1, ph], [], [])

  it('all 全量；placeholder/set 各自分流', () => {
    expect(filterReviewRows(rows, 'all', '').map((r) => r.book.id)).toEqual(['ph', 'set1'])
    expect(filterReviewRows(rows, 'placeholder', '').map((r) => r.book.id)).toEqual(['ph'])
    expect(filterReviewRows(rows, 'set', '').map((r) => r.book.id)).toEqual(['set1'])
  })

  it('搜索按题名/ISBN 子串（大小写不敏感）', () => {
    expect(filterReviewRows(rows, 'all', '合成').map((r) => r.book.id)).toEqual(['set1'])
    expect(filterReviewRows(rows, 'all', '7574').map((r) => r.book.id)).toEqual(['set1'])
    expect(filterReviewRows(rows, 'set', '书目').map((r) => r.book.id)).toEqual(['set1'])
    expect(filterReviewRows(rows, 'all', '不存在')).toEqual([])
  })
})

describe('catalogTitleByRecord — 编目题名原文溯源', () => {
  const raws: RawRecord[] = [
    {
      id: 'raw-1',
      importLogId: 'log-1',
      sourceId: 'szlib',
      data: { metaid: 7109377, barcode: 'B3', title: '合成书目052 : 合成副题 52 . 3' },
      rowIndex: 1,
      borrowCycleId: null,
      bookId: 'bk-set',
      parseStatus: 'success',
      parseNote: null,
    },
    {
      id: 'raw-2',
      importLogId: 'log-1',
      sourceId: 'szlib',
      data: { metaid: 7109378, barcode: 'B4', title: '合成书目053 : 合成副题 53 . 4' },
      rowIndex: 2,
      borrowCycleId: null,
      bookId: 'bk-set',
      parseStatus: 'success',
      parseNote: null,
    },
    {
      id: 'raw-3',
      importLogId: 'log-1',
      sourceId: 'szlib',
      data: { metaid: 0, barcode: 'B5', title: '合成期刊', },
      rowIndex: 3,
      borrowCycleId: null,
      bookId: 'bk-other',
      parseStatus: 'success',
      parseNote: null,
    },
    {
      id: 'raw-4',
      importLogId: 'log-1',
      sourceId: 'szlib',
      data: { metaid: 0, barcode: 'B5', title: '合成无 meta 书目' },
      rowIndex: 4,
      borrowCycleId: null,
      bookId: 'bk-set',
      parseStatus: 'success',
      parseNote: null,
    },
  ]
  const crs = [
    mkCr({ id: 'cr-v3', bookId: 'bk-set', metaIdKey: '7109377', barcodes: ['B3'] }),
    mkCr({ id: 'cr-v4', bookId: 'bk-set', metaIdKey: '7109378', barcodes: ['B4'] }),
  ]

  it('按 metaIdKey 命中各自题名原文（不含 `/` 后责任区）', () => {
    const m = catalogTitleByRecord('bk-set', crs, raws)
    expect(m.get('cr-v3')).toBe('合成书目052 : 合成副题 52 . 3')
    expect(m.get('cr-v4')).toBe('合成书目053 : 合成副题 53 . 4')
  })

  it('责任者尾缀剥除：原始行含 `/ 著者` 时题名区仍可解析卷号', () => {
    const withResp: RawRecord[] = [
      {
        ...raws[0]!,
        data: { metaid: 7109377, barcode: 'B3', title: '合成书目052 : 合成副题 52 . 3/ 合成著者52著' },
      },
    ]
    const m = catalogTitleByRecord('bk-set', [crs[0]!], withResp)
    expect(m.get('cr-v3')).toBe('合成书目052 : 合成副题 52 . 3')
  })

  it('无 metaid 时按 barcode 匹配；无原始行 → 空串', () => {
    const noMeta = mkCr({ id: 'cr-bc', bookId: 'bk-set', metaIdKey: null, barcodes: ['B5'] })
    const orphan = mkCr({ id: 'cr-x', bookId: 'bk-set', metaIdKey: null, barcodes: ['NOPE'] })
    const m = catalogTitleByRecord('bk-set', [noMeta, orphan], raws)
    expect(m.get('cr-bc')).toBe('合成无 meta 书目')
    // 无任何匹配时兜底该书任一原始行标题（表单仍可改）。
    expect(m.get('cr-x')).toBe('合成无 meta 书目')
  })

  it('无原始行 → 空串', () => {
    const m = catalogTitleByRecord('bk-set', [mkCr({ id: 'cr-z', bookId: 'bk-set' })], [])
    expect(m.get('cr-z')).toBe('')
  })

  it('只考虑该书原始行（不串挂他书）', () => {
    const m = catalogTitleByRecord('bk-other', [mkCr({ id: 'cr-o', bookId: 'bk-other' })], raws)
    expect(m.get('cr-o')).toBe('合成期刊')
  })
})
