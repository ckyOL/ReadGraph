// Q-6 zod 默认值读路径兜底（M1 classCodes 同类）：parseOrDefault 从 schema 提取默认值，
// 直读旧记录时只补缺字段——不覆盖已有字段、不校验、不剥离未知字段、不执行派生 transform。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { bookSchema, catalogRecordSchema, importLogSchema } from '@/db/schemas'
import {
  createTestDB,
  closeTestDB,
  makeBook,
  makeCatalog,
  makeImportLog,
} from '@/db/test-helpers'
import type { ReadGraphDB } from '@/db/db'
import type { Book, CatalogRecord } from '@/types/entities'
import { buildLibraryRows } from './library-view'
import { parseOrDefault } from './parse-or-default'

describe('parseOrDefault — 读路径默认值归一', () => {
  it('缺 parallelTitles 的旧 Book 记录 → []（与 schema 默认值一致），其余字段原样保留', () => {
    const { parallelTitles: _pt, ...legacy } = makeBook('bk-1', '9787000000001', '旧书')
    void _pt
    const out = parseOrDefault(bookSchema, legacy)
    expect(out.parallelTitles).toEqual([])
    expect(out.title).toBe('旧书')
    expect(out.isbn13).toBe('9787000000001')
    expect(out.authors).toEqual(['A'])
    expect(out.sourceIds).toEqual(['src-sz'])
    expect(out.needsReview).toBe(false)
  })

  it('缺 materialType → "book"（与 schema 默认值一致）', () => {
    const { materialType: _mt, ...legacy } = makeBook('bk-2', null, '无类型书')
    void _mt
    const out = parseOrDefault(bookSchema, legacy)
    expect(out.materialType).toBe('book')
  })

  it('已有字段不覆盖：parallelTitles 非空保留、materialType=device 保留', () => {
    const book = makeBook('bk-3', '9787000000002', '有字段书')
    const out = parseOrDefault(bookSchema, {
      ...book,
      parallelTitles: ['The Lord of the Rings'],
      materialType: 'device' as const,
    })
    expect(out.parallelTitles).toEqual(['The Lord of the Rings'])
    expect(out.materialType).toBe('device')
  })

  it('undefined 值字段视同缺失（与 zod 解析语义一致）', () => {
    const out = parseOrDefault(bookSchema, {
      ...makeBook('bk-4', null, 'u'),
      parallelTitles: undefined,
    })
    expect(out.parallelTitles).toEqual([])
  })

  it('未知字段保留（读路径不剥离）', () => {
    const book = makeBook('bk-5', null, 'extra')
    const out = parseOrDefault(bookSchema, { ...book, legacyFlag: true })
    expect((out as Book & { legacyFlag?: boolean }).legacyFlag).toBe(true)
  })

  it('非对象输入原样返回（null/undefined/原始值/数组不归一）', () => {
    expect(parseOrDefault(bookSchema, null)).toBeNull()
    expect(parseOrDefault(bookSchema, undefined)).toBeUndefined()
    expect(parseOrDefault(bookSchema, 'x')).toBe('x')
    expect(parseOrDefault(bookSchema, [])).toEqual([])
  })

  it('对象未缺任何字段 → 返回原引用（不产生无谓复制）', () => {
    const book = makeBook('bk-6', null, '完整书')
    expect(parseOrDefault(bookSchema, book)).toBe(book)
  })

  it('catalogRecord：缺 volume/opacEnrichment → null；transform 不执行（不补 classCodes 派生字段）', () => {
    const { volume: _v, opacEnrichment: _o, ...legacy } = makeCatalog(
      'cr-1',
      'bk-1',
      'src-sz',
      'BC1',
      'K1',
      [],
    )
    void _v
    void _o
    const out = parseOrDefault(catalogRecordSchema, legacy)
    expect(out.volume).toBeNull()
    expect(out.opacEnrichment).toBeNull()
    // 读路径只补默认值，派生 transform（classCodes）由写路径/存量回填负责。
    expect(out.classCodes).toBeUndefined()
    expect(out.barcodes).toEqual(['BC1'])
  })

  it('catalogRecord：已有 volume/opacEnrichment 原样保留', () => {
    const cr = makeCatalog('cr-2', 'bk-2', 'src-sz', 'BC2', 'K2', [
      { system: 'clc', code: 'I247.5' },
    ])
    const out = parseOrDefault(catalogRecordSchema, {
      ...cr,
      volume: '上',
      opacEnrichment: {
        providerId: 'szlib',
        status: 'fetched' as const,
        fetchedAt: new Date('2026-01-01T00:00:00.000Z'),
        sourceUrl: null,
      },
    })
    expect(out.volume).toBe('上')
    expect(out.opacEnrichment?.status).toBe('fetched')
  })

  it('嵌套对象：importLog.stats 缺 filteredRows → 0（嵌套递归补默认值，不覆盖已有）', () => {
    const { stats, ...rest } = makeImportLog()
    const { filteredRows: _f, ...statsLegacy } = stats
    void _f
    const out = parseOrDefault(importLogSchema, { ...rest, stats: statsLegacy })
    expect(out.stats.filteredRows).toBe(0)
    expect(out.stats.totalRawRecords).toBe(1)
    expect(out.fileName).toBe('export.json')
  })
})

describe('详情页直读路径（fake-indexeddb 旧记录）', () => {
  let db: ReadGraphDB
  beforeEach(() => {
    db = createTestDB()
  })
  afterEach(async () => {
    await closeTestDB(db)
  })

  it('旧 Book 记录缺 parallelTitles/materialType：toArray 直读 → parseOrDefault → 详情页渲染字段安全访问', async () => {
    // 模拟旧写路径：绕过 repository 校验直接落库缺默认字段的记录。
    const { parallelTitles: _pt, materialType: _mt, ...legacy } = makeBook(
      'bk-old',
      '9787000000001',
      '旧书',
    )
    void _pt
    void _mt
    // 显式断言为 Book：缺默认字段正是旧写路径遗留的形态（模拟对象，非类型说谎）。
    await db.books.put(legacy as Book)

    // 详情页 useLiveQuery 等价直读 + 归一（$bookId.tsx 渲染前）。
    const books = (await db.books.toArray()).map((b) => parseOrDefault(bookSchema, b))
    const book = books.find((b) => b.id === 'bk-old')!
    // 详情页渲染崩溃点：book.parallelTitles.length > 0（缺失时 undefined.length 抛 TypeError）。
    expect(book.parallelTitles.length).toBe(0)
    expect(book.materialType).toBe('book')
    expect(book.title).toBe('旧书')
    expect(book.authors).toEqual(['A'])
  })

  it('旧编目记录缺 volume/opacEnrichment：归一后 null，编目卡渲染字段安全', async () => {
    const { volume: _v, opacEnrichment: _o, ...legacy } = makeCatalog(
      'cr-old',
      'bk-old',
      'src-sz',
      'BC1',
      'K1',
      [{ system: 'clc', code: 'TP312' }],
    )
    void _v
    void _o
    // 显式断言为 CatalogRecord：缺默认字段正是旧写路径遗留的形态。
    await db.catalogRecords.put(legacy as CatalogRecord)

    const records = (await db.catalogRecords.toArray()).map((cr) =>
      parseOrDefault(catalogRecordSchema, cr),
    )
    const record = records[0]!
    // CatalogRecordCard 渲染读取：record.volume ?? null / record.classifications.length。
    expect(record.volume).toBeNull()
    expect(record.opacEnrichment).toBeNull()
    expect(record.classifications.length).toBe(1)
    expect(record.barcodes.length).toBe(1)
  })
})

describe('列表页读路径评估（Q-6 接入判断）', () => {
  it('行派生不读任何带默认值的字段 → 缺 parallelTitles/materialType 不崩（无需接入）', () => {
    const { parallelTitles: _pt, materialType: _mt, ...legacy } = makeBook(
      'bk-l',
      '9787000000003',
      '列表书',
    )
    void _pt
    void _mt
    // buildLibraryRows 只读 title/authors/isbn13/sourceIds/needsReview（均 schema 必填字段）。
    const rows = buildLibraryRows([legacy as Book], [], [], [])
    expect(rows[0]!.book.title).toBe('列表书')
    expect(rows[0]!.authors).toBe('A')
    expect(rows[0]!.isbn13).toBe('9787000000003')
    expect(rows[0]!.sourceName).toBeNull()
  })
})
