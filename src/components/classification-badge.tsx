// 分类号芯片（classification-hierarchy §5.1）。
// 主文本 = 最深已解析段类名（tree-partial 时如实显示已解析段，不推测剩余类名）；
// 次文本 = 等宽 code 原样；tooltip（Radix，shadcn ui/tooltip）= 完整面包屑逐行呈现
// （tree-partial 追加「细分未收录」弱化提示）。tooltip 内容独立为
// ClassificationTooltipContent 纯展示，便于 node 环境单测（Radix 关闭态不挂载内容）。
// 静态树经懒加载器动态 import（独立 chunk，bundle-dynamic-imports），加载前
// 回退一级类目显示（现状），首屏不阻塞。
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  loadClcTree,
  loadClcOverlay,
  loadClcAuxiliary,
  resolveClassificationPath,
  type ClassificationPath,
  type ClcNode,
  type OverlayData,
  type AuxiliaryData,
} from '@/lib/classification-path'
import type { ClassificationSystem } from '@/types/entities'

interface ClassificationBadgeProps {
  system: ClassificationSystem
  code: string
  /** 显式 category（已有编目数据时优先）；无深层路径（none）时回退显示。 */
  category?: string
  /** 次级类名截断宽度类（同 ClassificationBadgeView）。 */
  categoryClassName?: string
}

/** 树/overlay/复分表懒加载状态（clc 体系一次性拉取，缓存于模块内）。 */
function useClassificationPath(
  system: ClassificationSystem,
  code: string,
): ClassificationPath {
  const [data, setData] = useState<{
    tree: ClcNode[]
    overlay: OverlayData
    auxiliary: AuxiliaryData
  } | null>(null)
  useEffect(() => {
    if (system !== 'clc') return
    let cancelled = false
    void Promise.all([loadClcTree(), loadClcOverlay(), loadClcAuxiliary()]).then(
      ([tree, overlay, auxiliary]) => {
        if (!cancelled) setData({ tree, overlay, auxiliary })
      },
    )
    return () => {
      cancelled = true
    }
  }, [system])
  return useMemo(() => {
    if (system !== 'clc' || !data) return resolveClassificationPath(system, code, [], undefined)
    return resolveClassificationPath(system, code, data.tree, data.overlay, data.auxiliary)
  }, [system, code, data])
}

interface ClassificationBadgeViewProps {
  code: string
  category?: string
  path: ClassificationPath
  /** 次级类名截断宽度类（默认 max-w-28；书库表格/卡片等宽裕场景放宽，规格 ui-navigation §3）。 */
  categoryClassName?: string
}

interface ClassificationTooltipContentProps {
  code: string
  category?: string
  path: ClassificationPath
}

/** tooltip 内容（纯展示）：完整面包屑逐行 = 等宽 code + 类名；
 * 复分号段（§10.6）独立一行（上罫线分隔）；tree-partial 追加「细分未收录」弱化提示；
 * 无路径（none）时回退显式 category，否则「未分类」。 */
export function ClassificationTooltipContent({
  code,
  category,
  path,
}: ClassificationTooltipContentProps) {
  const { t } = useTranslation('pages')
  const segments = path.path
  const deepest = segments.length > 0 ? segments[segments.length - 1] : null

  if (!deepest) {
    return <>{category ?? t('classification.none')}</>
  }
  return (
    <>
      <ol className="flex flex-col gap-1">
        {segments.map((s) => (
          <li key={s.code} className="flex items-baseline gap-2">
            <span className="font-mono">{s.code}</span> <span>{s.name}</span>
          </li>
        ))}
        {path.auxiliary && (
          <li className="mt-1 flex items-baseline gap-2 border-t border-border pt-1">
            <span className="font-mono">{path.auxiliary.code}</span>{' '}
            <span>{path.auxiliary.name}</span>
          </li>
        )}
      </ol>
      {path.source === 'tree-partial' && (
        <p className="mt-1.5 border-t border-border pt-1.5 text-muted-foreground">
          {t('classification.treePartialHint', { code })}
        </p>
      )}
    </>
  )
}

/** 纯展示：给定已解析路径渲染芯片（树/overlay 已由调用方解析）。 */
export function ClassificationBadgeView({
  code,
  category,
  path,
  categoryClassName,
}: ClassificationBadgeViewProps) {
  const segments = path.path
  const deepest = segments.length > 0 ? segments[segments.length - 1] : null
  // none（无路径）时仅显示 code；显式 category 仍保留（lcc/udc 等无表体系）。
  const primary = deepest ? deepest.name : category ?? null

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge variant="outline" className="gap-1 rounded-none font-mono">
            <span>{code}</span>
            {primary && (
              <span
                className={cn(
                  'truncate text-[10px] font-normal text-muted-foreground',
                  categoryClassName ?? 'max-w-28',
                )}
              >
                {primary}
              </span>
            )}
          </Badge>
        </TooltipTrigger>
        <TooltipContent
          sideOffset={4}
          className="flex-col items-start rounded-none border border-border bg-popover px-3 py-2 text-popover-foreground"
          arrowClassName="bg-popover fill-popover"
        >
          <ClassificationTooltipContent code={code} category={category} path={path} />
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/**
 * 分类号芯片：懒加载 CLC 树并解析到最深层级；非 clc 体系维持一级/原样降级。
 * 调用点传 `system` + `code` 即可（书库列表/详情），内部走懒加载 + 解析。
 */
export const ClassificationBadge = memo(function ClassificationBadge({
  system,
  code,
  category,
  categoryClassName,
}: ClassificationBadgeProps) {
  const path = useClassificationPath(system, code)
  return (
    <ClassificationBadgeView
      code={code}
      category={category}
      path={path}
      categoryClassName={categoryClassName}
    />
  )
})