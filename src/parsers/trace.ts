// 导入决策 trace 数据契约（debug-mode spec §5.1）。
// DBG-0 仅落类型；collector（initTrace/逐行记录助手/collectCatalogDecision）归 DBG-1。
// ImportTrace 是会话态结构，不承诺跨版本向后兼容（spec §7 版本边界）；
// 不进 ExportData、不落库（D4）。
import type { ImportLogStats, ParseWarningType } from '@/types/entities'

/**
 * 逐行决策判定优先级（spec §8 验收用例为准，DBG-1 实现时遵守）：
 * `row-filtered`（装配层，DBG-3）> `row-error` > `cycle-skipped-duplicate` >
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
  | 'row-filtered' // 被 parser.filterRows 预剔除（装配层补充，spec §5.3，DBG-3）

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
   * stableHash 口径；仅 verbose 且命中派生 ID 时填写（DBG-1），非 verbose 不分配。
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
  /** 主线程/Worker 计时；纯函数测试环境为 null（DBG-3 装配层填写）。 */
  durationMs: number | null
}
