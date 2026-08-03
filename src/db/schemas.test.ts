import { describe, it, expect } from 'vitest'

import { bookSchema, catalogRecordSchema, borrowCycleSchema, sourceSchema, rawRecordSchema, importLogSchema } from '@/db/schemas'
import { uuid } from '@/db/uuid'

const now = () => new Date('2025-01-02T03:04:05Z')

const validBook = {
  id: uuid(),
  isbn13: '9787111111111',
  isbn10: null,
  title: '合成系统详解',
  subtitle: null,
  authors: ['合成作者甲', "合成作者乙"],
  translators: ['合成译者甲'],
  publisher: '机械工业出版社',
  publishDate: '2016',
  edition: null,
  pages: 733,
  price: { amount: 139, currency: 'CNY' },
  subjects: ['计算机'],
  tags: [],
  coverUrl: null,
  description: null,
  createdAt: now(),
  updatedAt: now(),
  needsReview: false,
  sourceIds: ['src-1'],
  parallelTitles: [],
}

const validCatalogRecord = {
  id: uuid(),
  bookId: validBook.id,
  sourceId: 'src-1',
  metaId: 123456,
  metaIdKey: '123456',
  barcodes: ['BC001'],
  classifications: [{ system: 'clc', code: 'TP312' }],
  volume: null,
  createdAt: now(),
  updatedAt: now(),
}

const validBorrowCycle = {
  id: uuid(),
  bookId: validBook.id,
  catalogRecordId: validCatalogRecord.id,
  sourceId: 'src-1',
  borrowedAt: now(),
  returnedAt: null,
  status: 'borrowed',
  borrowLocation: '深圳图书馆',
  returnLocation: null,
  rawRecordIds: [],
  barcode: 'BC001',
  createdAt: now(),
  updatedAt: now(),
}

const validSource = {
  id: uuid(),
  type: 'library',
  name: '深圳图书馆',
  parserId: 'szlib',
  parserVersion: '1',
  timezone: 'Asia/Shanghai',
  library: {
    libraryType: 'public',
    city: '深圳',
    province: '广东',
    website: 'https://szlib.org.cn',
    opacUrl: null,
    classificationSystem: 'clc',
  },
  notes: null,
  createdAt: now(),
  lastImportAt: null,
  totalImportedRecords: 0,
}

const validRawRecord = {
  id: uuid(),
  importLogId: 'log-1',
  sourceId: 'src-1',
  data: { title: 'x', barCode: 'BC001' },
  rowIndex: 0,
  borrowCycleId: null,
  bookId: null,
  parseStatus: 'success',
  parseNote: null,
}

const validImportLog = {
  id: 'log-1',
  sourceId: 'src-1',
  importedAt: now(),
  fileName: 'export.json',
  fileSize: 1024,
  detectedEncoding: 'utf-8',
  parserId: 'szlib',
  stats: {
    totalRawRecords: 1, newBooks: 1, updatedBooks: 0, newBorrowCycles: 1,
    skippedRecords: 0, warningCount: 0, errorCount: 0,
  },
  warnings: [],
}

describe('entity schemas — accept valid', () => {
  it.each([
    ['book', bookSchema, validBook],
    ['catalogRecord', catalogRecordSchema, validCatalogRecord],
    ['borrowCycle', borrowCycleSchema, validBorrowCycle],
    ['source', sourceSchema, validSource],
    ['rawRecord', rawRecordSchema, validRawRecord],
    ['importLog', importLogSchema, validImportLog],
  ] as const)('parses %s', (_name, schema, value) => {
    const r = schema.safeParse(value)
    expect(r.success).toBe(true)
  })
})

describe('entity schemas — reject invalid', () => {
  it('book rejects isbn13 with wrong length', () => {
    expect(bookSchema.safeParse({ ...validBook, isbn13: '123' }).success).toBe(false)
  })
  it('book rejects non-boolean needsReview', () => {
    expect(bookSchema.safeParse({ ...validBook, needsReview: 1 as unknown as boolean }).success).toBe(false)
  })
  it('catalogRecord rejects bad classification system enum', () => {
    expect(
      catalogRecordSchema.safeParse({
        ...validCatalogRecord,
        classifications: [{ system: 'xyz', code: 'TP' }],
      }).success,
    ).toBe(false)
  })
  it('catalogRecord rejects non-string/non-null volume', () => {
    expect(
      catalogRecordSchema.safeParse({ ...validCatalogRecord, volume: 3 }).success,
    ).toBe(false)
  })
  it('catalogRecord accepts volume string and null', () => {
    expect(
      catalogRecordSchema.safeParse({ ...validCatalogRecord, volume: '3' }).success,
    ).toBe(true)
    expect(
      catalogRecordSchema.safeParse({ ...validCatalogRecord, volume: null }).success,
    ).toBe(true)
  })
  it('catalogRecord missing volume defaults to null (旧导出兼容)', () => {
    const { volume: _omit, ...rest } = validCatalogRecord
    void _omit
    const r = catalogRecordSchema.safeParse(rest)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.volume).toBeNull()
  })
  it('borrowCycle rejects bad status enum', () => {
    expect(borrowCycleSchema.safeParse({ ...validBorrowCycle, status: 'overdue' }).success).toBe(false)
  })
  it('source rejects bad type enum', () => {
    expect(sourceSchema.safeParse({ ...validSource, type: 'vendor' }).success).toBe(false)
  })
  it('rawRecord rejects bad parseStatus enum', () => {
    expect(rawRecordSchema.safeParse({ ...validRawRecord, parseStatus: 'pending' }).success).toBe(false)
  })
  it('rejects missing required field (book.title)', () => {
    const { title: _omit, ...rest } = validBook
    void _omit
    expect(bookSchema.safeParse(rest).success).toBe(false)
  })
})

describe('UTC date handling', () => {
  it('book accepts ISO string and transforms to Date', () => {
    const r = bookSchema.safeParse({ ...validBook, createdAt: '2025-06-25T00:00:00.000Z' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.createdAt).toBeInstanceOf(Date)
  })
  it('book rejects invalid ISO date string', () => {
    expect(bookSchema.safeParse({ ...validBook, createdAt: 'not-a-date' }).success).toBe(false)
  })
  it('catalogRecord createdAt Date passes through as Date', () => {
    const r = catalogRecordSchema.safeParse(validCatalogRecord)
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.createdAt).toBeInstanceOf(Date)
  })
})

describe('isbn13 rules', () => {
  it('accepts null isbn13', () => {
    expect(bookSchema.safeParse({ ...validBook, isbn13: null }).success).toBe(true)
  })
  it('accepts 13-digit string', () => {
    expect(bookSchema.safeParse({ ...validBook, isbn13: '9787111111111' }).success).toBe(true)
  })
  it('rejects 12-digit string', () => {
    expect(bookSchema.safeParse({ ...validBook, isbn13: '978711111111' }).success).toBe(false)
  })
  it('rejects 14-digit string', () => {
    expect(bookSchema.safeParse({ ...validBook, isbn13: '97871111111110' }).success).toBe(false)
  })
})
