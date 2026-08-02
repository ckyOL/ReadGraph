// 存量数据回填：'unknown' + returnedAt=null 的借阅周期 → 'borrowed'。
//
// 背景（2026-08-02 修复）：szlib parser 曾把「文件末尾仍开启的周期」
// （只有借出、无归还）标为 status='unknown'，而 borrow-cycle.md 派生规则
// 要求 status='borrowed'。这导致时间线/仪表盘/画像的「在借」计数与徽标
// 全部失真（甘特图按日期渲染不受影响）。parser 已修正；本模块在应用启动
// 时一次性回填存量缺口。
//
// 限定条件：仅当该周期是其 (bookId, barcode) 借阅链上的**最新**周期时转换。
// 「同一 metaid 借出未还又借」产生的旧周期 status='unknown' 且 returnedAt=null，
// 但其后必有更晚周期——按规格（borrow-cycle.md 规则表「连续两次借出」）应
// 保持 'unknown'，不得误判为在借。
import type { ReadGraphDB } from './db'
import type { BorrowCycle } from '@/types/entities'

/** 甘特 lane 键约定（与 profile-stats 的 gantt laneKey 一致）。 */
function laneKey(c: Pick<BorrowCycle, 'bookId' | 'barcode'>): string {
  return `${c.bookId}:${c.barcode ?? '__noBarcode__'}`
}

/**
 * 回填误标为 'unknown' 的未归还周期（该 lane 的最新周期且 returnedAt=null）。
 * 返回回填条数。幂等：重复调用无副作用（无候选即返回 0）。
 */
export async function backfillBorrowStatus(db: ReadGraphDB): Promise<number> {
  const all = await db.borrowCycles.toArray()
  const latestByLane = new Map<string, BorrowCycle>()
  for (const c of all) {
    const key = laneKey(c)
    const cur = latestByLane.get(key)
    if (!cur || c.borrowedAt.getTime() > cur.borrowedAt.getTime()) {
      latestByLane.set(key, c)
    }
  }
  const changed = all.filter(
    (c) =>
      c.status === 'unknown' &&
      c.returnedAt == null &&
      latestByLane.get(laneKey(c)) === c,
  )
  if (changed.length === 0) return 0
  await db.borrowCycles.bulkPut(changed.map((c) => ({ ...c, status: 'borrowed' as const })))
  return changed.length
}
