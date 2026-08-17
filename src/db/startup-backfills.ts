// H-5 启动回填失败可见性：三回填并行执行，任一失败不阻断其余、不抛出；
// 失败原因逐项 console.error 保留诊断（此前 main.tsx 的 .catch(() => {}) 静默吞错——
// classCodes 回填失败时分类索引查询静默不完整且无任何日志）。
// 独立成模块为可测性（console-spy 单测）；main.tsx 仅保留
// maybeSeedFromE2E().then(() => runStartupBackfills(db)) 的启动顺序。
// classCodes 回填失败留下的索引字段缺口，由读取侧 withClassCodes 对内存物化
// 记录自愈（见 src/lib/with-class-codes.ts）；索引查询（treemap 下钻等）不可自愈，
// 依赖本模块的 console.error 暴露。
import type { ReadGraphDB } from './db'
import { backfillClassCodes } from './backfill-class-codes'
import { backfillBorrowStatus } from './backfill-borrow-status'
import { backfillDeviceKind } from './backfill-device-kind'

/** 启动回填编排：Promise.all 并行，逐项 catch → console.error（不抛出）。 */
export async function runStartupBackfills(database: ReadGraphDB): Promise<void> {
  await Promise.all([
    backfillClassCodes(database).catch((err) =>
      console.error('backfillClassCodes failed', err),
    ),
    backfillBorrowStatus(database).catch((err) =>
      console.error('backfillBorrowStatus failed', err),
    ),
    backfillDeviceKind(database).catch((err) =>
      console.error('backfillDeviceKind failed', err),
    ),
  ])
}
