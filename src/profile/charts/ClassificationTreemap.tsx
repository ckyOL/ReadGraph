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
import {
  selectClassificationNodes,
  canDrillClassification,
  type ClassificationNode,
} from './classification-nodes'

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

  // 视图切换（A-1 键盘等价路径）：canvas 交互仅鼠标可用，列表视图提供
  // 键盘可导航的当前层级节点按钮；仅 clc 体系可下钻，故切换器仅 clc 显示。
  const [view, setView] = useState<'canvas' | 'list'>('canvas')
  const showList = system === 'clc' && view === 'list'

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
  // 局限（H-5）：索引查询只能命中已写 classCodes 字段的记录——启动回填失败时存量
  // 缺该字段，此处会漏书；自愈需全表扫描，渲染路径禁扫（roadmap 性能规则），故
  // 不可自愈。内存物化路径由 withClassCodes 读侧归一兜底，诊断由启动回填的
  // console.error 兜底（见 src/db/startup-backfills.ts）。
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

  // 当前层级节点（canvas option 与列表视图同源，A-1）。
  const listNodes = useMemo<ClassificationNode[]>(
    () => selectClassificationNodes({ drill, drillChildren, topNodes }),
    [drill, drillChildren, topNodes],
  )

  const option = useMemo<EChartsOption | null>(() => {
    if (!hasData && !drill) return null
    const nodes: ClassificationNode[] = listNodes
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
  }, [hasData, listNodes])

  // 点击：clc 节点下钻一层（buildClassificationChildren 在查询侧完成分组）。
  // 列表视图按钮与 canvas 点击共用同一判定（A-1 键盘等价路径）。
  const drillNode = (node: ClassificationNode) => {
    if (!canDrillClassification(node.code, { system, treeLoaded: !!treeData })) return
    setDrillPath((prev) => [
      ...prev,
      { code: node.code, name: node.name, value: node.value },
    ])
  }
  const onClick = useMemo(
    () => (params: unknown) => {
      const p = params as { data?: TreemapDatum }
      if (p.data) drillNode(p.data)
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
      {system === 'clc' && (
        <div
          role="group"
          aria-label={t('classification.viewToggleLabel')}
          className="mb-1 flex items-center gap-1 text-xs"
        >
          <button
            type="button"
            aria-pressed={view === 'canvas'}
            onClick={() => setView('canvas')}
            className={`rounded-none border px-1.5 ${
              view === 'canvas'
                ? 'bg-muted-foreground/20 text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('classification.viewCanvas')}
          </button>
          <button
            type="button"
            aria-pressed={view === 'list'}
            onClick={() => setView('list')}
            className={`rounded-none border px-1.5 ${
              view === 'list'
                ? 'bg-muted-foreground/20 text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t('classification.viewList')}
          </button>
        </div>
      )}
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
      {/* A-1：容器带 role="img" + aria-label（WCAG 1.1.1）；列表视图时隐藏而非
          卸载，避免 echarts re-init 闪烁（profile.spec 每 tab 恰 1 canvas 断言不变）。 */}
      <div
        ref={ref}
        className="h-[480px] w-full"
        lang={i18n.language}
        role="img"
        aria-label={t('profile.chart.classification.ariaLabel')}
        hidden={showList}
      />
      {showList && (
        <ul
          aria-label={t('classification.listLabel')}
          className="max-h-[480px] w-full divide-y overflow-y-auto border-y border-border text-xs"
        >
          {listNodes.map((node) => (
            <li key={node.code}>
              <button
                type="button"
                onClick={() => drillNode(node)}
                className="flex w-full items-center justify-between gap-2 px-1.5 py-1.5 text-left text-foreground hover:text-foreground"
              >
                <span>{node.name}</span>
                <span className="text-muted-foreground">{node.value}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export const ClassificationTreemap = memo(ClassificationTreemapImpl)
