// 脱敏管道黑名单断言（ai-features §3.3）：装配产物只含白名单字段，
// 黑名单值在序列化文本中逐值穷举断言不出现（非抽样）。纯函数性由两次调用深等价 + Date.now stub 强制。
import { describe, expect, it, vi } from 'vitest'

import { computeProfileStats } from '@/lib/profile-stats'
import type { ProfileStatsInput, ProfileStatsOptions } from '@/lib/profile-stats'
import { makeBook, makeCatalog, makeCycle, makeRawRecord, makeSource } from '@/db/test-helpers'
import { BOOKLIST_FULL_LIMIT, profilePayloadSchema, serializePayload } from './sanitize'
import sanitizeSource from './sanitize.ts?raw'
import type { ProfilePayload } from './sanitize'
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
