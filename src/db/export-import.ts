import { z } from 'zod'

import type { ExportData } from '@/types/entities'
import type { ReadGraphDB } from './db'
import { READGRAPH_TABLES } from './db'
import { resetDatabase } from './reset'
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
 * snapshot 模式：先 resetDatabase 清空，再单事务 bulkPut 全部实体
 * （逐实体过 Zod safeParse 校验）。
 * replay 模式仅落 sources + rawRecords，其余由管线重放——本里程碑不实现。
 */
export async function importDatabase(
  db: ReadGraphDB,
  data: unknown,
  options: ImportOptions,
): Promise<void> {
  if (options.mode === 'replay') {
    throw new Error("importDatabase: 'replay' mode not implemented in this milestone")
  }
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

  await resetDatabase(db)
  await db.transaction('rw', READGRAPH_TABLES, async () => {
    await Promise.all([
      db.sources.bulkPut(parsed.sources),
      db.rawRecords.bulkPut(parsed.rawRecords),
      db.books.bulkPut(parsed.books),
      db.catalogRecords.bulkPut(parsed.catalogRecords),
      db.borrowCycles.bulkPut(parsed.borrowCycles),
      db.importLogs.bulkPut(parsed.importLogs),
    ])
  })
}
