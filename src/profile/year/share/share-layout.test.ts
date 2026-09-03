// SC-2（annual-share-card-batch W1）：canvas 逻辑坐标布局纯函数测试。
// 规格：reading-profile §4.1（四段 120/560/520/240、边距 64、恒亮色、R4 Δ 对照行）。
// 断言纯数据结构，不触 DOM/canvas/Intl/t()（vitest 环境 = node）。
import { describe, it, expect } from 'vitest'

import type { ShareContent } from './share-content'
import type { ShareLayoutOptions } from './share-layout'
import {
  SHARE_CANVAS,
  SHARE_SEGMENTS,
  SHARE_COLORS,
  SHARE_BAR_COLORS,
  computeShareLayout,
} from './share-layout'
import type { ShareLayout, ShareTextInstruction } from './share-layout'

// ---- 画布常量（与 share-layout.ts 同源导出，测试与实现共用） ----
const W = SHARE_CANVAS.width // 1080
const M = SHARE_CANVAS.margin // 64
const RIGHT = W - M // 1016（内容右缘）
const CW = RIGHT - M // 952（内容宽）
// 封面三联槽宽 = (1080 - 2*64 - 2*24)/3（规格 §4.1 三联 3 等分，gap 24）
const COVER_GAP = 24
const COVER_W = (CW - 2 * COVER_GAP) / 3
const COVER_H = (COVER_W * 4) / 3 // 封面 3:4

/** ShareContent.summary 键名串由 SC-1 定稿（可微调），宽化类型透传避免测试与键名串耦合 */
function summaryOf(key: string): ShareContent['summary'] {
  return {
    key,
    params: { count: 27, categories: 3, topCategory: '文学' },
  } as ShareContent['summary']
}

const LONG_TITLE =
  'A quite long book title designed to exceed the clamped width so the renderer must truncate it to a single line'

function makeContent(over: Partial<ShareContent> = {}): ShareContent {
  return {
    year: 2025,
    bookCount: 27,
    topItems: [
      { title: '  三体：地球往事', authors: ['刘慈欣'], coverUrl: null, count: 12 },
      { title: '百年孤独', authors: ['加西亚·马尔克斯'], coverUrl: 'https://example.com/cover2.png', count: 8 },
      { title: LONG_TITLE, authors: [], coverUrl: null, count: 5 },
    ],
    topCategories: [
      { name: '文学', ratio: 12 / 27 },
      { name: '历史', ratio: 8 / 27 },
      { name: '科学', ratio: 5 / 27 },
    ],
    summary: summaryOf('profile.year.share.summary'),
    delta: { prevBookCount: 21 },
    ...over,
  }
}

const OPTS: ShareLayoutOptions = {
  yearLabel: '2025 阅读年报',
  summaryText: '共 27 本 · 3 类 · 最爱文学',
  deltaText: '2024 年借了 21 本',
  brandText: 'ReadGraph',
  fontStack: {
    title: '"Songti SC", "Noto Serif CJK SC", serif',
    body: 'ui-sans-serif, system-ui, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
}

function layoutOf(content: ShareContent, opts: ShareLayoutOptions = OPTS): ShareLayout {
  return computeShareLayout(content, opts)
}

/** 按文本取指令（文案原样进入指令的断言入口） */
function byText(layout: ShareLayout, text: string): ShareTextInstruction {
  const found = layout.textBlocks.find((b) => b.text === text)
  expect(found, `textBlocks 应含 "${text}"`).toBeDefined()
  return found as ShareTextInstruction
}

describe('SC-2 版式常量（§4.1 逻辑坐标 / R6 恒亮色）', () => {
  it('画布 1080×1440、dpr ×2、边距 64', () => {
    expect(SHARE_CANVAS).toEqual({ width: 1080, height: 1440, dpr: 2, margin: 64 })
  })

  it('四段高度 120/560/520/240，段界累加闭合画布高', () => {
    expect(SHARE_SEGMENTS).toEqual({ header: 120, hero: 560, facts: 520, footer: 240 })
    const { header, hero, facts, footer } = SHARE_SEGMENTS
    expect(header + hero + facts + footer).toBe(SHARE_CANVAS.height)
    // 段界 = 自顶累加：标识 [0,120) / 主视觉 [120,680) / 事实 [680,1200) / 落款 [1200,1440)
    expect(header).toBe(120)
    expect(header + hero).toBe(680)
    expect(header + hero + facts).toBe(1200)
    expect(header + hero + facts + footer).toBe(1440)
  })

  it('R6 恒亮色纸面 + 亮色 chart-1..5 + 徽标描边色', () => {
    expect(SHARE_COLORS).toEqual({
      paper: '#F9F7F2',
      ink: '#2A2A2A',
      rule: '#E8E4DC',
      placeholder: '#EAE0D5',
      accent: '#27477A',
      emblem: '#27477A',
    })
    expect(SHARE_BAR_COLORS).toEqual(['#27477A', '#61764B', '#576D79', '#AD3140', '#998D86'])
    expect(SHARE_BAR_COLORS[0]).toBe(SHARE_COLORS.accent)
  })
})

describe('四段 y 区间划分与 64 边距', () => {
  const layout = layoutOf(makeContent())

  it('所有指令坐标落在画布界内且文本不越内容横距', () => {
    for (const b of layout.textBlocks) {
      expect(b.x).toBeGreaterThanOrEqual(0)
      expect(b.x).toBeLessThanOrEqual(W)
      expect(b.y).toBeGreaterThanOrEqual(0)
      expect(b.y).toBeLessThanOrEqual(SHARE_CANVAS.height)
    }
    for (const s of layout.coverSlots) {
      expect(s.x).toBeGreaterThanOrEqual(M)
      expect(s.x + s.width).toBeLessThanOrEqual(RIGHT)
    }
    for (const r of layout.rules) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.x + r.width).toBeLessThanOrEqual(W)
    }
  })

  it('① 标识段（y[0,120)）：徽标与标题视觉对齐（盒中心 = 基线 - cap 半高 20），年份大字让位徽标右（x=128）与字标共基线，段底罫线 y=119', () => {
    const year = byText(layout, OPTS.yearLabel)
    const brand = byText(layout, OPTS.brandText)
    expect(year.x).toBe(M + 64) // 徽标 44 + 20 间隙
    expect(year.y).toBeLessThan(SHARE_SEGMENTS.header)
    expect(brand.y).toBeLessThan(SHARE_SEGMENTS.header)
    const baseline = Math.round(SHARE_SEGMENTS.header * 0.72)
    const emblem = layout.emblems[0]
    expect(emblem.size).toBe(44)
    // 视觉对齐：徽标盒中心 y = 标题基线 - 20（cap 半高），上下各 22
    expect(emblem.y).toBe(baseline - 20 - 22)
    expect(emblem.y + emblem.size).toBe(baseline - 20 + 22)
    expect(layout.emblems).toEqual([
      { kind: 'emblem', x: M, y: baseline - 42, size: 44 },
    ])
    expect(layout.rules).toEqual([
      { x: M, y: SHARE_SEGMENTS.header - 1, width: CW },
      { x: M, y: 1200, width: CW },
    ])
  })
  it('② 主视觉段（y[120,680)）：封面槽整槽与主数字基线均落段内', () => {
    for (const s of layout.coverSlots) {
      expect(s.y).toBeGreaterThanOrEqual(120)
      expect(s.y + s.height).toBeLessThanOrEqual(680)
    }
    const number = byText(layout, '27')
    expect(number.y).toBeGreaterThanOrEqual(120)
    expect(number.y).toBeLessThanOrEqual(680)
  })

  it('③ 事实段（y[680,1200)）：榜单行/类目名/Δ 行基线落段内，色块条整条不出段', () => {
    for (let i = 0; i < 3; i++) {
      const rankY = byText(layout, String(i + 1)).y
      expect(rankY).toBeGreaterThanOrEqual(680)
      expect(rankY).toBeLessThan(1200)
    }
    const deltaY = byText(layout, OPTS.deltaText as string).y
    expect(deltaY).toBeGreaterThanOrEqual(680)
    expect(deltaY).toBeLessThan(1200)
    for (const bar of layout.bars) {
      expect(bar.y).toBeGreaterThanOrEqual(680)
      expect(bar.y + bar.height).toBeLessThanOrEqual(1200)
    }
  })

  it('④ 落款段（y[1200,1440)）：总结句与 @字标基线落段内，段顶罫线 y=1200', () => {
    expect(byText(layout, OPTS.summaryText).y).toBeGreaterThanOrEqual(1200)
    expect(byText(layout, '@ReadGraph').y).toBeGreaterThanOrEqual(1200)
    expect(layout.rules[1].y).toBe(1200)
  })
})

describe('封面三联槽位（① Top 3 主视觉）', () => {
  it('3 等分：槽宽 = (1080-2*64-2*24)/3、间隙一致、槽高 = 宽*4/3、紧贴内容左右缘', () => {
    const layout = layoutOf(makeContent())
    expect(layout.coverSlots).toHaveLength(3)
    const [a, b, c] = layout.coverSlots
    expect(a.x).toBe(M)
    expect(a.width).toBeCloseTo(COVER_W, 6)
    expect(b.width).toBeCloseTo(COVER_W, 6)
    expect(c.width).toBeCloseTo(COVER_W, 6)
    expect(a.height).toBeCloseTo(COVER_H, 6)
    expect(b.height).toBeCloseTo(COVER_H, 6)
    // 间隙一致 = 槽位等差
    expect(b.x - a.x).toBeCloseTo(COVER_W + COVER_GAP, 6)
    expect(c.x - b.x).toBeCloseTo(COVER_W + COVER_GAP, 6)
    // 整组贴内容宽（右缘 = 1080-64）
    expect(c.x + c.width).toBeCloseTo(RIGHT, 6)
    expect(a.y).toBe(b.y)
    expect(a.y).toBe(c.y)
    expect(a.slotIndex).toBe(0)
    expect(b.slotIndex).toBe(1)
    expect(c.slotIndex).toBe(2)
  })

  it('不足 3 → 槽数随实际数，固定槽宽整组居中', () => {
    const layout = layoutOf(makeContent({ topItems: makeContent().topItems.slice(0, 2) }))
    expect(layout.coverSlots).toHaveLength(2)
    const [a, b] = layout.coverSlots
    expect(a.width).toBeCloseTo(COVER_W, 6)
    expect(b.width).toBeCloseTo(COVER_W, 6)
    expect(b.x - a.x).toBeCloseTo(COVER_W + COVER_GAP, 6)
    // 整组居中于画布（左右空白相等）
    expect(a.x - M).toBeCloseTo(RIGHT - (b.x + b.width), 6)
    expect((a.x + b.x + b.width) / 2).toBeCloseTo(W / 2, 6)
    expect(a.slotIndex).toBe(0)
    expect(b.slotIndex).toBe(1)
  })

  it('topItems 为空 → 无封面槽', () => {
    expect(layoutOf(makeContent({ topItems: [] })).coverSlots).toEqual([])
  })

  it('占位字符 = 题名首字（trim 后），空题名兜底 ·', () => {
    const layout = layoutOf(makeContent())
    expect(layout.coverSlots.map((s) => s.placeholderChar)).toEqual(['三', '百', 'A'])
    const emptyTitle = layoutOf(makeContent({ topItems: [{ title: '  ', authors: [], coverUrl: null, count: 1 }] }))
    expect(emptyTitle.coverSlots.map((s) => s.placeholderChar)).toEqual(['·'])
  })
})

describe('文本 clamp（长题名/总结句截断参数语义）', () => {
  it('长题名完整进入指令（布局不做字符级截断），携带 maxWidth/maxLines 交渲染器', () => {
    const layout = layoutOf(makeContent())
    const title = byText(layout, LONG_TITLE)
    expect(title.text).toBe(LONG_TITLE) // 原样、未截断
    expect(title.maxWidth).toBe(784) // 题名列宽 = 内容右缘 - 次数预留列 128 - 题名 x=104
    expect(title.maxLines).toBe(1)
  })

  it('总结句 body 可两行 clamp（maxWidth=内容宽、maxLines=2、lineHeight=40）', () => {
    const layout = layoutOf(makeContent())
    const summary = byText(layout, OPTS.summaryText)
    expect(summary.maxWidth).toBe(CW)
    expect(summary.maxLines).toBe(2)
    expect(summary.lineHeight).toBe(40)
  })
})

describe('③ 事实段榜单行', () => {
  const layout = layoutOf(makeContent())

  it('序号 mono 小字 + 题名 body + 次数 mono 右对齐，行高固定 56、自 y=740 起', () => {
    for (const [i, item] of makeContent().topItems.entries()) {
      const y = 740 + i * 56
      const rank = byText(layout, String(i + 1))
      expect(rank.x).toBe(M)
      expect(rank.y).toBe(y)
      expect(rank.align).toBe('left')
      expect(rank.color).toBe('muted')

      const title = byText(layout, item.title)
      expect(title.x).toBe(104) // 64 序号列宽 40
      expect(title.y).toBe(y)

      const count = byText(layout, String(item.count))
      expect(count.x).toBe(RIGHT)
      expect(count.y).toBe(y)
      expect(count.align).toBe('right')
      expect(count.color).toBe('ink')
    }
  })

  it('行内次数文本为数字原文（无 Intl 分组）', () => {
    expect(byText(layout, '12').text).toBe('12')
    expect(byText(layout, '8').text).toBe('8')
    expect(byText(layout, '5').text).toBe('5')
  })
})

describe('分类色块条（segments = topCategories ratio）', () => {
  const layout = layoutOf(makeContent())

  it('单条横向条：x=64、宽 1080-128、高 16、y=940', () => {
    expect(layout.bars).toHaveLength(1)
    const bar = layout.bars[0]
    expect(bar.x).toBe(M)
    expect(bar.width).toBe(CW)
    expect(bar.y).toBe(940)
    expect(bar.height).toBe(16)
  })

  it('类目名行随条产出：「name N%」左起对位各段，y=996；maxWidth = 段宽 - 16（长名段内截断不挤下一段）；首段 ink 余段 muted', () => {
    const cats = makeContent().topCategories
    let lx = M
    cats.forEach((cat, i) => {
      const label = byText(layout, `${cat.name} ${Math.round(cat.ratio * 100)} %`)
      expect(label.x).toBe(lx)
      expect(label.y).toBe(996)
      expect(label.font).toEqual({ size: 18, weight: 400, family: 'body' })
      expect(label.color).toBe(i === 0 ? 'ink' : 'muted')
      expect(label.maxWidth).toBe(cat.ratio * CW - 16)
      expect(label.maxLines).toBe(1)
      lx += cat.ratio * CW
    })
  })

  it('窄段避让：段可用宽 < 24 时跳过该段标注（不产出文本指令），色块仍在', () => {
    const layout = layoutOf(
      makeContent({
        topCategories: [
          { name: '文学', ratio: 0.7 },
          { name: '历史', ratio: 0.02 },
          { name: '科学', ratio: 0.28 },
        ],
      }),
    )
    expect(layout.bars[0].segments).toHaveLength(3)
    expect(layout.textBlocks.some((b) => b.text.startsWith('历史'))).toBe(false)
    expect(byText(layout, '文学 70 %').maxWidth).toBe(0.7 * CW - 16)
    expect(byText(layout, '科学 28 %').x).toBe(M + 0.72 * CW)
  })

  it('ratio=0 的段不产出（条与类目名行一致），colorIndex 按产出序连续', () => {
    const layout = layoutOf(
      makeContent({
        topCategories: [
          { name: '文学', ratio: 0.5 },
          { name: '历史', ratio: 0 },
          { name: '科学', ratio: 0.25 },
        ],
      }),
    )
    expect(layout.bars).toHaveLength(1)
    const bar = layout.bars[0]
    expect(bar.segments).toEqual([
      { ratio: 0.5, colorIndex: 0, label: '文学' },
      { ratio: 0.25, colorIndex: 1, label: '科学' },
    ])
    expect(layout.textBlocks.some((b) => b.text === '历史 0 %')).toBe(false)
  })

  it('无分类 → 不产出色块条与类目名行', () => {
    expect(layoutOf(makeContent({ topCategories: [] })).bars).toEqual([])
    expect(layoutOf(makeContent({ topCategories: [] })).textBlocks.some((b) => b.text.includes('%'))).toBe(false)
    expect(layoutOf(makeContent({ topCategories: [{ name: '空', ratio: 0 }] })).bars).toEqual([])
  })
})

describe('历年对照行（R4：delta=null → 不产出对照行指令）', () => {
  it('delta 非 null 且 deltaText 非空 → 一条 mono muted 小字指令', () => {
    const layout = layoutOf(makeContent())
    const delta = byText(layout, OPTS.deltaText as string)
    expect(delta.font.family).toBe('mono')
    expect(delta.font.size).toBe(20)
    expect(delta.color).toBe('muted')
    expect(delta.x).toBe(M)
    expect(delta.y).toBe(1048)
    expect(delta.align).toBe('left')
  })

  it('delta=null（无上年数据）→ 即便传入 deltaText 也不产出对照行指令', () => {
    const layout = layoutOf(makeContent({ delta: null }))
    expect(layout.textBlocks.some((b) => b.text === OPTS.deltaText)).toBe(false)
  })

  it('delta 非 null 但 deltaText 为空/缺省 → 不产出对照行指令', () => {
    const content = makeContent({ delta: { prevBookCount: 21 } })
    expect(layoutOf(content, { ...OPTS, deltaText: null }).textBlocks.some((b) => b.text === OPTS.deltaText)).toBe(
      false,
    )
    expect(layoutOf(content, { ...OPTS, deltaText: '' }).textBlocks.some((b) => b.text === '')).toBe(false)
  })
})

describe('字号/字重 token 与规格表一致（title 56/600、body 28/400）', () => {
  const layout = layoutOf(makeContent())

  it('年份大标题：title 56/600、ink', () => {
    const year = byText(layout, OPTS.yearLabel)
    expect(year.font).toEqual({ size: 56, weight: 600, family: 'title' })
    expect(year.color).toBe('ink')
    expect(year.kind).toBe('text')
  })

  it('主数字：mono 大号 600、accent', () => {
    const number = byText(layout, '27')
    expect(number.font.family).toBe('mono')
    expect(number.font.size).toBe(96)
    expect(number.font.weight).toBe(600)
    expect(number.color).toBe('accent')
  })

  it('榜单题名/总结句：body 28/400 ink；次数：mono 28/400', () => {
    const title = byText(layout, '百年孤独')
    expect(title.font).toEqual({ size: 28, weight: 400, family: 'body' })
    expect(title.color).toBe('ink')
    expect(byText(layout, OPTS.summaryText).font).toEqual({ size: 28, weight: 400, family: 'body' })
    const count = byText(layout, '8')
    expect(count.font).toEqual({ size: 28, weight: 400, family: 'mono' })
  })

  it('字标/序号：mono 20/400', () => {
    expect(byText(layout, OPTS.brandText).font).toEqual({ size: 20, weight: 400, family: 'mono' })
    expect(byText(layout, '1').font).toEqual({ size: 20, weight: 400, family: 'mono' })
  })
})

describe('文案原样进入指令（布局不触 Intl/t()）', () => {
  const layout = layoutOf(makeContent())

  it('yearLabel/summaryText 原样', () => {
    expect(byText(layout, OPTS.yearLabel).text).toBe(OPTS.yearLabel)
    expect(byText(layout, OPTS.summaryText).text).toBe(OPTS.summaryText)
  })

  it('brandText 进 ① 标识段；"@"+brandText 进 ④ 落款段', () => {
    const headerBrand = byText(layout, OPTS.brandText)
    expect(headerBrand.x).toBe(RIGHT)
    expect(headerBrand.align).toBe('right')
    const footerBrand = byText(layout, '@ReadGraph')
    expect(footerBrand.text).toBe('@' + OPTS.brandText)
    expect(footerBrand.y).toBe(1384)
    expect(footerBrand.color).toBe('muted')
  })
})

describe('纯函数性与降级结构', () => {
  it('同输入两次调用深等价，输入不被改写', () => {
    const content = makeContent()
    const opts = { ...OPTS }
    const a = computeShareLayout(content, opts)
    const b = computeShareLayout(content, opts)
    expect(a).toEqual(b)
    expect(content).toEqual(makeContent())
  })

  it('空榜单 + 空分类 + 无上年 → 仅头/主数字/总结/双字标指令与两条罫线，徽标仍产出，不崩', () => {
    const layout = layoutOf(makeContent({ topItems: [], topCategories: [], delta: null }), {
      ...OPTS,
      deltaText: undefined,
    })
    expect(layout.textBlocks.map((b) => b.text)).toEqual([OPTS.yearLabel, 'ReadGraph', '27', OPTS.summaryText, '@ReadGraph'])
    expect(layout.coverSlots).toEqual([])
    expect(layout.bars).toEqual([])
    expect(layout.rules).toHaveLength(2)
    expect(layout.emblems).toHaveLength(1)
    expect(layout.width).toBe(1080)
    expect(layout.height).toBe(1440)
  })
})
