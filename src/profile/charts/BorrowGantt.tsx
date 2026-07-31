// 借阅甘特带（reading-profile §4，C-3）。
// lane = bookId:barcode；status='borrowed' 的 end=null 由组件层 useDeferredValue
// 的 now 补齐视觉，不回写聚合产物（§2/§5）。区间数 ≥ GANTT_THRESHOLD 启用
// dataZoom 视口；超量时按最近活跃 lane 封顶渲染矩形数（不一次性渲染超量矩形）。
import { memo, useEffect, useMemo, useState, useDeferredValue } from 'react'
import { useTranslation } from 'react-i18next'
import type { EChartsOption } from 'echarts'

import type { ProfileStatsResult } from '@/lib/profile-stats'
import type { BorrowStatus } from '@/types/entities'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'

import { useECharts, useChartPalette } from './use-echarts'

/** 大数据启用视口下采样的阈值（reading-profile §5 候选 5000 区间）。 */
export const GANTT_THRESHOLD = 5000
/** 渲染矩形硬上限：超过则按最近活跃 lane 封顶，保性能。 */
const MAX_RENDER_INTERVALS = 12000

// echarts custom-series renderItem 的 api 在类型层为可选联合（coord/value
// 标注为 possibly undefined），实际渲染时必存在 → 命名常量按已知形状取。
interface GanttRenderApi {
  value(idx: number): number
  coord(pt: readonly [number, number]): [number, number]
  size(pt: readonly [number, number]): [number, number]
}

interface Props {
  data: ProfileStatsResult['gantt']
  emptyTitle: string
  emptyDescription: string
}

// status→palette 颜色（custom series 不自动套主题色板，需显式指定）。
function statusColor(
  status: BorrowStatus,
  pal: ReturnType<typeof useChartPalette>,
): string {
  switch (status) {
    case 'borrowed':
      return pal.chart1
    case 'unknown':
      return pal.chart5
    default:
      return pal.chart3
  }
}

function BorrowGanttImpl({ data, emptyTitle, emptyDescription }: Props) {
  const { t, i18n } = useTranslation('pages')
  const palette = useChartPalette()

  // 在借端点视觉锚：每分钟滴答，deferred 不阻塞输入（rerender-use-deferred-value）。
  const [nowTick, setNowTick] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  const now = useDeferredValue(nowTick)

  const hasData = data.length > 0

  const { option, laneCount } = useMemo(() => {
    if (!hasData) return { option: null as EChartsOption | null, laneCount: 0 }

    // 选择保留的 lane：超量时按最近 borrowedAt 排序取前 N，使矩形数封顶。
    const ranked = data
      .map((lane) => {
        let lastMs = 0
        let count = 0
        for (const it of lane.intervals) {
          count += 1
          const s = Date.parse(it.start)
          const e = it.end ? Date.parse(it.end) : now
          if (e > lastMs) lastMs = e
          if (s > lastMs) lastMs = s
        }
        return { lane, lastMs, count }
      })
      .sort((a, b) => b.lastMs - a.lastMs)

    let totalIntervals = 0
    for (const r of ranked) totalIntervals += r.count
    let keep = ranked
    if (totalIntervals > MAX_RENDER_INTERVALS) {
      let acc = 0
      const kept: typeof ranked = []
      for (const r of ranked) {
        if (acc >= MAX_RENDER_INTERVALS) break
        kept.push(r)
        acc += r.count
      }
      keep = kept
    }

    const lanes = keep.map((r) => r.lane)
    const downsample = totalIntervals >= GANTT_THRESHOLD

    const items: {
      value: [number, number, number]
      _label: string
      _start: string
      _end: string | null
      _status: BorrowStatus
    }[] = []
    for (let li = 0; li < lanes.length; li++) {
      const lane = lanes[li]
      for (const it of lane.intervals) {
        const s = Date.parse(it.start)
        const e = it.end ? Date.parse(it.end) : now
        items.push({
          value: [s, e, li],
          _label: lane.label,
          _start: it.start,
          _end: it.end,
          _status: it.status,
        })
      }
    }

    const laneLabels = lanes.map((l) => l.label)

    const opt: EChartsOption = {
      tooltip: {
        formatter: (p) => {
          // echarts formatter 参数为 union，custom-series 单项 tooltip 的 .data
          // 在类型层丢失（library type under-expressive）→ 命名常量按已知形状取。
          const param = p as { data?: (typeof items)[number] }
          const d = param.data
          if (!d) return ''
          const endTxt = d._end ? new Date(d._end).toLocaleDateString(i18n.language) : t('profile.summary.inBorrow')
          return `${d._label}<br/>${new Date(d._start).toLocaleDateString(i18n.language)} → ${endTxt}`
        },
        backgroundColor: palette.popover,
        textStyle: { color: palette.popoverForeground },
      },
      grid: {
        left: 8,
        right: 16,
        top: 8,
        bottom: downsample ? 48 : 16,
        containLabel: true,
      },
      xAxis: {
        type: 'time',
        axisLine: { lineStyle: { color: palette.border } },
        axisLabel: { color: palette.mutedForeground, hideOverlap: true },
      },
      yAxis: {
        type: 'category',
        data: laneLabels,
        inverse: true,
        axisLine: { lineStyle: { color: palette.border } },
        axisLabel: {
          color: palette.mutedForeground,
          width: 110,
          overflow: 'truncate',
          fontSize: 11,
        },
      },
      dataZoom: downsample
        ? [
            { type: 'inside', xAxisIndex: 0, filterMode: 'none' },
            { type: 'slider', xAxisIndex: 0, height: 18, bottom: 12, filterMode: 'none' },
          ]
        : undefined,
      series: [
        {
          type: 'custom',
          renderItem: (params, api) => {
            const a = api as unknown as GanttRenderApi
            const d = items[params.dataIndex]
            const startPt = a.coord([a.value(0), a.value(2)])
            const endPt = a.coord([a.value(1), a.value(2)])
            const bandH = a.size([0, 1])[1]
            const w = endPt[0] - startPt[0]
            return {
              type: 'rect',
              shape: {
                x: startPt[0],
                y: startPt[1] - bandH / 2 + 2,
                width: Math.max(w, 2),
                height: Math.max(bandH - 4, 3),
              },
              style: { fill: statusColor(d._status, palette) },
            }
          },
          encode: { x: [0, 1], y: 2 },
          clip: true,
          data: items,
        },
      ],
    }
    return { option: opt, laneCount: lanes.length }
  }, [data, hasData, now, palette, t, i18n.language])

  const ref = useECharts(option)

  if (!hasData) {
    return (
      <Empty className="min-h-[280px]">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  // 下采样提示：当原始 lane 数多于渲染 lane 数时标注。
  const collapsed = data.length - laneCount
  return (
    <div className="relative">
      {collapsed > 0 && (
        <span className="absolute right-2 top-1 z-10 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {t('profile.chart.density')} · {collapsed}
        </span>
      )}
      <div ref={ref} className="h-[320px] w-full overflow-x-auto" lang={i18n.language} />
    </div>
  )
}

export const BorrowGantt = memo(BorrowGanttImpl)
