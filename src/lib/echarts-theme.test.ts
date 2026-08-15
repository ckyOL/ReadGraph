import { describe, it, expect } from 'vitest'

import { buildTheme } from '@/lib/echarts-theme'

// 主题 CSS 变量样本（对照 §11.3：palette/坐标轴/tooltip 取自对应变量）
const LIGHT_VARS: Record<string, string> = {
  '--background': '#ffffff',
  '--foreground': '#0a0a0a',
  '--border': '#e5e5e5',
  '--muted-foreground': '#6b7280',
  '--popover': '#ffffff',
  '--popover-foreground': '#0a0a0a',
  '--chart-1': '#4e79a7',
  '--chart-2': '#59a14f',
  '--chart-3': '#e15759',
  '--chart-4': '#f28e2b',
  '--chart-5': '#b07aa1',
}

const DARK_VARS: Record<string, string> = {
  '--background': '#0a0a0a',
  '--foreground': '#fafafa',
  '--border': '#27272a',
  '--muted-foreground': '#a1a1aa',
  '--popover': '#0a0a0a',
  '--popover-foreground': '#fafafa',
  '--chart-1': '#3b82f6',
  '--chart-2': '#10b981',
  '--chart-3': '#ef4444',
  '--chart-4': '#f59e0b',
  '--chart-5': '#a855f7',
}

describe('buildTheme - 调色板', () => {
  it('palette 取 --chart-1..5', () => {
    const t = buildTheme(false, LIGHT_VARS)
    expect(t.color).toEqual(['#4e79a7', '#59a14f', '#e15759', '#f28e2b', '#b07aa1'])
  })

  it('暗色调色板取 dark vars', () => {
    const t = buildTheme(true, DARK_VARS)
    expect(t.color).toEqual(['#3b82f6', '#10b981', '#ef4444', '#f59e0b', '#a855f7'])
  })
})

describe('buildTheme - 坐标轴', () => {
  it('轴线用 --border，标签用 --muted-foreground', () => {
    const t = buildTheme(false, LIGHT_VARS)
    expect(t.axis?.line?.lineStyle?.color).toBe('#e5e5e5')
    expect(t.axis?.label?.color).toBe('#6b7280')
  })

  it('暗色轴线/标签取 dark vars', () => {
    const t = buildTheme(true, DARK_VARS)
    expect(t.axis?.line?.lineStyle?.color).toBe('#27272a')
    expect(t.axis?.label?.color).toBe('#a1a1aa')
  })
})

describe('buildTheme - tooltip', () => {
  it('背景 --popover，文字 --popover-foreground', () => {
    const t = buildTheme(false, LIGHT_VARS)
    expect(t.tooltip?.backgroundColor).toBe('#ffffff')
    expect(t.tooltip?.textStyle?.color).toBe('#0a0a0a')
  })
})

describe('buildTheme - 背景与纯函数', () => {
  it('背景透明（由卡片呈现，不重复卡片底色）', () => {
    const t = buildTheme(false, LIGHT_VARS)
    expect(t.backgroundColor).toBe('transparent')
  })

  it('缺失 chart 变量时用首色循环补齐', () => {
    const vars = { ...LIGHT_VARS }
    delete vars['--chart-3']
    delete vars['--chart-4']
    const t = buildTheme(false, vars)
    // 缺失项回退到 palette[0]，保证长度恒为 5
    expect(t.color).toHaveLength(5)
    expect(t.color[0]).toBe('#4e79a7')
    expect(t.color[2]).toBe('#4e79a7')
  })

  it('同入参两次调用深等价', () => {
    const a = buildTheme(true, DARK_VARS)
    const b = buildTheme(true, DARK_VARS)
    expect(a).toEqual(b)
  })
})
