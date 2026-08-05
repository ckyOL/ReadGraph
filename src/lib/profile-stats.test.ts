import { describe, it, expect } from 'vitest'

import type { Book, BorrowCycle, CatalogRecord, ClassificationSystem, Source } from '@/types/entities'

import { computeProfileStats } from '@/lib/profile-stats'

// ---- 固定 UTC 时刻（用 Date 构造显式 UTC 串，避免本地时区污染桶归属） ----
const U = (isoUtc: string) => new Date(isoUtc)
// 2023-01-15T00:00:00Z 起的「+N 天」Date，便于读 duration 边界
const Day1 = U('2023-01-15T00:00:00Z')
const addDays = (base: Date, n: number) => new Date(base.getTime() + n * 86_400_000)

// ---- 最小实体构造器 ----
function makeBook(id: string, over: Partial<Book> = {}): Book {
  return {
    id,
    isbn13: null,
    isbn10: null,
    title: id,
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
    createdAt: Day1,
    updatedAt: Day1,
    needsReview: false,
    sourceIds: ['src-1'],
    parallelTitles: [],
    ...over,
  }
}

function makeCatalog(
  id: string,
  bookId: string,
  over: Partial<CatalogRecord> = {},
): CatalogRecord {
  return {
    id,
    bookId,
    sourceId: 'src-1',
    metaId: null,
    metaIdKey: null,
    barcodes: [],
    classifications: [],
    opacEnrichment: null,
    volume: null,
    createdAt: Day1,
    updatedAt: Day1,
    ...over,
  }
}

function makeCycle(
  id: string,
  bookId: string,
  borrowedAt: Date,
  over: Partial<BorrowCycle> = {},
): BorrowCycle {
  return {
    id,
    bookId,
    catalogRecordId: 'cr-1',
    sourceId: 'src-1',
    borrowedAt,
    returnedAt: null,
    status: 'borrowed',
    borrowLocation: null,
    returnLocation: null,
    rawRecordIds: [],
    barcode: null,
    createdAt: Day1,
    updatedAt: Day1,
    ...over,
  }
}

function makeSource(id: string, system: ClassificationSystem | null): Source {
  return {
    id,
    type: 'library',
    name: id,
    parserId: id,
    parserVersion: null,
    timezone: 'Asia/Shanghai',
    library: {
      libraryType: 'public',
      city: null,
      province: null,
      website: null,
      opacUrl: null,
      classificationSystem: system,
    },
    notes: null,
    createdAt: Day1,
    lastImportAt: null,
    totalImportedRecords: 0,
  }
}

const NO_OP = { classificationSystem: null, range: null, displayTimezone: 'UTC' }

describe('computeProfileStats - empty input', () => {
  it('空入参返回全零结构且不抛异常', () => {
    const r = computeProfileStats(
      { books: [], catalogRecords: [], borrowCycles: [], sources: [] },
      NO_OP,
    )
    expect(r.summary).toEqual({
      totalBooks: 0,
      totalCycles: 0,
      inBorrow: 0,
      avgDurationDays: null,
      medianDurationDays: null,
    })
    expect(r.classification).toEqual([])
    expect(r.gantt).toEqual([])
    expect(r.borrowVolume).toEqual([])
    expect(r.durationDistribution).toEqual([])
  })
})

describe('computeProfileStats - 分类体系缺省度量', () => {
  it('多 Source 不同体系取多数票', () => {
    const b = makeBook('b1')
    const cr = makeCatalog('cr1', 'b1', {
      classifications: [
        { system: 'clc', code: 'T', category: '工业技术' },
        { system: 'ddc', code: '0', category: 'Computer science' },
      ],
    })
    const r1 = computeProfileStats(
      { books: [b], catalogRecords: [cr], borrowCycles: [], sources: [makeSource('s1', 'clc'), makeSource('s2', 'clc'), makeSource('s3', 'ddc')] },
      NO_OP,
    )
    // 多数票 = clc → 命中 CLC 条目，归并到一级 T
    expect(r1.classification).toContainEqual(
      expect.objectContaining({ code: 'T', category: '工业技术', value: 1 }),
    )
    // 显式指定 ddc 时不再多数票
    const r2 = computeProfileStats(
      { books: [b], catalogRecords: [cr], borrowCycles: [], sources: [makeSource('s1', 'clc'), makeSource('s2', 'ddc')] },
      { classificationSystem: 'ddc', range: null, displayTimezone: 'UTC' },
    )
    // DDC 一级归并输出 category 始终取内置一级类目名（spec §11.2「主类名」）
    expect(r2.classification).toContainEqual(
      expect.objectContaining({ code: '0', category: 'Computer science, information & general works', value: 1 }),
    )
  })

  it('全空回退 clc', () => {
    const b = makeBook('b1')
    const cr = makeCatalog('cr1', 'b1', {
      classifications: [{ system: 'clc', code: 'I', category: '文学' }],
    })
    const r = computeProfileStats(
      { books: [b], catalogRecords: [cr], borrowCycles: [], sources: [makeSource('s1', null), makeSource('s2', null)] },
      NO_OP,
    )
    expect(r.classification).toContainEqual(
      expect.objectContaining({ code: 'I', category: '文学', value: 1 }),
    )
  })
})

describe('computeProfileStats - CLC/DDC 一级归并 + 未分类', () => {
  it('CLC 取首字母归并到一级类目', () => {
    const b = makeBook('b1')
    const cr = makeCatalog('cr1', 'b1', {
      classifications: [{ system: 'clc', code: 'TP312', category: '自动化技术、计算机技术' }],
    })
    const r = computeProfileStats(
      { books: [b], catalogRecords: [cr], borrowCycles: [], sources: [] },
      NO_OP,
    )
    expect(r.classification).toContainEqual(
      expect.objectContaining({ code: 'T', category: '工业技术', value: 1 }),
    )
  })

  it('DDC 取首位归并到一级类目', () => {
    const b = makeBook('b1')
    const cr = makeCatalog('cr1', 'b1', {
      classifications: [{ system: 'ddc', code: '005.1', category: 'Computer programming' }],
    })
    const r = computeProfileStats(
      { books: [b], catalogRecords: [cr], borrowCycles: [], sources: [makeSource('s1', 'ddc')] },
      { classificationSystem: 'ddc', range: null, displayTimezone: 'UTC' },
    )
    expect(r.classification).toContainEqual(
      expect.objectContaining({ code: '0', category: 'Computer science, information & general works', value: 1 }),
    )
  })

  it('无匹配体系的分类号归入 __unclassified__', () => {
    const b = makeBook('b1')
    const cr = makeCatalog('cr1', 'b1', {
      classifications: [{ system: 'lcc', code: 'QA76', category: 'Mathematics' }],
    })
    const r = computeProfileStats(
      { books: [b], catalogRecords: [cr], borrowCycles: [], sources: [] },
      NO_OP,
    )
    expect(r.classification).toContainEqual(
      expect.objectContaining({ code: '__unclassified__', value: 1 }),
    )
  })
})

describe('computeProfileStats - Book 计一次', () => {
  it('多 CatalogRecord 同 ISBN 不同分类号只计一次', () => {
    const b = makeBook('b1', { isbn13: '9780000000001' })
    const cr1 = makeCatalog('cr1', 'b1', {
      barcodes: ['B001'],
      classifications: [{ system: 'clc', code: 'TP', category: '工业技术' }],
    })
    const cr2 = makeCatalog('cr2', 'b1', {
      barcodes: ['B002'],
      classifications: [{ system: 'clc', code: 'I', category: '文学' }],
    })
    const r = computeProfileStats(
      { books: [b], catalogRecords: [cr1, cr2], borrowCycles: [], sources: [] },
      NO_OP,
    )
    const total = r.classification.reduce((s, c) => s + c.value, 0)
    expect(total).toBe(1)
  })
})

describe('computeProfileStats - 借阅量桶', () => {
  it('数据跨度 ≤2 年用月粒度', () => {
    const cycles = [
      makeCycle('c1', 'b1', U('2023-01-15T00:00:00Z'), { status: 'returned', returnedAt: U('2023-01-22T00:00:00Z') }),
      makeCycle('c2', 'b1', U('2023-03-15T00:00:00Z'), { status: 'returned', returnedAt: U('2023-03-22T00:00:00Z') }),
      makeCycle('c3', 'b2', U('2024-01-15T00:00:00Z'), { status: 'returned', returnedAt: U('2024-01-22T00:00:00Z') }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1'), makeBook('b2')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const buckets = r.borrowVolume.map((p) => `${p.bucket}:${p.count}`).sort()
    expect(buckets).toEqual(['2023-01:1', '2023-03:1', '2024-01:1'].sort())
  })

  it('数据跨度 >2 年用年粒度', () => {
    const cycles = [
      makeCycle('c1', 'b1', U('2020-06-15T00:00:00Z'), { status: 'returned', returnedAt: U('2020-07-15T00:00:00Z') }),
      makeCycle('c2', 'b2', U('2024-06-15T00:00:00Z'), { status: 'returned', returnedAt: U('2024-07-15T00:00:00Z') }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1'), makeBook('b2')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const buckets = r.borrowVolume.map((p) => `${p.bucket}:${p.count}`).sort()
    expect(buckets).toEqual(['2020:1', '2024:1'].sort())
  })

  it('range 左闭右开裁剪仅落入区间周期', () => {
    const cycles = [
      makeCycle('c1', 'b1', U('2023-03-15T00:00:00Z'), { status: 'returned', returnedAt: U('2023-03-22T00:00:00Z') }),
      makeCycle('c2', 'b2', U('2023-09-15T00:00:00Z'), { status: 'returned', returnedAt: U('2023-09-22T00:00:00Z') }),
      makeCycle('c3', 'b3', U('2024-02-15T00:00:00Z'), { status: 'returned', returnedAt: U('2024-02-22T00:00:00Z') }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1'), makeBook('b2'), makeBook('b3')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      { classificationSystem: null, range: { from: U('2023-06-01T00:00:00Z'), to: U('2024-01-01T00:00:00Z') }, displayTimezone: 'UTC' },
    )
    const stayedI = r.borrowVolume.find((p) => p.bucket.startsWith('2023-09'))
    expect(stayedI?.count).toBe(1)
    const gonePre = r.borrowVolume.find((p) => p.bucket.startsWith('2023-03'))
    expect(gonePre).toBeUndefined()
    const gonePost = r.borrowVolume.find((p) => p.bucket.startsWith('2024-02'))
    expect(gonePost).toBeUndefined()
  })

  it('桶归属与 displayTimezone 无关', () => {
    const cycles = [
      // 1 月 31 日 23:00 UTC（=2 月 1 日 07:00 Asia/Shanghai / 1 月 31 日 18:00 纽约）
      makeCycle('c1', 'b1', U('2023-01-31T23:00:00Z'), { status: 'returned', returnedAt: U('2023-02-07T00:00:00Z') }),
    ]
    const rSH = computeProfileStats(
      { books: [makeBook('b1')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      { classificationSystem: null, range: null, displayTimezone: 'Asia/Shanghai' },
    )
    const rNY = computeProfileStats(
      { books: [makeBook('b1')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      { classificationSystem: null, range: null, displayTimezone: 'America/New_York' },
    )
    expect(rSH.borrowVolume).toEqual(rNY.borrowVolume)
    // UTC 桶应为 2023-01
    expect(rSH.borrowVolume.map((p) => p.bucket)).toEqual(['2023-01'])
  })
})

describe('computeProfileStats - 借阅时长分布', () => {
  it('status=returned 计入，borrowed/unknown 不计', () => {
    const cycles = [
      makeCycle('c1', 'b1', Day1, { status: 'returned', returnedAt: addDays(Day1, 7) }),
      makeCycle('c2', 'b2', Day1, { status: 'borrowed', returnedAt: null }),
      makeCycle('c3', 'b3', Day1, { status: 'unknown', returnedAt: addDays(Day1, 10) }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1'), makeBook('b2'), makeBook('b3')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const total = r.durationDistribution.reduce((s, p) => s + p.count, 0)
    expect(total).toBe(1)
  })

  it('分桶边界（7/14/30/60 天）正确', () => {
    const cases = [7, 8, 14, 15, 30, 31, 60, 61]
    const cycles = cases.map((d, i) =>
      makeCycle(`c${i}`, 'b1', Day1, { status: 'returned', returnedAt: addDays(Day1, d), barcode: `B${i}` }),
    )
    const r = computeProfileStats(
      { books: [makeBook('b1')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const by: Record<string, number> = {}
    for (const p of r.durationDistribution) by[p.range] = p.count
    expect(by['0–7']).toBe(1)
    expect(by['8–14']).toBe(2)
    expect(by['15–30']).toBe(2)
    expect(by['31–60']).toBe(2)
    expect(by['>60']).toBe(1)
  })

  it('空样本 avg/median 为 null', () => {
    const cycles = [
      makeCycle('c1', 'b1', Day1, { status: 'borrowed', returnedAt: null }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    expect(r.summary.avgDurationDays).toBeNull()
    expect(r.summary.medianDurationDays).toBeNull()
  })

  it('avg/median 仅基于已归还周期', () => {
    const cycles = [
      // durations: 10, 20, 30 → avg=20, median=20
      makeCycle('c1', 'b1', Day1, { status: 'returned', returnedAt: addDays(Day1, 10) }),
      makeCycle('c2', 'b2', Day1, { status: 'returned', returnedAt: addDays(Day1, 20) }),
      makeCycle('c3', 'b3', Day1, { status: 'returned', returnedAt: addDays(Day1, 30) }),
      makeCycle('c4', 'b4', Day1, { status: 'borrowed', returnedAt: null }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1'), makeBook('b2'), makeBook('b3'), makeBook('b4')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    expect(r.summary.avgDurationDays).toBe(20)
    expect(r.summary.medianDurationDays).toBe(20)
  })
})

describe('computeProfileStats - 甘特带', () => {
  it('lane = bookId+barcode；同 lane 区间按 borrowedAt 升序', () => {
    const cycles = [
      makeCycle('c2', 'b1', U('2023-02-01T00:00:00Z'), { status: 'returned', returnedAt: U('2023-02-08T00:00:00Z'), barcode: 'B001' }),
      makeCycle('c1', 'b1', U('2023-01-01T00:00:00Z'), { status: 'returned', returnedAt: U('2023-01-08T00:00:00Z'), barcode: 'B001' }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const lane = r.gantt.find((l) => l.laneKey === 'b1:B001')
    expect(lane).toBeDefined()
    expect(lane!.intervals.map((i) => i.start)).toEqual([
      '2023-01-01T00:00:00.000Z',
      '2023-02-01T00:00:00.000Z',
    ])
  })

  it('无 barcode 退化为 bookId+__noBarcode__', () => {
    const cycles = [makeCycle('c1', 'b1', U('2023-01-01T00:00:00Z'), { status: 'returned', returnedAt: U('2023-01-08T00:00:00Z') })]
    const r = computeProfileStats(
      { books: [makeBook('b1')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const lane = r.gantt.find((l) => l.laneKey === 'b1:__noBarcode__')
    expect(lane).toBeDefined()
  })

  it('borrowed 状态的 interval.end 为 null', () => {
    const cycles = [
      makeCycle('c1', 'b1', U('2023-01-01T00:00:00Z'), { status: 'borrowed', returnedAt: null, barcode: 'B001' }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const lane = r.gantt.find((l) => l.laneKey === 'b1:B001')
    expect(lane?.intervals[0]?.end).toBeNull()
    expect(lane?.intervals[0]?.status).toBe('borrowed')
  })

  it('套装书 lane 携带卷号（catalogRecordId 直查），label 保持公共题名', () => {
    const cr3 = makeCatalog('cr-3', 'b1', { barcodes: ['B003'], volume: '3' })
    const cr4 = makeCatalog('cr-4', 'b1', { barcodes: ['B004'], volume: '4' })
    const cycles = [
      makeCycle('c1', 'b1', U('2023-01-01T00:00:00Z'), {
        status: 'returned',
        returnedAt: U('2023-01-08T00:00:00Z'),
        barcode: 'B003',
        catalogRecordId: 'cr-3',
      }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1', { title: '大秦帝国' })], catalogRecords: [cr3, cr4], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const lane = r.gantt.find((l) => l.laneKey === 'b1:B003')!
    expect(lane.label).toBe('大秦帝国')
    expect(lane.volume).toBe('3')
  })

  it('套装书 lane 卷号按 barcode 兜底（catalogRecordId 失效时）', () => {
    const cr3 = makeCatalog('cr-3', 'b1', { barcodes: ['B003'], volume: '3' })
    const cr4 = makeCatalog('cr-4', 'b1', { barcodes: ['B004'], volume: '4' })
    const cycles = [
      makeCycle('c1', 'b1', U('2023-01-01T00:00:00Z'), {
        status: 'returned',
        returnedAt: U('2023-01-08T00:00:00Z'),
        barcode: 'B004',
        catalogRecordId: 'stale-id',
      }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1', { title: '大秦帝国' })], catalogRecords: [cr3, cr4], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const lane = r.gantt.find((l) => l.laneKey === 'b1:B004')!
    expect(lane.volume).toBe('4')
  })

  it('非套装书 lane volume 为 null（单卷编目不补卷号）', () => {
    const cr3 = makeCatalog('cr-3', 'b1', { barcodes: ['B003'], volume: '3' })
    const cycles = [
      makeCycle('c1', 'b1', U('2023-01-01T00:00:00Z'), {
        status: 'returned',
        returnedAt: U('2023-01-08T00:00:00Z'),
        barcode: 'B003',
        catalogRecordId: 'cr-3',
      }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1', { title: '单行本' })], catalogRecords: [cr3], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const lane = r.gantt.find((l) => l.laneKey === 'b1:B003')!
    expect(lane.label).toBe('单行本')
    expect(lane.volume).toBeNull()
  })

  it('套装书卷号解析不到（无匹配编目）→ null，label 照常', () => {
    const cr3 = makeCatalog('cr-3', 'b1', { barcodes: ['B003'], volume: '3' })
    const cr4 = makeCatalog('cr-4', 'b1', { barcodes: ['B004'], volume: '4' })
    const cycles = [
      makeCycle('c1', 'b1', U('2023-01-01T00:00:00Z'), {
        status: 'returned',
        returnedAt: U('2023-01-08T00:00:00Z'),
        barcode: 'B009',
        catalogRecordId: 'missing',
      }),
    ]
    const r = computeProfileStats(
      { books: [makeBook('b1', { title: '大秦帝国' })], catalogRecords: [cr3, cr4], borrowCycles: cycles, sources: [] },
      NO_OP,
    )
    const lane = r.gantt.find((l) => l.laneKey === 'b1:B009')!
    expect(lane.label).toBe('大秦帝国')
    expect(lane.volume).toBeNull()
  })
})

describe('computeProfileStats - 纯函数性', () => {
  it('同输入两次调用深等价', () => {
    const input = {
      books: [makeBook('b1')],
      catalogRecords: [makeCatalog('cr1', 'b1', { classifications: [{ system: 'clc', code: 'T', category: '工业技术' }] })],
      borrowCycles: [makeCycle('c1', 'b1', U('2023-01-01T00:00:00Z'), { status: 'returned', returnedAt: U('2023-01-08T00:00:00Z'), barcode: 'B001' })],
      sources: [],
    }
    const a = computeProfileStats(input, NO_OP)
    const b = computeProfileStats(input, NO_OP)
    expect(a).toEqual(b)
  })
})
