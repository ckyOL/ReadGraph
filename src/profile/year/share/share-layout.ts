// 分享图 canvas 逻辑坐标布局纯函数（annual-share-card-batch SC-2；reading-profile §4.1）。
// 版式：1080×1440（3:4）恒亮色纸面，上→下四段（标识 ~120 / 主视觉 ~560 / 事实 ~520 / 落款 ~240），
// 边距 64。每段产出位置化绘制指令（文本块/封面槽/色块条/罫线），由渲染器（SC-3）逐条消费。
// 纯函数：无 DOM/canvas/时钟/存储；不触 Intl/t()——yearLabel/summaryText/deltaText/brandText
// 均为调用方 t() 渲染后的字符串（C5），布局只做定位与 clamp 参数携带（字符级截断归渲染器）。
import type { ShareContent } from './share-content'

/** 画布常量：逻辑 1080×1440，dpr ×2 定标，边距 64（R6 恒亮色纸面，硬编码不读 CSS 变量） */
export const SHARE_CANVAS = { width: 1080, height: 1440, dpr: 2, margin: 64 } as const

/** 四段高度（§4.1 结构；段界 = 自顶累加，合计 = 画布高） */
export const SHARE_SEGMENTS = { header: 120, hero: 560, facts: 520, footer: 240 } as const

/** 恒亮色板（R6）：纸白底 + 铁黑字 + 数据强调瑠璃紺；罫线/占位块弱色 */
export const SHARE_COLORS = {
  paper: '#F9F7F2',
  ink: '#2A2A2A',
  rule: '#E8E4DC',
  placeholder: '#EAE0D5',
  accent: '#27477A',
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

/** 封面槽指令：占位字符 = 题名首字（无封面降级时由渲染器绘制占位块 + 首字） */
export interface ShareCoverSlotInstruction {
  x: number
  y: number
  width: number
  height: number
  slotIndex: 0 | 1 | 2
  placeholderChar: string
}

/** 色块条指令：segments 按 topCategories ratio 分段，colorIndex = SHARE_BAR_COLORS 下标 */
export interface ShareBarInstruction {
  x: number
  y: number
  width: number
  height: number
  segments: { ratio: number; colorIndex: number }[]
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
}

// ---- 版式内部常量（单位：逻辑 px；段内锚点推导自 §4.1 结构与四段界） ----
const COVER_GAP = 24 // 封面三联槽间隙
const COVER_SLOTS_MAX = 3 // 槽数上限（slotIndex 0|1|2 枚举宽度）

const LIST_ROW_H = 56 // ③ 榜单行高
const LIST_FIRST_Y = 740 // ③ 榜单首行基线（段顶 680 + 两行版间距）
const BAR_Y = 940 // ③ 分类色块条顶 y
const DELTA_Y = 1008 // ③ Δ 对照行基线
const SUM_MAX_LINES = 2 // ④ 总结句两行 clamp（§4.1 canvas 内文本截断）
const SUM_LINE_H = 40 // ④ 总结句行高（28px body 宽松行距）

/**
 * computeShareLayout：ShareContent + 版式选项 → 位置化绘制指令。
 * 纯函数：同输入两次调用深等价；不做字符级截断（题名/总结句仅携带 maxWidth/maxLines
 * clamp 参数，按度量截断归 canvas 渲染器，§4.1「canvas 内文本截断」）。
 */
export function computeShareLayout(
  content: ShareContent,
  opts: ShareLayoutOptions,
): ShareLayout {
  const { width, margin } = SHARE_CANVAS
  const contentW = width - margin * 2 // 内容横宽（左右边距之间）
  const left = margin
  const right = width - margin

  // ---- 指令收集器（push 序即渲染序） ----
  const textBlocks: ShareTextInstruction[] = []
  const coverSlots: ShareCoverSlotInstruction[] = []
  const bars: ShareBarInstruction[] = []
  const rules: ShareRuleInstruction[] = []

  // ---- ① 标识段（y[0,120)）：年份大字（title/ink）左 + 字标（mono）右 + 段底罫线 ----
  // 年份大字与字标共基线：段内偏高（约 0.72 段高，容 56px 字形下行）
  const headerBaselineY = Math.round(SHARE_SEGMENTS.header * 0.72)
  textBlocks.push({
    kind: 'text',
    x: left,
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
  rules.push({ x: left, y: SHARE_SEGMENTS.header - 1, width: contentW })

  // ---- ② 主视觉段（y[120,680)）：Top 3 封面三联 + 主数字（R2 甲） ----
  const items = content.topItems.slice(0, COVER_SLOTS_MAX)
  if (items.length > 0) {
    const coverW = (contentW - COVER_GAP * (COVER_SLOTS_MAX - 1)) / COVER_SLOTS_MAX
    const coverH = (coverW * 4) / 3 // 封面 3:4（槽高 = 宽 * 4/3）
    const groupW = items.length * coverW + COVER_GAP * (items.length - 1)
    // 不足 3 槽时整组居中：槽宽与间隙不变，左右留白对分
    const groupX = left + (contentW - groupW) / 2
    // 整组在段内垂直居中（组高 = 槽高），主数字基线另置槽组下方
    const coverY = SHARE_SEGMENTS.header + (SHARE_SEGMENTS.hero - coverH) / 2
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
  // 主数字（bookCount，mono 大号 accent）置于封面行下方段内
  textBlocks.push({
    kind: 'text',
    x: width / 2,
    y: 656,
    text: String(content.bookCount),
    font: { size: 96, weight: 600, family: 'mono' },
    align: 'center',
    color: 'accent',
  })

  // ---- ③ 事实段（y[680,1200)）：Top 3 榜单 + 分类色块条 + Δ 对照行（R4） ----
  // 榜单：序号 mono 弱字 + 题名 body（maxWidth/maxLines clamp 交渲染器）+ 次数 mono 右对齐（等宽 tabular 语义）
  const rankColW = 40 // 序号列宽（左边距起）
  const countColW = 128 // 次数右对齐预留列宽
  content.topItems.slice(0, COVER_SLOTS_MAX).forEach((item, i) => {
    const y = LIST_FIRST_Y + i * LIST_ROW_H
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

  // 分类色块条：x=64 通栏横向条，segments 按 topCategories ratio 分段、colorIndex = 产出序
  // （ratio=0 的段不产出，colorIndex 连续）
  const cats = content.topCategories.filter((c) => c.ratio > 0)
  if (cats.length > 0) {
    bars.push({
      x: left,
      y: BAR_Y,
      width: contentW,
      height: 16,
      segments: cats.map((c, i) => ({ ratio: c.ratio, colorIndex: i })),
    })
  }

  // R4：历年对照行——有上年数据（delta 非 null）且调用方给出行文案才产出；否则无任何对照行指令
  if (content.delta !== null && opts.deltaText) {
    textBlocks.push({
      kind: 'text',
      x: left,
      y: DELTA_Y,
      text: opts.deltaText,
      font: { size: 20, weight: 400, family: 'mono' },
      align: 'left',
      color: 'muted',
    })
  }

  // ---- ④ 落款段（y[1200,1440)）：总结句（body 两行 clamp）+ '@'字标弱字 + 段顶罫线 ----
  rules.push({ x: left, y: 1200, width: contentW })
  textBlocks.push({
    kind: 'text',
    x: left,
    y: 1320,
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
    y: 1384,
    text: `@${opts.brandText}`,
    font: { size: 20, weight: 400, family: 'mono' },
    align: 'left',
    color: 'muted',
  })

  return {
    width,
    height: SHARE_CANVAS.height,
    textBlocks,
    coverSlots,
    bars,
    rules,
  }
}
