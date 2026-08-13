// 借阅量柱图（reading-profile §4，C-4）。
// 桶归属基于 UTC（聚合层）；桶键即 UTC 日历单位（YYYY-MM / YYYY），标签按
// formatBucketLabel 以 UTC 名字呈现（displayTimezone 格式化会错显上月/上年，
// M6 回归），语言随 locale。
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { EChartsOption } from 'echarts'

import type { ProfileStatsResult } from '@/lib/profile-stats'
import { formatBucketLabel } from '@/lib/display-time'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'

import { useECharts, useChartPalette } from './use-echarts'

interface Props {
  data: ProfileStatsResult['borrowVolume']
  emptyTitle: string
  emptyDescription: string
}

function BorrowVolumeBarImpl({
  data,
  emptyTitle,
  emptyDescription,
}: Props) {
  const { i18n } = useTranslation('pages')
  const palette = useChartPalette()
  const language = i18n.language

  const hasData = data.length > 0

  const option = useMemo<EChartsOption | null>(() => {
    if (!hasData) return null
    const labels = data.map((d) => formatBucketLabel(d.bucket, language))
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
  }, [data, hasData, language, palette])

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
