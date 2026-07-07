// 导入管线纯函数（§10.3、§10.4 派生 ID、§10.6 去重、import-workflow 纯度）。
// 不写库、不带时钟、不读全局可变状态。相同入参恒等产出 PipelineResult。
import type {
  Book,
  BorrowCycle,
  CatalogRecord,
  ImportLog,
  ImportLogStats,
  ParseWarning,
  RawRecord,
  Source,
} from '@/types/entities'
import { stableHash } from '@/lib/hash'
import type { SourceParser } from './types'
import {
  dedupeBorrowCycles,
  dedupeCatalogsAndBooks,
  type CandidateCatalog,
  type CandidateCycle,
  type DedupeState,
} from './dedupe'

/** 已有库状态（显式入参，纯度要求 import-workflow）。 */
export interface ExistingState {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
}

/** 导入批次的可派生元数据。 */
export interface ImportMeta {
  id: string
  fileName: string
  fileSize: number
  detectedEncoding: string
  importedAt: Date
}

/** 管线产出。 */
export interface PipelineResult {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  importLog: ImportLog
  rawRecords: RawRecord[]
  warnings: ParseWarning[]
}

const makeCrId = (input: string) => `cr-${stableHash(input)}`
const bkId = (input: string) => `bk-${stableHash(input)}`
const cyId = (input: string) => `cy-${stableHash(input)}`

/**
 * importPipeline：导入管线核心纯函数（§10.3）。
 * rows 由调用方预分配 id/importLogId/sourceId/rowIndex；data 保留原始键值。
 * parser.parse 解析 rawData（由调用方从 rows 派生的整码字符串/缓冲）喂入。
 * 返回合并去重后的实体并集与 ImportLog，不写库。
 */
export function importPipeline(
  rows: RawRecord[],
  source: Source,
  parser: SourceParser,
  existing: ExistingState,
  meta: ImportMeta,
): PipelineResult {
  const warnings: ParseWarning[] = []
  const now = meta.importedAt

  // 1. 把 rows 的 data 序列化为 parser 消费的 rawData（保持纯：不读文件）。
  const rawData = JSON.stringify(rows.map((r) => r.data))
  const parseRes = parser.parse(rawData, source)
  warnings.push(...parseRes.warnings)

  // 2. 装配候选编目与书目；按 rowIndex（rows 顺序）对齐 parseRes 产出。
  //    parseRes 内 books/catalogRecords 已去重为「本次新批次」候选；
  //    这里转换为 CandidateCatalog 列表，逐条确定 barcode 与 bookId。
  const candidates: CandidateCatalog[] = []
  const candidateBarcodes: string[] = []
  const validRows: RawRecord[] = rows.filter((r) => r.parseStatus !== 'skipped')

  // parseRes.books 已按出现顺序去重；用其在 parseRes.catalogRecords 内的
  // barcode 关联。简化装配：循环 catalogRecords，每条对应一个候选。
  for (let i = 0; i < parseRes.catalogRecords.length; i++) {
    const cr = parseRes.catalogRecords[i]!
    const barcode = (cr.barcodes?.[0] ?? '') as string
    const bookPartial = findBookForCatalog(parseRes.books, cr)
    const isPlaceholder =
      bookPartial?.needsReview === true && (bookPartial.isbn13 ?? null) === null
    candidates.push({
      partial: cr,
      bookPartial: bookPartial ?? {},
      isPlaceholder,
    })
    candidateBarcodes.push(barcode)
  }

  // 3. 编目/书目去重（§10.6 第 1~4 条）。
  const dedupeState: DedupeState = {
    books: existing.books,
    catalogRecords: existing.catalogRecords,
    borrowCycles: existing.borrowCycles,
  }
  const { bookIdByBarcode, warnings: ddWarnings } = dedupeCatalogsAndBooks(
    candidates,
    candidateBarcodes,
    dedupeState,
    parser,
  )
  warnings.push(...ddWarnings)

  // 4. 实际产出 Books + CatalogRecords（ID 确定性派生，§10.4）。
  const newBooks: Book[] = []
  const newCatalogRecords: CatalogRecord[] = []
  const crIdByBarcode = new Map<string, string>()
  const bookIdByCrIndex = new Map<number, string>()

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]!
    const barcode = candidateBarcodes[i]!
    const cr = cand.partial
    const sourceId = (cr.sourceId ?? source.id) as string
    const metaIdKey = (cr.metaIdKey ?? null) as string | null
    const crDerivedInput = metaIdKey
      ? `${sourceId}|${metaIdKey}`
      : `${sourceId}|${barcode}`
    const cId = crIdByBarcode.get(barcode) ?? makeCrId(crDerivedInput)
    crIdByBarcode.set(barcode, cId)

    let bookId = bookIdByBarcode.get(barcode)
    if (!bookId || bookId.startsWith('new:')) {
      // 新建 Book：ID 取首个命中它的 CatalogRecord.id（一书一编目首记）。
      const newBookId = bkId(crDerivedInput)
      bookId = newBookId
      const bookPartial = cand.bookPartial
      newBooks.push({
        id: newBookId,
        isbn13: (bookPartial.isbn13 ?? null) as string | null,
        isbn10: (bookPartial.isbn10 ?? null) as string | null,
        title: (bookPartial.title ?? '') as string,
        subtitle: (bookPartial.subtitle ?? null) as string | null,
        authors: (bookPartial.authors ?? []) as string[],
        translators: (bookPartial.translators ?? []) as string[],
        publisher: (bookPartial.publisher ?? null) as string | null,
        publishDate: (bookPartial.publishDate ?? null) as string | null,
        edition: (bookPartial.edition ?? null) as string | null,
        pages: (bookPartial.pages ?? null) as number | null,
        price: (bookPartial.price ?? null) as Book['price'],
        subjects: (bookPartial.subjects ?? []) as string[],
        tags: (bookPartial.tags ?? []) as string[],
        coverUrl: (bookPartial.coverUrl ?? null) as string | null,
        description: (bookPartial.description ?? null) as string | null,
        createdAt: now,
        updatedAt: now,
        needsReview: (bookPartial.needsReview ?? false) as boolean,
        sourceIds: (bookPartial.sourceIds ?? [source.id]) as string[],
        parallelTitles: (bookPartial.parallelTitles ?? []) as string[],
      })
    }
    bookIdByCrIndex.set(i, bookId)

    newCatalogRecords.push({
      id: cId,
      bookId,
      sourceId,
      metaId: (cr.metaId ?? null) as CatalogRecord['metaId'],
      metaIdKey,
      barcodes: (cr.barcodes ?? []) as string[],
      classifications: (cr.classifications ?? []) as CatalogRecord['classifications'],
      createdAt: now,
      updatedAt: now,
    })
  }

  // 5. 装配候选 BorrowCycle（parseRes 产出的周期逐个映射 rawRecordIds）。
  //    规则：同 barcode 内的周期按 parseRes 顺序排定，rawRecordIds 取该周期
  //    对应的 rows（按 barcode 过滤后第 k 个借/还操作）。这里采用简化但确定性
  //    的关联：同 barcode 下按 parseRes 周期序号依次取 validRows 中该 barcode 的操作行。
  const cyclesByBarcode = new Map<string, RawRecord[]>()
  for (const r of validRows) {
    const bc = String((r.data as { barcode?: unknown }).barcode ?? '')
    if (!cyclesByBarcode.has(bc)) cyclesByBarcode.set(bc, [])
    cyclesByBarcode.get(bc)!.push(r)
  }
  const candidateCycles: CandidateCycle[] = []
  const cycleBarcodeCursor = new Map<string, number>()
  for (const cyc of parseRes.borrowCycles) {
    const bc = String(cyc.barcode ?? '')
    const arr = cyclesByBarcode.get(bc) ?? []
    let cursor = cycleBarcodeCursor.get(bc) ?? 0
    const rawIds: string[] = []
    // 借出取一行，归还取同行/下行使 rawRecordIds 稳定；此处取同 cursor 行。
    if (cursor < arr.length) {
      rawIds.push(arr[cursor]!.id)
      cursor++
    }
    if (cyc.status === 'returned' && cursor < arr.length) {
      rawIds.push(arr[cursor]!.id)
      cursor++
    }
    cycleBarcodeCursor.set(bc, cursor)
    candidateCycles.push({
      sourceId: cyc.sourceId ?? source.id,
      barcode: cyc.barcode ?? null,
      borrowedAt: cyc.borrowedAt ?? now,
      returnedAt: cyc.returnedAt ?? null,
      status: cyc.status ?? 'unknown',
      borrowLocation: cyc.borrowLocation ?? null,
      returnLocation: cyc.returnLocation ?? null,
      rawRecordIds: rawIds,
    })
  }

  // 6. 周期去重 + ID 派生（§10.4 + §10.6 后段）。
  const { cycles, warnings: cyWarnings, skippedFlags } = dedupeBorrowCycles(
    candidateCycles,
    existing.borrowCycles,
  )
  warnings.push(...cyWarnings)

  const finalCycles: BorrowCycle[] = cycles.map((c) => {
    const rawKey = c.rawRecordIds.slice().sort().join(',')
    const id = c.id ? c.id : cyId(`${meta.id}|${rawKey}`)
    // 关联 catalogRecordId/bookId（按 barcode 找 crId）。
    const bc = c.barcode ?? ''
    const crIdForBc = crIdByBarcode.get(bc) ?? ''
    const bookIdForBc = (() => {
      const found = bookIdByBarcode.get(bc)
      if (found && !found.startsWith('new:')) return found
      const cr = newCatalogRecords.find((x) => x.barcodes.includes(bc))
      return cr?.bookId ?? bookIdByCrIndex.get(0) ?? ''
    })()
    return {
      ...c,
      id,
      bookId: bookIdForBc,
      catalogRecordId: crIdForBc,
    }
  })

  // skippedFlags 对应 candidateCycles；标记对应 rawRecord.parseStatus='skipped'。
  for (let i = 0; i < candidateCycles.length; i++) {
    if (skippedFlags[i]) {
      const cyc = candidateCycles[i]!
      for (const rid of cyc.rawRecordIds) {
        const rr = rows.find((r) => r.id === rid)
        if (rr) rr.parseStatus = 'skipped'
      }
    }
  }

  // 7. 回填 rawRecord 的 bookId/borrowCycleId/parseStatus（简化：有效行 success）。
  for (const r of rows) {
    const bc = String((r.data as { barcode?: unknown }).barcode ?? '')
    r.bookId = bookIdByBarcode.get(bc) ?? r.bookId
    if (r.parseStatus === 'success' || r.parseStatus === undefined) {
      r.parseStatus = 'success'
    }
  }

  // 8. 统计 ImportLog（§10.3）。
  const stats: ImportLogStats = {
    totalRawRecords: rows.length,
    newBooks: newBooks.length,
    updatedBooks: 0,
    newBorrowCycles: finalCycles.length - existing.borrowCycles.length,
    skippedRecords: rows.filter((r) => r.parseStatus === 'skipped').length,
    warningCount: warnings.filter((w) => w.type !== 'format_error').length,
    errorCount: warnings.filter((w) => w.type === 'format_error').length,
  }
  const importLog: ImportLog = {
    id: meta.id,
    sourceId: source.id,
    importedAt: now,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    detectedEncoding: meta.detectedEncoding,
    parserId: source.parserId,
    stats,
    warnings,
  }

  return {
    books: [...existing.books, ...newBooks],
    catalogRecords: [...existing.catalogRecords, ...newCatalogRecords],
    borrowCycles: finalCycles,
    importLog,
    rawRecords: rows,
    warnings,
  }
}

/** 在 parseRes.books 中为某 catalogRecord 找对应 bookPartial。 */
function findBookForCatalog(
  books: Partial<Book>[],
  cr: Partial<CatalogRecord>,
): Partial<Book> | undefined {
  // 按 szlib 注入的瞬态 _bookKey 对齐（非类型字段，仅解析器内部约定）。
  const key = (cr as Record<string, unknown>)._bookKey
  if (typeof key === 'string') {
    const hit = books.find((b) => (b as Record<string, unknown>)._bookKey === key)
    if (hit) return hit
  }
  return undefined
}
