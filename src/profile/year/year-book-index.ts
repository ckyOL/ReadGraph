// 年度视图书单/网格共享的书目索引条目：题名/作者/封面（bookIndex 式索引，
// 不携带整本 Book——reading-profile §4 年度书单）。年度视图与 Top 5 共用。
export interface YearBookIndexEntry {
  title: string
  authors: string[]
  coverUrl: string | null
}