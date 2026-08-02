// 书目详情「借阅历史」列表（ui-navigation §2 书目详情）。
// 列表只负责遍历渲染 BorrowCycleRow 块；块级展示行为（时间行/地点行/降级）见行组件。
// 空数组返回 null，空态由页面处理。
import { BorrowCycleRow } from '@/components/borrow-cycle-row'
import type { BorrowCycle } from '@/types/entities'

interface BorrowCyclesListProps {
  cycles: BorrowCycle[]
  /** 显示时区（IANA）；时间以 UTC 存储，此处仅做展示转换。 */
  displayTimezone: string
}

export function BorrowCyclesList({ cycles, displayTimezone }: BorrowCyclesListProps) {
  if (cycles.length === 0) return null

  return (
    <ul className="divide-y">
      {cycles.map((c) => (
        <BorrowCycleRow key={c.id} cycle={c} displayTimezone={displayTimezone} />
      ))}
    </ul>
  )
}
