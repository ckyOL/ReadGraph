// 书库视图派生（opac-enrichment §10 翻页 + ui-navigation §3 列表共用管线）。
// 列表页（/library）与详情页（/library/$bookId 翻页）共用同一过滤/排序派生，
// 单一实现防两处漂移。纯函数、无 I/O；数据源为 useLiveQuery 全量实体。
import type { Book, BorrowCycle, CatalogRecord, ClassificationSystem, Source } from '@/types/entities'
import { filterBookByReviewType, type ReviewTypeFilter } from '@/lib/book-status'

export type SortKey = 'title' | 'author' | 'isbn' | 'borrowed' | 'borrows'
export type SortDir = 'asc' | 'desc'

/** 视图参数（URL search 同构；q 为实时输入态，detail 页取 URL q）。 */
export interface LibraryViewParams {
  q?: string
  /** sourceId；'all'/缺省 = 不过滤 */
  source?: string
  status?: ReviewTypeFilter
  sort?: SortKey
  dir?: SortDir
}

export interface LibraryRow {
  book: Book
  authors: string
  isbn13: string | null
  sourceName: string | null
  classification: { system: ClassificationSystem; code: string } | null
  borrowCount: number
  lastBorrowedAt: Date | null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** 行派生：来源名取首条编目来源（无编目回退 book.sourceIds[0]）；分类取首条编目首个条目；
 *  借阅计数与 lastBorrowedAt（max）由 BorrowCycle 聚合。 */
export function buildLibraryRows(
  books: Book[],
  catalogRecords: CatalogRecord[],
  borrowCycles: BorrowCycle[],
  sources: Source[],
): LibraryRow[] {
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const cycleCountByBook = new Map<string, number>()
  const lastBorrowedByBook = new Map<string, Date>()
  for (const c of borrowCycles) {
    cycleCountByBook.set(c.bookId, (cycleCountByBook.get(c.bookId) ?? 0) + 1)
    const prev = lastBorrowedByBook.get(c.bookId)
    if (!prev || c.borrowedAt > prev) lastBorrowedByBook.set(c.bookId, c.borrowedAt)
  }
  return books.map((book) => {
    const cr = catalogRecords.find((c) => c.bookId === book.id)
    const source = cr ? sourceById.get(cr.sourceId) : sourceById.get(book.sourceIds[0] ?? '')
    const entry = cr?.classifications[0] ?? null
    return {
      book,
      authors: book.authors.join(' / '),
      isbn13: book.isbn13,
      sourceName: source?.name ?? null,
      classification: entry ? { system: entry.system, code: entry.code } : null,
      borrowCount: cycleCountByBook.get(book.id) ?? 0,
      lastBorrowedAt: lastBorrowedByBook.get(book.id) ?? null,
    }
  })
}

/** 过滤 + 排序（与既有列表行为逐项等价；borrowed 无借阅恒排末尾不随方向翻转）。 */
export function filterAndSortRows(rows: LibraryRow[], params: LibraryViewParams): LibraryRow[] {
  const needle = (params.q ?? '').trim().toLowerCase()
  let out = rows
  if (needle) {
    out = out.filter(
      (r) =>
        r.book.title.toLowerCase().includes(needle) ||
        r.authors.toLowerCase().includes(needle) ||
        (r.isbn13 ?? '').toLowerCase().includes(needle),
    )
  }
  const sourceFilter = params.source ?? 'all'
  if (sourceFilter !== 'all') {
    out = out.filter((r) => r.book.sourceIds.includes(sourceFilter))
  }
  const reviewFilter = params.status ?? 'all'
  if (reviewFilter !== 'all') {
    out = out.filter((r) => filterBookByReviewType(r.book, reviewFilter))
  }
  const sortKey = params.sort ?? 'title'
  const dir = (params.dir ?? 'asc') === 'asc' ? 1 : -1
  return [...out].sort((a, b) => {
    switch (sortKey) {
      case 'author':
        return collator.compare(a.authors, b.authors) * dir
      case 'isbn':
        return (a.isbn13 ?? '').localeCompare(b.isbn13 ?? '') * dir
      case 'borrowed': {
        if (!a.lastBorrowedAt && !b.lastBorrowedAt) return 0
        if (!a.lastBorrowedAt) return 1
        if (!b.lastBorrowedAt) return -1
        return (a.lastBorrowedAt.getTime() - b.lastBorrowedAt.getTime()) * dir
      }
      case 'borrows':
        return (a.borrowCount - b.borrowCount) * dir
      default:
        return collator.compare(a.book.title, b.book.title) * dir
    }
  })
}

/** 详情页翻页：按视图顺序（已排序行）找 currentBookId 的相邻行；边界/未命中 → null。 */
export function adjacentBookIds(
  rows: LibraryRow[],
  currentBookId: string,
): { prevId: string | null; nextId: string | null } {
  const index = rows.findIndex((r) => r.book.id === currentBookId)
  if (index === -1) return { prevId: null, nextId: null }
  return {
    prevId: index > 0 ? rows[index - 1]!.book.id : null,
    nextId: index < rows.length - 1 ? rows[index + 1]!.book.id : null,
  }
}
