// 分类号芯片（ui-navigation §3「分类法芯片是一等视觉元素」）。
// CLC/DDC 归并到一级类目名（classificationCategory 映射）；未知体系原样显示。
// code 走等宽字体（DESIGN.md §3 编目卡标签条）。
import { Badge } from '@/components/ui/badge'
import { classificationCategory } from '@/lib/classification'
import type { ClassificationSystem } from '@/types/entities'

interface ClassificationBadgeProps {
  system: ClassificationSystem
  code: string
  /** 显式 category（已有编目数据时优先），缺省按 code 归并。 */
  category?: string
}

/**
 * 分类号芯片：等宽 code + 一级类目（tooltip 全称）。
 * 不可归并（lcc/udc/other 或未知 code）时仅显示 code。
 */
export function ClassificationBadge({ system, code, category }: ClassificationBadgeProps) {
  const resolved = category ?? classificationCategory(system, code)
  return (
    <Badge
      variant="outline"
      className="gap-1 rounded-none font-mono"
      title={resolved ?? undefined}
    >
      <span>{code}</span>
      {resolved && (
        <span className="max-w-28 truncate text-[10px] font-normal text-muted-foreground">
          {resolved}
        </span>
      )}
    </Badge>
  )
}
