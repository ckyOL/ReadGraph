// 借阅时长分布（reading-profile §4，C-5）。
// 5 档分桶（聚合层）；空样本 avg/median 表达 `—`；avg/median 来源 summary。
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
  data: ProfileStatsResult['durationDistribution']
  summary: ProfileStatsResult['summary']
  emptyTitle: string
  emptyDescription: string
}

function DurationDistributionImpl({
  data,
  summary,
  emptyTitle,
  emptyDescription,
}: Props) {
  const { t, i18n } = useTranslation('pages')
  const palette = useChartPalette()
  const language = i18n.language
  const unit = t('profile.summary.days')

  const hasData = data.length > 0

  const option = useMemo<EChartsOption | null>(() => {
    if (!hasData) return null
    return {
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: palette.popover,
        textStyle: { color: palette.popoverForeground },
        formatter: (p) => {
          const item = (p as unknown as { name?: string; value?: number }[])[0]
          return `${item?.name ?? ''}: ${item?.value ?? 0}`
        },
      },
      grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
      xAxis: {
        type: 'category',
        data: data.map((d) => d.range),
        axisLine: { lineStyle: { color: palette.border } },
        axisTick: { show: false },
        axisLabel: { color: palette.mutedForeground, fontSize: 11 },
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
          barMaxWidth: 48,
        },
      ],
    }
  }, [data, hasData, palette])

  const ref = useECharts(option)

  const fmtDays = (v: number | null): string =>
    v === null ? '—' : `${v.toFixed(1)} ${unit}`

  if (!hasData) {
    return (
      <div className="flex min-h-[240px] w-full flex-col gap-3">
        <div className="flex items-center justify-around text-xs text-muted-foreground">
          <span>{t('profile.summary.avgDuration')}: —</span>
          <span>{t('profile.summary.medianDuration')}: —</span>
        </div>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex items-center justify-around text-xs text-muted-foreground">
        <span>
          {t('profile.summary.avgDuration')}: {fmtDays(summary.avgDurationDays)}
        </span>
        <span>
          {t('profile.summary.medianDuration')}:{' '}
          {fmtDays(summary.medianDurationDays)}
        </span>
      </div>
      <div ref={ref} className="h-[320px] w-full" lang={language} />
    </div>
  )
}

export const DurationDistribution = memo(DurationDistributionImpl)
