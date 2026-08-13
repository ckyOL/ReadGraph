import { z } from 'zod'

import type { ExportData, ImportLog, RawRecord } from '@/types/entities'
import type { ReadGraphDB } from './db'
import { READGRAPH_TABLES } from './db'
import { deriveClassCodes } from './repositories'
import { getParser } from '@/parsers/registry'
import { importPipeline, type ExistingState, type ImportMeta } from '@/parsers/pipeline'
import {
  bookSchema,
  borrowCycleSchema,
  catalogRecordSchema,
  importLogSchema,
  rawRecordSchema,
  sourceSchema,
} from './schemas'

export const EXPORT_VERSION = '1'

/** 时间字段：接受 Date 实例或 ISO 8601 字符串，归一为 Date。 */
const exportDate = z.union([
  z.date(),
  z.string().transform((value, ctx): Date => {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: 'custom', message: `invalid date: ${value}` })
    }
    return parsed
  }),
])

/**
 * 导出数据校验 schema：外部 JSON 的时间字段为 ISO 字符串，
 * 各实体 schema 内的 utcDate 已接受 ISO 字符串并 .transform 为 Date，
 * safeParse 后归一为 Date 对象，供 importDatabase bulkPut 使用。
 */
export const exportDataSchema = z.object({
  version: z.literal(EXPORT_VERSION),
  exportedAt: exportDate,
  sources: z.array(sourceSchema),
  rawRecords: z.array(rawRecordSchema),
  books: z.array(bookSchema),
  catalogRecords: z.array(catalogRecordSchema),
  borrowCycles: z.array(borrowCycleSchema),
  importLogs: z.array(importLogSchema),
})

/**
 * 读取全部六张表，组装 ExportData（version='1', exportedAt=当前 UTC）。
 * Date 直接透出，序列化由 JSON.stringify 处理为 ISO 8601 'Z' 串。
 * sources 与 rawRecords 为必导项，不可选。
 */
export async function exportDatabase(db: ReadGraphDB): Promise<ExportData> {
  const [books, catalogRecords, borrowCycles, sources, rawRecords, importLogs] =
    (await Promise.all(
      READGRAPH_TABLES.map(async (name) => db.table(name).toArray()),
    )) as [
    ExportData['books'],
    ExportData['catalogRecords'],
    ExportData['borrowCycles'],
    ExportData['sources'],
    ExportData['rawRecords'],
    ExportData['importLogs'],
  ]

  return {
    version: EXPORT_VERSION,
    exportedAt: new Date(),
    sources,
    rawRecords,
    books,
    catalogRecords,
    borrowCycles,
    importLogs,
  }
}

export type ImportMode = 'snapshot' | 'replay'

export interface ImportOptions {
  mode: ImportMode
}

/**
 * replay 模式（settings 规格 §4）：从 rawRecords 重放重建，派生数据随当前
 * Parser 逻辑变化而非旧快照。
 * - 按 rawRecord.importLogId 分组；批次顺序取 ImportLog.importedAt（并列按 id，
 *   保证确定性）；组内按 rowIndex 排序（管线按行序消费）。
 * - 各组取所属 source.parserId 从注册表取 parser；ImportMeta 由 ImportLog 的
 *   importedAt/fileName/fileSize/detectedEncoding 派生。
 * - 累积 ExistingState 串接多批，避免跨批去重状态丢失。
 * - 不得读 Date.now()：实体时间锚取各批 ImportLog.importedAt。
 * 所有校验与纯函数计算先于任何写操作；失败时拒绝且不触碰既有数据。
 */
async function replayImport(db: ReadGraphDB, parsed: ExportData): Promise<void> {
  // 完整性：每条 rawRecord 必须能回溯到 ImportLog，且来源与所属批次一致
  // （M3 回归：损坏备份中 rawRecord.sourceId 与 ImportLog.sourceId 不一致会
  // 静默归错来源；空批次 ImportLog 保留与 snapshot 模式一致）。
  const logsById = new Map(parsed.importLogs.map((l) => [l.id, l] as const))
  for (const r of parsed.rawRecords) {
    const log = logsById.get(r.importLogId)
    if (!log) {
      throw new Error(
        `importDatabase: rawRecord ${r.id} references unknown importLog ${r.importLogId}`,
      )
    }
    if (r.sourceId !== log.sourceId) {
      throw new Error(
        `importDatabase: rawRecord ${r.id} sourceId ${r.sourceId} does not match importLog ${log.id} sourceId ${log.sourceId}`,
      )
    }
  }

  const sourcesById = new Map(parsed.sources.map((s) => [s.id, s]))
  const rowsByLog = new Map<string, RawRecord[]>()
  for (const r of parsed.rawRecords) {
    const arr = rowsByLog.get(r.importLogId)
    if (arr) arr.push(r)
    else rowsByLog.set(r.importLogId, [r])
  }
  for (const arr of rowsByLog.values()) {
    arr.sort((a, b) => a.rowIndex - b.rowIndex)
  }
  const logs = [...parsed.importLogs].sort((a, b) => {
    const byTime = a.importedAt.getTime() - b.importedAt.getTime()
    if (byTime !== 0) return byTime
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  let existing: ExistingState = { books: [], catalogRecords: [], borrowCycles: [] }
  const finalRows: RawRecord[] = []
  const finalLogs: ImportLog[] = []

  for (const log of logs) {
    const rows = rowsByLog.get(log.id)
    if (!rows || rows.length === 0) {
      // 空批次（导入文件全被行级过滤剔除）：无原始行可重放，但 ImportLog 是
      // 导入史的一部分——保留（与 snapshot 模式恢复结果一致，M3 回归）。
      finalLogs.push(log)
      continue
    }
    const source = sourcesById.get(log.sourceId)
    if (!source) {
      throw new Error(`importDatabase: replay source not found: ${log.sourceId}`)
    }
    const parser = getParser(source.parserId) // parser 未注册时抛错，整体拒绝
    const meta: ImportMeta = {
      id: log.id,
      fileName: log.fileName,
      fileSize: log.fileSize,
      detectedEncoding: log.detectedEncoding,
      importedAt: log.importedAt,
    }
    const result = importPipeline(rows, source, parser, existing, meta)
    existing = {
      books: result.books,
      catalogRecords: result.catalogRecords,
      borrowCycles: result.borrowCycles,
    }
    finalRows.push(...result.rawRecords)
    finalLogs.push(result.importLog)
  }

  // 单事务：清空 + 写库原子（任一 bulkPut 失败整体回滚，不留半清空）。
  await db.transaction('rw', READGRAPH_TABLES, async () => {
    await Promise.all(READGRAPH_TABLES.map((name) => db.table(name).clear()))
    await Promise.all([
      db.sources.bulkPut(parsed.sources),
      db.books.bulkPut(existing.books),
      db.catalogRecords.bulkPut(existing.catalogRecords.map(deriveClassCodes)),
      db.borrowCycles.bulkPut(existing.borrowCycles),
      db.rawRecords.bulkPut(finalRows),
      db.importLogs.bulkPut(finalLogs),
    ])
  })
}

/**
 * M2 回归：快照模式参照完整性校验——孤儿 bookId/sourceId/catalogRecordId/
 * importLogId 一律拒绝入库（先清库后写，坏数据会成为唯一状态）。
 * 纯函数，先于任何写操作执行；失败抛错，事务不启动。
 */
export function assertSnapshotIntegrity(data: ExportData): void {
  const bookIds = new Set(data.books.map((b) => b.id))
  const sourceIds = new Set(data.sources.map((s) => s.id))
  const crIds = new Set(data.catalogRecords.map((c) => c.id))
  const logIds = new Set(data.importLogs.map((l) => l.id))
  const must = (cond: boolean, msg: string): void => {
    if (!cond) throw new Error(`importDatabase: ${msg}`)
  }
  for (const b of data.books) {
    for (const sid of b.sourceIds) {
      must(sourceIds.has(sid), `book ${b.id} references unknown source ${sid}`)
    }
  }
  for (const cr of data.catalogRecords) {
    must(bookIds.has(cr.bookId), `catalogRecord ${cr.id} references unknown book ${cr.bookId}`)
    must(sourceIds.has(cr.sourceId), `catalogRecord ${cr.id} references unknown source ${cr.sourceId}`)
  }
  for (const c of data.borrowCycles) {
    must(bookIds.has(c.bookId), `borrowCycle ${c.id} references unknown book ${c.bookId}`)
    must(
      sourceIds.has(c.sourceId),
      `borrowCycle ${c.id} references unknown source ${c.sourceId}`,
    )
    must(
      crIds.has(c.catalogRecordId),
      `borrowCycle ${c.id} references unknown catalogRecord ${c.catalogRecordId}`,
    )
  }
  for (const r of data.rawRecords) {
    must(sourceIds.has(r.sourceId), `rawRecord ${r.id} references unknown source ${r.sourceId}`)
    must(
      logIds.has(r.importLogId),
      `rawRecord ${r.id} references unknown importLog ${r.importLogId}`,
    )
  }
  for (const l of data.importLogs) {
    must(sourceIds.has(l.sourceId), `importLog ${l.id} references unknown source ${l.sourceId}`)
  }
}

/**
 * snapshot 模式：先校验，再单事务清空 + bulkPut 全部实体
 * （逐实体过 Zod safeParse 校验；清空与写入同事务，失败整体回滚）。
 * replay 模式：sources + rawRecords 重放重建（见 replayImport）。
 */
export async function importDatabase(
  db: ReadGraphDB,
  data: unknown,
  options: ImportOptions,
): Promise<void> {
  const result = exportDataSchema.safeParse(data)
  if (!result.success) throw result.error
  const parsed = result.data
  if (parsed.version !== EXPORT_VERSION) {
    throw new Error(`importDatabase: unsupported export version "${parsed.version}"`)
  }
  // rawRecords 为必导项，字段缺失（undefined）时拒绝。
  if (!('rawRecords' in parsed) || !Array.isArray(parsed.rawRecords)) {
    throw new Error('importDatabase: rawRecords is required')
  }

  if (options.mode === 'replay') {
    await replayImport(db, parsed)
    return
  }

  // M2 回归：孤儿引用先于清库/写库拒绝（快照数据成为唯一状态前兜底）。
  assertSnapshotIntegrity(parsed)

  await db.transaction('rw', READGRAPH_TABLES, async () => {
    await Promise.all(READGRAPH_TABLES.map((name) => db.table(name).clear()))
    await Promise.all([
      db.sources.bulkPut(parsed.sources),
      db.rawRecords.bulkPut(parsed.rawRecords),
      db.books.bulkPut(parsed.books),
      db.catalogRecords.bulkPut(parsed.catalogRecords.map(deriveClassCodes)),
      db.borrowCycles.bulkPut(parsed.borrowCycles),
      db.importLogs.bulkPut(parsed.importLogs),
    ])
  })
}
