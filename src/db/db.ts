import Dexie from 'dexie'

import type {
  Book,
  BorrowCycle,
  CatalogRecord,
  ImportLog,
  RawRecord,
  Source,
} from '@/types/entities'

// 索引定义对照 docs/metadata/internal-schema.md 各 Object Store：
//   &  = unique, * = multiEntry, [a+b] = compound。
// 所有 store 以 'id'（UUID v4）为主键。
export class ReadGraphDB extends Dexie {
  books!: Dexie.Table<Book, string>
  catalogRecords!: Dexie.Table<CatalogRecord, string>
  borrowCycles!: Dexie.Table<BorrowCycle, string>
  sources!: Dexie.Table<Source, string>
  rawRecords!: Dexie.Table<RawRecord, string>
  importLogs!: Dexie.Table<ImportLog, string>

  constructor(name = 'readgraph') {
    super(name)
    this.version(1).stores({
      books: 'id, &isbn13, title, createdAt, *sourceIds, *tags, needsReview',
      catalogRecords:
        'id, bookId, sourceId, metaId, metaIdKey, *classCodes, *barcodes, [sourceId+metaIdKey]',
      borrowCycles:
        'id, bookId, sourceId, borrowedAt, returnedAt, status, [bookId+borrowedAt], [sourceId+borrowedAt]',
      sources: 'id, &parserId, type',
      rawRecords: 'id, importLogId, sourceId, parseStatus',
      importLogs: 'id, sourceId, importedAt',
    })
  }
}

export type ReadGraphTableName =
  | 'books'
  | 'catalogRecords'
  | 'borrowCycles'
  | 'sources'
  | 'rawRecords'
  | 'importLogs'

export const READGRAPH_TABLES: ReadGraphTableName[] = [
  'books',
  'catalogRecords',
  'borrowCycles',
  'sources',
  'rawRecords',
  'importLogs',
]
