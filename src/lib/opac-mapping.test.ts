// mapOpacDetail / prefillFromChanges 纯函数测试（opac-enrichment §5.2/§5.3/§12）。
// 输入统一 OpacDetail（来源无关），夹具构造自 szlib 实测样本（§3.3）。
import { describe, expect, it, vi } from 'vitest'

import { szlibProvider } from '@/enrich/providers/szlib'
import type { OpacDetail } from '@/enrich/opac-provider'
import { mapOpacDetail, prefillFromChanges } from '@/lib/opac-mapping'
import type { Book, CatalogRecord, ClassificationEntry, ClassificationSystem, Source } from '@/types/entities'

const now = () => new Date('2025-01-01T00:00:00Z')

const emptyBook = (over: Partial<Book> = {}): Book => ({
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
  createdAt: now(),
  updatedAt: now(),
  needsReview: false,
  sourceIds: ['src-1'],
  parallelTitles: [],
  ...over,
})

const emptyRecord = (over: Partial<CatalogRecord> = {}): CatalogRecord => ({
  id: 'cr-1',
  bookId: 'bk-1',
  sourceId: 'src-1',
  metaId: 6092919,
  metaIdKey: '6092919',
  barcodes: ['D1200000001'],
  classifications: [],
  volume: null,
  createdAt: now(),
  updatedAt: now(),
  opacEnrichment: null,
  ...over,
})

const source = (system: ClassificationSystem | null = 'clc'): Source => ({
  id: 'src-1',
  type: 'library',
  name: '深圳图书馆',
  parserId: 'szlib',
  parserVersion: '1',
  timezone: 'Asia/Shanghai',
  library: {
    libraryType: 'public',
    city: '深圳',
    province: '广东',
    website: null,
    opacUrl: null,
    classificationSystem: system,
  },
  notes: null,
  createdAt: now(),
  lastImportAt: null,
  totalImportedRecords: 0,
})

/** §3.3 实测样本 → 统一 OpacDetail。 */
const sampleDetail: OpacDetail = {
  title: '合成绘本甲=Synthetic story',
  author: '(日)合成作者著 　合成译者译',
  publish: '北京:合成出版社,2023',
  page: '198页',
  price: 'CNY35.00',
  subject: '漫画-连环画-日本-现代',
  classno: 'J238.2(313)',
  abstract: null,
  isbn: '978-7-5217-4823-9',
  img: 'https://www.bookcovers.cn/index.php?client=szlib&isbn=978-7-5217-4823-9/cover',
}

/** 全空 Book + 空编目 → 全部按 §5.2 产出 fill change。 */
const ALL_FILL_CHANGES = [
  { field: 'title', kind: 'fill', current: '', proposed: '合成绘本甲' },
  { field: 'parallelTitles', kind: 'fill', current: [], proposed: ['Synthetic story'] },
  { field: 'authors', kind: 'fill', current: [], proposed: ['合成作者'] },
  { field: 'translators', kind: 'fill', current: [], proposed: ['合成译者'] },
  { field: 'isbn13', kind: 'fill', current: null, proposed: '9787521748239' },
  { field: 'publisher', kind: 'fill', current: null, proposed: '合成出版社' },
  { field: 'publishDate', kind: 'fill', current: null, proposed: '2023' },
  { field: 'pages', kind: 'fill', current: null, proposed: 198 },
  { field: 'price', kind: 'fill', current: null, proposed: { amount: 35, currency: 'CNY' } },
  { field: 'subjects', kind: 'fill', current: [], proposed: ['漫画', '连环画', '日本', '现代'] },
  {
    field: 'coverUrl',
    kind: 'fill',
    current: null,
    proposed: 'https://www.bookcovers.cn/index.php?client=szlib&isbn=978-7-5217-4823-9/cover',
  },
  {
    field: 'classifications',
    kind: 'fill',
    current: [],
    proposed: [{ system: 'clc', code: 'J238.2' } satisfies ClassificationEntry],
  },
] as const

describe('mapOpacDetail — 全空 Book', () => {
  it('样本 → 全部字段 fill change，proposed 与 §5.2 解析一致', () => {
    const { changes, warnings } = mapOpacDetail(sampleDetail, {
      book: emptyBook(),
      record: emptyRecord(),
      source: source(),
    })
    expect(changes).toEqual(ALL_FILL_CHANGES)
    expect(warnings).toEqual([])
  })

  it('title 分隔符归一化：`合成绘本甲=Synthetic story` → title/parallelTitles（§12 样本一致）', () => {
    const { changes } = mapOpacDetail(sampleDetail, {
      book: emptyBook(),
      record: emptyRecord(),
      source: source(),
    })
    const titleChange = changes.find((c) => c.field === 'title')
    const ptChange = changes.find((c) => c.field === 'parallelTitles')
    expect(titleChange?.proposed).toBe('合成绘本甲')
    expect(ptChange?.proposed).toEqual(['Synthetic story'])
  })

  it('author 归一化：`(日)合成作者著 　合成译者译` → authors/translators（§12 样本一致）', () => {
    const { changes } = mapOpacDetail(sampleDetail, {
      book: emptyBook(),
      record: emptyRecord(),
      source: source(),
    })
    expect(changes.find((c) => c.field === 'authors')?.proposed).toEqual(['合成作者'])
    expect(changes.find((c) => c.field === 'translators')?.proposed).toEqual(['合成译者'])
  })

  it('classno 去 (…) 后缀；classifications.system 取来源 classificationSystem 缺省 clc', () => {
    const { changes } = mapOpacDetail(sampleDetail, {
      book: emptyBook(),
      record: emptyRecord(),
      source: source(),
    })
    expect(changes.find((c) => c.field === 'classifications')?.proposed).toEqual([
      { system: 'clc', code: 'J238.2' },
    ])
    // 时代区分号 = 后缀剥离（纸本「不作实际号码」；实证 K833.135.72=6）
    const era = mapOpacDetail(
      { ...sampleDetail, classno: 'K833.135.72=6' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(era.changes.find((c) => c.field === 'classifications')?.proposed).toEqual([
      { system: 'clc', code: 'K833.135.72' },
    ])
    const ddc = mapOpacDetail(sampleDetail, {
      book: emptyBook(),
      record: emptyRecord(),
      source: source('ddc'),
    })
    expect(ddc.changes.find((c) => c.field === 'classifications')?.proposed).toEqual([
      { system: 'ddc', code: 'J238.2' },
    ])
    const noLib = mapOpacDetail(sampleDetail, {
      book: emptyBook(),
      record: emptyRecord(),
      source: { ...source(), library: null },
    })
    expect(noLib.changes.find((c) => c.field === 'classifications')?.proposed).toEqual([
      { system: 'clc', code: 'J238.2' },
    ])
  })

  it('占位现有书名 → title fill（占位排除属候选集 §7.1，映射层只填空）', () => {
    const { changes } = mapOpacDetail(sampleDetail, {
      book: emptyBook({ title: '福田图书馆读者自选图书' }),
      record: emptyRecord(),
      source: source(),
    })
    expect(changes.find((c) => c.field === 'title')).toEqual({
      field: 'title',
      kind: 'fill',
      current: '福田图书馆读者自选图书',
      proposed: '合成绘本甲',
    })
  })
})

describe('mapOpacDetail — 现有值相同/不同', () => {
  const fullBook = emptyBook({
    isbn13: '9787521748239',
    isbn10: null,
    title: '合成绘本甲',
    authors: ['合成作者'],
    translators: ['合成译者'],
    publisher: '合成出版社',
    publishDate: '2023',
    pages: 198,
    price: { amount: 35, currency: 'CNY' },
    subjects: ['漫画', '连环画', '日本', '现代'],
    coverUrl: 'https://www.bookcovers.cn/index.php?client=szlib&isbn=978-7-5217-4823-9/cover',
    parallelTitles: ['Synthetic story'],
  })

  it('字段非空且值相同 → 不产出 change（isbn 归一化后相同亦不产出）', () => {
    const { changes, warnings } = mapOpacDetail(sampleDetail, {
      book: fullBook,
      record: emptyRecord({
        classifications: [{ system: 'clc', code: 'J238.2' }],
      }),
      source: source(),
    })
    expect(changes).toEqual([])
    expect(warnings).toEqual([])
  })

  it('subjects 同集合不同顺序 → 不产出 change（集合语义）', () => {
    const { changes } = mapOpacDetail(sampleDetail, {
      book: emptyBook({ ...fullBook, subjects: ['现代', '日本', '连环画', '漫画'] }),
      record: emptyRecord({ classifications: [{ system: 'clc', code: 'J238.2' }] }),
      source: source(),
    })
    expect(changes).toEqual([])
  })

  it('isbn 冲突 → conflict，current/proposed 正确', () => {
    const { changes } = mapOpacDetail(sampleDetail, {
      book: emptyBook({ isbn13: '9787111111111' }),
      record: emptyRecord(),
      source: source(),
    })
    expect(changes).toContainEqual({
      field: 'isbn13',
      kind: 'conflict',
      current: '9787111111111',
      proposed: '9787521748239',
    })
  })

  it('title/pages/authors 差异 → conflict', () => {
    const { changes } = mapOpacDetail(sampleDetail, {
      book: emptyBook({ title: '旧题名', pages: 100, authors: ['别的作者'] }),
      record: emptyRecord(),
      source: source(),
    })
    expect(changes).toContainEqual({
      field: 'title',
      kind: 'conflict',
      current: '旧题名',
      proposed: '合成绘本甲',
    })
    expect(changes).toContainEqual({ field: 'pages', kind: 'conflict', current: 100, proposed: 198 })
    expect(changes).toContainEqual({
      field: 'authors',
      kind: 'conflict',
      current: ['别的作者'],
      proposed: ['合成作者'],
    })
  })

  it('subjects 集合差异 → conflict', () => {
    const { changes } = mapOpacDetail(sampleDetail, {
      book: emptyBook({ subjects: ['漫画'] }),
      record: emptyRecord(),
      source: source(),
    })
    expect(changes).toContainEqual({
      field: 'subjects',
      kind: 'conflict',
      current: ['漫画'],
      proposed: ['漫画', '连环画', '日本', '现代'],
    })
  })

  it('price 相同（对象字段级相等）→ 不产出；不同 → conflict', () => {
    const same = mapOpacDetail(sampleDetail, {
      book: emptyBook({ price: { amount: 35, currency: 'CNY' } }),
      record: emptyRecord(),
      source: source(),
    })
    expect(same.changes.find((c) => c.field === 'price')).toBeUndefined()
    const diff = mapOpacDetail(sampleDetail, {
      book: emptyBook({ price: { amount: 50, currency: 'CNY' } }),
      record: emptyRecord(),
      source: source(),
    })
    expect(diff.changes).toContainEqual({
      field: 'price',
      kind: 'conflict',
      current: { amount: 50, currency: 'CNY' },
      proposed: { amount: 35, currency: 'CNY' },
    })
  })

  it('classno 同 code+system 已有 → 不产出；不同 → fill（追加语义）', () => {
    const dup = mapOpacDetail(sampleDetail, {
      book: emptyBook(),
      record: emptyRecord({ classifications: [{ system: 'clc', code: 'J238.2' }] }),
      source: source(),
    })
    expect(dup.changes.find((c) => c.field === 'classifications')).toBeUndefined()
    const other = mapOpacDetail(sampleDetail, {
      book: emptyBook(),
      record: emptyRecord({ classifications: [{ system: 'clc', code: 'I247.5' }] }),
      source: source(),
    })
    expect(other.changes).toContainEqual({
      field: 'classifications',
      kind: 'fill',
      current: [{ system: 'clc', code: 'I247.5' }],
      proposed: [{ system: 'clc', code: 'J238.2' }],
    })
  })
})

describe('mapOpacDetail — 解析退化与 warning', () => {
  it('publish 无冒号 → 整体为 publisher，无 publishDate', () => {
    const { changes } = mapOpacDetail(
      { ...sampleDetail, publish: '上海译文出版社' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(changes.find((c) => c.field === 'publisher')).toEqual({
      field: 'publisher',
      kind: 'fill',
      current: null,
      proposed: '上海译文出版社',
    })
    expect(changes.find((c) => c.field === 'publishDate')).toBeUndefined()
  })

  it('publish 出版年后带括注（台版民国纪年实测形态，metaid 4473139）→ publishDate 取年份', () => {
    const { changes, warnings } = mapOpacDetail(
      { ...sampleDetail, publish: '台北:合成出版社,2019(民108)' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(changes.find((c) => c.field === 'publisher')).toEqual({
      field: 'publisher',
      kind: 'fill',
      current: null,
      proposed: '合成出版社',
    })
    expect(changes.find((c) => c.field === 'publishDate')).toEqual({
      field: 'publishDate',
      kind: 'fill',
      current: null,
      proposed: '2019',
    })
    expect(warnings).toEqual([])
  })

  it('publish 不可解析（冒号后为空）→ format_error warning + 无对应 change', () => {
    const { changes, warnings } = mapOpacDetail(
      { ...sampleDetail, publish: '北京:' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(changes.find((c) => c.field === 'publisher')).toBeUndefined()
    expect(changes.find((c) => c.field === 'publishDate')).toBeUndefined()
    expect(warnings).toEqual([
      { type: 'format_error', message: '无法解析出版信息: "北京:"', recordRef: null },
    ])
  })

  it('page 无整数序列 → format_error warning + 无 pages change', () => {
    const { changes, warnings } = mapOpacDetail(
      { ...sampleDetail, page: '无页码' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(changes.find((c) => c.field === 'pages')).toBeUndefined()
    expect(warnings).toEqual([
      { type: 'format_error', message: '无法解析页数: "无页码"', recordRef: null },
    ])
  })

  it('price 前缀规则：¥ → CNY、无前缀 → CNY、字母前缀 → 原样大写', () => {
    const yen = mapOpacDetail(
      { ...sampleDetail, price: '¥35.00' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(yen.changes.find((c) => c.field === 'price')?.proposed).toEqual({
      amount: 35,
      currency: 'CNY',
    })
    const bare = mapOpacDetail(
      { ...sampleDetail, price: '35.00' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(bare.changes.find((c) => c.field === 'price')?.proposed).toEqual({
      amount: 35,
      currency: 'CNY',
    })
    const usd = mapOpacDetail(
      { ...sampleDetail, price: 'USD9.99' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(usd.changes.find((c) => c.field === 'price')?.proposed).toEqual({
      amount: 9.99,
      currency: 'USD',
    })
  })

  it('price 台版多币种形态「CNY110.00(TWD350.00,HKD117.00)」→ 取括号前主价（实测 metaid=4942259）', () => {
    const { changes, warnings } = mapOpacDetail(
      { ...sampleDetail, price: 'CNY110.00(TWD350.00,HKD117.00)' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(changes.find((c) => c.field === 'price')).toEqual({
      field: 'price',
      kind: 'fill',
      current: null,
      proposed: { amount: 110, currency: 'CNY' },
    })
    expect(warnings).toEqual([])
    // 全角括号同规则
    const fullWidth = mapOpacDetail(
      { ...sampleDetail, price: 'CNY110.00（TWD350.00）' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(fullWidth.changes.find((c) => c.field === 'price')?.proposed).toEqual({
      amount: 110,
      currency: 'CNY',
    })
    // 无主价（纯括号原价）→ 不可解析 → warning
    const bareParen = mapOpacDetail(
      { ...sampleDetail, price: '(TWD350.00,HKD117.00)' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(bareParen.changes.find((c) => c.field === 'price')).toBeUndefined()
    expect(bareParen.warnings).toEqual([
      { type: 'format_error', message: '无法解析定价: "(TWD350.00,HKD117.00)"', recordRef: null },
    ])
  })

  it('price 不可解析 → format_error warning + 无 price change', () => {
    const { changes, warnings } = mapOpacDetail(
      { ...sampleDetail, price: '赠书' },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(changes.find((c) => c.field === 'price')).toBeUndefined()
    expect(warnings).toEqual([
      { type: 'format_error', message: '无法解析定价: "赠书"', recordRef: null },
    ])
  })

  it('OpacDetail 字段为 null → 对应字段不产出 change（来源无关性）', () => {
    const { changes } = mapOpacDetail(
      { ...sampleDetail, isbn: null, price: null, img: null, subject: null, classno: null },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    const fields = changes.map((c) => c.field)
    expect(fields).not.toContain('isbn13')
    expect(fields).not.toContain('isbn10')
    expect(fields).not.toContain('price')
    expect(fields).not.toContain('coverUrl')
    expect(fields).not.toContain('subjects')
    expect(fields).not.toContain('classifications')
    expect(fields).toContain('title')
  })

  it('detail 只有 title（无 ` = ` 并列段）→ 仅 title change，无 parallelTitles', () => {
    const { changes } = mapOpacDetail(
      { ...sampleDetail, title: '只有题名', author: null, publish: null, page: null, price: null, subject: null, classno: null, isbn: null, img: null },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(changes).toEqual([
      { field: 'title', kind: 'fill', current: '', proposed: '只有题名' },
    ])
  })

  it('现有 parallelTitles 非空而 OPAC 无并列题名 → conflict（建议清空，用户可恢复）', () => {
    const { changes } = mapOpacDetail(
      { ...sampleDetail, title: '只有题名', author: null, publish: null, page: null, price: null, subject: null, classno: null, isbn: null, img: null },
      { book: emptyBook({ parallelTitles: ['Old title'] }), record: emptyRecord(), source: source() },
    )
    expect(changes).toContainEqual({
      field: 'parallelTitles',
      kind: 'conflict',
      current: ['Old title'],
      proposed: [],
    })
  })

  it('description 由 abstract 落 fill', () => {
    const { changes } = mapOpacDetail(
      { ...sampleDetail, abstract: '内容简介', img: null, isbn: null },
      { book: emptyBook(), record: emptyRecord(), source: source() },
    )
    expect(changes).toContainEqual({
      field: 'description',
      kind: 'fill',
      current: null,
      proposed: '内容简介',
    })
  })
})

describe('prefillFromChanges', () => {
  const { changes } = mapOpacDetail(sampleDetail, {
    book: emptyBook({ isbn13: '9787111111111', pages: 100 }),
    record: emptyRecord({ classifications: [{ system: 'clc', code: 'I247.5' }] }),
    source: source(),
  })

  it('fill 与 conflict 的建议值全部落入 bookPrefill / recordPrefill；kind 保留', () => {
    const { bookPrefill, recordPrefill, applied } = prefillFromChanges(
      emptyBook({ isbn13: '9787111111111', pages: 100 }),
      emptyRecord({ classifications: [{ system: 'clc', code: 'I247.5' }] }),
      changes,
    )
    expect(changes.some((c) => c.kind === 'fill')).toBe(true)
    expect(changes.some((c) => c.kind === 'conflict')).toBe(true)
    expect(bookPrefill.title).toBe('合成绘本甲')
    expect(bookPrefill.parallelTitles).toEqual(['Synthetic story'])
    expect(bookPrefill.authors).toEqual(['合成作者'])
    expect(bookPrefill.isbn13).toBe('9787521748239')
    expect(bookPrefill.pages).toBe(198)
    expect(bookPrefill.price).toEqual({ amount: 35, currency: 'CNY' })
    expect(bookPrefill.subjects).toEqual(['漫画', '连环画', '日本', '现代'])
    expect(recordPrefill).toEqual({
      classifications: [
        { system: 'clc', code: 'I247.5' },
        { system: 'clc', code: 'J238.2' },
      ],
    })
    // applied = 实际预填字段（fill 与 conflict 均计入），顺序 = changes 顺序去重
    expect(applied).toEqual([
      'title',
      'parallelTitles',
      'authors',
      'translators',
      'isbn13',
      'publisher',
      'publishDate',
      'pages',
      'price',
      'subjects',
      'coverUrl',
      'classifications',
    ])
  })

  it('无 classifications change → recordPrefill=null', () => {
    const { recordPrefill } = prefillFromChanges(
      emptyBook(),
      emptyRecord(),
      changes.filter((c) => c.field !== 'classifications'),
    )
    expect(recordPrefill).toBeNull()
  })

  it('classifications 合并按 code+system 去重（防御：proposed 与现有重复）', () => {
    const crafted = [
      { field: 'classifications', kind: 'fill', current: [], proposed: [{ system: 'clc', code: 'J238.2' }] },
      { field: 'classifications', kind: 'fill', current: [], proposed: [{ system: 'clc', code: 'J238.2' }, { system: 'ddc', code: 'J238.2' }] },
    ] as const
    const { recordPrefill } = prefillFromChanges(
      emptyBook(),
      emptyRecord({ classifications: [{ system: 'clc', code: 'J238.2' }] }),
      [...crafted],
    )
    expect(recordPrefill).toEqual({
      classifications: [
        { system: 'clc', code: 'J238.2' },
        { system: 'ddc', code: 'J238.2' },
      ],
    })
  })
})

describe('mapOpacDetail — 确定性', () => {
  it('同输入两次调用深等价', () => {
    const a = mapOpacDetail(sampleDetail, { book: emptyBook(), record: emptyRecord(), source: source() })
    const b = mapOpacDetail(sampleDetail, { book: emptyBook(), record: emptyRecord(), source: source() })
    expect(a).toEqual(b)
  })
})

describe('opac-enrichment §12 组合：provider 产物 → 映射 → 预填', () => {
  it('szlib fetchDetail 样本走通映射与预填（来源无关链路）', async () => {
    const fetchMock = vi.fn(async () => ({ text: async () => JSON.stringify({ ...sampleDetail, abstract: '', abstracts: '', isPreloan: false, callno: '', series: '', districtList: [], CanLoanBook: [], OnlyReadBook: [], BorrowedBook: [] }) }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await szlibProvider.fetchDetail(emptyRecord(), emptyBook(), { timeoutMs: 10_000 })
    vi.unstubAllGlobals()
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const { changes } = mapOpacDetail(r.detail, { book: emptyBook(), record: emptyRecord(), source: source() })
    const { bookPrefill } = prefillFromChanges(emptyBook(), emptyRecord(), changes)
    expect(bookPrefill.title).toBe('合成绘本甲')
    expect(bookPrefill.authors).toEqual(['合成作者'])
  })
})
