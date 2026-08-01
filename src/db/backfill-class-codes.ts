// 存量数据回填：catalogRecords.classCodes 派生字段。
//
// 背景（2026-08-01 修复）：classCodes multiEntry 索引自数据层初版即存在，
// 但导入/备份恢复写路径绕过 repository 直接 bulkPut，从未执行
// deriveClassCodes —— 存量数据普遍缺失该字段，导致 `where('classCodes')`
// 查询（treemap 下钻等）匹配不到任何记录。写路径已统一补派生；
// 本模块在应用启动时一次性回填存量缺口（幂等：已有字段的记录原样保留）。
import type { ReadGraphDB } from './db'
import { deriveClassCodes } from './repositories'

/**
 * 回填缺失 classCodes 的记录（无该字段或非数组）。返回回填条数。
 * 幂等：重复调用无副作用（缺失集为空即返回 0）。
 */
export async function backfillClassCodes(db: ReadGraphDB): Promise<number> {
  const missing = await db.catalogRecords
    .filter((rec) => !Array.isArray(rec.classCodes))
    .toArray()
  if (missing.length === 0) return 0
  await db.catalogRecords.bulkPut(missing.map(deriveClassCodes))
  return missing.length
}
