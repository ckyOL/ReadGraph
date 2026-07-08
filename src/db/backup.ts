import type { ExportData } from '@/types/entities'
import { exportDataSchema } from './export-import'

const pad = (n: number): string => String(n).padStart(2, '0')

/**
 * 备份文件名：`readgraph-backup-YYYYMMDD-HHmmss.json`。
 * 取 exportedAt 的 UTC 分量，跨本地时区命名一致（§12.3）。
 */
export function buildBackupFilename(exportedAt: Date): string {
  const y = exportedAt.getUTCFullYear()
  const mo = pad(exportedAt.getUTCMonth() + 1)
  const d = pad(exportedAt.getUTCDate())
  const h = pad(exportedAt.getUTCHours())
  const mi = pad(exportedAt.getUTCMinutes())
  const s = pad(exportedAt.getUTCSeconds())
  return `readgraph-backup-${y}${mo}${d}-${h}${mi}${s}.json`
}

/**
 * 序列化 ExportData 为确定性 JSON 文本（§12.3）。
 * 顶层键顺序固定，2 空格缩进；Date 经 toJSON 序列化为 ISO 8601 'Z' 串。
 * rawRecords 与 sources 为必导项，构造时不得省略。
 */
export function serializeExportText(data: ExportData): string {
  const ordered: ExportData = {
    version: data.version,
    exportedAt: data.exportedAt,
    sources: data.sources,
    rawRecords: data.rawRecords,
    books: data.books,
    catalogRecords: data.catalogRecords,
    borrowCycles: data.borrowCycles,
    importLogs: data.importLogs,
  }
  return JSON.stringify(ordered, undefined, 2)
}

/**
 * 反序列化备份文本为 ExportData（§12.3）。
 * JSON.parse 后过 exportDataSchema.safeParse：version 不匹配 / rawRecords 缺失 /
 * 字段非法时抛 ZodError；exportDataSchema 已把 ISO 串 transform 回 Date 实例。
 */
export function parseExportText(text: string): ExportData {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`parseExportText: invalid JSON (${msg})`)
  }
  const result = exportDataSchema.safeParse(json)
  if (!result.success) throw result.error
  return result.data
}
