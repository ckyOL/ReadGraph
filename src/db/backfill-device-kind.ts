// 存量设备材料类型回填（device-borrows 规格 §6）：rawRecords 保留 szlib 原始行
// （含 cirtype），凡 cirtype='电子设备外借' 且 bookId 非空的原始记录 → 其 Book
// 置 materialType='device'。
//
// 背景（2026-08-13）：szlib parser 此前把设备借阅（cirtype='电子设备外借'，
// 如 metaid=5952182 电子书阅读器）按普通图书解析入库，未标记材料类型，导致
// 阅读画像统计把设备计入藏书/周期/分类/时长。parser 已修正（新导入自动标记）；
// 本模块在应用启动时一次性回填存量缺口。
//
// 限定条件：仅当 Book 尚未标记（materialType !== 'device'）时回写，不覆盖
// 其它材料类型。幂等：重复调用无副作用（无候选即返回 0）。
import type { ReadGraphDB } from './db'
import { isDeviceCirtype } from '@/parsers/szlib'

/**
 * 回填设备 Book 材料类型。返回回填条数。幂等：重复调用无副作用。
 * 判定与 szlib parser 共用 isDeviceCirtype（单一事实来源，device-borrows 规格 §2）。
 */
export async function backfillDeviceKind(db: ReadGraphDB): Promise<number> {
  const raws = await db.rawRecords.toArray()
  const deviceBookIds = new Set<string>()
  for (const r of raws) {
    if (!r.bookId) continue
    const cirtype = (r.data as Record<string, unknown>).cirtype
    if (isDeviceCirtype(typeof cirtype === 'string' ? cirtype : undefined)) {
      deviceBookIds.add(r.bookId)
    }
  }
  if (deviceBookIds.size === 0) return 0
  const books = await db.books.toArray()
  const changed = books.filter(
    (b) => deviceBookIds.has(b.id) && b.materialType !== 'device',
  )
  if (changed.length === 0) return 0
  await db.books.bulkPut(
    changed.map((b) => ({ ...b, materialType: 'device' as const })),
  )
  return changed.length
}
