// 分类号芯片（classification-hierarchy §5.1）。
// 主文本 = 最深已解析段类名（tree-partial 时如实显示已解析段，不推测剩余类名）；
// 次文本 = 等宽 code 原样；tooltip = 完整面包屑（tree-partial 追加「细分未收录」提示）。
// 静态树经懒加载器动态 import（独立 chunk，bundle-dynamic-imports），加载前
// 回退一级类目显示（现状），首屏不阻塞。
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
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

/** 纯展示：给定已解析路径渲染芯片（树/overlay 已由调用方解析）。 */
export function ClassificationBadgeView({
  code,
  category,
  path,
  categoryClassName,
}: ClassificationBadgeViewProps) {
  const { t } = useTranslation('pages')
  const segments = path.path
  const deepest = segments.length > 0 ? segments[segments.length - 1] : null
  // none（无路径）时仅显示 code；显式 category 仍保留（lcc/udc 等无表体系）。
  const primary = deepest ? deepest.name : category ?? null

  const title = useMemo(() => {
    if (deepest) {
      const crumbs = segments
        .map((s) => `${s.code} ${s.name}`)
        .join(t('classification.breadcrumbSeparator'))
      // 复分号段（§10.6）：主类路径后追加（如 `› -39 信息化建设、新技术的应用`）。
      const withAux = path.auxiliary
        ? crumbs + t('classification.breadcrumbSeparator') + `${path.auxiliary.code} ${path.auxiliary.name}`
        : crumbs
      if (path.source === 'tree-partial') {
        return `${withAux}\n${t('classification.treePartialHint', { code })}`
      }
      return withAux
    }
    return primary ?? t('classification.none')
  }, [deepest, segments, path.source, path.auxiliary, primary, t, code])

  return (
    <Badge
      variant="outline"
      className="gap-1 rounded-none font-mono"
      title={title}
    >
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
