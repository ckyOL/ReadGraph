// 分类法分布 treemap（reading-profile §4，C-2；classification-hierarchy §5.3 下钻）。
// 一级类目呈现 + 交互高亮 + tooltip；点一级节点后按该级 code 前缀过滤桶内书目
// 分类号（useLiveQuery 直查 DB，classCodes multiEntry 索引），resolveClassificationPath
// 建子级树，setOption 重建；面包屑回退一级。下钻数据链在 UI 层，聚合层
// （computeProfileStats 一级桶）不变（规格 §4.4）。仅 clc 体系可下钻（有树），
// lcc/ddc/udc 维持 zoomToNode 原交互。
import { memo, useEffect, useMemo, useDeferredValue, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import type { EChartsOption } from 'echarts'

import type { ProfileStatsResult } from '@/lib/profile-stats'
import {
  buildClassificationChildren,
  loadClcTree,
  loadClcOverlay,
  loadClcAuxiliary,
  type ClassificationChild,
  type ClcNode,
  type OverlayData,
  type AuxiliaryData,
} from '@/lib/classification-path'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { db } from '@/db/db-instance'
import type { ClassificationSystem } from '@/types/entities'

import { useECharts } from './use-echarts'

interface Props {
  data: ProfileStatsResult['classification']
  /** 生效分类体系（treemap 数据按此聚合，与 computeProfileStats 同源）；仅 clc 可下钻。 */
  system: ClassificationSystem
  emptyTitle: string
  emptyDescription: string
}

interface DrillLevel {
  code: string
  name: string
  value: number
}

interface TreemapDatum {
  name: string
  code: string
  value: number
}

function ClassificationTreemapImpl({ data, system, emptyTitle, emptyDescription }: Props) {
  const { t, i18n } = useTranslation('pages')

  // 下钻路径（栈式）。useDeferredValue 延迟下钻查询，保输入响应（rerender-use-deferred-value）。
  const [drillPath, setDrillPath] = useState<DrillLevel[]>([])
  const deferredDrillPath = useDeferredValue(drillPath)
  const drill =
    deferredDrillPath.length > 0 ? deferredDrillPath[deferredDrillPath.length - 1] : null

  // CLC 树懒加载（独立 chunk，与芯片共享模块级缓存）。
  const [treeData, setTreeData] = useState<{
    tree: ClcNode[]
    overlay: OverlayData
    auxiliary: AuxiliaryData
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    void Promise.all([loadClcTree(), loadClcOverlay(), loadClcAuxiliary()]).then(
      ([tree, overlay, auxiliary]) => {
        if (!cancelled) setTreeData({ tree, overlay, auxiliary })
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  // 下钻数据链（UI 层）：按当前下钻 code 前缀直查 DB（classCodes multiEntry 索引），
  // 每本书取首条 clc 命中码（与 computeProfileStats 的 first-record 语义一致）。
  const drillQuery = useLiveQuery<{ code: string; children: ClassificationChild[] } | null>(
    async () => {
      if (!drill || system !== 'clc' || !treeData) return null
      const records = await db.catalogRecords
        .where('classCodes')
        .startsWith(drill.code)
        .toArray()
      const byBook = new Map<string, string>()
      for (const rec of records) {
        if (byBook.has(rec.bookId)) continue
        const entry = rec.classifications.find(
          (c) => c.system === 'clc' && c.code.toUpperCase().startsWith(drill.code),
        )
        if (entry) byBook.set(rec.bookId, entry.code)
      }
      return {
        code: drill.code,
        children: buildClassificationChildren(
          drill.code,
          Array.from(byBook.values()),
          treeData.tree,
          treeData.overlay,
          treeData.auxiliary,
        ),
      }
    },
    [drill, system, treeData],
  )
  // 查询结果携带所属下钻 code，避免下钻切换瞬间展示旧层级数据。
  const drillChildren =
    drillQuery && drillQuery.code === drill?.code ? drillQuery.children : null

  const hasData = data.length > 0 && data.some((d) => d.value > 0)

  const topNodes = useMemo<TreemapDatum[]>(
    () =>
      data
        .filter((d) => d.value > 0)
        .map((d) => ({
          name:
            d.name === '__unclassified__'
              ? t('profile.classification.unclassified')
              : d.name,
          code: d.code,
          value: d.value,
        })),
    [data, t],
  )

  const option = useMemo<EChartsOption | null>(() => {
    if (!hasData && !drill) return null
    const nodes: TreemapDatum[] = drill
      ? drillChildren && drillChildren.length > 0
        ? drillChildren.map((c) => ({ name: c.name, code: c.code, value: c.value }))
        : // 叶子/无子级：呈现下钻节点自身，不空白。
          [{ name: drill.name, code: drill.code, value: drill.value }]
      : topNodes
    if (nodes.length === 0) return null
    return {
      tooltip: {
        formatter: (p) => {
          const v = (p as { value?: number }).value
          return `${(p as { name?: string }).name ?? ''}: ${v ?? 0}`
        },
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          // 保留原交互（非下钻体系/叶子节点 zoomToNode）。
          nodeClick: 'zoomToNode',
          breadcrumb: { show: false },
          data: nodes,
          label: {
            show: true,
            formatter: '{b}: {c}',
          },
          upperLabel: { show: false },
          itemStyle: { borderColor: 'var(--background)', borderWidth: 1, gapWidth: 1 },
        },
      ],
    }
  }, [hasData, drill, drillChildren, topNodes])

  // 点击：clc 节点下钻一层（buildClassificationChildren 在查询侧完成分组）。
  const onClick = useMemo(
    () => (params: unknown) => {
      const p = params as { data?: TreemapDatum }
      const code = p.data?.code
      if (!code || code === '__unclassified__' || system !== 'clc' || !treeData) return
      if (!/^[A-Z]/.test(code)) return
      setDrillPath((prev) => [...prev, { code, name: p.data!.name, value: p.data!.value }])
    },
    [system, treeData],
  )

  const ref = useECharts(option, { click: onClick })

  if (!hasData && !drill) {
    return (
      <Empty className="min-h-[320px]">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div>
      {drillPath.length > 0 && (
        <nav
          aria-label={t('classification.drillBreadcrumb')}
          className="mb-1 flex flex-wrap items-center gap-1 text-xs"
        >
          <button
            type="button"
            onClick={() => setDrillPath([])}
            className="rounded-none border px-1.5 text-muted-foreground hover:text-foreground"
          >
            {t('classification.drillRoot')}
          </button>
          {drillPath.map((level, i) => (
            <span key={level.code} className="flex items-center gap-1">
              <span aria-hidden className="text-muted-foreground">
                {t('classification.breadcrumbSeparator')}
              </span>
              <button
                type="button"
                onClick={() => setDrillPath((prev) => prev.slice(0, i + 1))}
                className="rounded-none border px-1.5 hover:text-foreground"
              >
                {level.name}
              </button>
            </span>
          ))}
        </nav>
      )}
      <div ref={ref} className="h-[480px] w-full" lang={i18n.language} />
    </div>
  )
}

export const ClassificationTreemap = memo(ClassificationTreemapImpl)
