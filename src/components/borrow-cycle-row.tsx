// 单条借阅周期「块」（ui-navigation §2 书目详情 / borrow-cycle 规格「地点与附加元数据」）。
// 纯展示组件，由 BorrowCyclesList 按周期逐个渲染。
// 块内布局：借出块（细罫线方框：时间在上、地点在下）→ 归还块（同构），
// 两块之间只有一个流向箭头（垂直居中）。地点为 null/空串时对应块内省略该行，
// 方框结构保持稳定（旧数据、非 szlib 来源降级）。
// 状态徽章按 DESIGN.md §4.4 语义高对比：借阅中=松叶 success、已归还=蓝鼠 info、
// unknown=outline 弱化；在借周期归还侧时间以 muted 呈现。
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { BranchBadge } from '@/components/branch-badge'
import { formatDateInTz } from '@/lib/display-time'
import type { BorrowCycle } from '@/types/entities'

interface BorrowCycleRowProps {
  cycle: BorrowCycle
  /** 显示时区（IANA）；时间以 UTC 存储，此处仅做展示转换。 */
  displayTimezone: string
  /** 周期所属来源 parserId（来源缺失/未知时不解析归属馆）。 */
  parserId?: string | null
}

export function BorrowCycleRow({ cycle: c, displayTimezone, parserId }: BorrowCycleRowProps) {
  const { t } = useTranslation('pages')

  return (
    <li className="py-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div className="border border-border px-2.5 py-1.5">
          <div className="font-medium tabular-nums">
            {formatDateInTz(c.borrowedAt, displayTimezone)}
          </div>
          {c.borrowLocation && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {c.borrowLocation}
            </div>
          )}
        </div>
        <span className="text-muted-foreground" aria-hidden>
          →
        </span>
        <div className="border border-border px-2.5 py-1.5">
          <div
            className={
              c.returnedAt
                ? 'font-medium tabular-nums'
                : 'font-medium tabular-nums text-muted-foreground'
            }
          >
            {c.returnedAt ? formatDateInTz(c.returnedAt, displayTimezone) : '—'}
          </div>
          {c.returnLocation && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              {c.returnLocation}
            </div>
          )}
        </div>
        {c.barcode && <span className="font-mono text-xs">{c.barcode}</span>}
        {c.barcode && <BranchBadge barcode={c.barcode} parserId={parserId} />}
        {c.status === 'borrowed' && (
          <Badge className="rounded-none bg-success text-success-foreground">
            {t('timeline.status.borrowed')}
          </Badge>
        )}
        {c.status === 'returned' && (
          <Badge className="rounded-none bg-info text-info-foreground">
            {t('timeline.status.returned')}
          </Badge>
        )}
        {c.status === 'unknown' && (
          <Badge variant="outline" className="rounded-none">
            {t('timeline.status.unknown')}
          </Badge>
        )}
      </div>
    </li>
  )
}
