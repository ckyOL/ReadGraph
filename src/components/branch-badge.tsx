// 归属馆小框组件（branch-library 规格 §4）。
// 深图编目条码前 6 位命中 → 条码后渲染 outline 直角小框（归属馆名）；
// 未命中（非 szlib 条码/长度不足/未知前缀）→ 渲染 null，不占位。
// 与编目卡卷号徽标同构（Badge outline + rounded-none，DESIGN.md 纸墨语言：完全直角、无阴影）。
import { Badge } from '@/components/ui/badge'
import { branchOfBarcode } from '@/lib/szlib-branch'

export function BranchBadge({ barcode }: { barcode: string | null | undefined }) {
  const branch = branchOfBarcode(barcode)
  if (branch === null) return null
  return (
    <Badge variant="outline" className="rounded-none">
      {branch}
    </Badge>
  )
}
