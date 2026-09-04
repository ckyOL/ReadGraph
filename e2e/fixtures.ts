// 脱敏 E2E 夹具构造（C-7）。
// 生成 Book / CatalogRecord / BorrowCycle / Source 实体，日期为 ISO 字符串
// （由 e2e-seed 在浏览器侧 revive 为 Date）。
const DAY = 86_400_000

/** 夹具 Book 形状（日期为 ISO 字符串，e2e-seed 在浏览器侧 revive 为 Date）。
 *  字段与 src/types/entities.ts Book 对齐；缺省字段由 schema 默认值兜底。 */
interface FixtureBook {
  id: string
  isbn13: string | null
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
  createdAt: string
  updatedAt: string
}

/** 夹具 CatalogRecord 形状（含 volume / opacEnrichment，opac-enrichment §6）。 */
interface FixtureCatalogRecord {
  id: string
  bookId: string
  sourceId: string
  metaId: string | number | null
  metaIdKey: string | null
  barcodes: string[]
  classifications: { system: 'clc'; code: string }[]
  volume: string | null
  opacEnrichment: {
    providerId: string | null
    status: 'fetched' | 'not_found' | 'failed'
    fetchedAt: Date | null
    sourceUrl: string | null
  } | null
  createdAt: string
  updatedAt: string
}

/** 夹具 BorrowCycle 形状。 */
interface FixtureBorrowCycle {
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
  createdAt: string
  updatedAt: string
}

/** 夹具 Source 形状（library 嵌套 + parserVersion 保留编辑语义）。 */
interface FixtureSource {
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
  createdAt: string
  lastImportAt: Date | null
}

/** 夹具载荷：与 e2e-seed SeedPayload 对齐的实体集合（日期为 ISO 字符串）。 */
interface FixturePayload {
  sources: FixtureSource[]
  books: FixtureBook[]
  catalogRecords: FixtureCatalogRecord[]
  borrowCycles: FixtureBorrowCycle[]
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

function book(
  i: number,
  title: string,
  isbn13: string | null,
  clc: string,
  sourceId: string,
  needsReview = false,
): FixtureBook {
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
    needsReview,
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
  volume: string | null = null,
  opacEnrichment: FixtureCatalogRecord['opacEnrichment'] = null,
): FixtureCatalogRecord {
  return {
    id: `cat-${i}`,
    bookId,
    sourceId,
    metaId: 1000 + i,
    metaIdKey: 'metaid',
    barcodes: [barcode],
    classifications: [{ system: 'clc', code: clc }],
    volume,
    opacEnrichment,
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
): FixtureBorrowCycle {
  return {
    id: `cycle-${i}`,
    bookId,
    // 周期归属该书编目（M2/M3 参照完整性：导出→恢复须可 round-trip）。
    // 不能用 `cat-${i}`：book-2/book-3 各有两个周期，索引会溢出到不存在的 cat-4+。
    catalogRecordId: `cat-${bookId.replace('book-', '')}`,
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
export function buildDesensitizedFixture(): FixturePayload {
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

/**
 * 拼贴乙版式夹具（v2 §4.2.3 E2E 增补）：14 本书各 1 周期（bookCount=14 ≥ 阈值 12），
 * 触发拼贴带 + 「+6 本」角标；其余结构与脱敏小数据集同形态（无封面 → 占位路径）。
 * id 偏移 2000 起，与基础数据集不冲突。
 */
export function buildCollageFixture(): FixturePayload {
  const src = source()
  const books: FixtureBook[] = []
  const cats: FixtureCatalogRecord[] = []
  const cycles: FixtureBorrowCycle[] = []
  const base = Date.UTC(2024, 0, 10)
  for (let i = 0; i < 14; i++) {
    const n = 2000 + i
    books.push(book(n, `拼贴书${i + 1}`, `9788${String(i).padStart(9, '0')}`, 'I', src.id))
    cats.push(catalog(n, `book-${n}`, src.id, `BC${n}`, 'I'))
    cycles.push(
      cycle(n, `book-${n}`, src.id, `BC${n}`, base + i * 3 * DAY, base + i * 3 * DAY + DAY, 'returned'),
    )
  }
  return { sources: [src], books, catalogRecords: cats, borrowCycles: cycles }
}

function source(): FixtureSource {
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

/**
 * 分类法层级 E2E 夹具（classification-hierarchy §8）：4 本书全部 J 类
 * （含细分缺口 `J238.2`，跨 J 子类 J2/J29/J6），treemap 一级仅一个 J 单元格，
 * 便于画布中心点击下钻。classCodes 派生字段由 e2e-seed 注入时补写。
 */
export function buildClassificationFixture(): FixturePayload {
  const src = source()
  const books = [
    book(1, '漫画A', '9781000000001', 'J218.2', src.id),
    book(2, '外国漫画B', '9781000000002', 'J238.2', src.id),
    book(3, '书法C', '9781000000003', 'J292', src.id),
    book(4, '音乐D', '9781000000004', 'J624', src.id),
  ]
  const cats = [
    catalog(1, 'book-1', src.id, 'JC1', 'J218.2'),
    catalog(2, 'book-2', src.id, 'JC2', 'J238.2'),
    catalog(3, 'book-3', src.id, 'JC3', 'J292'),
    catalog(4, 'book-4', src.id, 'JC4', 'J624'),
  ]
  const base = Date.UTC(2024, 0, 10)
  const cycles = [
    cycle(1, 'book-1', src.id, 'JC1', base, base + 5 * DAY, 'returned'),
    cycle(2, 'book-2', src.id, 'JC2', base + 10 * DAY, base + 20 * DAY, 'returned'),
    cycle(3, 'book-3', src.id, 'JC3', base + 30 * DAY, base + 40 * DAY, 'returned'),
    cycle(4, 'book-4', src.id, 'JC4', base + 60 * DAY, null, 'borrowed'),
  ]
  return { sources: [src], books, catalogRecords: cats, borrowCycles: cycles }
}

/**
 * 150-lane 大库夹具（reading-profile §7 gantt 性能基线）：脱敏小数据集 +
 * 150 本书 × 各 2 周期（已还 + 在借），验证高 lane 数下甘特 canvas 渲染不崩、
 * 视口高度封顶（min 280 / max 624）。id 偏移 1000 起，与基础数据集不冲突。
 */
export function buildLargeFixture(): FixturePayload {
  const base = buildDesensitizedFixture()
  const srcId = base.sources[0].id
  const books: FixtureBook[] = []
  const cats: FixtureCatalogRecord[] = []
  const cycles: FixtureBorrowCycle[] = []
  for (let i = 0; i < 150; i++) {
    const bid = `book-${1000 + i}`
    books.push(book(1000 + i, `书${i}`, `9789${String(i).padStart(9, '0')}`, 'I', srcId))
    cats.push(catalog(1000 + i, bid, srcId, `BB${i}`, 'I'))
    cycles.push(
      cycle(
        1000 + i,
        bid,
        srcId,
        `BB${i}`,
        Date.UTC(2024, 0, 1) + i * DAY,
        Date.UTC(2024, 0, 8) + i * DAY,
        'returned',
      ),
      cycle(
        2000 + i,
        bid,
        srcId,
        `BB${i}`,
        Date.UTC(2024, 1, 1) + i * DAY,
        null,
        'borrowed',
      ),
    )
  }
  return {
    sources: base.sources,
    books: [...base.books, ...books],
    catalogRecords: [...base.catalogRecords, ...cats],
    borrowCycles: [...base.borrowCycles, ...cycles],
  }
}

/**
 * 书库编辑 E2E 夹具（book-editing §7.6）：四类书覆盖——普通（book-1）、
 * 占位（book-2：needsReview && 无 ISBN）、套装候选（book-3：needsReview && 有 ISBN）、
 * 已确认套装（book-4：两个 volume 编目，cat-4a 已补全 fetched → 详情页 Re-fetch，
 * cat-4b 未补全 → Enrich）。source 保留 library 嵌套 + parserVersion。
 */
export function buildEditingFixture(): FixturePayload {
  const src = source()
  const books: FixtureBook[] = [
    { ...book(1, '小说A', '9780000000001', 'I', src.id), authors: ['作者A'] },
    { ...book(2, '福田图书馆读者自选图书', null, 'I', src.id, true), authors: ['作者A'] },
    { ...book(3, '合成书目052', '9787574012745', 'I', src.id, true), authors: ['作者A'] },
    { ...book(4, '历史C', '9780000000003', 'I', src.id), authors: ['作者A'] },
  ]
  const cats: FixtureCatalogRecord[] = [
    catalog(1, 'book-1', src.id, 'BC1', 'I'),
    catalog(2, 'book-2', src.id, 'BC2', 'I'),
    catalog(3, 'book-3', src.id, 'BC3', 'I'),
    catalog(4, 'book-4', src.id, 'BC4', 'I', '3', {
      providerId: 'szlib',
      status: 'fetched',
      fetchedAt: null,
      sourceUrl: 'https://example.test/',
    }),
    catalog(5, 'book-4', src.id, 'BC5', 'I', '4'),
  ]
  const base = Date.UTC(2024, 0, 10)
  const cycles: FixtureBorrowCycle[] = [
    cycle(1, 'book-1', src.id, 'BC1', base, base + 5 * DAY, 'returned'),
    cycle(2, 'book-2', src.id, 'BC2', base, base + 5 * DAY, 'returned'),
    cycle(3, 'book-3', src.id, 'BC3', base, base + 5 * DAY, 'returned'),
  ]
  return { sources: [src], books, catalogRecords: cats, borrowCycles: cycles }
}
