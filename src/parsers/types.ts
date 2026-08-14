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
  /** 支持的文件格式（本里程碑 szlib 仅 JSON）。 */
  supportedFormats: ('json' | 'csv' | 'xlsx')[]
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

/** 解析结果：候选实体的「部分」描述（id 等由 pipeline 派生补全）。 */
export interface ParseResult {
  books: Partial<Book>[]
  catalogRecords: Partial<CatalogRecord>[]
  borrowCycles: Partial<BorrowCycle>[]
  warnings: ParseWarning[]
  stats: {
    totalRawRecords: number
    parsedBooks: number
    parsedCatalogRecords: number
    parsedCycles: number
    skippedRecords: number
  }
}

/** §10.8 ParseWarning.type 语义。 */
export type ParseWarningType = ParseWarning['type']

/** 构造 recordRef 行号串（§10.8）。 */
export function rowRef(rowIndex: number): string {
  return `row:${rowIndex}`
}

/** 构造 recordRef 原始 id 串。 */
export function rawRef(rawRecordId: string): string {
  return `raw:${rawRecordId}`
}
