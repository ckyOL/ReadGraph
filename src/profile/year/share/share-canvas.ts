// 分享图 canvas 渲染器（annual-share-card-batch SC-3；reading-profile §4.1）。
// 消费 SC-2 的 ShareLayout 指令逐条绘制（fillText/drawImage/fillRect/1px 罫线）；
// 恒亮色纸面（R6：#F9F7F2 底 + #2A2A2A 字，不读当前主题）；数字半角 + 等宽栈；
// 无封面槽绘占位块 + 题名首字。devicePixelRatio ×2 定标（1080×1440 逻辑 →
// 2160×2880 物理）保证锐度；预览与导出共用本渲染函数（「预览即导出」硬约束）。
import type {
  ShareCoverSlotInstruction,
  ShareLayout,
  ShareTextInstruction,
} from './share-layout'
import { SHARE_BAR_COLORS, SHARE_CANVAS, SHARE_COLORS } from './share-layout'

/** 字体栈（与 ShareLayoutOptions.fontStack 同形，调用方按 locale 传入后透传） */
export interface ShareRenderFonts {
  title: string
  body: string
  mono: string
}

/** 色块条弱字色（恒亮纸面上的 muted 弱化字；对齐亮色 --muted-foreground） */
export const SHARE_MUTED_COLOR = '#666F68'

/** 逻辑 → 物理颜色 token 解析（布局只携带 token，渲染器映射到恒亮色板） */
function resolveColor(token: ShareTextInstruction['color']): string {
  switch (token) {
    case 'ink':
      return SHARE_COLORS.ink
    case 'muted':
      return SHARE_MUTED_COLOR
    case 'accent':
      return SHARE_COLORS.accent
  }
}

function resolveFontFamily(family: ShareTextInstruction['font']['family'], fonts: ShareRenderFonts): string {
  switch (family) {
    case 'title':
      return fonts.title
    case 'body':
      return fonts.body
    case 'mono':
      return fonts.mono
  }
}

/**
 * 字符级 maxWidth + maxLines clamp（§4.1「canvas 内文本截断」）：
 * 逐字符累积 measureText 宽度，超出 maxWidth 从该字符截断并补 '…'；
 * maxLines 仅支持 1（版式内题名/总结句均为单行 clamp 参数携带，多行由布局拆分指令）。
 */
function clampText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string {
  if (maxLines <= 1 && ctx.measureText(text).width <= maxWidth) return text
  let acc = ''
  for (const ch of text) {
    if (ctx.measureText(acc + ch).width > maxWidth) {
      return acc.replace(/…?$/, '…')
    }
    acc += ch
  }
  return acc
}

/**
 * 封面槽绘制：covers[slotIndex] 存在 → drawImage（封面 3:4 由图源保证，
 * 拉伸语义可接受）；缺失 → 占位块 #EAE0D5 + 题名首字（与页内 year-book-grid 同语义）。
 */
function drawCoverSlot(
  ctx: CanvasRenderingContext2D,
  slot: ShareCoverSlotInstruction,
  img: HTMLImageElement | undefined,
): void {
  if (img) {
    ctx.drawImage(img, slot.x, slot.y, slot.width, slot.height)
    return
  }
  ctx.fillStyle = SHARE_COLORS.placeholder
  ctx.fillRect(slot.x, slot.y, slot.width, slot.height)
}

/**
 * renderShareCard：ShareLayout + 字体栈 → 逐条绘制指令到 canvas。
 * 物理尺寸 = 逻辑 × dpr（SHARE_CANVAS.dpr = 2），ctx.scale(dpr, dpr) 后全部按
 * 逻辑坐标绘制。covers 键 = slotIndex（0|1|2），由调用方把 onEach(bookId) 映射进槽位。
 */
export function renderShareCard(
  canvas: HTMLCanvasElement,
  layout: ShareLayout,
  fonts: ShareRenderFonts,
  covers?: Record<number, HTMLImageElement>,
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('share-canvas: 2d context unavailable')
  const { width, height, dpr } = SHARE_CANVAS
  canvas.width = width * dpr
  canvas.height = height * dpr
  ctx.scale(dpr, dpr)

  // 底色：恒亮纸面（R6），先于一切内容
  ctx.fillStyle = SHARE_COLORS.paper
  ctx.fillRect(0, 0, width, height)

  for (const rule of layout.rules) {
    ctx.fillStyle = SHARE_COLORS.rule
    ctx.fillRect(rule.x, rule.y, rule.width, 1)
  }

  for (const bar of layout.bars) {
    let x = bar.x
    for (const seg of bar.segments) {
      if (seg.ratio === 0) continue
      ctx.fillStyle = SHARE_BAR_COLORS[seg.colorIndex] ?? SHARE_COLORS.accent
      ctx.fillRect(x, bar.y, seg.ratio * bar.width, bar.height)
      x += seg.ratio * bar.width
    }
  }

  for (const slot of layout.coverSlots) {
    drawCoverSlot(ctx, slot, covers?.[slot.slotIndex])
    if (!covers?.[slot.slotIndex]) {
      // 占位字符绘制在占位块中心（drawCoverSlot 只画块；字在此补齐）
      const size = Math.round(slot.width * 0.18)
      ctx.fillStyle = SHARE_MUTED_COLOR
      ctx.font = `400 ${size}px ${fonts.body}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(slot.placeholderChar, slot.x + slot.width / 2, slot.y + slot.height / 2)
      ctx.textBaseline = 'alphabetic'
    }
  }

  for (const block of layout.textBlocks) {
    ctx.fillStyle = resolveColor(block.color)
    ctx.font = `${block.font.weight} ${block.font.size}px ${resolveFontFamily(block.font.family, fonts)}`
    ctx.textAlign = block.align
    const text =
      block.maxWidth != null
        ? clampText(ctx, block.text, block.maxWidth, block.maxLines ?? 1)
        : block.text
    ctx.fillText(text, block.x, block.y)
  }
}

/** 导出 PNG 文件名（E2E 断言与 SC-5 复用同源） */
export function sharePngFilename(year: number): string {
  return `readgraph-annual-${year}.png`
}

/**
 * exportSharePng：canvas.toBlob('image/png') → URL.createObjectURL →
 * <a download="readgraph-annual-{year}.png"> 点击 → revoke。失败向上抛
 * （Dialog 层 toast，规格状态表）。一次性下载微任务，不阻塞渲染。
 */
export function exportSharePng(canvas: HTMLCanvasElement, year: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('share-canvas: toBlob returned null'))
        return
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = sharePngFilename(year)
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      resolve()
    }, 'image/png')
  })
}
