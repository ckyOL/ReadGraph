// 价格分布（reading-profile §2.5/§4，第 5 个图谱块）。
// 仅主导币种分桶（聚合层已按 dominantCurrency 过滤）；桶区间串不带货币
// 符号，币种代码由本组件标注（tooltip）。
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
  data: ProfileStatsResult['money']['distribution']
  /** 主导币种（ISO 4217）；null → 无定价，空态 */
  currency: string | null
  emptyTitle: string
  emptyDescription: string
}

function PriceDistributionImpl({ data, currency, emptyTitle, emptyDescription }: Props) {
  const { t, i18n } = useTranslation('pages')
  const palette = useChartPalette()
  const language = i18n.language

  const hasData = currency != null && data.length > 0

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
          // 桶区间（"20–50"）+ 币种代码标注，金额单位由 context 说明。
          return `${item?.name ?? ''} ${currency}: ${item?.value ?? 0}`
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
  }, [data, hasData, currency, palette])

  const ref = useECharts(option)

  if (!hasData) {
    return (
      <div className="flex min-h-[240px] w-full flex-col">
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  // A-1：容器带 role="img" + aria-label（WCAG 1.1.1）。
  return <div ref={ref} className="h-[360px] w-full" lang={language} role="img" aria-label={t('profile.chart.price.ariaLabel')} />
}

export const PriceDistribution = memo(PriceDistributionImpl)
