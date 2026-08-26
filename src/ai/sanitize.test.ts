// 脱敏管道黑名单断言（ai-features §3.3）：装配产物只含白名单字段，
// 黑名单值在序列化文本中逐值穷举断言不出现（非抽样）。纯函数性由两次调用深等价 + Date.now stub 强制。
import { describe, expect, it, vi } from 'vitest'

import { computeProfileStats, computeYearSlice } from '@/lib/profile-stats'
import type { ProfileStatsInput, ProfileStatsOptions, YearSliceResult } from '@/lib/profile-stats'
import { makeBook, makeCatalog, makeCycle, makeRawRecord, makeSource } from '@/db/test-helpers'
import {
  BOOKLIST_FULL_LIMIT,
  SAMPLE_BOOKS_LIMIT,
  profilePayloadSchema,
  serializePayload,
  yearPayloadSchema,
  serializeYearPayload,
} from './sanitize'
import sanitizeSource from './sanitize.ts?raw'
import type { ProfilePayload, YearPayload } from './sanitize'
import type { Book, BorrowCycle, CatalogRecord, RawRecord } from '@/types/entities'

const U = (isoUtc: string) => new Date(isoUtc)

const STATS_OPTS: ProfileStatsOptions = {
  classificationSystem: 'clc',
  range: null,
  displayTimezone: 'UTC',
  calendarAnchor: null,
}

function expectValidPayload(payload: ProfilePayload): void {
  const result = profilePayloadSchema.safeParse(payload)
  expect(result.success).toBe(true)
}

// ---- 黑名单穷举夹具：每个黑名单字段塞一个唯一秘密值 ----
function secretBook(): Book {
  return {
    ...makeBook('book-secret', '9787123456789', '秘密之书'),
    isbn10: '123456789X',
    subtitle: '副标题-公开',
    authors: ['作者甲', '作者乙'],
    translators: ['TOP-SECRET-translator'],
    publisher: '出版社-公开',
    publishDate: '2026-05-10',
    edition: '第1版',
    pages: 999,
    price: { amount: 59.99, currency: 'CNY' },
    subjects: ['主题词-公开'],
    tags: ['TOP-SECRET-tag'],
    coverUrl: 'https://cdn.example.test/cover-TOP-SECRET.jpg',
    description: 'TOP-SECRET-desc',
    parallelTitles: ['TOP-SECRET-parallel'],
    sourceIds: ['src-secret'],
  }
}

function secretCatalog(): CatalogRecord {
  return {
    ...makeCatalog('cr-secret', 'book-secret', 'src-secret', 'BC-SECRET-77', 'metaId-TOP-SECRET', [
      { system: 'clc', code: 'I247.5' },
    ]),
    metaIdKey: 'metaIdKey-TOP-SECRET',
  }
}

function secretCycle(): BorrowCycle {
  return {
    ...makeCycle('cyc-secret', 'book-secret', 'src-secret', U('2026-02-14T08:30:00.000Z'), 'returned', 'BC-SECRET-77'),
    returnedAt: U('2026-02-20T08:30:00.000Z'),
    borrowLocation: 'TOP-SECRET-location',
    returnLocation: 'TOP-SECRET-return-location',
  }
}

function secretRaw(): RawRecord {
  return {
    ...makeRawRecord('raw-secret'),
    data: { cardno: 'cardno-9X8Y7Z', rawOnly: 'RAW-ONLY-SECRET' },
  }
}

function blacklistInput(): ProfileStatsInput & { rawRecords: RawRecord[] } {
  return {
    books: [secretBook()],
    catalogRecords: [secretCatalog()],
    borrowCycles: [secretCycle()],
    sources: [makeSource('src-secret')], // name='深圳图书馆'
    rawRecords: [secretRaw()],
  }
}

describe('serializePayload', () => {
  it('黑名单逐值穷举：cardno/条码/借还时点/馆名/metaId/rawRecords/ISBN/个人标签等不出现于序列化产物', () => {
    const input = blacklistInput()
    const stats = computeProfileStats(input, STATS_OPTS)
    const payload = serializePayload(input, stats, { classificationSystem: 'clc' })
    const serialized = JSON.stringify(payload)

    const blacklistValues = [
      'cardno-9X8Y7Z', // RawRecord.data.cardno
      'RAW-ONLY-SECRET', // RawRecord 独有值（rawRecords 整体不发送）
      'BC-SECRET-77', // CatalogRecord.barcodes + BorrowCycle.barcode
      '2026-02-14T08:30:00.000Z', // borrowedAt（gantt/calendar 均不发送）
      '2026-02-20T08:30:00.000Z', // returnedAt
      '深圳图书馆', // Source.name 馆名
      'metaId-TOP-SECRET', // CatalogRecord.metaId
      'metaIdKey-TOP-SECRET', // CatalogRecord.metaIdKey
      '9787123456789', // Book.isbn13
      '123456789X', // Book.isbn10
      'TOP-SECRET-tag', // Book.tags（用户个人标签）
      '59.99', // Book.price.amount
      'CNY', // Book.price.currency
      'cover-TOP-SECRET', // Book.coverUrl
      'TOP-SECRET-translator', // Book.translators
      'TOP-SECRET-parallel', // Book.parallelTitles
      'TOP-SECRET-desc', // Book.description
      'TOP-SECRET-location', // BorrowCycle.borrowLocation
      'TOP-SECRET-return-location', // BorrowCycle.returnLocation
      'src-secret', // Book.sourceIds / Source.id
      'I247.5', // 原始分类号（只发一级归并 code）
      '第1版', // Book.edition
      '999', // Book.pages
    ]
    for (const value of blacklistValues) {
      expect(serialized).not.toContain(value)
    }

    // 结构白名单：顶层/calendar/每书只含规格字段，无 gantt/money/rawRecords
    const parsed = JSON.parse(serialized) as ProfilePayload
    expect(Object.keys(parsed).sort()).toEqual([
      'books',
      'borrowVolume',
      'calendar',
      'classification',
      'durationDistribution',
      'summary',
    ])
    expect(Object.keys(parsed.calendar)).toEqual(['borrowDays'])
    expect(Object.keys(parsed.books[0]!).sort()).toEqual([
      'authors',
      'borrowCount',
      'classification',
      'publishYear',
      'publisher',
      'subjects',
      'subtitle',
      'title',
    ])
    expect(parsed).not.toHaveProperty('gantt')
    expect(parsed).not.toHaveProperty('money')
    expect(parsed).not.toHaveProperty('rawRecords')
    expectValidPayload(payload)
  })

  it('每书字段：题名/作者/出版年份/分类/主题词/借阅次数齐全，借阅次数与输入周期本地计数一致', () => {
    const bookA: Book = {
      ...makeBook('book-a', '9780000000001', '三体'),
      authors: ['刘慈欣'],
      subtitle: '地球往事',
      publisher: '重庆出版社',
      publishDate: '2008-01-15',
      subjects: ['科幻小说'],
      tags: ['私密标签'],
      price: { amount: 12.34, currency: 'CNY' },
    }
    const bookB: Book = { ...makeBook('book-b', null, '无分类书'), publishDate: '2026' }
    const bookC: Book = { ...makeBook('book-c', null, '年份未知书'), publishDate: 'abc' }
    const bookD: Book = { ...makeBook('book-d', null, '无出版年书'), publishDate: null }

    const cycles: BorrowCycle[] = [
      {
        ...makeCycle('cyc-a1', 'book-a', 'src-sz', U('2025-11-01T10:00:00.000Z'), 'returned'),
        returnedAt: U('2025-11-08T10:00:00.000Z'),
      },
      {
        ...makeCycle('cyc-a2', 'book-a', 'src-sz', U('2026-01-05T09:00:00.000Z'), 'returned'),
        returnedAt: U('2026-01-11T09:00:00.000Z'),
      },
      { ...makeCycle('cyc-b1', 'book-b', 'src-sz', U('2026-02-01T00:00:00.000Z')) },
    ]
    const catalogs: CatalogRecord[] = [
      makeCatalog('cr-a', 'book-a', 'src-sz', 'BC-A', null, [{ system: 'clc', code: 'I247.5' }]),
    ]
    const input: ProfileStatsInput = {
      books: [bookA, bookB, bookC, bookD],
      catalogRecords: catalogs,
      borrowCycles: cycles,
      sources: [makeSource('src-sz')],
    }
    const stats = computeProfileStats(input, STATS_OPTS)
    const payload = serializePayload(input, stats, { classificationSystem: 'clc' })

    expect(payload.books).toHaveLength(4)
    const byTitle = (title: string) => payload.books.find((b) => b.title === title)!

    expect(byTitle('三体')).toMatchObject({
      title: '三体',
      subtitle: '地球往事',
      authors: ['刘慈欣'],
      publishYear: '2008',
      publisher: '重庆出版社',
      classification: { code: 'I', name: '文学' },
      subjects: ['科幻小说'],
    })
    expect(byTitle('三体').borrowCount).toBe(2)
    expect(byTitle('无分类书').publishYear).toBe('2026')
    expect(byTitle('无分类书').classification).toBeNull() // 无编目 → null
    expect(byTitle('年份未知书').publishYear).toBeNull() // 非 4 位数字开头 → null
    expect(byTitle('无出版年书').publishYear).toBeNull()

    // 借阅次数 = 该书周期数（同 profile-stats 数据源）
    for (const book of [bookA, bookB, bookC, bookD]) {
      const row = byTitle(book.title)
      expect(row.borrowCount).toBe(cycles.filter((c) => c.bookId === book.id).length)
    }

    // 序列化文本不含书目黑名单字段
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('9780000000001') // isbn13
    expect(serialized).not.toContain('私密标签') // tags
    expect(serialized).not.toContain('12.34') // price
    expect(serialized).not.toContain('2025-11-01T10:00:00.000Z') // borrowedAt
    expect(serialized).not.toContain('2026-01-05T09:00:00.000Z') // returnedAt
    expectValidPayload(payload)
  })

  it('单书分类：首选体系一级归并（resolveSystem 同口径），无匹配体系/未知 code → null', () => {
    const base = makeBook('book-x', null, '分类书')
    const books: Book[] = [
      { ...base, id: 'book-clc', title: 'CLC书' },
      { ...base, id: 'book-ddc', title: 'DDC书' },
      { ...base, id: 'book-mismatch', title: '体系不匹配书' },
      { ...base, id: 'book-unknown', title: '未知code书' },
    ]
    const catalogs: CatalogRecord[] = [
      makeCatalog('cr-clc', 'book-clc', 'src-sz', 'BC-X', null, [{ system: 'clc', code: 'I247.5' }]),
      makeCatalog('cr-ddc', 'book-ddc', 'src-sz', 'BC-X', null, [{ system: 'ddc', code: '813.4' }]),
      makeCatalog('cr-mis', 'book-mismatch', 'src-sz', 'BC-X', null, [{ system: 'ddc', code: '813.4' }]),
      makeCatalog('cr-unk', 'book-unknown', 'src-sz', 'BC-X', null, [{ system: 'clc', code: '123.4' }]),
    ]
    const input: ProfileStatsInput = {
      books,
      catalogRecords: catalogs,
      borrowCycles: [],
      sources: [makeSource('src-sz')], // library.classificationSystem='clc' → 缺省多数票
    }
    const stats = computeProfileStats(input, STATS_OPTS)

    // opts.classificationSystem=null → resolveSystem 取 Source 多数票 'clc'
    const clcPayload = serializePayload(input, stats, { classificationSystem: null })
    const clcByTitle = (title: string) => clcPayload.books.find((b) => b.title === title)!
    expect(clcByTitle('CLC书').classification).toEqual({ code: 'I', name: '文学' })
    expect(clcByTitle('DDC书').classification).toBeNull() // 编目只有 ddc 条目，clc 无匹配
    expect(clcByTitle('体系不匹配书').classification).toBeNull()
    expect(clcByTitle('未知code书').classification).toBeNull() // '1' 不在 CLC 一级表

    // opts 显式 'ddc' 覆盖 Source 多数票
    const ddcPayload = serializePayload(input, stats, { classificationSystem: 'ddc' })
    const ddcByTitle = (title: string) => ddcPayload.books.find((b) => b.title === title)!
    expect(ddcByTitle('DDC书').classification).toEqual({ code: '8', name: 'Literature' })
    expect(ddcByTitle('CLC书').classification).toBeNull()
    expectValidPayload(ddcPayload)
  })

  it('设备书（materialType=device）不进 payload.books', () => {
    const device: Book = { ...makeBook('book-device', null, '电子书阅读器'), materialType: 'device' }
    const normal: Book = { ...makeBook('book-normal', null, '正常书') }
    const cycles: BorrowCycle[] = [
      makeCycle('cyc-d1', 'book-device', 'src-sz', U('2026-01-01T00:00:00.000Z'), 'borrowed', 'BC-DEV'),
      makeCycle('cyc-n1', 'book-normal', 'src-sz', U('2026-01-02T00:00:00.000Z'), 'borrowed', 'BC-N'),
    ]
    const input: ProfileStatsInput = {
      books: [device, normal],
      catalogRecords: [],
      borrowCycles: cycles,
      sources: [makeSource('src-sz')],
    }
    const stats = computeProfileStats(input, STATS_OPTS)
    const payload = serializePayload(input, stats, { classificationSystem: 'clc' })

    expect(payload.books.map((b) => b.title)).toEqual(['正常书'])
    expect(payload.books[0]!.borrowCount).toBe(1)
    expect(JSON.stringify(payload)).not.toContain('电子书阅读器')
    expectValidPayload(payload)
  })

  it('空 books 输入：books=[]，聚合白名单子集透传，结构完整', () => {
    const input: ProfileStatsInput = { books: [], catalogRecords: [], borrowCycles: [], sources: [] }
    const stats = computeProfileStats(input, STATS_OPTS)
    const payload = serializePayload(input, stats, { classificationSystem: null })

    expect(payload.books).toEqual([])
    expect(payload.calendar).toEqual({ borrowDays: 0 })
    expect(payload.summary).toEqual(stats.summary)
    expect(payload.classification).toEqual([])
    expect(payload.borrowVolume).toEqual([])
    expect(payload.durationDistribution).toEqual([])
    expectValidPayload(payload)
  })

  it('纯函数性：同输入两次调用深等价；stub Date.now 前后输出不变', () => {
    const input = blacklistInput()
    const stats = computeProfileStats(input, STATS_OPTS)
    const first = serializePayload(input, stats, { classificationSystem: 'clc' })

    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const statsUnderStub = computeProfileStats(input, STATS_OPTS)
    const second = serializePayload(input, statsUnderStub, { classificationSystem: 'clc' })
    spy.mockRestore()

    expect(statsUnderStub).toEqual(stats)
    expect(second).toEqual(first)
    expect(serializePayload(input, stats, { classificationSystem: 'clc' })).toEqual(first)
  })

  it('模块源码无 localStorage/DOM 引用', () => {
        expect(sanitizeSource).not.toMatch(/\b(localStorage|document|window)\b/)
  })
})

describe('profilePayloadSchema / BOOKLIST_FULL_LIMIT', () => {
  it('BOOKLIST_FULL_LIMIT = 3000（S-2 波次2采样阈值）', () => {
    expect(BOOKLIST_FULL_LIMIT).toBe(3000)
  })

  it('schema 严格白名单：合法 payload 通过；缺字段/未知字段拒绝', () => {
    const input = blacklistInput()
    const stats = computeProfileStats(input, STATS_OPTS)
    const payload = serializePayload(input, stats, { classificationSystem: 'clc' })

    expect(profilePayloadSchema.safeParse(payload).success).toBe(true)

    const missing = { ...payload } as Record<string, unknown>
    delete missing.summary
    expect(profilePayloadSchema.safeParse(missing).success).toBe(false)

    const extra = { ...payload, cardno: 'cardno-9X8Y7Z' }
    expect(profilePayloadSchema.safeParse(extra).success).toBe(false)

    const extraBookField = {
      ...payload,
      books: [{ ...payload.books[0]!, isbn13: '9787123456789' }],
    }
    expect(profilePayloadSchema.safeParse(extraBookField).success).toBe(false)
  })
})
describe('serializePayload 分层采样（S-2，ai-features §3.2 极端档案防护）', () => {
  /** 批量构造书目：id=`${prefix}-NNNN`，title=`${prefix} NNNN`（NNNN 四位零填充）。 */
  function makeLibraryBooks(count: number, prefix: string): Book[] {
    return Array.from({ length: count }, (_, i) => {
      const n = String(i).padStart(4, '0')
      return { ...makeBook(`${prefix}-${n}`, null, `${prefix} ${n}`) }
    })
  }

  function makeCycles(bookId: string, count: number): BorrowCycle[] {
    return Array.from(
      { length: count },
      (_, i) =>
        makeCycle(`cyc-${bookId}-${i}`, bookId, 'src-sz', U('2026-01-01T00:00:00.000Z')),
    )
  }

  it('SAMPLE_BOOKS_LIMIT = 500（采样总上限）', () => {
    expect(SAMPLE_BOOKS_LIMIT).toBe(500)
  })

  it('阈值左侧：3000 本全量进 payload 且无 sampled 字段', () => {
    const books = makeLibraryBooks(BOOKLIST_FULL_LIMIT, 'F')
    const input: ProfileStatsInput = {
      books,
      catalogRecords: [],
      borrowCycles: [],
      sources: [makeSource('src-sz')],
    }
    const stats = computeProfileStats(input, STATS_OPTS)
    const payload = serializePayload(input, stats, { classificationSystem: 'clc' })

    expect(payload.books).toHaveLength(3000)
    expect(payload).not.toHaveProperty('sampled')
    expectValidPayload(payload)
  })

  it('阈值右侧：3001 本 → 采样 500 本，sampled={ total:3001, sent:500 }；两次调用深等价（确定性）', () => {
    const books = makeLibraryBooks(BOOKLIST_FULL_LIMIT + 1, 'F')
    const input: ProfileStatsInput = {
      books,
      catalogRecords: [],
      borrowCycles: [],
      sources: [makeSource('src-sz')],
    }
    const stats = computeProfileStats(input, STATS_OPTS)
    const first = serializePayload(input, stats, { classificationSystem: 'clc' })
    const second = serializePayload(input, stats, { classificationSystem: 'clc' })

    expect(first.books).toHaveLength(SAMPLE_BOOKS_LIMIT)
    expect(first.sampled).toEqual({ total: 3001, sent: 500 })
    expect(first.sampled!.sent).toBe(first.books.length)
    expectValidPayload(first)
    expect(second).toEqual(first)
  })

  it('采样集分类全覆盖：跨 ≥3 分类（含无编目书）→ 每分类桶（含未分类）采样集 ≥1 本，无空桶', () => {
    const groups = [
      { prefix: 'I', code: 'I247.5', count: 1001 },
      { prefix: 'T', code: 'TP311', count: 1001 },
      { prefix: 'U', code: 'U41', count: 1000 },
    ]
    const books: Book[] = []
    const catalogRecords: CatalogRecord[] = []
    for (const g of groups) {
      for (let i = 0; i < g.count; i++) {
        const n = String(i).padStart(4, '0')
        const id = `${g.prefix}-${n}`
        books.push({ ...makeBook(id, null, `${g.prefix} ${n}`) })
        catalogRecords.push(
          makeCatalog(`cr-${id}`, id, 'src-sz', `BC-${id}`, null, [
            { system: 'clc', code: g.code },
          ]),
        )
      }
    }
    books.push({ ...makeBook('un-0001', null, '未分类书') }) // 无编目 → __unclassified__ 桶
    const input: ProfileStatsInput = {
      books,
      catalogRecords,
      borrowCycles: [],
      sources: [makeSource('src-sz')],
    }
    const stats = computeProfileStats(input, STATS_OPTS)
    const payload = serializePayload(input, stats, { classificationSystem: 'clc' })

    expect(payload.books).toHaveLength(SAMPLE_BOOKS_LIMIT)
    expect(payload.sampled).toEqual({ total: 3003, sent: 500 })
    const codesInSample = new Set(
      payload.books.map((b) => b.classification?.code ?? '__unclassified__'),
    )
    expect(codesInSample).toEqual(new Set(['I', 'T', 'U', '__unclassified__']))
    expectValidPayload(payload)
  })

  it('代表规则：同分类内 borrowCount 高者优先入选（对照断言）', () => {
    const books = [...makeLibraryBooks(2000, 'I'), ...makeLibraryBooks(1001, 'K')]
    // I 0000..I 0004 分别借阅 5..1 次，其余 0 次 → 高借阅者必入选，0 借阅尾部出局
    const cycles: BorrowCycle[] = []
    for (let i = 0; i < 5; i++) {
      const id = `I-${String(i).padStart(4, '0')}`
      cycles.push(...makeCycles(id, 5 - i))
    }
    const input: ProfileStatsInput = {
      books,
      catalogRecords: [],
      borrowCycles: cycles,
      sources: [makeSource('src-sz')],
    }
    const stats = computeProfileStats(input, STATS_OPTS)
    const payload = serializePayload(input, stats, { classificationSystem: 'clc' })

    expect(payload.sampled).toEqual({ total: 3001, sent: 500 })
    const sampleTitles = new Set(payload.books.map((b) => b.title))
    for (let i = 0; i < 5; i++) {
      expect(sampleTitles.has(`I ${String(i).padStart(4, '0')}`)).toBe(true)
    }
    expect(sampleTitles.has('I 1999')).toBe(false)
    expect(sampleTitles.has('K 1000')).toBe(false)
    expect(payload.books.slice(0, 5).map((b) => b.borrowCount)).toEqual([5, 4, 3, 2, 1])
    expectValidPayload(payload)
  })

  it('采样产物可校验：sampled 产物过 profilePayloadSchema.safeParse（§3.3 预览与上送同一装配产物）；sampled 形状非法被拒', () => {
    const books = makeLibraryBooks(BOOKLIST_FULL_LIMIT + 1, 'V')
    const input: ProfileStatsInput = {
      books,
      catalogRecords: [],
      borrowCycles: [],
      sources: [makeSource('src-sz')],
    }
    const stats = computeProfileStats(input, STATS_OPTS)
    const payload = serializePayload(input, stats, { classificationSystem: 'clc' })

    expect(profilePayloadSchema.safeParse(payload).success).toBe(true)
    expect(payload.sampled).toEqual({ total: 3001, sent: 500 })
    expect(payload.books).toHaveLength(payload.sampled!.sent)

    // sampled 对象自身 strict：多余字段拒绝
    expect(
      profilePayloadSchema
        .safeParse({ ...payload, sampled: { total: 3001, sent: 500, extra: 1 } })
        .success,
    ).toBe(false)
  })

  it('空库/无借阅：books=[] 结构完整且无 sampled；超阈值全 0 借阅 → 采样集 borrowCount 全 0', () => {
    const empty: ProfileStatsInput = { books: [], catalogRecords: [], borrowCycles: [], sources: [] }
    const emptyPayload = serializePayload(empty, computeProfileStats(empty, STATS_OPTS), {
      classificationSystem: null,
    })
    expect(emptyPayload.books).toEqual([])
    expect(emptyPayload).not.toHaveProperty('sampled')
    expectValidPayload(emptyPayload)

    const books = makeLibraryBooks(BOOKLIST_FULL_LIMIT + 1, 'Z')
    const zeroInput: ProfileStatsInput = {
      books,
      catalogRecords: [],
      borrowCycles: [],
      sources: [makeSource('src-sz')],
    }
    const zeroPayload = serializePayload(zeroInput, computeProfileStats(zeroInput, STATS_OPTS), {
      classificationSystem: 'clc',
    })
    expect(zeroPayload.sampled).toEqual({ total: 3001, sent: 500 })
    expect(zeroPayload.books).toHaveLength(SAMPLE_BOOKS_LIMIT)
    expect(zeroPayload.books.every((b) => b.borrowCount === 0)).toBe(true)
  })

  it('采样分支黑名单穷举：采样书条目与全量同白名单字段集，黑名单值不出现', () => {
    const secret = secretBook() // id 'book-secret'、title '秘密之书'，塞满黑名单值
    const books = [secret, ...makeLibraryBooks(BOOKLIST_FULL_LIMIT, 'BL')]
    // 秘密书 10 次借阅（其余 0 次）→ 必入选采样集
    const cycles = Array.from({ length: 10 }, (_, i) =>
      makeCycle(`cyc-sec-${i}`, 'book-secret', 'src-secret', U('2026-01-01T00:00:00.000Z'), 'borrowed', 'BC-SECRET-77'),
    )
    const input: ProfileStatsInput & { rawRecords: RawRecord[] } = {
      books,
      catalogRecords: [secretCatalog()],
      borrowCycles: cycles,
      sources: [makeSource('src-secret')],
      rawRecords: [secretRaw()],
    }
    const stats = computeProfileStats(input, STATS_OPTS)
    const payload = serializePayload(input, stats, { classificationSystem: 'clc' })
    const serialized = JSON.stringify(payload)

    expect(payload.sampled).toEqual({ total: 3001, sent: 500 })
    const sampledSecret = payload.books.find((b) => b.title === '秘密之书')
    expect(sampledSecret).toBeDefined()
    expect(sampledSecret!.classification).toEqual({ code: 'I', name: '文学' })
    expect(sampledSecret!.borrowCount).toBe(10)
    expect(Object.keys(sampledSecret!).sort()).toEqual([
      'authors',
      'borrowCount',
      'classification',
      'publishYear',
      'publisher',
      'subjects',
      'subtitle',
      'title',
    ])

    const blacklistValues = [
      'cardno-9X8Y7Z',
      'RAW-ONLY-SECRET',
      'BC-SECRET-77',
      '2026-02-14T08:30:00.000Z',
      '2026-02-20T08:30:00.000Z',
      '深圳图书馆',
      'metaId-TOP-SECRET',
      'metaIdKey-TOP-SECRET',
      '9787123456789',
      '123456789X',
      'TOP-SECRET-tag',
      '59.99',
      'CNY',
      'cover-TOP-SECRET',
      'TOP-SECRET-translator',
      'TOP-SECRET-parallel',
      'TOP-SECRET-desc',
      'TOP-SECRET-location',
      'TOP-SECRET-return-location',
      'src-secret',
      'I247.5',
      '第1版',
      '999',
    ]
    for (const value of blacklistValues) {
      expect(serialized).not.toContain(value)
    }
    expectValidPayload(payload)
  })
})
// ---- 年度场景（S-3，ai-features §9.1：切片替代全量、同一白名单形态、目标值排除） ----
// 年度叙事 payload：yearSlice 聚合白名单子集 + 切片内全量每书字段（§3.2 同形态）；
// 装配器与画像同函数族（分类/采样复用），借阅次数取年内口径（与 computeYearSlice 同源）；
// 年度目标值（UserPreferences.annualGoals，G-2 字段名）绝不进 payload——逐值穷举断言强制。
describe('serializeYearPayload（S-3 年度场景，ai-features §9.1/§3.2）', () => {
  const YEAR = 2026

  /** 年度切片（该年独立 Book + 聚合，分类体系固定 clc）。 */
  function yearSliceOf(input: ProfileStatsInput, year: number): YearSliceResult {
    return computeYearSlice(
      input.books,
      {
        catalogRecords: input.catalogRecords,
        borrowCycles: input.borrowCycles,
        sources: input.sources,
      },
      year,
      { classificationSystem: 'clc' },
    )
  }

  /** 2026 切片夹具：book-a 年内 2 次 / book-c 在借 1 次 / secret 1 次；book-b 跨年只计 2025；
   *  device 书 2026 周期被设备排除。 */
  function yearFixtures(): ProfileStatsInput {
    const bookA: Book = {
      ...makeBook('book-a', '9780000000001', '三体'),
      authors: ['刘慈欣'],
      subtitle: '地球往事',
      publisher: '重庆出版社',
      publishDate: '2008-01-15',
      subjects: ['科幻小说'],
      tags: ['私密标签'],
      price: { amount: 12.34, currency: 'CNY' },
    }
    const bookB: Book = { ...makeBook('book-b', '9780000000002', '去年之书') }
    const bookC: Book = { ...makeBook('book-c', null, '在借之书') }
    const device: Book = { ...makeBook('book-dev', null, '电子阅读器'), materialType: 'device' }
    return {
      books: [bookA, bookB, device, bookC, secretBook()],
      catalogRecords: [
        makeCatalog('cr-a', 'book-a', 'src-sz', 'BC-A', 'metaId-A', [
          { system: 'clc', code: 'I247.5' },
        ]),
        makeCatalog('cr-b', 'book-b', 'src-sz', 'BC-B', 'metaId-B', [
          { system: 'clc', code: 'K252.1' },
        ]),
        secretCatalog(),
      ],
      borrowCycles: [
        {
          ...makeCycle('cyc-a1', 'book-a', 'src-sz', U('2026-01-10T00:00:00.000Z'), 'returned', 'BC-A'),
          returnedAt: U('2026-01-20T00:00:00.000Z'),
        },
        {
          ...makeCycle('cyc-a2', 'book-a', 'src-sz', U('2026-03-05T00:00:00.000Z'), 'returned', 'BC-A'),
          returnedAt: U('2026-03-11T00:00:00.000Z'),
        },
        {
          ...makeCycle('cyc-b1', 'book-b', 'src-sz', U('2025-12-31T12:00:00.000Z'), 'returned', 'BC-B'),
          returnedAt: U('2026-01-08T12:00:00.000Z'), // 跨年周期只计入 borrowedAt 所在年（2025）
        },
        // 在借周期计入（不依赖 status='returned'）
        makeCycle('cyc-c1', 'book-c', 'src-sz', U('2026-06-01T00:00:00.000Z'), 'borrowed', 'BC-C'),
        // 设备书 2026 周期 → 排除
        makeCycle('cyc-d1', 'book-dev', 'src-sz', U('2026-02-01T00:00:00.000Z'), 'returned', 'BC-D'),
        secretCycle(), // book-secret，2026-02-14 借出
      ],
      sources: [makeSource('src-sz'), makeSource('src-secret')],
    }
  }

  it('黑名单逐值穷举（年度专项）：cardno/条码/借还时点/馆名/单条周期/ISBN/标签/价格 + annualGoals 目标值不出现', () => {
    const input = yearFixtures()
    const slice = yearSliceOf(input, YEAR)
    const payload = serializeYearPayload(input, slice, YEAR, {
      classificationSystem: 'clc',
    })
    const serialized = JSON.stringify(payload)

    const blacklistValues = [
      'cardno-9X8Y7Z', // RawRecord.data.cardno（rawRecords 整体不发送）
      'RAW-ONLY-SECRET', // RawRecord 独有值
      'BC-SECRET-77', // CatalogRecord.barcodes + BorrowCycle.barcode
      '2026-02-14T08:30:00.000Z', // secretCycle.borrowedAt（单条周期/时点）
      '2026-02-20T08:30:00.000Z', // secretCycle.returnedAt
      '2026-01-10T00:00:00.000Z', // book-a borrowedAt
      '2026-03-11T00:00:00.000Z', // book-a returnedAt
      '深圳图书馆', // Source.name 馆名
      'metaId-TOP-SECRET', // CatalogRecord.metaId
      'metaIdKey-TOP-SECRET', // CatalogRecord.metaIdKey
      '9787123456789', // Book.isbn13
      '123456789X', // Book.isbn10
      'TOP-SECRET-tag', // Book.tags
      '私密标签', // Book.tags（年度夹具）
      '59.99', // Book.price.amount
      '12.34', // Book.price.amount（年度夹具）
      'CNY', // Book.price.currency
      'cover-TOP-SECRET', // Book.coverUrl
      'TOP-SECRET-translator', // Book.translators
      'TOP-SECRET-parallel', // Book.parallelTitles
      'TOP-SECRET-desc', // Book.description
      'TOP-SECRET-location', // BorrowCycle.borrowLocation
      'TOP-SECRET-return-location', // BorrowCycle.returnLocation
      'src-secret', // Book.sourceIds / Source.id（切片实体外也不得出现）
      'I247.5', // 原始分类号（只发一级归并 code）
      '第1版', // Book.edition
      '999', // Book.pages
    ]
    for (const value of blacklistValues) {
      expect(serialized).not.toContain(value)
    }
    // 年度目标值（G-2 字段名 + 值）：UserPreferences.annualGoals 绝不出现在 payload。
    expect(serialized).not.toContain('annualGoals')
    expect(serialized).not.toContain('17') // 目标值 17（夹具聚合数字为 1/2/3，不碰撞）

    // 结构白名单：顶层 = [books, slice, year]；slice = [bookCount, classification, topBooks]；
    // 每书 = §3.2 8 字段；无 gantt/money/rawRecords/bookIds。
    const parsed = JSON.parse(serialized) as YearPayload
    expect(Object.keys(parsed).sort()).toEqual(['books', 'slice', 'year'])
    expect(Object.keys(parsed.slice).sort()).toEqual([
      'bookCount',
      'classification',
      'topBooks',
    ])
    expect(Object.keys(parsed.books[0]!).sort()).toEqual([
      'authors',
      'borrowCount',
      'classification',
      'publishYear',
      'publisher',
      'subjects',
      'subtitle',
      'title',
    ])
    expect(parsed).not.toHaveProperty('gantt')
    expect(parsed).not.toHaveProperty('money')
    expect(parsed).not.toHaveProperty('rawRecords')
    expect(parsed).not.toHaveProperty('sampled')
    expect(parsed.slice).not.toHaveProperty('bookIds')
    expectValidYearPayload(payload)
  })

  it('数字同源：slice 子集 = computeYearSlice 产物；每书 borrowCount = 年内借阅次数（非全量）', () => {
    const input = yearFixtures()
    const slice = yearSliceOf(input, YEAR)
    const payload = serializeYearPayload(input, slice, YEAR, {
      classificationSystem: 'clc',
    })

    // 聚合白名单子集与本地聚合深等价（数字同源：叙事/目标卡/回顾同一产物）。
    expect(payload.slice).toEqual({
      bookCount: slice.bookCount,
      topBooks: slice.topBooks,
      classification: slice.classification,
    })
    expect(payload.year).toBe(YEAR)
    // 2026 年独立 Book = book-a/book-c/book-secret（device、2025 排除）
    expect(payload.slice.bookCount).toBe(3)
    expect(payload.books.map((b) => b.title).sort()).toEqual([
      '三体',
      '在借之书',
      '秘密之书',
    ])

    // 每书 borrowCount = 年内借阅次数（book-a 年内 2 次而非全量 2 次；book-c 在借 1 次）。
    const byTitle = (title: string) => payload.books.find((b) => b.title === title)!
    expect(byTitle('三体').borrowCount).toBe(2)
    expect(byTitle('在借之书').borrowCount).toBe(1)
    expect(byTitle('秘密之书').borrowCount).toBe(1)
    expect(byTitle('三体')).toMatchObject({
      title: '三体',
      subtitle: '地球往事',
      authors: ['刘慈欣'],
      publishYear: '2008',
      publisher: '重庆出版社',
      classification: { code: 'I', name: '文学' },
      subjects: ['科幻小说'],
    })
    expectValidYearPayload(payload)
  })

  it('空年：slice 零值 → books=[]/bookCount=0/topBooks=[]/classification=[]，结构完整不抛错', () => {
    const input = yearFixtures()
    const slice = yearSliceOf(input, 2024)
    const payload = serializeYearPayload(input, slice, 2024, {
      classificationSystem: 'clc',
    })

    expect(payload.year).toBe(2024)
    expect(payload.slice.bookCount).toBe(0)
    expect(payload.slice.topBooks).toEqual([])
    expect(payload.slice.classification).toEqual([])
    expect(payload.books).toEqual([])
    expect(payload).not.toHaveProperty('sampled')
    expectValidYearPayload(payload)
  })

  it('采样兜底：切片书目超 BOOKLIST_FULL_LIMIT → sampled 标记（聚合完整、书籍降级）', () => {
    const books = Array.from({ length: BOOKLIST_FULL_LIMIT + 1 }, (_, i) => {
      const n = String(i).padStart(4, '0')
      return { ...makeBook(`Y-${n}`, null, `Y ${n}`) }
    })
    const cycles = books.map((b) =>
      makeCycle(`cyc-${b.id}`, b.id, 'src-sz', U('2026-01-01T00:00:00.000Z'), 'borrowed'),
    )
    const input: ProfileStatsInput = {
      books,
      catalogRecords: [],
      borrowCycles: cycles,
      sources: [makeSource('src-sz')],
    }
    const slice = yearSliceOf(input, YEAR)
    const payload = serializeYearPayload(input, slice, YEAR, {
      classificationSystem: 'clc',
    })

    expect(payload.slice.bookCount).toBe(BOOKLIST_FULL_LIMIT + 1) // 聚合不采样
    expect(payload.books).toHaveLength(SAMPLE_BOOKS_LIMIT)
    expect(payload.sampled).toEqual({ total: 3001, sent: 500 })
    expectValidYearPayload(payload)
  })

  it('schema 严格白名单：合法 payload 通过；缺字段/错型/未知字段（顶层/slice/topBooks/每书/sampled）拒绝', () => {
    const input = yearFixtures()
    const slice = yearSliceOf(input, YEAR)
    const payload = serializeYearPayload(input as ProfileStatsInput, slice, YEAR, { classificationSystem: 'clc' })
    expect(yearPayloadSchema.safeParse(payload).success).toBe(true)

    const missingYear = { ...payload } as Record<string, unknown>
    delete missingYear.year
    expect(yearPayloadSchema.safeParse(missingYear).success).toBe(false)
    const stringYear = { ...payload, year: '2026' }
    expect(yearPayloadSchema.safeParse(stringYear).success).toBe(false)

    const extraTop = { ...payload, bookIds: ['book-a'] }
    expect(yearPayloadSchema.safeParse(extraTop).success).toBe(false)
    const extraSlice = {
      ...payload,
      slice: { ...payload.slice, yearIds: ['book-a'] },
    }
    expect(yearPayloadSchema.safeParse(extraSlice).success).toBe(false)
    const stringCount = {
      ...payload,
      slice: { ...payload.slice, bookCount: '3' },
    }
    expect(yearPayloadSchema.safeParse(stringCount).success).toBe(false)
    const extraTopBook = {
      ...payload,
      slice: {
        ...payload.slice,
        topBooks: [{ ...payload.slice.topBooks[0]!, title: '三体' }],
      },
    }
    expect(yearPayloadSchema.safeParse(extraTopBook).success).toBe(false)
    const extraBookField = {
      ...payload,
      books: [{ ...payload.books[0]!, isbn13: '9787123456789' }],
    }
    expect(yearPayloadSchema.safeParse(extraBookField).success).toBe(false)
    const extraSampled = {
      ...payload,
      sampled: { total: 3001, sent: 500, extra: 1 },
    }
    expect(yearPayloadSchema.safeParse(extraSampled).success).toBe(false)
  })

  it('纯函数性：同输入两次调用深等价；stub Date.now 前后输出不变', () => {
    const input = yearFixtures()
    const slice = yearSliceOf(input, YEAR)
    const first = serializeYearPayload(input as ProfileStatsInput, slice, YEAR, { classificationSystem: 'clc' })

    const spy = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const second = serializeYearPayload(input, slice, YEAR, { classificationSystem: 'clc' })
    spy.mockRestore()

    expect(second).toEqual(first)
    expect(serializeYearPayload(input, slice, YEAR, { classificationSystem: 'clc' })).toEqual(
      first,
    )
  })

  it('模块源码不读偏好（无 annualGoals/readPreferences 引用——目标值装配源不存在）', () => {
    expect(sanitizeSource).not.toMatch(/annualGoals|readPreferences/)
  })

  function expectValidYearPayload(payload: YearPayload): void {
    const result = yearPayloadSchema.safeParse(payload)
    expect(result.success).toBe(true)
  }
})
