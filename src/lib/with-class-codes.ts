// H-5 分类索引读路径自愈（与 Q-6 parseOrDefault 同源思路）：
// classCodes 为 multiEntry 索引派生字段，写路径（repository/schema transform）恒补写；
// 但启动回填（backfillClassCodes）失败时存量记录仍缺该字段。索引查询
// （where('classCodes')，如 treemap 下钻 / findClassCodes）无法在渲染路径自愈——
// 自愈需全表扫描，roadmap 性能规则禁扫。对已经物化到内存的记录（toArray → map），
// 读取侧一次派生即可兜底：缺 classCodes 的记录按 classifications 派生补写，
// 已有字段原样保留（与回填幂等语义一致）。
// 派生逻辑与写路径共用 repositories 的 deriveClassCodes（单一事实来源，防双维护漂移）。
import type { CatalogRecord } from '@/types/entities'
import { deriveClassCodes } from '@/db/repositories'

/**
 * 单条读路径归一：缺 classCodes 才派生（已有字段零分配、原引用返回）。
 * 供详情页等单记录物化路径使用。
 */
export function withClassCodes<T extends CatalogRecord>(rec: T): T & { classCodes: string[] } {
  if (Array.isArray(rec.classCodes)) return rec as T & { classCodes: string[] }
  return deriveClassCodes(rec)
}

/**
 * 批量读路径归一：仅当存在缺失记录时映射一次；全有字段返回原数组引用（零分配）。
 * 供列表页等 toArray 物化路径使用（接线处：library/index、library/$bookId）。
 */
export function withClassCodesAll(records: CatalogRecord[]): CatalogRecord[] {
  if (!records.some((r) => !Array.isArray(r.classCodes))) return records
  return records.map(withClassCodes)
}
