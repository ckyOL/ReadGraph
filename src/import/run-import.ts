// 导入向导执行装配（G-5，ui-navigation §6/§9）。
// 复用 import-pipeline 已落地纯函数引擎：UI 层不重算去重/配对；
// 本模块只做「文件文本 → RawRecord 预分配 → existing 显式读取 → 管线 →
// 事务写库」的编排。大文件（≥ IMPORT_WORKER_THRESHOLD）把纯管线下放
// import-worker.ts（Comlink），主线程不阻塞导航。
import { wrap } from 'comlink'

import type { ReadGraphDB } from '@/db/db'
import { deriveClassCodes } from '@/db/repositories'
import { getParser } from '@/parsers/registry'
import {
  importPipeline,
  type ExistingState,
  type ImportMeta,
  type PipelineResult,
  type TraceOptions,
} from '@/parsers/pipeline'
import type { ImportTraceRow } from '@/parsers/trace'
// __DEBUG_MODE__ 直引（define 构建期静态替换，同 ai-client.ts
// __AI_DEV_PROXY__ 先例）：生产构建 debug 装配分支折叠剔除（US4 产物
// 零残留）；测试环境 vi.stubGlobal 可切换（debug.test.ts 同语义）。
declare const __DEBUG_MODE__: boolean
import { isDebugVerbose } from '@/lib/debug'
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
  /**
   * 被 parser.filterRows 预剔除的行在原数组中的下标（1-based，debug-mode
   * spec §5.3）。仅 trace 收集开启时被消费（补 row-filtered 行）；生产路径
   * 不计算、不传（D5 零分配）。
   */
  filteredRowIndexes?: number[]
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
  traceOptions: TraceOptions | undefined,
) {
  const worker = new Worker(new URL('./import-worker.ts', import.meta.url), {
    type: 'module',
  })
  try {
    const api = wrap<ImportWorkerApi>(worker)
    // D6：Worker 回传 { result, trace }（durationMs 已在 Worker 内填写），
    // 主线程解包合并——trace 并入返回值，console 输出统一在 UI 层。
    const { result, trace } = await api.run({ rows, source, existing, meta, traceOptions })
    return trace ? { ...result, trace } : result
  } finally {
    worker.terminate()
  }
}

/**
 * 执行一次导入：validate → filterRows 行级预过滤（剔除「自助查询」等无用
 * 条目）→ 预分配 rows → existing 显式读取 → 管线（大文件走 Worker）→
 * 单事务写库 + 来源回写。返回管线产出。
 *
 * 抛错场景（不落库）：来源不存在、JSON 非法、Parser 不匹配。
 */
export async function executeImport(
  db: ReadGraphDB,
  req: ImportRequest,
): Promise<PipelineResult> {
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
  // 与预览共用 parser.filterRows：无用条目（自助查询/读者续借等）在进入
  // 管线与落库前即剔除，rawRecords 只保留有效行（溯源/备份/重放均不含无用条目）。
  const filtered = parser.filterRows(parsed as Record<string, unknown>[])
  const filteredRows = parsed.length - filtered.length
  // L3 回归：全无效文件（全部行被行级过滤剔除）显式拒绝——旧版静默导入为空
  // （零实体零警告），审计无从查证。
  if (filtered.length === 0) {
    throw new Error(
      `import contains no valid rows after filtering (${filteredRows} rows filtered)`,
    )
  }
  const rows = buildRawRecords(filtered, meta, req.sourceId)
  const existing: ExistingState = {
    books: await db.books.toArray(),
    catalogRecords: await db.catalogRecords.toArray(),
    borrowCycles: await db.borrowCycles.toArray(),
  }

  // debug-mode spec §5.2/§4.2：traceOptions 仅由 debug 装配层决定（D3/D5）——
  // 门控直引 __DEBUG_MODE__：生产构建 false 折叠、mark/measure 分支剔除
  // （US4 零残留）；测试环境 vi.stubGlobal('__DEBUG_MODE__') 可切换。
  const debugOn = __DEBUG_MODE__
  const startedAt = performance.now()
  if (debugOn) performance.mark('readgraph:import:start')
  const traceOptions: TraceOptions | undefined = debugOn
    ? { verbose: isDebugVerbose() }
    : undefined
  let result =
    req.fileSize >= IMPORT_WORKER_THRESHOLD
      ? await runInWorker(rows, source, existing, meta, traceOptions)
      : importPipeline(rows, source, parser, existing, meta, traceOptions)

  if (debugOn && result.trace) {
    // 主线程同步路径：performance.now 差值填 durationMs（spec §4.2）；Worker
    // 路径已由 Worker 填写，executeImport 不覆盖（runInWorker 内已并入）。
    if (result.trace.durationMs === null) {
      result = {
        ...result,
        trace: { ...result.trace, durationMs: performance.now() - startedAt },
      }
    }
    // spec §4.2 主线程打点：mark/measure 供 Performance 面板观察导入总耗时。
    performance.mark('readgraph:import:end')
    performance.measure('readgraph:import', 'readgraph:import:start')
  }

  if (debugOn && result.trace && req.filteredRowIndexes) {
    result = withFilteredRows(result, req.filteredRowIndexes, parsed as Record<string, unknown>[])
  }

  // L3：行级预过滤剔除数记入 ImportLog.stats（管线内无过滤概念，此处覆盖）。
  // trace.stats 与 importLog.stats 深同步（spec §4.1 步骤 4 输出源一致性）：
  // 管线内两者同引用，覆盖后 trace.stats 若不同步会残留 filteredRows=0。
  result.importLog.stats = {
    ...result.importLog.stats,
    filteredRows,
  }
  if (result.trace) result.trace.stats = result.importLog.stats
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

/**
 * 被过滤行的 trace 补充（debug-mode spec §5.3，仅 trace 收集开启时）：
 * `decision='row-filtered'`、`status='filtered-out'`、实体 ID 与 rawRecordId
 * 均 null；barcode/title 尽力从原始行字段填充（缺失为 null）。rows 按
 * rowIndex 升序合并；不触碰 stats（totalRawRecords 语义保持「进入管线的
 * 行数」）。生产路径永不调用（D5 零分配）。
 */
function withFilteredRows(
  result: PipelineResult,
  filteredRowIndexes: number[],
  parsed: Record<string, unknown>[],
): PipelineResult {
  const trace = result.trace
  if (!trace) return result
  const extra: ImportTraceRow[] = []
  for (const index of filteredRowIndexes) {
    // rowIndex 保留 UI 传入的原数组下标（spec §5.3「rowIndex 正确」）；
    // 与管线行号（过滤后数组内的 1..N）分属两个下标空间，不去重不重排——
    // trace.rows 仅按 rowIndex 升序合并（spec §5.3）。
    const data = parsed[index - 1]
    const barcode = data?.['barcode']
    const title = data?.['title']
    extra.push({
      rowIndex: index,
      rawRecordId: null,
      status: 'filtered-out',
      decision: 'row-filtered',
      reason: '被行级预过滤剔除（filterRows：与借还状态无关的操作类型）',
      barcode: typeof barcode === 'string' && barcode !== '' ? barcode : null,
      title: typeof title === 'string' && title !== '' ? title : null,
      bookId: null,
      catalogRecordId: null,
      borrowCycleId: null,
      warningType: null,
    })
  }
  return {
    ...result,
    trace: {
      ...trace,
      rows: [...trace.rows, ...extra].sort((a, b) => a.rowIndex - b.rowIndex),
    },
  }
}
