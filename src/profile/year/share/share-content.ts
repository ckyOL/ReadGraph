// 分享图内容收敛纯函数（annual-share-card-batch SC-1；reading-profile §4.1）。
// 白名单硬约束面：输入仅含 year/bookCount/topBooks/classification/covers/prevYear，
// 类型层面排除 annualGoals/price/barcode/isbn13/馆名（规格 C2 隐私护栏）。
// 纯函数：无 DOM/时钟/存储；同输入两次调用深等价。
import type { YearBookIndexEntry } from '@/profile/year/year-book-index'

/** 分享图封面槽条目：与 year-book-index 同构（题名/作者/封面，不携带整本 Book）。 */
export interface ShareCoverEntry {
  title: string
  authors: string[]
  coverUrl: string | null
}

/** 分享图内容输入（白名单硬约束面，reading-profile §4.1 映射表）。 */
export interface ShareContentInput {
  year: number
  bookCount: number
  /** 年内复借 Top（调用方传 slice.topBooks，函数内截取 Top 3） */
  topBooks: { bookId: string; count: number }[]
  /** 分类分布（调用方传 slice.classification，函数内截取 Top 3；占比 = value/bookCount） */
  classification: { name: string; value: number }[]
  /** bookId → 书目索引（year-book-index 同构；无对应书 → 跳过该 Top 项） */
  covers: Record<string, YearBookIndexEntry | undefined>
  /** 上一年对照（R4；同一切片函数对 year-1 的产物，无上年数据 → null） */
  prevYear: { year: number; bookCount: number } | null
}

/** 分享图内容（ShareContentInput 收敛产物，SC-2 布局唯一输入）。 */
export interface ShareContent {
  year: number
  bookCount: number
  /** Top 3 封面/书脊行（≤3；covers 无对应书则跳过） */
  topItems: { title: string; authors: string[]; coverUrl: string | null; count: number }[]
  /** Top 3 分类（≤3；ratio = value/bookCount） */
  topCategories: { name: string; ratio: number }[]
  /** R3 平实总结句 i18n 描述符（t() 渲染由 UI 层完成，布局只消费字符串） */
  summary: {
    key: 'profile.year.share.summary' | 'profile.year.share.summaryNoTop'
    params: { count: number; categories: number; topCategory?: string }
  }
  /** R4 历年对照（无上年数据 → null，布局不产出对照行指令） */
  delta: { prevBookCount: number } | null
}

/**
 * 分享图内容收敛：YearSlice 产物 + 书目索引 → ShareContent。
 * 纯函数（SC-1 实现）：Top 3 截取、占比归一、summary 描述符组装、delta 透传。
 *
 * 隐私护栏（C2）：仅消费白名单字段——题名/作者/封面/分类名/计数；
 * covers 无对应书 → 跳过该 Top 项（不占位），黑名单字段自始不进产物。
 */
export function buildShareContent(input: ShareContentInput): ShareContent {
  const { year, bookCount, topBooks, classification, covers, prevYear } = input

  // Top 3 封面行：按调用方降序截取前 3；covers 缺该 bookId/值为 undefined → 跳过
  //（不占位不补位，其余条目保持输入顺序）。
  const topItems: ShareContent['topItems'] = []
  for (const top of topBooks) {
    if (topItems.length >= 3) break
    const entry = covers[top.bookId]
    if (entry === undefined || entry === null) continue
    topItems.push({
      title: entry.title,
      authors: entry.authors,
      coverUrl: entry.coverUrl,
      count: top.count,
    })
  }

  // Top 3 分类：占比 = value / bookCount；bookCount=0 时除法无意义 → 直接空数组
  //（避免 NaN 落图，空年降级）。
  const topCategories: ShareContent['topCategories'] =
    bookCount <= 0
      ? []
      : classification.slice(0, 3).map((c) => ({ name: c.name, ratio: c.value / bookCount }))

  // R3 平实总结句描述符：无分类时省略 topCategory 段（summaryNoTop 键，同型 params）。
  const summary: ShareContent['summary'] =
    topCategories.length > 0
      ? {
          key: 'profile.year.share.summary',
          params: { count: bookCount, categories: topCategories.length, topCategory: topCategories[0]!.name },
        }
      : { key: 'profile.year.share.summaryNoTop', params: { count: bookCount, categories: 0 } }

  // R4 历年对照：无上年数据或上年零读数 → 不产出对照（布局不画对照行）。
  const delta: ShareContent['delta'] =
    prevYear !== null && prevYear.bookCount > 0 ? { prevBookCount: prevYear.bookCount } : null

  return { year, bookCount, topItems, topCategories, summary, delta }
}
