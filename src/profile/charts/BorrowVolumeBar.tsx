// 借阅量柱图（reading-profile §4，C-4）。
// 桶归属基于 UTC（聚合层），轴标签按 displayTimezone 用 Intl.DateTimeFormat
// 呈现（桶归属不变）。range 左闭右开裁剪在聚合层已处理。
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { EChartsOption } from 'echarts'

import type { ProfileStatsResult } from '@/lib/profile-stats'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'

import { useECharts, useChartPalette } from './use-echarts'

interface Props {
  data: ProfileStatsResult['borrowVolume']
  displayTimezone: string
  emptyTitle: string
  emptyDescription: string
}

const MONTH_RE = /^(\d{4})-(\d{2})$/

function formatBucketLabel(
  bucket: string,
  timezone: string,
  language: string,
): string {
  const m = MONTH_RE.exec(bucket)
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, 1))
    return new Intl.DateTimeFormat(language, {
      timeZone: timezone,
      year: 'numeric',
      month: 'short',
    }).format(d)
  }
  // 年桶：时区无影响，仅显示年。
  const d = new Date(Date.UTC(+bucket, 0, 1))
  return new Intl.DateTimeFormat(language, {
    timeZone: timezone,
    year: 'numeric',
  }).format(d)
}

function BorrowVolumeBarImpl({
  data,
  displayTimezone,
  emptyTitle,
  emptyDescription,
}: Props) {
  const { i18n } = useTranslation('pages')
  const palette = useChartPalette()
  const language = i18n.language

  const hasData = data.length > 0

  const option = useMemo<EChartsOption | null>(() => {
    if (!hasData) return null
    const labels = data.map((d) => formatBucketLabel(d.bucket, displayTimezone, language))
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: palette.popover,
        textStyle: { color: palette.popoverForeground },
      },
      grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: palette.border } },
        axisTick: { show: false },
        axisLabel: { color: palette.mutedForeground, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        splitLine: { lineStyle: { color: palette.border } },
        axisLabel: { color: palette.mutedForeground, minInterval: 1 },
      },
      series: [
        {
          type: 'bar',
          data: data.map((d) => d.count),
          barMaxWidth: 40,
          itemStyle: { borderRadius: [0, 0, 0, 0] },
        },
      ],
    }
  }, [data, hasData, displayTimezone, language, palette])

  const ref = useECharts(option)

  if (!hasData) {
    return (
      <Empty className="min-h-[240px]">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return <div ref={ref} className="h-[360px] w-full" lang={language} />
}

export const BorrowVolumeBar = memo(BorrowVolumeBarImpl)
