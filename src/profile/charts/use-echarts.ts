// ECharts 薄适配层（reading-profile §3）。
//
// - 按需注册：`echarts/core` + `TreemapChart`/`BarChart`/`CustomChart` +
//   `CanvasRenderer` + 所需 component，不走 `echarts` barrel（bundle-barrel-imports）。
// - 动态 import：仅 `/profile` 激活后加载 echarts chunk（bundle-dynamic-imports）。
// - 主题：`.dark` 切换时重建 theme 并 re-init + setOption，旧实例 dispose 防泄漏。
// v6 实例化约束（legend 锚定 / grid.outerBoundsMode）由各图组件在 option 中遵守。
import * as React from 'react'
import type { EChartsType, EChartsCoreOption } from 'echarts/core'

import { buildTheme } from '@/lib/echarts-theme'
import { useTheme } from '@/hooks/use-theme'

// 动态注册的 echarts core 模块类型（运行时动态 import，类型用 typeof 推断）。
type EChartsCore = typeof import('echarts/core')

let ready: Promise<EChartsCore> | null = null

/** 懒加载并注册所需 echarts 模块（幂等，仅首次执行注册）。 */
export function initECharts(): Promise<EChartsCore> {
  if (ready) return ready
  ready = (async () => {
    const core = await import('echarts/core')
    const [charts, components, renderers] = await Promise.all([
      import('echarts/charts'),
      import('echarts/components'),
      import('echarts/renderers'),
    ])
    core.use([
      charts.TreemapChart,
      charts.BarChart,
      charts.CustomChart,
      charts.HeatmapChart,
      components.TooltipComponent,
      components.GridComponent,
      components.LegendComponent,
      components.DataZoomComponent,
      components.VisualMapComponent,
      renderers.CanvasRenderer,
    ])
    return core
  })()
  return ready
}

const CHART_VAR_KEYS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--border',
  '--muted-foreground',
  '--popover',
  '--popover-foreground',
]

export interface ChartPalette {
  chart1: string
  chart2: string
  chart3: string
  chart4: string
  chart5: string
  border: string
  mutedForeground: string
  popover: string
  popoverForeground: string
}

const FALLBACK_PALETTE: ChartPalette = {
  chart1: '#27477A',
  chart2: '#61764B',
  chart3: '#576D79',
  chart4: '#AD3140',
  chart5: '#998D86',
  border: '#E8E4DC',
  mutedForeground: '#666F68',
  popover: '#FFFFFF',
  popoverForeground: '#2A2A2A',
}

/**
 * 读取当前主题下的图表 CSS 变量，主题变化时重读。
 * 仅客户端 effect 中读 DOM；首渲染用 fallback，effect 后更新触发重绘。
 */
export function useChartPalette(): ChartPalette {
  const { resolved } = useTheme()
  const [palette, setPalette] = React.useState<ChartPalette>(FALLBACK_PALETTE)
  React.useEffect(() => {
    const vars = readChartCssVars()
    setPalette({
      chart1: vars['--chart-1'] || FALLBACK_PALETTE.chart1,
      chart2: vars['--chart-2'] || FALLBACK_PALETTE.chart2,
      chart3: vars['--chart-3'] || FALLBACK_PALETTE.chart3,
      chart4: vars['--chart-4'] || FALLBACK_PALETTE.chart4,
      chart5: vars['--chart-5'] || FALLBACK_PALETTE.chart5,
      border: vars['--border'] || FALLBACK_PALETTE.border,
      mutedForeground: vars['--muted-foreground'] || FALLBACK_PALETTE.mutedForeground,
      popover: vars['--popover'] || FALLBACK_PALETTE.popover,
      popoverForeground: vars['--popover-foreground'] || FALLBACK_PALETTE.popoverForeground,
    })
  }, [resolved])
  return palette
}

/** 从 :root 读取图表所需 CSS 变量（仅客户端 effect 中调用）。 */
function readChartCssVars(): Record<string, string> {
  if (typeof document === 'undefined') return {}
  const style = getComputedStyle(document.documentElement)
  const out: Record<string, string> = {}
  for (const k of CHART_VAR_KEYS) out[k] = style.getPropertyValue(k)
  return out
}

function themeName(isDark: boolean): string {
  return isDark ? 'readgraph-dark' : 'readgraph-light'
}

export interface EChartsEvents {
  /** 图表 click 事件（treemap 下钻等；handler 经 ref 持有最新引用，主题重建后自动重挂）。 */
  click?: (params: unknown) => void
}

/**
 * ECharts 实例响应式包装。
 *
 * @param option 图表 option（由消费方 memo 化；引用变化触发 setOption）。
 * @param events 图表事件（可选）；handler 每次渲染刷新，无需 memo。
 * @returns container ref，绑到图表容器 `<div>`。
 *
 * 生命周期：theme(resolved) 变化 → dispose 旧实例 → 按新主题 re-init →
 * 重应用当前 option；option 变化 → setOption(notMerge)。卸载时 dispose +
 * ResizeObserver 断开，防泄漏（P0-2）。
 */
export function useECharts(
  option: EChartsCoreOption | null,
  events?: EChartsEvents,
): React.RefObject<HTMLDivElement | null> {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const instRef = React.useRef<EChartsType | null>(null)
  // 始终持有最新 option，供 theme 重 init 后重应用（避免把 option 列入 init effect 依赖）。
  const optionRef = React.useRef(option)
  optionRef.current = option
  const eventsRef = React.useRef(events)
  eventsRef.current = events
  const { resolved } = useTheme()

  // init / theme 重建
  React.useEffect(() => {
    let cancelled = false
    let ro: ResizeObserver | null = null
    const dom = ref.current
    if (!dom) return
    void initECharts().then((core) => {
      if (cancelled || !ref.current) return
      instRef.current?.dispose()
      const theme = buildTheme(resolved === 'dark', readChartCssVars())
      const name = themeName(resolved === 'dark')
      core.registerTheme(name, theme)
      const inst = core.init(ref.current, name)
      instRef.current = inst
      if (optionRef.current) inst.setOption(optionRef.current, true)
      // 事件：固定包装器读取最新 eventsRef，主题重建后自动重挂。
      inst.on('click', (params) => {
        eventsRef.current?.click?.(params)
      })
      ro = new ResizeObserver(() => inst.resize())
      ro.observe(ref.current)
    })
    return () => {
      cancelled = true
      ro?.disconnect()
      instRef.current?.dispose()
      instRef.current = null
    }
  }, [resolved])

  // option 变化（实例已就绪后）
  React.useEffect(() => {
    const inst = instRef.current
    if (inst && option) inst.setOption(option, true)
  }, [option])

  return ref
}
