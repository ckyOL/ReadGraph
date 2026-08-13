// 归属馆小框组件（branch-library 规格 §4）。
// 按来源（parserId）查该来源注册的「条码前缀 → 归属馆」表，命中 → outline 直角小框；
// 未知来源/未命中（非该来源条码/长度不足/未知前缀）→ 渲染 null，不占位。
// 与编目卡卷号徽标同构（Badge outline + rounded-none，DESIGN.md 纸墨语言：完全直角、无阴影）。
import { Badge } from '@/components/ui/badge'
import { branchOfBarcode } from '@/lib/branch-prefix'

interface BranchBadgeProps {
  barcode: string | null | undefined
  /** 来源 parserId（Source.parserId）；缺失/未知来源不解析。 */
  parserId?: string | null
}

export function BranchBadge({ barcode, parserId }: BranchBadgeProps) {
  const branch = branchOfBarcode(barcode, parserId)
  if (branch === null) return null
  return (
    <Badge variant="outline" className="rounded-none">
      {branch}
    </Badge>
  )
}
