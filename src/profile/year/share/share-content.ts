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
  /** 分类分布（调用方传 slice.classification，函数内按 value 降序截取 Top 3；占比 = value/bookCount） */
  classification: { name: string; value: number }[]
  /** 上一年对照（R4；同一切片函数对 year-1 的产物，无上年数据 → null） */
  prevYear: { year: number; bookCount: number } | null
  /**
   * 拼贴候选顺序（v2 §4.2.3，V-3b）：调用方传 `slice.bookIds` 升序（既有公开字段透传，
   * 非隐私白名单扩张）；缺省按 covers 键序兜底。仅被 collageBookIds 消费，不进产物。
   */
  collageOrder?: string[]
  /** bookId → 书目索引（year-book-index 同构；无对应书 → 跳过该 Top 项） */
  covers: Record<string, YearBookIndexEntry | undefined>
}

/** 分享图内容（ShareContentInput 收敛产物，SC-2 布局唯一输入）。 */
export interface ShareContent {
  year: number
  bookCount: number
  /** Top 3 封面/书脊行（≤3；covers 无对应书则跳过） */
  topItems: { title: string; authors: string[]; coverUrl: string | null; count: number }[]
  /** Top 3 分类（≤3；value 降序截取，`__unclassified__` 不上分享图；ratio = value/bookCount） */
  topCategories: { name: string; ratio: number }[]
  /** R3 平实总结句 i18n 描述符（t() 渲染由 UI 层完成，布局只消费字符串） */
  summary: {
    key: 'profile.year.share.summary' | 'profile.year.share.summaryNoTop'
    params: { count: number; categories: number; topCategory?: string }
  }
  /** R4 历年对照（无上年数据 → null，布局不产出对照行指令） */
  delta: { prevBookCount: number } | null
  /**
   * 人格化称号（v2 §4.2.1，V-1b）：i18n 描述符（与 summary 同构，t() 渲染归 UI 层）；
   * 无规则命中 → null（不虚构称号，布局不产指令）。
   */
  badge: { key: string; params: Record<string, string | number> } | null
  /**
   * 封面拼贴（v2 §4.2.3，V-3b）：bookCount ≥ SHARE_COLLAGE_THRESHOLD 时非 null；
   * items ≤ 8（题名/作者/封面，不含 bookId——内部 id 不进图片内容）、overflow = +K。
   */
  collage: { items: { title: string; authors: string[]; coverUrl: string | null }[]; overflow: number } | null
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

  // Top 3 分类：value 降序（与 treemap 口径一致——slice.classification 为桶插入序，
  // 直接 slice(0,3) 会截到非 Top 桶）→ 占比 = value / bookCount；
  // `__unclassified__`（分类号缺失聚合桶）不上分享图——对外图片无类目语义；
  // bookCount=0 时除法无意义 → 直接空数组（避免 NaN 落图，空年降级）。
  const rankedCategories = classification
    .filter((c) => c.name !== '__unclassified__' && c.value > 0)
    .sort((a, b) => b.value - a.value)
  const topCategories: ShareContent['topCategories'] =
    bookCount <= 0
      ? []
      : rankedCategories.slice(0, 3).map((c) => ({ name: c.name, ratio: c.value / bookCount }))

  // R3 平实总结句描述符：categories = 真实类目数（非 Top 3 截取数——「3 类」是截取
  // 伪事实）；无分类时省略 topCategory 段（summaryNoTop 键，同型 params）。
  const summary: ShareContent['summary'] =
    topCategories.length > 0
      ? {
          key: 'profile.year.share.summary',
          params: {
            count: bookCount,
            categories: rankedCategories.length,
            topCategory: topCategories[0]!.name,
          },
        }
      : { key: 'profile.year.share.summaryNoTop', params: { count: bookCount, categories: 0 } }

  // R4 历年对照：无上年数据或上年零读数 → 不产出对照（布局不画对照行）。
  const delta: ShareContent['delta'] =
    prevYear !== null && prevYear.bookCount > 0 ? { prevBookCount: prevYear.bookCount } : null

  // 人格化称号（v2 §4.2.1，V-1b）：规则从上到下至多命中一条（一张卡一个事实）。
  // 复借型优先；增速型 `bookCount ≥ 2×prev`（同比增长 ≥ 100%，恰好 2× 命中）；
  // 兜底 null（不虚构称号——复用 R3 总结句语义）。仅消费既有白名单产物。
  const badge: ShareContent['badge'] = (() => {
    const top = topItems[0]
    if (top !== undefined && top.count >= 3) {
      const params: Record<string, string | number> = { title: top.title, count: top.count }
      return { key: 'profile.year.share.badge.reborrow', params }
    }
    if (delta !== null && bookCount >= 2 * delta.prevBookCount && bookCount > 0) {
      const params: Record<string, string | number> = { count: bookCount, prev: delta.prevBookCount }
      return { key: 'profile.year.share.badge.growth', params }
    }
    return null
  })()

  // 封面拼贴（v2 §4.2.3，V-3b）：bookCount ≥ 阈值（§4.2.3 裁定 12，书少拼贴带空洞）
  // → 乙版式候选 ≤ 8 张 + overflow = +K；未触发 → null（甲版式三联，v1 路径逐字节一致）。
  const collage: ShareContent['collage'] = (() => {
    if (bookCount < SHARE_COLLAGE_THRESHOLD) return null
    const ids = collageBookIds(input)
    const items = ids.map((id) => {
      const entry = covers[id]!
      return { title: entry.title, authors: entry.authors, coverUrl: entry.coverUrl }
    })
    return { items, overflow: Math.max(0, bookCount - items.length) }
  })()

  return { year, bookCount, topItems, topCategories, summary, delta, badge, collage }
}

/** 拼贴触发阈值（v2 §4.2.3 裁定）：bookCount ≥ 12 自动切乙版式（书少时拼贴带空洞） */
export const SHARE_COLLAGE_THRESHOLD = 12

/** 拼贴槽位数（§4.2.3 裁定：8 张 4 列 × 2 行网格；超额由 +K 角标承载） */
export const SHARE_COLLAGE_SLOTS = 8

/**
 * 拼贴候选 id 序列（§4.2.3 单一事实源：布局产槽与 Dialog 封面加载共用）：
 * 1) topBooks（次数降序输入序）中有 covers 条目者依序入选；
 * 2) 不足 → collageOrder（调用方传 slice.bookIds 升序；缺省 covers 键序）未入选者补足；
 * 3) covers 无条目 → 跳过（不占槽不报错）；恒 ≤ 8；纯函数：不改写输入。
 */
export function collageBookIds(input: ShareContentInput): string[] {
  const { topBooks, covers, collageOrder } = input
  const picked: string[] = []
  const seen = new Set<string>()
  for (const top of topBooks) {
    if (picked.length >= SHARE_COLLAGE_SLOTS) return picked
    if (covers[top.bookId] === undefined || seen.has(top.bookId)) continue
    picked.push(top.bookId)
    seen.add(top.bookId)
  }
  const rest = collageOrder ?? Object.keys(covers)
  for (const id of rest) {
    if (picked.length >= SHARE_COLLAGE_SLOTS) break
    if (seen.has(id) || covers[id] === undefined) continue
    picked.push(id)
    seen.add(id)
  }
  return picked
}
