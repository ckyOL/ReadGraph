// 导入向导执行装配（G-5，ui-navigation §6/§9）。
// 复用 import-pipeline 已落地纯函数引擎：UI 层不重算去重/配对；
// 本模块只做「文件文本 → RawRecord 预分配 → existing 显式读取 → 管线 →
// 事务写库」的编排。大文件（≥ IMPORT_WORKER_THRESHOLD）把纯管线下放
// import-worker.ts（Comlink），主线程不阻塞导航。
import { wrap } from 'comlink'

import type { ReadGraphDB } from '@/db/db'
import { deriveClassCodes } from '@/db/repositories'
import { getParser } from '@/parsers/registry'
import { importPipeline, type ExistingState, type ImportMeta } from '@/parsers/pipeline'
import type { ImportLogStats, RawRecord, Source } from '@/types/entities'
import { uuid } from '@/db/uuid'
import { IMPORT_MAX_FILE_SIZE } from '@/lib/encoding'
import type { ImportWorkerApi } from './import-worker'

/** 大文件导入下放 Worker 的文件大小阈值（ui-navigation §6：50MB）。 */
export const IMPORT_WORKER_THRESHOLD = IMPORT_MAX_FILE_SIZE

export interface ImportRequest {
  fileName: string
  fileSize: number
  detectedEncoding: string
  /** 经 detectAndDecode 解码后的文件文本。 */
  text: string
  sourceId: string
}

/**
 * 预分配 RawRecord 壳（身份字段稳定）：id=uuid、importLogId、sourceId、
 * rowIndex；data 保留原始键值（溯源/重解析），parseNote=null。
 */
export function buildRawRecords(
  rows: Record<string, unknown>[],
  meta: ImportMeta,
  sourceId: string,
): RawRecord[] {
  return rows.map((data, i) => ({
    id: uuid(),
    importLogId: meta.id,
    sourceId,
    data,
    rowIndex: i + 1,
    borrowCycleId: null,
    bookId: null,
    parseStatus: 'success',
    parseNote: null,
  }))
}

/** 大数据纯管线 Worker 执行（Comlink）；卸载职责在调用方（terminate）。 */
async function runInWorker(
  rows: RawRecord[],
  source: Source,
  existing: ExistingState,
  meta: ImportMeta,
) {
  const worker = new Worker(new URL('./import-worker.ts', import.meta.url), {
    type: 'module',
  })
  try {
    const api = wrap<ImportWorkerApi>(worker)
    return await api.run({ rows, source, existing, meta })
  } finally {
    worker.terminate()
  }
}

/**
 * 执行一次导入：validate → 预分配 rows → existing 显式读取 → 管线
 * （大文件走 Worker）→ 单事务写库 + 来源回写。返回管线产出。
 *
 * 抛错场景（不落库）：来源不存在、JSON 非法、Parser 不匹配。
 */
export async function executeImport(
  db: ReadGraphDB,
  req: ImportRequest,
): Promise<ReturnType<typeof importPipeline>> {
  const source = await db.sources.get(req.sourceId)
  if (!source) throw new Error(`source not found: ${req.sourceId}`)

  const parser = getParser(source.parserId)
  let parsed: unknown
  try {
    parsed = JSON.parse(req.text)
  } catch {
    throw new Error('invalid JSON file')
  }
  if (!Array.isArray(parsed) || !parser.validate(req.text)) {
    throw new Error(`parser "${source.parserId}" does not match file content`)
  }

  const importedAt = new Date()
  const meta: ImportMeta = {
    id: uuid(),
    fileName: req.fileName,
    fileSize: req.fileSize,
    detectedEncoding: req.detectedEncoding,
    importedAt,
  }
  const rows = buildRawRecords(parsed as Record<string, unknown>[], meta, req.sourceId)
  const existing: ExistingState = {
    books: await db.books.toArray(),
    catalogRecords: await db.catalogRecords.toArray(),
    borrowCycles: await db.borrowCycles.toArray(),
  }

  const result =
    req.fileSize >= IMPORT_WORKER_THRESHOLD
      ? await runInWorker(rows, source, existing, meta)
      : importPipeline(rows, source, parser, existing, meta)

  const stats: ImportLogStats = result.importLog.stats
  await db.transaction(
    'rw',
    [
      db.books,
      db.catalogRecords,
      db.borrowCycles,
      db.rawRecords,
      db.importLogs,
      db.sources,
    ],
    async () => {
      if (result.rawRecords.length) await db.rawRecords.bulkPut(result.rawRecords)
      if (result.books.length) await db.books.bulkPut(result.books)
      if (result.catalogRecords.length)
        await db.catalogRecords.bulkPut(result.catalogRecords.map(deriveClassCodes))
      if (result.borrowCycles.length) await db.borrowCycles.bulkPut(result.borrowCycles)
      await db.importLogs.put(result.importLog)
      await db.sources.update(source.id, {
        lastImportAt: importedAt,
        totalImportedRecords: source.totalImportedRecords + stats.newBorrowCycles,
      })
    },
  )
  return result
}
