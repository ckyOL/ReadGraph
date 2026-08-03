// 待审派生模型（review 规格 §2/§4/§8）。纯函数、不读写存储。
// 待审类型判定为派生不落库：选书帮占位 = needsReview && isbn13===null；
// 套装候选 = needsReview && isbn13!==null；补全/结构化完成后 needsReview=false 退出列表。
import type { Book, BorrowCycle, CatalogRecord, RawRecord } from '@/types/entities'

export type ReviewKind = 'placeholder' | 'set'

/** 待审类型判定；非待审 → null。 */
export function reviewKindOf(
  book: Pick<Book, 'needsReview' | 'isbn13'>,
): ReviewKind | null {
  if (!book.needsReview) return null
  return book.isbn13 === null ? 'placeholder' : 'set'
}

export interface ReviewRow {
  book: Book
  kind: ReviewKind
  /** 该 Book 下编目数。 */
  catalogCount: number
  /** 借阅周期数。 */
  borrowCount: number
  lastBorrowedAt: Date | null
}

/**
 * 聚合两类待审（review 规格 §4）。排序：类型徽标（占位在前）+ 借阅次数降序，
 * 保证列表稳定可预期。
 */
export function buildReviewRows(
  books: Book[],
  catalogRecords: CatalogRecord[],
  borrowCycles: BorrowCycle[],
): ReviewRow[] {
  const cycleCountByBook = new Map<string, number>()
  const lastBorrowedByBook = new Map<string, Date>()
  for (const c of borrowCycles) {
    cycleCountByBook.set(c.bookId, (cycleCountByBook.get(c.bookId) ?? 0) + 1)
    const prev = lastBorrowedByBook.get(c.bookId)
    if (!prev || c.borrowedAt > prev) lastBorrowedByBook.set(c.bookId, c.borrowedAt)
  }
  const catalogCountByBook = new Map<string, number>()
  for (const cr of catalogRecords) {
    catalogCountByBook.set(cr.bookId, (catalogCountByBook.get(cr.bookId) ?? 0) + 1)
  }
  const rows: ReviewRow[] = []
  for (const book of books) {
    const kind = reviewKindOf(book)
    if (!kind) continue
    rows.push({
      book,
      kind,
      catalogCount: catalogCountByBook.get(book.id) ?? 0,
      borrowCount: cycleCountByBook.get(book.id) ?? 0,
      lastBorrowedAt: lastBorrowedByBook.get(book.id) ?? null,
    })
  }
  const kindOrder: Record<ReviewKind, number> = { placeholder: 0, set: 1 }
  return rows.sort(
    (a, b) =>
      kindOrder[a.kind] - kindOrder[b.kind] ||
      b.borrowCount - a.borrowCount ||
      a.book.title.localeCompare(b.book.title),
  )
}

export type ReviewTab = 'all' | 'placeholder' | 'set'

/** 列表分流（review 规格 §4）：Tabs + 搜索（题名/ISBN 子串，大小写不敏感）。 */
export function filterReviewRows(
  rows: ReviewRow[],
  tab: ReviewTab,
  search: string,
): ReviewRow[] {
  const needle = search.trim().toLowerCase()
  return rows.filter((r) => {
    if (tab !== 'all' && r.kind !== tab) return false
    if (!needle) return true
    return (
      r.book.title.toLowerCase().includes(needle) ||
      (r.book.isbn13 ?? '').toLowerCase().includes(needle)
    )
  })
}

/**
 * 套装 Book 判定：≥2 个 volume 非空编目（review 规格 §2 查询派生；书库列表「套装」Badge）。
 * volume 可能因历史数据缺失为 undefined，按 null 处理。
 */
export function isSetBook(bookId: string, catalogRecords: CatalogRecord[]): boolean {
  let volumes = 0
  for (const cr of catalogRecords) {
    if (cr.bookId !== bookId) continue
    const v = cr.volume ?? null
    if (v !== null && v !== '') {
      volumes++
      if (volumes >= 2) return true
    }
  }
  return false
}

/**
 * 编目 → 题名原文（rawRecords 溯源 join，review 规格 §6.2「题名原文」）。
 * 题名取原始行 `/` 前题名区（与 szlib-parser §2.A / parseTitle 一致，不含责任者），
 * 保证卷号解析与拆书 title 不被责任者尾缀干扰。
 * 匹配顺序：metaIdKey → barcode → 该书任意原始行标题（兜底）。
 * 无原始行的编目（手工来源等）映射为空串。
 */
export function catalogTitleByRecord(
  bookId: string,
  catalogRecords: CatalogRecord[],
  rawRecords: RawRecord[],
): Map<string, string> {
  const titleByMeta = new Map<string, string>()
  const titleByBarcode = new Map<string, string>()
  let fallback = ''
  for (const r of rawRecords) {
    if (r.bookId !== bookId) continue
    const raw = String((r.data as { title?: unknown }).title ?? '')
    if (raw === '') continue
    const title = raw.split('/')[0]!.trim()
    const meta = (r.data as { metaid?: unknown }).metaid
    if (meta != null && meta !== 0) {
      titleByMeta.set(String(meta), title)
    } else {
      const bc = String((r.data as { barcode?: unknown }).barcode ?? '')
      if (bc !== '') titleByBarcode.set(bc, title)
    }
    fallback = title
  }
  const out = new Map<string, string>()
  for (const cr of catalogRecords) {
    if (cr.bookId !== bookId) continue
    const byMeta = cr.metaIdKey ? titleByMeta.get(cr.metaIdKey) : undefined
    const byBc = cr.barcodes[0] ? titleByBarcode.get(cr.barcodes[0]) : undefined
    out.set(cr.id, byMeta ?? byBc ?? fallback)
  }
  return out
}
