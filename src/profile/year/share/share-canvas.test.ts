// canvas 渲染器测试（reading-profile §4.1）。
// node 环境无真实 canvas：注入记录型 2D context stub（cheap stand-ins 模式，
// 同 locale.test.ts），断言指令序列（scale/底色/drawImage 顺序/占位 fillRect 色值/
// fillText 参数/罫线调用数）；toBlob 失败路径 stub 抛错 → exportSharePng reject。
// 不引入 node-canvas/happy-dom（供应链面零新增）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SHARE_MUTED_COLOR,
  exportSharePng,
  renderShareCard,
  sharePngFilename,
} from './share-canvas'
import type { ShareRenderFonts } from './share-canvas'
import {
  SHARE_BAR_COLORS,
  SHARE_COLORS,
  computeShareLayout,
} from './share-layout'
import type { ShareContent } from './share-content'
/** 记录条目：op + 参数 + 当次 fillStyle 快照 */
interface Call {
  op: string
  args: unknown[]
  style: string
}
/** 记录型 2D context：方法调用入 log（快照当次 fillStyle），属性赋值经访问器入 props。 */
function makeRecordingCtx() {
  const log: Call[] = []
  const props: Record<string, unknown> = {}
  const stub = {
    log,
    props,
    fillStyle: '',
    strokeStyle: '',
    measureText: (text: string) => ({ width: text.length * 10 }),
    fillText: (...args: unknown[]) => log.push({ op: 'fillText', args, style: stub.fillStyle }),
    fillRect: (...args: unknown[]) => log.push({ op: 'fillRect', args, style: stub.fillStyle }),
    drawImage: (...args: unknown[]) => log.push({ op: 'drawImage', args, style: stub.fillStyle }),
    scale: (...args: unknown[]) => log.push({ op: 'scale', args, style: stub.fillStyle }),
    save: () => log.push({ op: 'save', args: [], style: stub.fillStyle }),
    restore: () => log.push({ op: 'restore', args: [], style: stub.fillStyle }),
    translate: (...args: unknown[]) => log.push({ op: 'translate', args, style: stub.fillStyle }),
    beginPath: () => log.push({ op: 'beginPath', args: [], style: stub.fillStyle }),
    moveTo: (...args: unknown[]) => log.push({ op: 'moveTo', args, style: stub.fillStyle }),
    lineTo: (...args: unknown[]) => log.push({ op: 'lineTo', args, style: stub.fillStyle }),
    arc: (...args: unknown[]) => log.push({ op: 'arc', args, style: stub.fillStyle }),
    stroke: () => log.push({ op: 'stroke', args: [], style: stub.strokeStyle }),
  }
  const handler: ProxyHandler<typeof stub> = {
    set(target, prop, value) {
      if (prop in target) {
        ;(target as Record<string | symbol, unknown>)[prop] = value
      } else {
        props[prop as string] = value
      }
      return true
    },
  }
  return new Proxy(stub, handler)
}

type RecordingCtx = ReturnType<typeof makeRecordingCtx>

/** 记录型 canvas：getContext 返回 stub；width/height 可写；toBlob 可编程。 */
function makeRecordingCanvas(ctx: RecordingCtx) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === '2d' ? ctx : null),
    toBlob: (cb: (b: Blob | null) => void, _type: string) => cb(new Blob(['x'])),
  } as unknown as HTMLCanvasElement
  return canvas
}

/** 测试字体栈（实现只拼接不解析，任意串可断言透传） */
const FONTS: ShareRenderFonts = { title: 'serif-stack-test', body: 'sans-stack-test', mono: 'mono-stack-test' }

function content(over: Partial<ShareContent> = {}): ShareContent {
  return {
    year: 2025,
    bookCount: 27,
    topItems: [
      { title: '三体：地球往事', authors: ['刘慈欣'], coverUrl: null, count: 12 },
      { title: '百年孤独', authors: ['加西亚·马尔克斯'], coverUrl: null, count: 8 },
      { title: '历史三', authors: ['作者丙'], coverUrl: null, count: 1 },
    ],
    topCategories: [
      { name: '文学', ratio: 0.5 },
      { name: '历史', ratio: 0.3 },
    ],
    summary: { key: 'profile.year.share.summary', params: { count: 27, categories: 2, topCategory: '文学' } },
    delta: { prevBookCount: 20 },
    badge: null,
    collage: null,
    ...over,
  }
}

function opts() {
  return {
    yearLabel: '2025 年度借阅',
    summaryText: '共 27 本 · 2 类 · 最爱文学',
    deltaText: '2024 · 20 本',
    brandText: 'ReadGraph',
    fontStack: FONTS,
  }
}

beforeEach(() => {
  vi.stubGlobal(
    'document',
    { createElement: vi.fn(), body: { appendChild: vi.fn() } },
  )
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:u1'), revokeObjectURL: vi.fn() })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('renderShareCard（渲染器指令序列）', () => {
  it('dpr ×2 定标：canvas 2160×2880 物理 + scale(2,2)', () => {
    const ctx = makeRecordingCtx()
    const canvas = makeRecordingCanvas(ctx)
    renderShareCard(canvas, computeShareLayout(content(), opts()), FONTS)
    expect(canvas.width).toBe(1080 * 2)
    expect(canvas.height).toBe(1440 * 2)
    expect(ctx.log[0]).toMatchObject({ op: 'scale', args: [2, 2] })
  })

  it('底色恒亮纸面先于一切内容指令（R6）', () => {
    const ctx = makeRecordingCtx()
    const canvas = makeRecordingCanvas(ctx)
    renderShareCard(canvas, computeShareLayout(content(), opts()), FONTS)
    const firstRect = ctx.log.find((c) => c.op === 'fillRect')
    expect(firstRect).toEqual({ op: 'fillRect', args: [0, 0, 1080, 1440], style: SHARE_COLORS.paper })
    // 底色先于一切内容指令（log 首条为 scale 定标，首条 fillRect 即底色）
    expect(ctx.log.findIndex((c) => c.op === 'fillRect')).toBe(1)
  })

  it('文本指令：font 串拼接（weight size px family）、textAlign、fillText 坐标', () => {
    const ctx = makeRecordingCtx()
    const canvas = makeRecordingCanvas(ctx)
    renderShareCard(canvas, computeShareLayout(content(), opts()), FONTS)
    const fontAssignments = Object.keys(ctx.props)
    expect(fontAssignments).toContain('font')
    const fillTexts = ctx.log.filter((c) => c.op === 'fillText')
    expect(fillTexts.length).toBeGreaterThan(0)
    // 年份大标题：56/600 title 栈
    expect(ctx.props.textAlign).toBeDefined()
    expect(fillTexts.some((c) => String((c.args[0] as string)).includes('2025'))).toBe(true)
  })

  it('maxWidth clamp：长文本 measureText 超限 → 截断加省略号', () => {
    const long = content({
      topItems: [
        { title: '一', authors: [], coverUrl: null, count: 1 },
        { title: '二', authors: [], coverUrl: null, count: 1 },
        {
          title: 'aaaa bbbb cccc dddd eeee ffff gggg hhhh iiii jjjj kkkk llll mmmm nnnn oooo pppp qqqq',
          authors: [],
          coverUrl: null,
          count: 1,
        },
      ],
    })
    const ctx = makeRecordingCtx()
    const canvas = makeRecordingCanvas(ctx)
    renderShareCard(canvas, computeShareLayout(long, opts()), FONTS)
    const fillTexts = ctx.log.filter((c) => c.op === 'fillText').map((c) => c.args[0] as string)
    const truncated = fillTexts.find((t) => t.includes('aaaa') && t.endsWith('…'))
    expect(truncated).toBeDefined()
    // clamp 后宽度不超 maxWidth（stub width = len*10；'…' 占 1 字符快照）
    expect(truncated!.endsWith('…')).toBe(true)
  })

  it('封面槽：covers 提供 slot → drawImage（槽位坐标宽高）；缺失 → 占位 fillRect + 首字', () => {
    const ctx = makeRecordingCtx()
    const canvas = makeRecordingCanvas(ctx)
    const img = { width: 300, height: 400 } as unknown as HTMLImageElement
    const noCover = content({
      topItems: [
        { title: '三体', authors: [], coverUrl: null, count: 1 },
        { title: '百年孤独', authors: [], coverUrl: null, count: 1 },
        { title: '历史三', authors: [], coverUrl: null, count: 1 },
      ],
    })
    renderShareCard(canvas, computeShareLayout(noCover, opts()), FONTS, { 0: img })
    const draws = ctx.log.filter((c) => c.op === 'drawImage')
    expect(draws).toHaveLength(1)
    expect(draws[0]!.args[0]).toBe(img)
    // 其余 2 槽占位：fillRect 色 = placeholder + fillText 首字（居中）
    const layout = computeShareLayout(noCover, opts())
    const placeholderRects = ctx.log.filter(
      (c) =>
        c.op === 'fillRect' &&
        c.args[2] === layout.coverSlots[1]!.width &&
        c.args[3] === layout.coverSlots[1]!.height &&
        c.style === SHARE_COLORS.placeholder,
    )
    expect(placeholderRects.length).toBeGreaterThanOrEqual(2)
    const fillTexts = ctx.log.filter((c) => c.op === 'fillText').map((c) => c.args[0] as string)
    // slot 0 已被 img 覆盖 → 无占位首字；slot 1/2 缺图 → 首字占位
    expect(fillTexts).not.toContain('三')
    expect(fillTexts).toContain('百')
    expect(fillTexts).toContain('历')
  })

  it('色块条：分段 x 累进 = ratio 累计 × 宽，色值 = SHARE_BAR_COLORS[colorIndex]', () => {
    const ctx = makeRecordingCtx()
    const canvas = makeRecordingCanvas(ctx)
    const layout = computeShareLayout(content(), opts())
    renderShareCard(canvas, layout, FONTS)
    const bar = layout.bars[0]!
    const barRects = ctx.log.filter(
      (c) => c.op === 'fillRect' && c.args[1] === bar.y && c.args[3] === bar.height,
    )
    expect(barRects).toHaveLength(bar.segments.length)
    let x = bar.x
    bar.segments.forEach((seg, i) => {
      expect(barRects[i]!.args).toEqual([x, bar.y, seg.ratio * bar.width, bar.height])
      x += seg.ratio * bar.width
    })
    // 每段 fillStyle 快照 = SHARE_BAR_COLORS[colorIndex]
    bar.segments.forEach((seg, i) => {
      expect(barRects[i]!.style).toBe(SHARE_BAR_COLORS[seg.colorIndex])
    })
  })
  it('muted 弱字色 = SHARE_MUTED_COLOR（占位首字路径）', () => {
    const ctx = makeRecordingCtx()
    const canvas = makeRecordingCanvas(ctx)
    renderShareCard(canvas, computeShareLayout(content(), opts()), FONTS)
    // 占位字符 fillText 的 fillStyle 快照 = muted 弱字色
    const placeholderTexts = ctx.log.filter((c) => c.op === 'fillText' && c.style === SHARE_MUTED_COLOR)
    expect(placeholderTexts.length).toBeGreaterThanOrEqual(2)
    expect(SHARE_MUTED_COLOR).toBe('#666F68')
  })
  it('品牌徽标：emblem 指令 → save/translate/scale 路径下弧 + 三书脊 stroke（emblem 色），restore 收尾', () => {
    const ctx = makeRecordingCtx()
    const canvas = makeRecordingCanvas(ctx)
    const layout = computeShareLayout(content(), opts())
    renderShareCard(canvas, layout, FONTS)
    expect(layout.emblems).toHaveLength(1)
    const emblem = layout.emblems[0]
    const saveIdx = ctx.log.findIndex((c) => c.op === 'save')
    expect(saveIdx).toBeGreaterThan(0)
    expect(ctx.log[saveIdx! + 1]).toMatchObject({ op: 'translate', args: [emblem.x, emblem.y] })
    expect(ctx.log[saveIdx! + 2]).toMatchObject({ op: 'scale', args: [emblem.size / 48, emblem.size / 48] })
    const arc = ctx.log.find((c) => c.op === 'arc')
    expect(arc).toMatchObject({ op: 'arc', args: [24, 20, 12, Math.PI, 0] })
    const lineTos = ctx.log.filter((c) => c.op === 'lineTo')
    expect(lineTos.map((c) => c.args)).toEqual([
      [12, 38],
      [24, 38],
      [36, 38],
    ])
    const stroke = ctx.log.find((c) => c.op === 'stroke')
    expect(stroke!.style).toBe(SHARE_COLORS.emblem)
    expect(ctx.log[saveIdx! + 13]).toMatchObject({ op: 'restore' })
  })
  it('罫线：fillRect 高度恒 1、色值 rule；数量 = layout.rules 数', () => {
    const ctx = makeRecordingCtx()
    const canvas = makeRecordingCanvas(ctx)
    const layout = computeShareLayout(content(), opts())
    renderShareCard(canvas, layout, FONTS)
    const rules = ctx.log.filter(
      (c) => c.op === 'fillRect' && c.args[3] === 1 && c.style === SHARE_COLORS.rule,
    )
    expect(rules).toHaveLength(layout.rules.length)
  })
})

describe('exportSharePng（导出）', () => {
  it('文件名 readgraph-annual-{year}.png + anchor click + revoke', async () => {
    const appendChild = document.body.appendChild as ReturnType<typeof vi.fn>
    const anchor: Record<string, unknown> = { click: vi.fn(), remove: vi.fn() }
    ;(document.createElement as ReturnType<typeof vi.fn>).mockReturnValue(anchor)
    await expect(exportSharePng(makeRecordingCanvas(makeRecordingCtx()), 2025)).resolves.toBeUndefined()
    expect(anchor.download).toBe('readgraph-annual-2025.png')
    expect(anchor.href).toBe('blob:u1')
    expect(anchor.click).toHaveBeenCalledTimes(1)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:u1')
    expect(appendChild).toHaveBeenCalledWith(anchor)
  })

  it('toBlob 回调 null → reject（Dialog 层 toast 场景）', async () => {
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => makeRecordingCtx(),
      toBlob: (cb: (b: Blob | null) => void) => cb(null),
    } as unknown as HTMLCanvasElement
    await expect(exportSharePng(canvas, 2025)).rejects.toThrow('toBlob returned null')
  })

  it('sharePngFilename 同源', () => {
    expect(sharePngFilename(2024)).toBe('readgraph-annual-2024.png')
  })
})
