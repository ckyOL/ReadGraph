// 分享图 canvas 逻辑坐标布局纯函数（annual-share-card-batch SC-2；reading-profile §4.1）。
// 版式：1080×1440（3:4）恒亮色纸面，上→下四段（标识 ~120 / 主视觉 ~560 / 事实 ~520 / 落款 ~240），
// 边距 64。每段产出位置化绘制指令（文本块/封面槽/图例色块/罫线），由渲染器（SC-3）逐条消费。
// 纯函数：无 DOM/canvas/时钟/存储；不触 Intl/t()——yearLabel/summaryText/deltaText/brandText
// 均为调用方 t() 渲染后的字符串（C5），布局只做定位与 clamp 参数携带（字符级截断归渲染器）。
import type { ShareContent } from './share-content'

/** 画布常量：逻辑 1080×1440，dpr ×2 定标，边距 64（R6 恒亮色纸面，硬编码不读 CSS 变量） */
export const SHARE_CANVAS = { width: 1080, height: 1440, dpr: 2, margin: 64 } as const

/** 四段高度（§4.1 结构；段界 = 自顶累加，合计 = 画布高） */
export const SHARE_SEGMENTS = { header: 120, hero: 560, facts: 520, footer: 240 } as const

/** 恒亮色板（R6）：纸白底 + 铁黑字 + 数据强调瑠璃紺；罫线/占位块弱色；emblem = 品牌徽标描边色 */
export const SHARE_COLORS = {
  paper: '#F9F7F2',
  ink: '#2A2A2A',
  rule: '#E8E4DC',
  placeholder: '#EAE0D5',
  accent: '#27477A',
  emblem: '#27477A',
} as const

/** 色块条亮色 chart-1..5（与 DESIGN.md §8 语义同源；[0] = 主数字强调色） */
export const SHARE_BAR_COLORS: string[] = ['#27477A', '#61764B', '#576D79', '#AD3140', '#998D86']

/** 版式选项：文案均由调用方 t()/Intl 渲染后传入（C5），布局不触 locale */
export interface ShareLayoutOptions {
  /** 年份大标题文案（如「2025 年度借阅」，locale 数字格式已由调用方完成） */
  yearLabel: string
  /** R3 平实总结句（t() 渲染后） */
  summaryText: string
  /** R4 历年对照行文案（t() 渲染后；无上年数据 → 传 null，布局不产出指令） */
  deltaText?: string | null
  /** 字标（如 ReadGraph） */
  brandText: string
  /** 字体栈（调用方按 locale 传入完整 font-family 串；布局只存 family 引用） */
  fontStack: { title: string; body: string; mono: string }
  /** 版式变体（v2 §4.2.2）：缺省 '3:4' 向后兼容——既有调用行为不变 */
  variant?: '3:4' | '9:16'
  /** 拼贴 +K 角标文案（t() 渲染后，如 "+6"；collage 非 null 时必传） */
  collageMoreText?: string
  /** 人格化称号行文案（t() 渲染后；badge=null → 不传，布局不产指令，§4.2.1） */
  badgeText?: string | null
}

/** 文本指令：基线 y，font 只携带 size/weight/family token，完整 font 串拼接归渲染器 */
export interface ShareTextInstruction {
  kind: 'text'
  x: number
  y: number
  text: string
  font: { size: number; weight: number; family: 'title' | 'body' | 'mono' }
  align: 'left' | 'center' | 'right'
  color: 'ink' | 'muted' | 'accent'
  maxWidth?: number
  maxLines?: number
  lineHeight?: number
}

/** 品牌徽标指令：favicon 同构矢量（圆弧 + 三书脊），stroke = emblem 色 */
export interface ShareEmblemInstruction {
  kind: 'emblem'
  x: number
  y: number
  size: number
}

/**
 * 封面槽指令：占位字符 = 题名首字（无封面降级时由渲染器绘制占位块 + 首字）。
 * slotIndex 0..2 = 甲版式三联；0..7 = 乙版式拼贴带（v2 §4.2.3，渲染器 drawImage/
 * 占位逻辑复用，covers map 键同步扩展）。
 */
export interface ShareCoverSlotInstruction {
  x: number
  y: number
  width: number
  height: number
  slotIndex: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7
  placeholderChar: string
}

/**
 * 拼贴 +K 角标指令（v2 §4.2.3，V-3b）：纸面色小方盒（直角、罫线弱化语义）+ 居中
 * mono ink 文本；盒贴末槽右下角。文本由调用方 t() 渲染后经 opts.collageMoreText 传入。
 */
export interface ShareCollageBadgeInstruction {
  kind: 'badge'
  x: number
  y: number
  width: number
  height: number
  text: string
}

/** 色块条指令：segments 按 topCategories ratio 分段，colorIndex = SHARE_BAR_COLORS 下标；label 行随条产出（类目名 + 占比，§4.1「色块条 + 类目名」） */
export interface ShareBarInstruction {
  x: number
  y: number
  width: number
  height: number
  segments: { ratio: number; colorIndex: number; label: string }[]
}

/** 1px 罫线指令 */
export interface ShareRuleInstruction {
  x: number
  y: number
  width: number
}

/** 布局产物：渲染器（SC-3）唯一输入，预览与导出共用（预览即导出） */
export interface ShareLayout {
  width: number
  height: number
  textBlocks: ShareTextInstruction[]
  coverSlots: ShareCoverSlotInstruction[]
  bars: ShareBarInstruction[]
  rules: ShareRuleInstruction[]
  emblems: ShareEmblemInstruction[]
  /** 拼贴 +K 角标（v2 §4.2.3）：乙版式产出一条；甲版式/缺省为空数组 */
  collageBadges: ShareCollageBadgeInstruction[]
}

/**
 * 9:16 Stories 分段高度（v2 §4.2.2 裁定：主视觉段比例增大 920、事实段 640、落款 240
 * 压缩；段界合计 = 1920）。SHARE_SEGMENTS 保持 3:4 基线（既有测试/调用兼容）。
 */
export const SHARE_SEGMENTS_9_16 = { header: 120, hero: 920, facts: 640, footer: 240 } as const

/** 拼贴带几何（v2 §4.2.3 裁定：8 张 4 列 × 2 行、槽 3:4 比例、间隙 16） */
const COLLAGE_COLS = 4
const COLLAGE_ROWS = 2
const COLLAGE_GAP = 16
const COLLAGE_BADGE_W = 88 // +K 角标盒宽（mono 20px「+99 本」内边距充裕）
const COLLAGE_BADGE_H = 40 // +K 角标盒高

// ---- 版式内部常量（单位：逻辑 px；段内锚点推导自 §4.1 结构与四段界） ----
const COVER_GAP = 24 // 封面三联槽间隙
const COVER_SLOTS_MAX = 3 // 槽数上限（slotIndex 0|1|2 枚举宽度）

const LIST_ROW_H = 56 // ③ 榜单行高
const SUM_MAX_LINES = 2 // ④ 总结句两行 clamp（§4.1 canvas 内文本截断）
const SUM_LINE_H = 40 // ④ 总结句行高（28px body 宽松行距）
const EMBLEM_SIZE = 44 // ① 品牌徽标边长（favicon 同构圆弧 + 三书脊）
const EMBLEM_TITLE_GAP = 20 // ① 徽标右缘与标题左缘间隙
const TITLE_OPTICAL_HALF = 20 // 56px 明朝 cap 高 ≈ 0.72em → 视觉半高（基线上方）
const LEGEND_SWATCH = 20 // ③ 图例色块边长（与占比数字 20px mono 同高）
const LEGEND_SWATCH_GAP = 14 // ③ 色块右缘与类目名左缘间隙
const LEGEND_ROW_H = 40 // ③ 图例行高
const LEGEND_RATIO_GAP = 16 // ③ 类目名与右对齐占比之间的最小间隙（maxWidth 预留）
const PERCENT_UNIT = ' %' // 类目名行百分号空隙（EN 数字窄空隙语义）

/**
 * computeShareLayout：ShareContent + 版式选项 → 位置化绘制指令。
 * 纯函数：同输入两次调用深等价；不做字符级截断（题名/总结句仅携带 maxWidth/maxLines
 * clamp 参数，按度量截断归 canvas 渲染器，§4.1「canvas 内文本截断」）。
 */
export function computeShareLayout(
  content: ShareContent,
  opts: ShareLayoutOptions,
): ShareLayout {
  const variant = opts.variant ?? '3:4'
  const height = variant === '9:16' ? 1920 : SHARE_CANVAS.height
  const segs = variant === '9:16' ? SHARE_SEGMENTS_9_16 : SHARE_SEGMENTS
  const segTop = { header: 0, hero: segs.header, facts: segs.header + segs.hero, footer: segs.header + segs.hero + segs.facts }
  const width = SHARE_CANVAS.width
  const contentW = width - SHARE_CANVAS.margin * 2 // 内容横宽（左右边距之间）
  const left = SHARE_CANVAS.margin
  const right = width - SHARE_CANVAS.margin

  // ---- 指令收集器（push 序即渲染序） ----
  const textBlocks: ShareTextInstruction[] = []
  const coverSlots: ShareCoverSlotInstruction[] = []
  const bars: ShareBarInstruction[] = []
  const rules: ShareRuleInstruction[] = []
  const emblems: ShareEmblemInstruction[] = []
  const collageBadges: ShareCollageBadgeInstruction[] = []

  // ---- ① 标识段（y[0,header)）：徽标 + 年份大字（title/ink）左 + 字标（mono）右 + 段底罫线 ----
  // 年份大字与字标共基线：段内偏高（约 0.72 段高，容 56px 字形下行）。两 variant 共用公式。
  const headerBaselineY = Math.round(segs.header * 0.72)
  // 徽标与标题**视觉对齐**：56px 明朝 cap 高 ≈ 0.72em，字形视觉中心在基线上方约 20px
  // （cap/2），徽标盒中心对到该视觉中心（而非段盒居中——那是与基线 86 的文字盒错位的根源）。
  const titleOpticalCenterY = headerBaselineY - TITLE_OPTICAL_HALF
  const emblemY = Math.round(titleOpticalCenterY - EMBLEM_SIZE / 2)
  emblems.push({ kind: 'emblem', x: left, y: emblemY, size: EMBLEM_SIZE })
  const titleX = left + EMBLEM_SIZE + EMBLEM_TITLE_GAP // 徽标右缘 + 间隙
  textBlocks.push({
    kind: 'text',
    x: titleX,
    y: headerBaselineY,
    text: opts.yearLabel,
    font: { size: 56, weight: 600, family: 'title' },
    align: 'left',
    color: 'ink',
  })
  textBlocks.push({
    kind: 'text',
    x: right,
    y: headerBaselineY,
    text: opts.brandText,
    font: { size: 20, weight: 400, family: 'mono' },
    align: 'right',
    color: 'muted',
  })
  rules.push({ x: left, y: segs.header - 1, width: contentW })

  // ---- ② 主视觉段：乙版式拼贴带（v2 §4.2.3，content.collage 非 null）或甲版式三联（R2 甲） ----
  const heroTop = segTop.hero
  const collage = content.collage
  if (collage !== null && collage.items.length > 0) {
    // 拼贴带：4 列 × 2 行网格、槽 3:4、间隙 16；行数随实际槽数（< 8 → 末行居中收排）。
    // 槽尺寸：高 = (段高 − 16) / 2（2 行满段高）；宽 = 高 × 3/4；宽超列限反推（9:16 以宽为限）。
    const rows = Math.ceil(collage.items.length / COLLAGE_COLS)
    let slotH = (segs.hero - COLLAGE_GAP) / COLLAGE_ROWS
    let slotW = (slotH * 3) / 4
    const maxSlotW = (contentW - COLLAGE_GAP * (COLLAGE_COLS - 1)) / COLLAGE_COLS
    if (slotW > maxSlotW) {
      slotW = maxSlotW
      slotH = (slotW * 4) / 3
    }
    const gridH = rows * slotH + (rows - 1) * COLLAGE_GAP
    const gridY = heroTop + (segs.hero - gridH) / 2
    collage.items.forEach((item, i) => {
      const row = Math.floor(i / COLLAGE_COLS)
      const rowCols = Math.min(COLLAGE_COLS, collage.items.length - row * COLLAGE_COLS)
      const rowW = rowCols * slotW + (rowCols - 1) * COLLAGE_GAP
      const rowX = left + (contentW - rowW) / 2 // 末行不满 → 行内居中
      const col = i % COLLAGE_COLS
      coverSlots.push({
        x: rowX + col * (slotW + COLLAGE_GAP),
        y: gridY + row * (slotH + COLLAGE_GAP),
        width: slotW,
        height: slotH,
        slotIndex: i as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
        placeholderChar: item.title.trim().charAt(0) || '·',
      })
    })
    // +K 角标：贴末槽右下角内侧（直角纸面盒 + mono ink 文本，§4.2.3）
    if (opts.collageMoreText) {
      const last = coverSlots[coverSlots.length - 1]!
      collageBadges.push({
        kind: 'badge',
        x: last.x + last.width - COLLAGE_BADGE_W,
        y: last.y + last.height - COLLAGE_BADGE_H,
        width: COLLAGE_BADGE_W,
        height: COLLAGE_BADGE_H,
        text: opts.collageMoreText,
      })
    }
  } else {
    // 甲版式：Top 3 封面三联 + 主数字次级（R2 甲）
    const items = content.topItems.slice(0, COVER_SLOTS_MAX)
    if (items.length > 0) {
      const coverW = (contentW - COVER_GAP * (COVER_SLOTS_MAX - 1)) / COVER_SLOTS_MAX
      const coverH = (coverW * 4) / 3 // 封面 3:4（槽高 = 宽 * 4/3）
      const groupW = items.length * coverW + COVER_GAP * (items.length - 1)
      // 不足 3 槽时整组居中：槽宽与间隙不变，左右留白对分
      const groupX = left + (contentW - groupW) / 2
      // 整组在段内垂直居中（组高 = 槽高），主数字基线另置槽组下方
      const coverY = heroTop + (segs.hero - coverH) / 2
      items.forEach((item, i) => {
        coverSlots.push({
          x: groupX + i * (coverW + COVER_GAP),
          y: coverY,
          width: coverW,
          height: coverH,
          slotIndex: i as 0 | 1 | 2,
          placeholderChar: item.title.trim().charAt(0) || '·',
        })
      })
    }
  }
  // 主数字（bookCount，mono 大号 accent）：甲版式置于封面行下方段内；乙版式下沉事实段底
  // （v2 §4.2.3：拼贴带满段高，Wrapped 式「数字独立位置」）。
  const numberY = collage !== null ? segTop.facts + segs.facts - 40 : heroTop + segs.hero - 24
  textBlocks.push({
    kind: 'text',
    x: width / 2,
    y: numberY,
    text: String(content.bookCount),
    font: { size: 96, weight: 600, family: 'mono' },
    align: 'center',
    color: 'accent',
  })

  // ---- ③ 事实段：Top 3 榜单 + 分类色块条 + Δ 对照行（R4）——锚点公式化（§4.2.2） ----
  // 榜单：序号 mono 弱字 + 题名 body（maxWidth/maxLines clamp 交渲染器）+ 次数 mono 右对齐（等宽 tabular 语义）
  const rankColW = 40 // 序号列宽（左边距起）
  const countColW = 128 // 次数右对齐预留列宽
  const listFirstY = segTop.facts + 60
  const legendFirstY = listFirstY + 200
  const deltaY = legendFirstY + 108
  content.topItems.slice(0, COVER_SLOTS_MAX).forEach((item, i) => {
    const y = listFirstY + i * LIST_ROW_H
    textBlocks.push({
      kind: 'text',
      x: left,
      y,
      text: String(i + 1),
      font: { size: 20, weight: 400, family: 'mono' },
      align: 'left',
      color: 'muted',
    })
    textBlocks.push({
      kind: 'text',
      x: left + rankColW,
      y,
      text: item.title,
      font: { size: 28, weight: 400, family: 'body' },
      align: 'left',
      color: 'ink',
      maxWidth: right - (left + rankColW) - countColW,
      maxLines: 1,
    })
    textBlocks.push({
      kind: 'text',
      x: right,
      y,
      text: String(item.count),
      font: { size: 28, weight: 400, family: 'mono' },
      align: 'right',
      color: 'ink',
    })
  })

  // 分类图例行（2026-09-04 定稿：横条逐段标注在窄段被省略号截断或整段跳过 → 改逐行
  // 图例）：每行 = 20px 色块（SHARE_BAR_COLORS[colorIndex]）+ 类目名 body 整行宽
  // （maxWidth = 右缘 - 占比预留列 - 间隙，长类目名仍截断加省略号但横宽充裕）+
  // 占比 mono 右对齐。§4.1「画像图例」。
  const cats = content.topCategories.filter((c) => c.ratio > 0)
  cats.forEach((c, i) => {
    const y = legendFirstY + i * LEGEND_ROW_H
    bars.push({
      x: left,
      y: y - LEGEND_SWATCH / 2 - 2,
      width: LEGEND_SWATCH,
      height: LEGEND_SWATCH,
      segments: [{ ratio: 1, colorIndex: i, label: c.name }],
    })
    const ratioColW = 64 // 「100 %」mono 20px 预留宽（右对齐）
    const nameX = left + LEGEND_SWATCH + LEGEND_SWATCH_GAP
    textBlocks.push({
      kind: 'text',
      x: nameX,
      y,
      text: c.name,
      font: { size: 24, weight: 400, family: 'body' },
      align: 'left',
      color: 'ink',
      maxWidth: right - nameX - ratioColW - LEGEND_RATIO_GAP,
      maxLines: 1,
    })
    textBlocks.push({
      kind: 'text',
      x: right,
      y,
      text: `${Math.round(c.ratio * 100)}${PERCENT_UNIT}`,
      font: { size: 20, weight: 400, family: 'mono' },
      align: 'right',
      color: 'muted',
    })
  })

  // R4：历年对照行——有上年数据（delta 非 null）且调用方给出行文案才产出；否则无任何对照行指令
  if (content.delta !== null && opts.deltaText) {
    textBlocks.push({
      kind: 'text',
      x: left,
      y: deltaY,
      text: opts.deltaText,
      font: { size: 20, weight: 400, family: 'mono' },
      align: 'left',
      color: 'muted',
    })
  }

  // ---- ④ 落款段：段顶罫线 + badge 行（v2 §4.2.1，badge 非 null 且有文案才产出）+ 总结句 + '@'字标弱字 ----
  rules.push({ x: left, y: segTop.footer, width: contentW })
  if (content.badge !== null && opts.badgeText) {
    textBlocks.push({
      kind: 'text',
      x: left,
      y: segTop.footer + 64,
      text: opts.badgeText,
      font: { size: 24, weight: 600, family: 'body' },
      align: 'left',
      color: 'accent',
      maxWidth: contentW,
      maxLines: 1,
    })
  }
  textBlocks.push({
    kind: 'text',
    x: left,
    y: segTop.footer + 120,
    text: opts.summaryText,
    font: { size: 28, weight: 400, family: 'body' },
    align: 'left',
    color: 'ink',
    maxWidth: contentW,
    maxLines: SUM_MAX_LINES,
    lineHeight: SUM_LINE_H,
  })
  textBlocks.push({
    kind: 'text',
    x: left,
    y: segTop.footer + 184,
    text: `@${opts.brandText}`,
    font: { size: 20, weight: 400, family: 'mono' },
    align: 'left',
    color: 'muted',
  })

  return {
    width,
    height,
    textBlocks,
    coverSlots,
    bars,
    rules,
    emblems,
    collageBadges,
  }
}
