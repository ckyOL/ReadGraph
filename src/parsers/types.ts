// Parser 接口与解析结果类型（§10.2、source.md Parser 接口规范）。
// 与 src/types/entities.ts 完全对齐。本里程碑 parse 为同步。
import type {
  Book,
  CatalogRecord,
  BorrowCycle,
  ParseWarning,
  Source,
} from '@/types/entities'

export type { ParseWarning, Source }

/** Parser 接口：每种数据来源实现一个，在浏览器/node 同步运行（无 Node API）。 */
export interface SourceParser {
  /** 唯一标识符，必须等于其所解析来源的 Source.parserId。 */
  id: string
  /** 显示名称（i18n 外，调试/报告用）。 */
  name: string
  /**
   * 解析原始数据。rawRecordIds 由调用方注入（pipeline 负责壳），
   * parser 的视角是「逐行解析 rows[i].data 并产出候选实体/警告」。
   * rawData 支持字符串/ArrayBuffer（validate 探测入口）与行对象数组
   * （pipeline 直接传 rows 的 data，跳过 JSON 两遍全量处理，L4）。
   */
  parse(rawData: string | ArrayBuffer | unknown[], source: Source): ParseResult
  /** 验证原始数据格式是否匹配此 Parser（自动检测来源）。 */
  validate(rawData: string | ArrayBuffer): boolean
  /**
   * 行级预过滤：返回剔除无效/无用记录（如「自助查询」「读者续借」）后的行，
   * 供导入预览使用。必须与 parse 的有效行集合一致，保证「预览所见即导入所得」。
   */
  filterRows(rows: Record<string, unknown>[]): Record<string, unknown>[]
}

/**
 * 瞬态字段契约（H-3）：以下字段**不是类型化字段**，由 parser 经
 * `as Record<string, unknown>` 附加在产出 partial 上，供 pipeline 装配对齐用；
 * 它们**不入库、不持久化、不进入最终实体**（szlib 为唯一生产方，见其
 * pushCycle / book/catalogRecord 装配处）。第三方 parser 必须照此约定设置，
 * 否则 pipeline 发出 `missing_field` 警告并降级（见 pipeline.ts 步骤 2/5）：
 * - `_rowIndexes: number[]` — 标注在 `borrowCycles[]` partial 上，值为该周期
 *   消费的原始行文件行号（1-based，与 RawRecord.rowIndex / buildRawRecords 一致）。
 *   pipeline 装配候选周期时按行号取 `rawRecordIds` 并做 metaid 消歧；缺失时
 *   rawRecordIds 为空、周期溯源与消歧降级（警告）。
 * - `_bookKey: string` — 标注在 `books[]` / `catalogRecords[]` partial 上，值为
 *   去重后的书目键（`isbn:` / `noisbn:` / `ph:` 前缀）。pipeline 用它在批次内把
 *   编目候选与 Book 候选对齐（findBookForCatalog）；缺失时无法定位对应
 *   Book 候选，占位/合并判定降级（警告）。
 */
export interface ParseResult {
  books: Partial<Book>[]
  catalogRecords: Partial<CatalogRecord>[]
  borrowCycles: Partial<BorrowCycle>[]
  warnings: ParseWarning[]
  stats: {
    totalRawRecords: number
    skippedRecords: number
  }
}

/** §10.8 ParseWarning.type 语义。 */
export type ParseWarningType = ParseWarning['type']
