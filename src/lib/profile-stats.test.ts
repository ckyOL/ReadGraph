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
    materialType: 'book',
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

const NO_OP = { classificationSystem: null, range: null, displayTimezone: 'UTC', calendarAnchor: null }

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
    expect(r.money).toEqual({
      collectionValue: [],
      borrowedValue: [],
      avgPrice: [],
      dominantCurrency: null,
      distribution: [],
      multiCurrency: false,
    })
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
      { classificationSystem: 'ddc', range: null, displayTimezone: 'UTC', calendarAnchor: null },
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
      { classificationSystem: 'ddc', range: null, displayTimezone: 'UTC', calendarAnchor: null },
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
      { classificationSystem: null, range: { from: U('2023-06-01T00:00:00Z'), to: U('2024-01-01T00:00:00Z') }, displayTimezone: 'UTC', calendarAnchor: null },
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
      { classificationSystem: null, range: null, displayTimezone: 'Asia/Shanghai', calendarAnchor: null },
    )
    const rNY = computeProfileStats(
      { books: [makeBook('b1')], catalogRecords: [], borrowCycles: cycles, sources: [] },
      { classificationSystem: null, range: null, displayTimezone: 'America/New_York', calendarAnchor: null },
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

describe('computeProfileStats - 设备排除（device-borrows 规格 §4）', () => {
  const bookA = makeBook('b-a', { title: '甲书' })
  const bookB = makeBook('b-b', { title: '乙书' })
  const device = makeBook('b-dev', { title: '电子书阅读器', materialType: 'device' })
  const cycA = makeCycle('c-a', 'b-a', U('2023-02-01T00:00:00Z'), {
    status: 'returned',
    returnedAt: U('2023-02-11T00:00:00Z'), // 10 天
    barcode: 'BA1',
  })
  const cycDev = makeCycle('c-dev', 'b-dev', U('2023-02-03T00:00:00Z'), {
    status: 'returned',
    returnedAt: U('2023-02-08T00:00:00Z'), // 5 天
    barcode: 'DEV1',
  })
  const cycDevOpen = makeCycle('c-dev2', 'b-dev', U('2023-03-01T00:00:00Z'), {
    status: 'borrowed',
    barcode: 'DEV1',
  })

  it('summary 全维度排除设备：totalBooks/totalCycles/inBorrow/时长', () => {
    const r = computeProfileStats(
      {
        books: [bookA, device],
        catalogRecords: [],
        borrowCycles: [cycA, cycDev, cycDevOpen],
        sources: [],
      },
      NO_OP,
    )
    expect(r.summary.totalBooks).toBe(1)
    expect(r.summary.totalCycles).toBe(1)
    expect(r.summary.inBorrow).toBe(0) // 设备在借不计
    expect(r.summary.avgDurationDays).toBe(10)
    expect(r.summary.medianDurationDays).toBe(10)
  })

  it('设备周期不进 borrowVolume / durationDistribution / gantt', () => {
    const r = computeProfileStats(
      {
        books: [bookA, bookB, device],
        catalogRecords: [],
        borrowCycles: [cycA, cycDev],
        sources: [],
      },
      NO_OP,
    )
    // 借阅量：仅乙、甲两书周期；设备周期（02-03）不入桶。
    const vol = r.borrowVolume.find((p) => p.bucket === '2023-02')
    expect(vol?.count).toBe(1)
    // 时长分布：仅 10 天桶 +1，设备 5 天不入桶。
    const dur = r.durationDistribution.find((d) => d.range === '0–7')
    expect(dur?.count).toBe(0)
    expect(r.durationDistribution.find((d) => d.range === '8–14')?.count).toBe(1)
    // 甘特：lane 只含图书周期，设备 lane 不存在。
    expect(r.gantt.map((l) => l.laneKey)).toEqual(['b-a:BA1'])
  })

  it('设备 Book 不进分类 treemap（含未分类桶）', () => {
    const crA = makeCatalog('cr-a', 'b-a', {
      classifications: [{ system: 'clc', code: 'I', category: '文学' }],
    })
    const r = computeProfileStats(
      { books: [bookA, device], catalogRecords: [crA], borrowCycles: [], sources: [] },
      NO_OP,
    )
    expect(r.classification.find((c) => c.code === 'I')?.value).toBe(1)
    // 设备无分类也不占 __unclassified__。
    expect(r.classification.find((c) => c.code === '__unclassified__')).toBeUndefined()
    expect(r.summary.totalBooks).toBe(1)
  })

  it('无设备数据时结果与旧语义一致（排除不误伤普通书）', () => {
    const r = computeProfileStats(
      {
        books: [bookA, bookB],
        catalogRecords: [],
        borrowCycles: [cycA, makeCycle('c-b', 'b-b', U('2023-05-01T00:00:00Z'), { status: 'borrowed' })],
        sources: [],
      },
      NO_OP,
    )
    expect(r.summary.totalBooks).toBe(2)
    expect(r.summary.totalCycles).toBe(2)
    expect(r.summary.inBorrow).toBe(1)
    expect(r.gantt.map((l) => l.laneKey).sort()).toEqual(['b-a:BA1', 'b-b:__noBarcode__'])
  })
})

describe('computeProfileStats - money 价值统计（reading-profile 规格 §2.5）', () => {
  it('单币种合计与平均：整数分累计无浮点误差（9.99+0.01=10.00）', () => {
    const r = computeProfileStats(
      {
        books: [
          makeBook('b1', { price: { amount: 9.99, currency: 'CNY' } }),
          makeBook('b2', { price: { amount: 0.01, currency: 'CNY' } }),
          makeBook('b3', { price: { amount: 35, currency: 'CNY' } }),
          makeBook('b4'), // 无定价不计值
        ],
        catalogRecords: [],
        borrowCycles: [],
        sources: [],
      },
      NO_OP,
    )
    expect(r.money.collectionValue).toEqual([{ currency: 'CNY', amount: 45, count: 3 }])
    expect(r.money.avgPrice).toEqual([{ currency: 'CNY', amount: 15, count: 3 }])
    expect(r.money.dominantCurrency).toBe('CNY')
    expect(r.money.multiCurrency).toBe(false)
  })

  it('多币种按币种分组互不串；dominantCurrency 取有定价书数最多者', () => {
    const r = computeProfileStats(
      {
        books: [
          makeBook('b1', { price: { amount: 35, currency: 'CNY' } }),
          makeBook('b2', { price: { amount: 50, currency: 'CNY' } }),
          makeBook('b3', { price: { amount: 12.99, currency: 'USD' } }),
          makeBook('b4', { price: { amount: 500, currency: 'JPY' } }),
        ],
        catalogRecords: [],
        borrowCycles: [],
        sources: [],
      },
      NO_OP,
    )
    expect(r.money.collectionValue).toEqual([
      { currency: 'CNY', amount: 85, count: 2 },
      { currency: 'USD', amount: 12.99, count: 1 },
      { currency: 'JPY', amount: 500, count: 1 },
    ])
    expect(r.money.avgPrice).toEqual([
      { currency: 'CNY', amount: 42.5, count: 2 },
      { currency: 'USD', amount: 12.99, count: 1 },
      { currency: 'JPY', amount: 500, count: 1 },
    ])
    expect(r.money.dominantCurrency).toBe('CNY')
    expect(r.money.multiCurrency).toBe(true)
  })

  it('借阅价值：独立 Book 去重，同书多次借阅只计一次', () => {
    const r = computeProfileStats(
      {
        books: [
          makeBook('b1', { price: { amount: 30, currency: 'CNY' } }),
          makeBook('b2', { price: { amount: 40, currency: 'CNY' } }),
          makeBook('b3', { price: { amount: 50, currency: 'CNY' } }), // 无借阅不计入借阅价值
        ],
        catalogRecords: [],
        borrowCycles: [
          makeCycle('c1', 'b1', U('2023-01-15T00:00:00Z'), {
            status: 'returned',
            returnedAt: U('2023-01-22T00:00:00Z'),
          }),
          makeCycle('c2', 'b1', U('2023-03-01T00:00:00Z'), {
            status: 'returned',
            returnedAt: U('2023-03-08T00:00:00Z'),
          }),
          makeCycle('c3', 'b2', U('2023-05-01T00:00:00Z'), { status: 'borrowed' }),
        ],
        sources: [],
      },
      NO_OP,
    )
    expect(r.money.borrowedValue).toEqual([{ currency: 'CNY', amount: 70, count: 2 }])
  })

  it('借阅价值 range 裁剪：borrowedAt 恰为 from 计入、恰为 to 不计；全量口径不受 range 影响', () => {
    const r = computeProfileStats(
      {
        books: [
          makeBook('b1', { price: { amount: 10, currency: 'CNY' } }),
          makeBook('b2', { price: { amount: 20, currency: 'CNY' } }),
          makeBook('b3', { price: { amount: 30, currency: 'CNY' } }),
        ],
        catalogRecords: [],
        borrowCycles: [
          makeCycle('c1', 'b1', U('2023-06-15T00:00:00Z'), { status: 'borrowed' }), // = from 计入
          makeCycle('c2', 'b2', U('2023-12-31T00:00:00Z'), { status: 'borrowed' }),
          makeCycle('c3', 'b3', U('2024-01-01T00:00:00Z'), { status: 'borrowed' }), // = to 不计
        ],
        sources: [],
      },
      {
        classificationSystem: null,
        range: { from: U('2023-06-15T00:00:00Z'), to: U('2024-01-01T00:00:00Z') },
        displayTimezone: 'UTC',
        calendarAnchor: null,
      },
    )
    expect(r.money.borrowedValue).toEqual([{ currency: 'CNY', amount: 30, count: 2 }])
    expect(r.money.collectionValue).toEqual([{ currency: 'CNY', amount: 60, count: 3 }])
  })

  it('排除：设备书不计值；无定价书不计值；零定价书计 count', () => {
    const r = computeProfileStats(
      {
        books: [
          makeBook('b1', { price: { amount: 30, currency: 'CNY' } }),
          makeBook('b-dev', { price: { amount: 99, currency: 'CNY' }, materialType: 'device' }),
          makeBook('b-free', { price: { amount: 0, currency: 'CNY' } }),
          makeBook('b-noprice', { price: null }),
        ],
        catalogRecords: [],
        borrowCycles: [],
        sources: [],
      },
      NO_OP,
    )
    expect(r.money.collectionValue).toEqual([{ currency: 'CNY', amount: 30, count: 2 }])
    expect(r.money.avgPrice).toEqual([{ currency: 'CNY', amount: 15, count: 2 }])
  })

  it('分布：仅主导币种；分桶边界（20/50/100/200）与桶标签正确', () => {
    const r = computeProfileStats(
      {
        books: [
          makeBook('b1', { price: { amount: 15, currency: 'CNY' } }), // <20
          makeBook('b2', { price: { amount: 20, currency: 'CNY' } }), // 20–50
          makeBook('b3', { price: { amount: 50, currency: 'CNY' } }), // 50–100
          makeBook('b4', { price: { amount: 100, currency: 'CNY' } }), // 100–200
          makeBook('b5', { price: { amount: 200, currency: 'CNY' } }), // >200
          makeBook('b6', { price: { amount: 49.99, currency: 'CNY' } }), // 20–50
          makeBook('b7', { price: { amount: 25, currency: 'USD' } }), // 非主导币种不入图
        ],
        catalogRecords: [],
        borrowCycles: [],
        sources: [],
      },
      NO_OP,
    )
    expect(r.money.distribution).toEqual([
      { range: '<20', count: 1 },
      { range: '20–50', count: 2 },
      { range: '50–100', count: 1 },
      { range: '100–200', count: 1 },
      { range: '>200', count: 1 },
    ])
    expect(r.money.dominantCurrency).toBe('CNY')
    expect(r.money.multiCurrency).toBe(true)
  })

  it('无定价：全部空结构、dominantCurrency=null、multiCurrency=false', () => {
    const r = computeProfileStats(
      {
        books: [makeBook('b1'), makeBook('b2')],
        catalogRecords: [],
        borrowCycles: [
          makeCycle('c1', 'b1', U('2023-01-15T00:00:00Z'), { status: 'borrowed' }),
        ],
        sources: [],
      },
      NO_OP,
    )
    expect(r.money.collectionValue).toEqual([])
    expect(r.money.borrowedValue).toEqual([])
    expect(r.money.avgPrice).toEqual([])
    expect(r.money.dominantCurrency).toBeNull()
    expect(r.money.distribution).toEqual([])
    expect(r.money.multiCurrency).toBe(false)
  })
})

describe('computeProfileStats - 借阅日历（reading-profile 规格 §2.6）', () => {
  const withAnchor = (anchor: Date) => ({ ...NO_OP, calendarAnchor: anchor })

  it('空入参返回全零结构且不抛异常', () => {
    const r = computeProfileStats(
      { books: [], catalogRecords: [], borrowCycles: [], sources: [] },
      withAnchor(Day1),
    )
    expect(r.calendar).toEqual({
      days: [],
      borrowDays: 0,
      minDate: null,
      maxDate: null,
      bookIndex: {},
    })
  })

  it('天区间：借出日与归还日均计入（相交语义）', () => {
    const r = computeProfileStats(
      {
        books: [makeBook('b1', { title: 'book-one' })],
        catalogRecords: [],
        borrowCycles: [
          makeCycle('c1', 'b1', U('2023-01-15T10:00:00Z'), {
            status: 'returned',
            returnedAt: U('2023-01-17T23:00:00Z'),
          }),
        ],
        sources: [],
      },
      withAnchor(U('2023-03-01T00:00:00Z')),
    )
    expect(r.calendar.days.map((d) => d.date)).toEqual([
      '2023-01-15',
      '2023-01-16',
      '2023-01-17',
    ])
    expect(r.calendar.borrowDays).toBe(3)
    expect(r.calendar.minDate).toBe('2023-01-15')
    expect(r.calendar.maxDate).toBe('2023-01-17')
    expect(r.calendar.days[0]).toMatchObject({ count: 1, bookIds: ['b1'] })
    expect(r.calendar.bookIndex).toEqual({ b1: { title: 'book-one', coverUrl: null } })
  })

  it('returnedAt 恰为 UTC 日 00:00 → 该日不计', () => {
    const r = computeProfileStats(
      {
        books: [makeBook('b1')],
        catalogRecords: [],
        borrowCycles: [
          makeCycle('c1', 'b1', U('2023-01-15T00:00:00Z'), {
            status: 'returned',
            returnedAt: U('2023-01-17T00:00:00.000Z'),
          }),
        ],
        sources: [],
      },
      withAnchor(U('2023-03-01T00:00:00Z')),
    )
    expect(r.calendar.days.map((d) => d.date)).toEqual(['2023-01-15', '2023-01-16'])
    expect(r.calendar.maxDate).toBe('2023-01-16')
  })

  it('returnedAt 恰为 1 月 1 日 00:00 → -1ms 跨年边界正确', () => {
    const r = computeProfileStats(
      {
        books: [makeBook('b1')],
        catalogRecords: [],
        borrowCycles: [
          makeCycle('c1', 'b1', U('2023-12-31T08:00:00Z'), {
            status: 'returned',
            returnedAt: U('2024-01-01T00:00:00.000Z'),
          }),
        ],
        sources: [],
      },
      withAnchor(U('2024-03-01T00:00:00Z')),
    )
    expect(r.calendar.days.map((d) => d.date)).toEqual(['2023-12-31'])
  })

  it('闰年跨月：2 月 28 日借、3 月 1 日还 → 含 2 月 29 日', () => {
    const r = computeProfileStats(
      {
        books: [makeBook('b1')],
        catalogRecords: [],
        borrowCycles: [
          makeCycle('c1', 'b1', U('2024-02-28T10:00:00Z'), {
            status: 'returned',
            returnedAt: U('2024-03-01T05:00:00Z'),
          }),
        ],
        sources: [],
      },
      withAnchor(U('2024-03-10T00:00:00Z')),
    )
    expect(r.calendar.days.map((d) => d.date)).toEqual([
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ])
  })

  it('开区间收敛到 calendarAnchor；锚为 null → 仅借出当日；锚早于借出日 → 零天格', () => {
    const base = {
      books: [makeBook('b1')],
      catalogRecords: [],
      borrowCycles: [
        makeCycle('c1', 'b1', U('2023-01-15T00:00:00Z'), { status: 'borrowed' }),
      ],
      sources: [],
    }
    const anchored = computeProfileStats(base, withAnchor(U('2023-01-20T00:00:00Z')))
    expect(anchored.calendar.days.map((d) => d.date)).toEqual([
      '2023-01-15',
      '2023-01-16',
      '2023-01-17',
      '2023-01-18',
      '2023-01-19',
      '2023-01-20',
    ])
    expect(anchored.calendar.borrowDays).toBe(6)

    const noAnchor = computeProfileStats(base, { ...NO_OP, calendarAnchor: null })
    expect(noAnchor.calendar.days.map((d) => d.date)).toEqual(['2023-01-15'])

    const past = computeProfileStats(
      base,
      withAnchor(U('2023-01-01T00:00:00Z')),
    )
    expect(past.calendar.days).toEqual([])
    expect(past.calendar.borrowDays).toBe(0)
  })

  it('同日同书多周期只计 1；同日多书 count=独立 Book 数且 bookIds 升序', () => {
    const r = computeProfileStats(
      {
        books: [makeBook('b1'), makeBook('b2')],
        catalogRecords: [],
        borrowCycles: [
          makeCycle('c1', 'b1', U('2023-01-15T00:00:00Z'), {
            status: 'returned',
            returnedAt: U('2023-01-20T00:00:00Z'),
          }),
          makeCycle('c2', 'b1', U('2023-01-17T00:00:00Z'), {
            status: 'returned',
            returnedAt: U('2023-01-22T00:00:00Z'),
          }),
          makeCycle('c3', 'b2', U('2023-01-18T00:00:00Z'), {
            status: 'returned',
            returnedAt: U('2023-01-20T00:00:00Z'),
          }),
        ],
        sources: [],
      },
      withAnchor(U('2023-02-01T00:00:00Z')),
    )
    const d18 = r.calendar.days.find((d) => d.date === '2023-01-18')
    expect(d18).toMatchObject({ count: 2, bookIds: ['b1', 'b2'] })
    const d16 = r.calendar.days.find((d) => d.date === '2023-01-16')
    expect(d16).toMatchObject({ count: 1, bookIds: ['b1'] })
    expect(Object.keys(r.calendar.bookIndex).sort()).toEqual(['b1', 'b2'])
  })

  it('口径：borrowDays 全量与 range 无关；days 随 range 裁剪（左闭右开）', () => {
    const base = {
      books: [makeBook('b1'), makeBook('b2')],
      catalogRecords: [],
      borrowCycles: [
        makeCycle('c1', 'b1', U('2023-03-15T00:00:00Z'), {
          status: 'returned',
          returnedAt: U('2023-03-22T12:00:00Z'),
        }),
        makeCycle('c2', 'b2', U('2024-02-15T00:00:00Z'), {
          status: 'returned',
          returnedAt: U('2024-02-22T12:00:00Z'),
        }),
      ],
      sources: [],
    }
    const range = {
      from: U('2023-06-01T00:00:00Z'),
      to: U('2024-01-01T00:00:00Z'),
    }
    const r = computeProfileStats(
      base,
      { ...NO_OP, calendarAnchor: U('2024-03-01T00:00:00Z'), range },
    )
    // days 仅 range 内周期（c2 的 borrowedAt 2024-02 不在 [2023-06, 2024-01)）
    expect(r.calendar.days).toEqual([])
    expect(r.calendar.minDate).toBeNull()
    expect(r.calendar.maxDate).toBeNull()
    // borrowDays 全量：c1 8 天 + c2 8 天
    expect(r.calendar.borrowDays).toBe(16)
  })

  it('range 边界：borrowedAt 恰为 from 计入、恰为 to 不计', () => {
    const base = {
      books: [makeBook('b1'), makeBook('b2')],
      catalogRecords: [],
      borrowCycles: [
        makeCycle('c1', 'b1', U('2023-06-15T00:00:00Z'), {
          status: 'returned',
          returnedAt: U('2023-06-16T12:00:00Z'),
        }), // = from
        makeCycle('c2', 'b2', U('2024-01-01T00:00:00Z'), {
          status: 'returned',
          returnedAt: U('2024-01-02T00:00:00Z'),
        }), // = to
      ],
      sources: [],
    }
    const r = computeProfileStats(
      base,
      {
        ...NO_OP,
        calendarAnchor: U('2024-03-01T00:00:00Z'),
        range: { from: U('2023-06-15T00:00:00Z'), to: U('2024-01-01T00:00:00Z') },
      },
    )
    expect(r.calendar.days.map((d) => d.date)).toEqual(['2023-06-15', '2023-06-16'])
  })

  it('设备书周期不产生天格、不入 borrowDays', () => {
    const r = computeProfileStats(
      {
        books: [
          makeBook('b1'),
          makeBook('b-dev', { materialType: 'device' }),
        ],
        catalogRecords: [],
        borrowCycles: [
          makeCycle('c1', 'b1', U('2023-01-15T00:00:00Z'), {
            status: 'returned',
            returnedAt: U('2023-01-20T12:00:00Z'),
          }),
          makeCycle('c2', 'b-dev', U('2023-01-10T00:00:00Z'), {
            status: 'returned',
            returnedAt: U('2023-01-30T00:00:00Z'),
          }),
        ],
        sources: [],
      },
      withAnchor(U('2023-02-01T00:00:00Z')),
    )
    expect(r.calendar.borrowDays).toBe(6)
    expect(r.calendar.days.every((d) => !d.bookIds.includes('b-dev'))).toBe(true)
    expect(r.calendar.bookIndex).not.toHaveProperty('b-dev')
  })

  it('UTC 桶归属与 displayTimezone 无关；同输入两次调用深等价', () => {
    const input = {
      books: [makeBook('b1')],
      catalogRecords: [],
      borrowCycles: [
        makeCycle('c1', 'b1', U('2023-01-31T23:00:00Z'), {
          status: 'returned',
          returnedAt: U('2023-02-07T00:00:00Z'),
        }),
      ],
      sources: [],
    }
    const optsA = {
      classificationSystem: null,
      range: null,
      displayTimezone: 'Asia/Shanghai',
      calendarAnchor: U('2023-03-01T00:00:00Z'),
    }
    const optsB = { ...optsA, displayTimezone: 'America/New_York' }
    const rA = computeProfileStats(input, optsA)
    const rB = computeProfileStats(input, optsB)
    const rA2 = computeProfileStats(input, optsA)
    expect(rA.calendar).toEqual(rB.calendar)
    expect(rA.calendar).toEqual(rA2.calendar)
  })
})
