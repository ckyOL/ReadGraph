// 导入决策 trace 数据契约（debug-mode spec §5.1）。
// 本文件落类型契约与 collector（collectCatalogDecision + 行/周期记录）。
// ImportTrace 是会话态结构，不承诺跨版本向后兼容（spec §7 版本边界）；
// 不进 ExportData、不落库（D4）。warnings 为扁平字段：spec §4.1 步骤 5 写
// trace.importLog.warnings，按 §5 契约（无 importLog 成员）扁平化裁定（主会话）。
import type {
  ImportLogStats,
  ParseWarning,
  ParseWarningType,
} from '@/types/entities'
/**
 * 逐行决策判定优先级（spec §8 验收用例为准）：
 * `row-filtered`（装配层补充）> `row-error` > `cycle-skipped-duplicate` >
 * `cycle-unpaired` > 候选分支（placeholder-isolated / merged-catalog /
 * merged-book-isbn / merged-book-fuzzy / new-book）> `cycle-created`。
 * 候选分支内部：占位判定**先于**编目级判定（dedupe.ts 占位候选命中既有编目
 * 也置 existingCrIds，后查会把重导占位行误判为 merged-catalog）。
 */
export type ImportDecision =
  | 'new-book' // 新建 Book + CatalogRecord（含无条码/无 ISBN 兜底）
  | 'merged-catalog' // 编目级命中：sourceId+barcode / metaIdKey，沿用既有 CatalogRecord
  | 'merged-book-isbn' // 无编目命中，ISBN 命中既有 Book，新编目挂入
  | 'merged-book-fuzzy' // 无 ISBN 无编目，normalize(title)+authors 模糊命中 → needsReview
  | 'placeholder-isolated' // 选书帮占位：按 barcode 独立 Book，不做合并
  | 'cycle-created' // 新建借阅周期（status=borrowed/returned/unknown）
  | 'cycle-skipped-duplicate' // 周期精确重复（sourceId+barcode+borrowedAt）→ parseStatus='skipped'
  | 'cycle-unpaired' // 借还不成对/时间重叠 → 记 unpaired_record 警告
  | 'row-error' // format_error 等致命解析错误，行未产出实体
  | 'row-filtered' // 被 parser.filterRows 预剔除（装配层补充，spec §5.3）

/** 单行决策明细（与 RawRecord.rowIndex 对齐，1-based）。 */
export interface ImportTraceRow {
  rowIndex: number
  rawRecordId: string | null
  status: 'imported' | 'skipped' | 'warning' | 'error' | 'filtered-out'
  decision: ImportDecision
  /** 人读决策原因（与 warning.message 同风格）。 */
  reason: string
  barcode: string | null
  title: string | null
  bookId: string | null
  catalogRecordId: string | null
  borrowCycleId: string | null
  /** 关联警告类型，便于与 warnings 交叉检索。 */
  warningType: ParseWarningType | null
  /**
   * 派生 ID 推导串（会话态细化，spec §7 允许字段演进）：
   * 如 `cr-{fnv1a32(sourceId|metaIdKey)}`、`bk-{fnv1a32(sourceId|barcode)}`，
   * stableHash 口径；仅 verbose 且命中派生 ID 时填写，非 verbose 不分配。
   */
  idDerivation?: string
}

/** 导入决策 trace（纯函数、确定性派生；durationMs 由装配层填写，纯函数内恒 null）。 */
export interface ImportTrace {
  importLogId: string
  sourceId: string
  parserId: string
  importedAt: Date
  fileName: string
  fileSize: number
  detectedEncoding: string
  stats: ImportLogStats
  rows: ImportTraceRow[]
  entityDelta: {
    /** 新建 Book id。 */
    newBooks: string[]
    /** 被并入的既有 Book id（merged-book-isbn/fuzzy 命中；占位独立书不在此列）。 */
    mergedBooks: string[]
    newCatalogRecords: string[]
    newBorrowCycles: string[]
    /** 跳过行 rowIndex。 */
    skippedRows: number[]
  }
  /** 警告明细（= importLog.warnings 同内容；spec §4.1 步骤 5 输出源）。 */
  warnings: ParseWarning[]
  /** 主线程/Worker 计时；纯函数测试环境为 null（装配层填写）。 */
  durationMs: number | null
}

// ---------------------------------------------------------------------------
// collector：由 dedupe 回传字段推导 trace，不改任何决策逻辑。
// ---------------------------------------------------------------------------

/** 候选编目行 decision（候选分支五值，collectCatalogDecision 产出）。 */
export type CatalogDecision =
  | 'new-book'
  | 'merged-catalog'
  | 'merged-book-isbn'
  | 'merged-book-fuzzy'
  | 'placeholder-isolated'

/** 候选编目行决策判定输入（pipeline 候选装配循环上下文）。 */
export interface CatalogDecisionInput {
  /** dedupe 回传 bookIds[i]（`new:` token 或既有 Book id；缺省 undefined）。 */
  bookIdRaw: string | undefined
  /** dedupe 回传 existingCrIds[i]（命中既有编目 id 或 ''）。 */
  existingCrId: string
  /** 候选是否选书帮占位。 */
  isPlaceholder: boolean
  /** 候选 ISBN13（判 merged-book-isbn vs fuzzy）。 */
  isbn13: string | null
}

/**
 * 候选编目行 decision 判定（纯函数，spec §5.2 收集点表第 1 行）。
 * 优先级：placeholder-isolated **先于**编目级（dedupe.ts:124-133 占位命中
 * 既有编目也置 existingCrIds[i]，后查会误判 merged-catalog）；
 * `new:` token → new-book；既有编目命中 → merged-catalog；
 * 非 new: + ISBN → merged-book-isbn；非 new: + 无 ISBN → merged-book-fuzzy。
 */
export function collectCatalogDecision(
  input: CatalogDecisionInput,
): CatalogDecision {
  if (input.isPlaceholder) return 'placeholder-isolated'
  if (input.existingCrId !== '') return 'merged-catalog'
  if (input.bookIdRaw != null && input.bookIdRaw.startsWith('new:')) {
    return 'new-book'
  }
  return input.isbn13 ? 'merged-book-isbn' : 'merged-book-fuzzy'
}

/**
 * trace 收集器（pipeline 持有；所有方法在 trace 收集关闭时不会被调用——
 * pipeline 侧以 `trace == null` 短路保证 D5 零分配）。
 */
export interface TraceCollector {
  /** 候选编目行记录（候选装配循环，spec §5.2 收集点 1）。 */
  catalogRow(input: {
    rowIndex: number
    rawRecordId: string | null
    barcode: string | null
    title: string | null
    decision: CatalogDecision
    bookId: string | null
    catalogRecordId: string | null
    warningType: ParseWarningType | null
  }): void
  /** 周期候选记录（周期去重对齐，spec §5.2 收集点 2）。 */
  cycleRow(input: {
    rowIndexes: number[]
    decision: 'cycle-created' | 'cycle-skipped-duplicate' | 'cycle-unpaired'
    reason: string
    barcode: string | null
    bookId: string | null
    catalogRecordId: string | null
    borrowCycleId: string | null
  }): void
  /** 行级警告回查表（row:{N} → warningType，spec §5.2 收集点 3）。 */
  rowWarnings(byRow: Map<number, ParseWarningType>): void
  /** 行回填循环后的终态采集（spec §5.2 收集点 4）。 */
  finalize(input: {
    books: { id: string; isbn13: string | null; title: string }[]
    mergedBookIds: string[]
    newCatalogRecordIds: string[]
    rawRecords: {
      id: string
      rowIndex: number
      barcode: string | null
      title: string | null
      bookId: string | null
      borrowCycleId: string | null
      catalogRecordId: string | null
      parseStatus: 'success' | 'warning' | 'error' | 'skipped'
    }[]
    /** 实体 id → 派生推导串（仅 verbose 传入；如 cr-{fnv1a32(sourceId|metaIdKey)}）。 */
    idDerivations: Map<string, string>
    stats: ImportLogStats
    warnings: ParseWarning[]
  }): void
  /** 收集器所属 trace（pipeline 返回时取用）。 */
  readonly trace: ImportTrace
}

/**
 * 初始化 trace 头部与收集器（仅 traceOptions 传入时调用）。
 * durationMs 恒 null（装配层填写，spec §5.1/§5.2 确定性）。
 */
export function initTrace(
  meta: ImportMetaLike,
  source: { id: string; parserId: string },
  verbose: boolean,
): ImportTrace & { collector: TraceCollector } {
  const rows: ImportTraceRow[] = []
  // 周期行先按候选暂存，行回填后统一合入 rows（rowIndex 升序由 finalize 排序）。
  const cycleRows: ImportTraceRow[] = []
  const catalogRows: ImportTraceRow[] = []
  let rowWarningMap: Map<number, ParseWarningType> = new Map()
  const newBookIds: string[] = []
  const mergedBookIds: string[] = []
  const newCatalogRecordIds: string[] = []
  const newBorrowCycleIds: string[] = []
  const skippedRowIndexes: number[] = []

  const trace: ImportTrace = {
    importLogId: meta.id,
    sourceId: source.id,
    parserId: source.parserId,
    importedAt: meta.importedAt,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    detectedEncoding: meta.detectedEncoding,
    stats: EMPTY_STATS,
    rows,
    entityDelta: {
      newBooks: newBookIds,
      mergedBooks: mergedBookIds,
      newCatalogRecords: newCatalogRecordIds,
      newBorrowCycles: newBorrowCycleIds,
      skippedRows: skippedRowIndexes,
    },
    warnings: [],
    durationMs: null,
  }

  const collector: TraceCollector = {
    get trace() {
      return trace
    },
    catalogRow(input) {
      catalogRows.push({
        rowIndex: input.rowIndex,
        rawRecordId: input.rawRecordId,
        status: 'imported',
        decision: input.decision,
        reason: REASON_BY_CATALOG[input.decision],
        barcode: input.barcode,
        title: input.title,
        bookId: input.bookId,
        catalogRecordId: input.catalogRecordId,
        borrowCycleId: null,
        warningType: input.warningType,
      })
    },
    cycleRow(input) {
      for (const rowIndex of input.rowIndexes) {
        cycleRows.push({
          rowIndex,
          rawRecordId: null,
          status:
            input.decision === 'cycle-skipped-duplicate' ? 'skipped' : 'imported',
          decision: input.decision,
          reason: input.reason,
          barcode: input.barcode,
          title: null,
          bookId: input.bookId,
          catalogRecordId: input.catalogRecordId,
          borrowCycleId: input.borrowCycleId,
          warningType: input.decision === 'cycle-unpaired' ? 'unpaired_record' : null,
        })
      }
    },
    rowWarnings(byRow) {
      rowWarningMap = byRow
    },
    finalize(input) {
      // 行终态：catalog/cycle 暂存行合入，再按 rawRecords 权威 status/ID 覆写。
      const byRow = new Map<number, ImportTraceRow>()
      for (const r of [...catalogRows, ...cycleRows]) {
        const prev = byRow.get(r.rowIndex)
        byRow.set(r.rowIndex, prev ? mergeRow(prev, r) : r)
      }
      for (const rr of input.rawRecords) {
        const row = byRow.get(rr.rowIndex) ?? {
          rowIndex: rr.rowIndex,
          rawRecordId: rr.id,
          status: 'imported' as const,
          decision: 'new-book' as const,
          reason: REASON_BY_CATALOG['new-book'],
          barcode: rr.barcode,
          title: rr.title,
          bookId: null,
          catalogRecordId: null,
          borrowCycleId: null,
          warningType: null,
        }
        row.rawRecordId = rr.id
        row.barcode = rr.barcode
        row.title = rr.title
        row.bookId = rr.bookId
        row.catalogRecordId = row.catalogRecordId ?? rr.catalogRecordId
        row.borrowCycleId = row.borrowCycleId ?? rr.borrowCycleId
        // 行级警告（row:{N}）→ warningType；format_error → row-error 覆写。
        const wt = rowWarningMap.get(rr.rowIndex) ?? null
        if (wt != null) row.warningType = wt
        if (wt === 'format_error') {
          row.decision = 'row-error'
          row.reason = REASON_BY_DECISION['row-error']
          row.status = 'error'
          row.bookId = null
          row.borrowCycleId = null
        } else {
          row.status = STATUS_BY_PARSE[rr.parseStatus]
          // cycle-unpaired 行记有 unpaired_record 警告 → status 提升为 warning
          // （与 row:{N} 警告行同口径；管线 parseStatus 不变，trace 侧呈现）。
          if (
            row.decision === 'cycle-unpaired' &&
            row.status === 'imported'
          ) {
            row.status = 'warning'
          }
          if (rr.parseStatus === 'skipped' && row.decision !== 'cycle-unpaired') {
            // skipped 由周期去重产生；非 unpaired 的 skipped 行补 decision
            // （catalog 暂存行占位为候选分支，周期侧未覆盖到时兜底）。
            if (row.decision !== 'cycle-skipped-duplicate') {
              row.decision = 'cycle-skipped-duplicate'
              row.reason = REASON_BY_DECISION['cycle-skipped-duplicate']
            }
          }
        }
        if (row.status === 'skipped') skippedRowIndexes.push(rr.rowIndex)
        byRow.set(rr.rowIndex, row)
      }
      rows.push(...byRow.values())
      rows.sort((a, b) => a.rowIndex - b.rowIndex)

      // entityDelta（管线权威数据直传，不在 trace 行上二次推导）：
      // newBooks = 本批新建 Book；mergedBooks = ISBN/模糊命中既有 Book；
      // newCatalogRecords/newBorrowCycles = 管线新产出计数；skippedRows
      // 已在行终态循环里按 status 收集。
      newBookIds.push(...input.books.map((b) => b.id))
      mergedBookIds.push(...input.mergedBookIds)
      newCatalogRecordIds.push(...input.newCatalogRecordIds)
      // 新借阅周期：以 rawRecords 回填的 borrowCycleId 为权威（去重）。
      for (const rr of input.rawRecords) {
        if (
          rr.borrowCycleId &&
          !newBorrowCycleIds.includes(rr.borrowCycleId)
        ) {
          newBorrowCycleIds.push(rr.borrowCycleId)
        }
      }
      trace.stats = input.stats
      trace.warnings = input.warnings
      // verbose：命中派生 ID 的行补 idDerivation（stableHash 口径）。
      if (verbose) {
        for (const row of rows) {
          if (row.catalogRecordId && input.idDerivations.has(row.catalogRecordId)) {
            row.idDerivation = input.idDerivations.get(row.catalogRecordId)
          } else if (row.bookId && input.idDerivations.has(row.bookId)) {
            row.idDerivation = input.idDerivations.get(row.bookId)
          }
        }
      }
    },
  }

  return { ...trace, collector }
}

/** 合并同 rowIndex 的 catalog/cycle 暂存行（spec §8 行 decision 单值优先级）：
 * skipped-duplicate > unpaired > 候选分支 > cycle-created。 */
function mergeRow(a: ImportTraceRow, b: ImportTraceRow): ImportTraceRow {
  const prio = (d: ImportDecision) =>
    d === 'cycle-skipped-duplicate'
      ? 4
      : d === 'cycle-unpaired'
        ? 3
        : d === 'cycle-created'
          ? 1
          : 2 // 候选分支（new-book/merged-*/placeholder-isolated）
  return prio(a.decision) >= prio(b.decision) ? a : b
}

/** parseStatus → 行 status 映射（spec §5.1 status 枚举）。 */
const STATUS_BY_PARSE: Record<
  'success' | 'warning' | 'error' | 'skipped',
  ImportTraceRow['status']
> = {
  success: 'imported',
  warning: 'warning',
  error: 'error',
  skipped: 'skipped',
}

/** 候选分支 reason 文案（人读，与 warning.message 同风格）。 */
const REASON_BY_CATALOG: Record<CatalogDecision, string> = {
  'new-book': '新建书目与编目记录',
  'merged-catalog': '编目级命中（sourceId+barcode/metaIdKey），沿用既有编目记录',
  'merged-book-isbn': '无编目命中，ISBN 命中既有书目，新编目挂入',
  'merged-book-fuzzy': '无 ISBN，题名/作者模糊命中既有书目（置待审）',
  'placeholder-isolated': '选书帮占位：按条码独立成书，不做合并',
}

/** 全 decision reason 文案（兜底覆写用）。 */
const REASON_BY_DECISION: Record<ImportDecision, string> = {
  ...REASON_BY_CATALOG,
  'cycle-created': '新建借阅周期',
  'cycle-skipped-duplicate': '周期精确重复（sourceId+barcode+借出时间+书目），跳过',
  'cycle-unpaired': '周期时间重叠/借还不成对，记警告并保留周期',
  'row-error': '解析致命错误（format_error），行未产出实体',
  'row-filtered': '被行级预过滤剔除（filterRows）',
}

/** initTrace 元数据入参形状（避免反向依赖 pipeline 类型）。 */
interface ImportMetaLike {
  id: string
  fileName: string
  fileSize: number
  detectedEncoding: string
  importedAt: Date
}

const EMPTY_STATS: ImportLogStats = {
  totalRawRecords: 0,
  newBooks: 0,
  updatedBooks: 0,
  newBorrowCycles: 0,
  skippedRecords: 0,
  filteredRows: 0,
  warningCount: 0,
  errorCount: 0,
}
