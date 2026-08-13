// book-editing 规格 §2/§5：待审派生模型单测（原 review.test.ts 迁移：删列表聚合，
// 增 reviewBadgeOf / filterBookByReviewType 书库承载断言）。
import { describe, it, expect } from 'vitest'

import type { Book, CatalogRecord, RawRecord } from '@/types/entities'
import {
  catalogTitleByRecord,
  filterBookByReviewType,
  isSetBook,
  reviewBadgeOf,
  reviewKindOf,
  setBookIdsOf,
} from './book-status'

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
    materialType: 'book',
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
    opacEnrichment: null,
    volume: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
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

describe('setBookIdsOf — 套装 id 批量集合', () => {
  it('≥2 卷编目的 Book 入集合，单卷/无卷不入', () => {
    const ids = setBookIdsOf([
      mkCr({ id: 'cr-a', bookId: 'bk-set', volume: '3' }),
      mkCr({ id: 'cr-b', bookId: 'bk-set', volume: '4' }),
      mkCr({ id: 'cr-c', bookId: 'bk-single', volume: '3' }),
      mkCr({ id: 'cr-d', bookId: 'bk-none' }),
    ])
    expect(ids).toEqual(new Set(['bk-set']))
  })

  it('空数组 → 空集合', () => {
    expect(setBookIdsOf([])).toEqual(new Set())
  })
})

describe('reviewBadgeOf — 书库列表状态徽标', () => {
  it('占位书 → placeholder', () => {
    const ph = mkBook({ id: 'bk-ph', needsReview: true, isbn13: null })
    expect(reviewBadgeOf(ph, 'bk-ph', [])).toBe('placeholder')
  })
  it('待审套装候选（isbn13 非空、volume 未填）→ set', () => {
    const cand = mkBook({ id: 'bk-c', needsReview: true, isbn13: '9787574012745' })
    expect(reviewBadgeOf(cand, 'bk-c', [mkCr({ bookId: 'bk-c', volume: null })])).toBe('set')
  })
  it('已结构化套装（needsReview=false、≥2 volume）→ set', () => {
    const done = mkBook({ id: 'bk-s', needsReview: false, isbn13: '9787574012745' })
    const crs = [
      mkCr({ bookId: 'bk-s', volume: '3' }),
      mkCr({ bookId: 'bk-s', volume: '4' }),
    ]
    expect(reviewBadgeOf(done, 'bk-s', crs)).toBe('set')
  })
  it('普通书（非待审、非套装）→ null', () => {
    const normal = mkBook({ id: 'bk-n', needsReview: false, isbn13: '9780000000001' })
    expect(reviewBadgeOf(normal, 'bk-n', [mkCr({ bookId: 'bk-n', volume: null })])).toBeNull()
  })
})

describe('filterBookByReviewType — 书库类型筛选（全部/待完善/占位/套装候选）', () => {
  const ph = mkBook({ needsReview: true, isbn13: null })
  const cand = mkBook({ needsReview: true, isbn13: '9787574012745' })
  const done = mkBook({ needsReview: false, isbn13: '9780000000001' })

  it('all 全量', () => {
    expect(filterBookByReviewType(ph, 'all')).toBe(true)
    expect(filterBookByReviewType(cand, 'all')).toBe(true)
    expect(filterBookByReviewType(done, 'all')).toBe(true)
  })
  it('needsReview 只取待完善（含占位与套装候选）', () => {
    expect(filterBookByReviewType(ph, 'needsReview')).toBe(true)
    expect(filterBookByReviewType(cand, 'needsReview')).toBe(true)
    expect(filterBookByReviewType(done, 'needsReview')).toBe(false)
  })
  it('placeholder 只取占位；set 取套装候选 + 已结构化套装（M4 与徽标同口径）', () => {
    expect(filterBookByReviewType(ph, 'placeholder')).toBe(true)
    expect(filterBookByReviewType(cand, 'placeholder')).toBe(false)
    expect(filterBookByReviewType(done, 'placeholder')).toBe(false)
    expect(filterBookByReviewType(cand, 'set')).toBe(true)
    expect(filterBookByReviewType(ph, 'set')).toBe(false)
    // 普通书非套装 → 不命中。
    expect(filterBookByReviewType(done, 'set')).toBe(false)
    // 已结构化套装（needsReview=false、≥2 volume）：徽标为 set，筛选必须命中
    // （M4 回归：旧版只认 needsReview，多卷书显示徽标但筛选搜不到）。
    expect(filterBookByReviewType(done, 'set', true)).toBe(true)
    expect(filterBookByReviewType(ph, 'set', true)).toBe(false)
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
      data: { metaid: 0, barcode: 'B5', title: '合成期刊' },
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
