// ECharts 薄适配：主题 CSS 变量 → echarts theme（§11.3）。
// 不在模块顶层读 DOM；由消费方在 .dark 切换时重建并 setOption 重应用。

/** ECharts theme 对象片段（仅覆盖本页所需项；未列字段沿用 echarts 默认）。 */
export interface EChartsTheme {
  /** 数据系列色板（取 --chart-1..5，缺项循环补齐）。 */
  color: string[]
  /** 图表背景：透明，由外层谱块承担底色，避免卡片套卡片。 */
  backgroundColor: string
  axis?: {
    line?: { lineStyle?: { color?: string } }
    label?: { color?: string }
  }
  tooltip?: {
    backgroundColor?: string
    textStyle?: { color?: string }
  }
}

const CHART_KEYS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']

/**
 * 组装 ECharts theme。纯函数：不读 DOM、不读时钟。
 * @param cssVars 主题 CSS 变量键值（消费方从 :root/.dark 读取后注入）
 * @param isDark 仅语义标记，不读全局主题；实际配色完全由 cssVars 决定
 */
export function buildTheme(
  _isDark: boolean,
  cssVars: Record<string, string>,
): EChartsTheme {
  const trimmed: Record<string, string> = {}
  for (const [k, v] of Object.entries(cssVars)) {
    if (typeof v === 'string') trimmed[k] = v.trim()
  }

  // palette：--chart-1..5；缺失项回退首色，保证长度恒为 5。
  const first = trimmed['--chart-1'] ?? '#4e79a7'
  const palette: string[] = CHART_KEYS.map((k) => trimmed[k] || first)

  return {
    color: palette,
    backgroundColor: 'transparent',
    axis: {
      line: { lineStyle: { color: trimmed['--border'] ?? '#e5e5e5' } },
      label: { color: trimmed['--muted-foreground'] ?? '#6b7280' },
    },
    tooltip: {
      backgroundColor: trimmed['--popover'] ?? '#ffffff',
      textStyle: { color: trimmed['--popover-foreground'] ?? '#0a0a0a' },
    },
  }
}
