// 待审类型派生模型（book-editing 规格 §2/§5；原 lib/review.ts 收缩迁移）。
// 纯函数、不读写存储。待审类型判定为派生不落库：选书帮占位 = needsReview && isbn13===null；
// 套装候选 = needsReview && isbn13!==null；补全/结构化完成后 needsReview=false。
// 消费方：书库列表徽标/类型筛选、详情页「更多」菜单、编辑表单卷号预填。
import type { Book, CatalogRecord, RawRecord } from '@/types/entities'

export type ReviewKind = 'placeholder' | 'set'

/** 待审类型判定；非待审 → null。 */
export function reviewKindOf(
  book: Pick<Book, 'needsReview' | 'isbn13'>,
): ReviewKind | null {
  if (!book.needsReview) return null
  return book.isbn13 === null ? 'placeholder' : 'set'
}

/**
 * 套装 Book 判定：≥2 个 volume 非空编目（查询派生；书库列表「套装」Badge）。
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
 * 套装 Book id 集合（isSetBook 批量版；时间线题名卷号后缀预判用）。
 * 无 id 的编目（孤儿）不产出集合项。
 */
export function setBookIdsOf(catalogRecords: CatalogRecord[]): Set<string> {
  const out = new Set<string>()
  const byBook = new Map<string, CatalogRecord[]>()
  for (const cr of catalogRecords) {
    const arr = byBook.get(cr.bookId)
    if (arr) arr.push(cr)
    else byBook.set(cr.bookId, [cr])
  }
  for (const [bookId, records] of byBook) {
    if (isSetBook(bookId, records)) out.add(bookId)
  }
  return out
}

/**
 * 书库列表状态徽标：占位书「占位」、套装（待审套装候选或已结构化套装）「套装」、普通书 null。
 * 套装候选虽未结构化 volume，仍属套装语义（用户进详情页结构化），与已确认套装统一徽标。
 */
export function reviewBadgeOf(
  book: Pick<Book, 'needsReview' | 'isbn13'>,
  bookId: string,
  catalogRecords: CatalogRecord[],
): ReviewKind | null {
  const kind = reviewKindOf(book)
  if (kind === 'placeholder') return 'placeholder'
  if (kind === 'set' || isSetBook(bookId, catalogRecords)) return 'set'
  return null
}

/** 书库类型筛选（book-editing 规格 §5.2）：全部 / 待完善 / 占位 / 套装候选。 */
export type ReviewTypeFilter = 'all' | 'needsReview' | 'placeholder' | 'set'

export function filterBookByReviewType(
  book: Pick<Book, 'needsReview' | 'isbn13'>,
  filter: ReviewTypeFilter,
): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'needsReview':
      return book.needsReview
    case 'placeholder':
      return reviewKindOf(book) === 'placeholder'
    case 'set':
      return reviewKindOf(book) === 'set'
  }
}

/**
 * 编目 → 题名原文（rawRecords 溯源 join；编辑表单卷号预填与拆书 title 用）。
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
