// 书目详情「借阅历史」列表（ui-navigation §2 书目详情）。
// 列表只负责遍历渲染 BorrowCycleRow 块；块级展示行为（时间行/地点行/降级）见行组件。
// sourceId → parserId 映射在此解析（来源缺失/未知时行组件不渲染归属馆框）。
// 空数组返回 null，空态由页面处理。
import { BorrowCycleRow } from '@/components/borrow-cycle-row'
import type { BorrowCycle, Source } from '@/types/entities'

interface BorrowCyclesListProps {
  cycles: BorrowCycle[]
  /** 显示时区（IANA）；时间以 UTC 存储，此处仅做展示转换。 */
  displayTimezone: string
  /** 全部来源：sourceId → parserId 映射用（归属馆按来源解析）。 */
  sources: Source[]
}

export function BorrowCyclesList({ cycles, displayTimezone, sources }: BorrowCyclesListProps) {
  if (cycles.length === 0) return null

  const parserIdOf = new Map(sources.map((s) => [s.id, s.parserId]))

  return (
    <ul className="divide-y">
      {cycles.map((c) => (
        <BorrowCycleRow
          key={c.id}
          cycle={c}
          displayTimezone={displayTimezone}
          parserId={parserIdOf.get(c.sourceId)}
        />
      ))}
    </ul>
  )
}
