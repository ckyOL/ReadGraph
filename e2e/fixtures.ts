// 脱敏 E2E 夹具构造（C-7）。
// 生成 Book / CatalogRecord / BorrowCycle / Source 实体，日期为 ISO 字符串
// （由 e2e-seed 在浏览器侧 revive 为 Date）。
const DAY = 86_400_000

interface EntityDate {
  createdAt: string
  updatedAt: string
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function book(
  i: number,
  title: string,
  isbn13: string,
  clc: string,
  sourceId: string,
): {
  id: string
  isbn13: string
  isbn10: string | null
  title: string
  subtitle: string | null
  authors: string[]
  translators: string[]
  publisher: string | null
  publishDate: string | null
  edition: string | null
  pages: number | null
  price: { amount: number; currency: string } | null
  subjects: string[]
  tags: string[]
  coverUrl: string | null
  description: string | null
  parallelTitles: string[]
  needsReview: boolean
  sourceIds: string[]
} & EntityDate {
  return {
    id: `book-${i}`,
    isbn13,
    isbn10: null,
    title,
    subtitle: null,
    authors: [`作者${i}`],
    translators: [],
    publisher: '出版社',
    publishDate: '2020-01-01',
    edition: null,
    pages: 200,
    price: { amount: 30, currency: 'CNY' },
    subjects: [],
    tags: [],
    coverUrl: null,
    description: null,
    parallelTitles: [],
    needsReview: false,
    sourceIds: [sourceId],
    createdAt: iso(Date.UTC(2024, 0, 1)),
    updatedAt: iso(Date.UTC(2024, 0, 1)),
  }
}

function catalog(
  i: number,
  bookId: string,
  sourceId: string,
  barcode: string,
  clc: string,
): {
  id: string
  bookId: string
  sourceId: string
  metaId: string | number | null
  metaIdKey: string | null
  barcodes: string[]
  classifications: { system: 'clc'; code: string }[]
} & EntityDate {
  return {
    id: `cat-${i}`,
    bookId,
    sourceId,
    metaId: 1000 + i,
    metaIdKey: 'metaid',
    barcodes: [barcode],
    classifications: [{ system: 'clc', code: clc }],
    createdAt: iso(Date.UTC(2024, 0, 1)),
    updatedAt: iso(Date.UTC(2024, 0, 1)),
  }
}

function cycle(
  i: number,
  bookId: string,
  sourceId: string,
  barcode: string,
  borrowedMs: number,
  returnedMs: number | null,
  status: 'borrowed' | 'returned',
): {
  id: string
  bookId: string
  catalogRecordId: string
  sourceId: string
  borrowedAt: string
  returnedAt: string | null
  status: 'borrowed' | 'returned'
  borrowLocation: string | null
  returnLocation: string | null
  rawRecordIds: string[]
  barcode: string
} & EntityDate {
  return {
    id: `cycle-${i}`,
    bookId,
    catalogRecordId: `cat-${i}`,
    sourceId,
    borrowedAt: iso(borrowedMs),
    returnedAt: returnedMs === null ? null : iso(returnedMs),
    status,
    borrowLocation: '图书馆',
    returnLocation: null,
    rawRecordIds: [],
    barcode,
    createdAt: iso(borrowedMs),
    updatedAt: iso(returnedMs ?? borrowedMs),
  }
}

/** 脱敏小数据集：3 本书、3 条编目、6 个借阅周期（含在借态），跨 CLC 一级类目。 */
export function buildDesensitizedFixture(): {
  sources: ReturnType<typeof source>[]
  books: ReturnType<typeof book>[]
  catalogRecords: ReturnType<typeof catalog>[]
  borrowCycles: ReturnType<typeof cycle>[]
} {
  const src = source()
  const books = [
    book(1, '小说A', '9780000000001', 'I', src.id),
    book(2, '哲学B', '9780000000002', 'B', src.id),
    book(3, '历史C', '9780000000003', 'K', src.id),
  ]
  const cats = [
    catalog(1, 'book-1', src.id, 'BC1', 'I'),
    catalog(2, 'book-2', src.id, 'BC2', 'B'),
    catalog(3, 'book-3', src.id, 'BC3', 'K'),
  ]
  const base = Date.UTC(2024, 0, 10)
  const cycles = [
    cycle(1, 'book-1', src.id, 'BC1', base, base + 5 * DAY, 'returned'),
    cycle(2, 'book-1', src.id, 'BC1', base + 30 * DAY, base + 40 * DAY, 'returned'),
    cycle(3, 'book-2', src.id, 'BC2', base + 10 * DAY, base + 20 * DAY, 'returned'),
    cycle(4, 'book-2', src.id, 'BC2', base + 60 * DAY, null, 'borrowed'),
    cycle(5, 'book-3', src.id, 'BC3', base + 100 * DAY, base + 120 * DAY, 'returned'),
    cycle(6, 'book-3', src.id, 'BC3', base + 150 * DAY, base + 190 * DAY, 'returned'),
  ]
  return { sources: [src], books, catalogRecords: cats, borrowCycles: cycles }
}

function source(): {
  id: string
  type: 'library'
  name: string
  parserId: string
  parserVersion: string | null
  timezone: string
  library: {
    libraryType: 'public'
    city: null
    province: null
    website: null
    opacUrl: null
    classificationSystem: 'clc'
  } | null
  notes: string | null
  totalImportedRecords: number
} & { createdAt: string; lastImportAt: Date | null } {
  return {
    id: 'src-e2e',
    type: 'library',
    name: '测试图书馆',
    parserId: 'szlib',
    parserVersion: '1.0.0',
    timezone: 'Asia/Shanghai',
    library: {
      libraryType: 'public',
      city: null,
      province: null,
      website: null,
      opacUrl: null,
      classificationSystem: 'clc',
    },
    notes: null,
    totalImportedRecords: 6,
    createdAt: iso(Date.UTC(2024, 0, 1)),
    lastImportAt: null,
  }
}
