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

/**
 * 按身份键 (sourceId, barcode, borrowedAt) 归并借阅周期，返回保留项/删除项/重指映射。
 * 纯函数：不读写存储，供 v2 迁移与测试复用。每组保留 rawRecordIds 最全者
 * （并列取 id 最小），其余标记删除；删除项的 rawRecords 应重指向保留项。
 */
export function dedupeBorrowCycleRows(cycles: BorrowCycle[]): {
  kept: BorrowCycle[]
  deleteIds: string[]
  repoint: Map<string, string>
} {
  const byKey = new Map<string, BorrowCycle[]>()
  for (const c of cycles) {
    const key = `${c.sourceId}|${c.barcode ?? ''}|${c.borrowedAt.getTime()}`
    const arr = byKey.get(key) ?? []
    arr.push(c)
    byKey.set(key, arr)
  }
  const deleteIds: string[] = []
  const repoint = new Map<string, string>()
  const kept: BorrowCycle[] = []
  for (const group of byKey.values()) {
    if (group.length === 1) {
      kept.push(group[0]!)
      continue
    }
    const keeper = [...group].sort((a, b) => {
      const ra = a.rawRecordIds.length
      const rb = b.rawRecordIds.length
      if (ra !== rb) return rb - ra
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })[0]!
    for (const c of group) {
      if (c.id === keeper.id) continue
      deleteIds.push(c.id)
      repoint.set(c.id, keeper.id)
    }
    // 合并 rawRecordIds 保持溯源完整。
    keeper.rawRecordIds = [
      ...new Set(group.flatMap((c) => c.rawRecordIds).sort()),
    ]
    kept.push(keeper)
  }
  return { kept, deleteIds, repoint }
}

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
    this.version(2)
      .stores({
        books: 'id, &isbn13, title, createdAt, *sourceIds, *tags, needsReview',
        catalogRecords:
          'id, bookId, sourceId, metaId, metaIdKey, *classCodes, *barcodes, [sourceId+metaIdKey]',
        borrowCycles:
          'id, bookId, sourceId, borrowedAt, returnedAt, status, [bookId+borrowedAt], [sourceId+borrowedAt]',
        sources: 'id, &parserId, type',
        rawRecords: 'id, importLogId, sourceId, parseStatus',
        importLogs: 'id, sourceId, importedAt',
      })
      .upgrade(async (tx) => {
        // v2 迁移：清理历史版本导入产生的重复借阅周期。
        // 早期 dedupeBorrowCycles 只与 existing 比对、不查批次内重复，
        // 同一文件内重复行（如爬虫分页边界）会落库多条相同周期。
        const cyclesTable = tx.table<BorrowCycle, string>('borrowCycles')
        const all = await cyclesTable.toArray()
        const { kept, deleteIds, repoint } = dedupeBorrowCycleRows(all)
        if (deleteIds.length > 0) {
          await cyclesTable.bulkDelete(deleteIds)
          await cyclesTable.bulkPut(kept)
          await tx
            .table<RawRecord, string>('rawRecords')
            .toCollection()
            .modify((rr) => {
              const target = rr.borrowCycleId
                ? repoint.get(rr.borrowCycleId)
                : undefined
              if (target) rr.borrowCycleId = target
            })
        }
      })
    // v3 迁移：移除 books.needsReview 索引（H1 回归）。IDB 合法键类型不含
    // boolean（MDN：string/date/float/binary/array），真实浏览器中该索引
    // 永不收录记录且查询抛 DataError；书库列表/待完善计数本就在内存过滤，
    // 索引无收益反而制造「Chrome 恒 0 / Firefox 写库报错」的差异。纯索引
    // 变更：无 upgrade 回调，Dexie 自动重建，数据保留。
    this.version(3).stores({
      books: 'id, &isbn13, title, createdAt, *sourceIds, *tags',
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
