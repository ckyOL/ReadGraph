// 实体 TypeScript 类型（对照 docs/metadata 各实体元数据文档）。
// 字段语义唯一来源：docs/metadata/{book,catalog-record,borrow-cycle,source}.md
// 与 docs/metadata/internal-schema.md。本文件只定义代码侧形状，不重复抄录字段说明。

/** 价格（结构化） */
export interface Price {
  amount: number
  currency: string
}

export type ClassificationSystem = 'clc' | 'ddc' | 'lcc' | 'udc' | 'other'

/** 馆内分类条目 */
export interface ClassificationEntry {
  system: ClassificationSystem
  code: string
  category?: string
}

/** 书目信息元数据 */
export interface Book {
  id: string
  isbn13: string | null
  isbn10: string | null
  title: string
  subtitle: string | null
  authors: string[]
  translators: string[]
  publisher: string | null
  publishDate: string | null
  edition: string | null
  pages: number | null
  price: Price | null
  subjects: string[]
  tags: string[]
  coverUrl: string | null
  description: string | null
  createdAt: Date
  updatedAt: Date
  needsReview: boolean
  sourceIds: string[]
  /** 并列题名（ISBD ` = ` 右侧各段，跨语种辅助辨识）。参见 app-spec §10.13。 */
  parallelTitles: string[]
}

/** 数据来源的本地编目记录 */
export interface CatalogRecord {
  id: string
  bookId: string
  sourceId: string
  metaId: string | number | null
  metaIdKey: string | null
  barcodes: string[]
  classifications: ClassificationEntry[]
  /** classCodes multiEntry 索引派生字段：存储前由 deriveClassCodes 补写（schema 不校验；存量缺失由启动回填）。 */
  classCodes?: string[]
  createdAt: Date
  updatedAt: Date
}

export type BorrowStatus = 'borrowed' | 'returned' | 'unknown'

/** 借阅周期（Parser 配对合成） */
export interface BorrowCycle {
  id: string
  bookId: string
  catalogRecordId: string
  sourceId: string
  borrowedAt: Date
  returnedAt: Date | null
  status: BorrowStatus
  borrowLocation: string | null
  returnLocation: string | null
  rawRecordIds: string[]
  barcode: string | null
  createdAt: Date
  updatedAt: Date
}

export type LibraryType = 'public' | 'academic' | 'special'

export interface LibraryInfo {
  libraryType: LibraryType
  city: string | null
  province: string | null
  website: string | null
  opacUrl: string | null
  classificationSystem: ClassificationSystem | null
}

export type SourceType = 'library' | 'manual'

/** 数据来源元数据 */
export interface Source {
  id: string
  type: SourceType
  name: string
  parserId: string
  parserVersion: string | null
  timezone: string
  library: LibraryInfo | null
  notes: string | null
  createdAt: Date
  lastImportAt: Date | null
  totalImportedRecords: number
}

export type ParseStatus = 'success' | 'warning' | 'error' | 'skipped'

/** 原始导入记录（溯源、重新解析） */
export interface RawRecord {
  id: string
  importLogId: string
  sourceId: string
  data: Record<string, unknown>
  rowIndex: number
  borrowCycleId: string | null
  bookId: string | null
  parseStatus: ParseStatus
  parseNote: string | null
}

export type ParseWarningType =
  | 'missing_field'
  | 'invalid_date'
  | 'unpaired_record'
  | 'duplicate'
  | 'format_error'

export interface ParseWarning {
  type: ParseWarningType
  message: string
  recordRef: string | null
}

export interface ImportLogStats {
  totalRawRecords: number
  newBooks: number
  updatedBooks: number
  newBorrowCycles: number
  skippedRecords: number
  warningCount: number
  errorCount: number
}

/** 导入批次元数据 */
export interface ImportLog {
  id: string
  sourceId: string
  importedAt: Date
  fileName: string
  fileSize: number
  detectedEncoding: string
  parserId: string
  stats: ImportLogStats
  warnings: ParseWarning[]
}

/** 导出数据快照（internal-schema 数据导出）。rawRecords 为必导项。 */
export interface ExportData {
  version: string
  exportedAt: Date
  sources: Source[]
  rawRecords: RawRecord[]
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  importLogs: ImportLog[]
}

export type Theme = 'light' | 'dark' | 'auto'
export type Locale = 'zh-CN' | 'en'

/** 用户偏好（localStorage: readgraph:preferences） */
export interface UserPreferences {
  locale: Locale
  theme: Theme
  displayTimezone: string
}
