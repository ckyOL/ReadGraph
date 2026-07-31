// 分类法分布 treemap（reading-profile §4，C-2）。
// 一级类目呈现 + 交互高亮 + tooltip；子类下钻标 TODO。
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

import { useECharts } from './use-echarts'

interface Props {
  data: ProfileStatsResult['classification']
  emptyTitle: string
  emptyDescription: string
}

function ClassificationTreemapImpl({ data, emptyTitle, emptyDescription }: Props) {
  const { t, i18n } = useTranslation('pages')

  const hasData = data.length > 0 && data.some((d) => d.value > 0)

  const option = useMemo<EChartsOption | null>(() => {
    if (!hasData) return null
    const label = (name: string): string =>
      name === '__unclassified__'
        ? t('profile.classification.unclassified')
        : name
    return {
      tooltip: {
        formatter: (p) => {
          const v = (p as { value?: number }).value
          return `${label((p as { name?: string }).name ?? '')}: ${v ?? 0}`
        },
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: 'zoomToNode',
          breadcrumb: { show: false },
          // 子类下钻：本里程碑仅一级呈现，下钻交互留 TODO（reading-profile §4）。
          data: data
            .filter((d) => d.value > 0)
            .map((d) => ({
              name: label(d.name),
              value: d.value,
            })),
          label: {
            show: true,
            formatter: '{b}: {c}',
          },
          upperLabel: { show: false },
          itemStyle: { borderColor: 'var(--background)', borderWidth: 1, gapWidth: 1 },
        },
      ],
    }
  }, [data, hasData, t])

  const ref = useECharts(option)

  if (!hasData) {
    return (
      <Empty className="min-h-[320px]">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return <div ref={ref} className="h-[360px] w-full" lang={i18n.language} />
}

export const ClassificationTreemap = memo(ClassificationTreemapImpl)
