import { z } from 'zod'

import type { Book, BorrowCycle, CatalogRecord, ImportLog, RawRecord, Source } from '@/types/entities'
import type { ReadGraphDB } from './db'
import {
  bookSchema,
  borrowCycleSchema,
  catalogRecordSchema,
  importLogSchema,
  rawRecordSchema,
  sourceSchema,
} from './schemas'

// 通用 Repository 契约：薄封装 Dexie table，不持状态。
// 接收 db 句柄构造（便于测试注入 fake-indexeddb 实例）。
// 写方法落库前对入参跑对应 Zod safeParse，失败抛 ZodError，不部分写入。

export interface Repository<T extends { id: string }> {
  get(id: string): Promise<T | undefined>
  getAll(): Promise<T[]>
  put(entity: T): Promise<string>
  bulkPut(entities: T[]): Promise<void>
  delete(id: string): Promise<void>
  count(): Promise<number>
}

// 校验后 upsert；返回 id。重复校验确保不部分写入。
function validate<S extends z.ZodType>(schema: S, value: unknown): z.infer<S> {
  const result = schema.safeParse(value)
  if (!result.success) throw result.error
  return result.data
}

// catalogRecords 的 classCodes multiEntry 索引指向 classifications[].code 派生数组，
// 存储前补写该非规范化字段，使 *classCodes 索引可用；schema 不校验该字段。
// 所有写路径（repository / 导入 / 备份恢复 / E2E seed / 存量回填）统一经此派生，
// 避免索引字段缺失导致 treemap 下钻等 classCodes 查询失效。
export function deriveClassCodes<T extends CatalogRecord>(rec: T): T & { classCodes: string[] } {
  return { ...rec, classCodes: rec.classifications.map((c) => c.code) }
}


export class BookRepository implements Repository<Book> {
  private db: ReadGraphDB
  constructor(db: ReadGraphDB) { this.db = db }

  get(id: string): Promise<Book | undefined> {
    return this.db.books.get(id) as Promise<Book | undefined>
  }
  getAll(): Promise<Book[]> {
    return this.db.books.toArray() as Promise<Book[]>
  }
  async put(entity: Book): Promise<string> {
    const valid = validate(bookSchema, entity)
    return this.db.books.put(valid)
  }
  async bulkPut(entities: Book[]): Promise<void> {
    const valid = entities.map((e) => validate(bookSchema, e))
    await this.db.books.bulkPut(valid)
  }
  async delete(id: string): Promise<void> {
    await this.db.books.delete(id)
  }
  count(): Promise<number> {
    return this.db.books.count() as Promise<number>
  }

  findByIsbn13(isbn13: string): Promise<Book | undefined> {
    return this.db.books.where('isbn13').equals(isbn13).first() as Promise<Book | undefined>
  }
  findBySourceId(sourceId: string): Promise<Book[]> {
    return this.db.books.where('sourceIds').equals(sourceId).toArray() as Promise<Book[]>
  }
  /**
   * 待完善书目（needsReview=true）。全量内存过滤、不建索引：IDB 合法键类型
   * 不含 boolean（真实浏览器中布尔索引永不收录记录、equals(true) 抛 DataError，
   * H1 回归），书库列表/待完善筛选本就在内存过滤。
   */
  findNeedsReview(): Promise<Book[]> {
    return this.db.books.toArray().then((books) => books.filter((b) => b.needsReview))
  }
  searchByTitle(query: string): Promise<Book[]> {
    const lower = query.toLowerCase()
    return this.db.books
      .filter((b) => b.title.toLowerCase().includes(lower))
      .toArray() as Promise<Book[]>
  }
}

export class CatalogRecordRepository implements Repository<CatalogRecord> {
  private db: ReadGraphDB
  constructor(db: ReadGraphDB) { this.db = db }

  get(id: string): Promise<CatalogRecord | undefined> {
    return this.db.catalogRecords.get(id) as Promise<CatalogRecord | undefined>
  }
  getAll(): Promise<CatalogRecord[]> {
    return this.db.catalogRecords.toArray() as Promise<CatalogRecord[]>
  }
  async put(entity: CatalogRecord): Promise<string> {
    const valid = validate(catalogRecordSchema, entity)
    return this.db.catalogRecords.put(deriveClassCodes(valid))
  }
  async bulkPut(entities: CatalogRecord[]): Promise<void> {
    const valid = entities.map((e) => deriveClassCodes(validate(catalogRecordSchema, e)))
    await this.db.catalogRecords.bulkPut(valid)
  }
  // classCodes 为 multiEntry 索引字段：本查询只能命中已写该字段的记录。
  // 启动回填（backfillClassCodes）失败时存量记录缺该字段 → 索引查询天然漏掉它们；
  // 自愈需全表扫描，渲染路径禁扫（roadmap 性能规则），故此处不可自愈。可诊断性由
  // 启动回填的 console.error 兜底；已物化到内存的记录由 withClassCodes 读侧归一兜底
  // （见 src/lib/with-class-codes.ts）。
  findClassCodes(code: string): Promise<CatalogRecord[]> {
    return this.db.catalogRecords
      .where('classCodes')
      .equals(code)
      .toArray() as Promise<CatalogRecord[]>
  }
  async delete(id: string): Promise<void> {
    await this.db.catalogRecords.delete(id)
  }
  count(): Promise<number> {
    return this.db.catalogRecords.count() as Promise<number>
  }

  findByBookId(bookId: string): Promise<CatalogRecord[]> {
    return this.db.catalogRecords.where('bookId').equals(bookId).toArray() as Promise<CatalogRecord[]>
  }
  findBySourceId(sourceId: string): Promise<CatalogRecord[]> {
    return this.db.catalogRecords
      .where('sourceId')
      .equals(sourceId)
      .toArray() as Promise<CatalogRecord[]>
  }
  findByBarcode(barcode: string): Promise<CatalogRecord[]> {
    return this.db.catalogRecords
      .where('barcodes')
      .equals(barcode)
      .toArray() as Promise<CatalogRecord[]>
  }
  findBySourceMetaIdKey(sourceId: string, metaIdKey: string): Promise<CatalogRecord[]> {
    return this.db.catalogRecords
      .where('[sourceId+metaIdKey]')
      .equals([sourceId, metaIdKey])
      .toArray() as Promise<CatalogRecord[]>
  }
}

export class BorrowCycleRepository implements Repository<BorrowCycle> {
  private db: ReadGraphDB
  constructor(db: ReadGraphDB) { this.db = db }

  get(id: string): Promise<BorrowCycle | undefined> {
    return this.db.borrowCycles.get(id) as Promise<BorrowCycle | undefined>
  }
  getAll(): Promise<BorrowCycle[]> {
    return this.db.borrowCycles.toArray() as Promise<BorrowCycle[]>
  }
  async put(entity: BorrowCycle): Promise<string> {
    const valid = validate(borrowCycleSchema, entity)
    return this.db.borrowCycles.put(valid)
  }
  async bulkPut(entities: BorrowCycle[]): Promise<void> {
    const valid = entities.map((e) => validate(borrowCycleSchema, e))
    await this.db.borrowCycles.bulkPut(valid)
  }
  async delete(id: string): Promise<void> {
    await this.db.borrowCycles.delete(id)
  }
  count(): Promise<number> {
    return this.db.borrowCycles.count() as Promise<number>
  }

  findByBookId(bookId: string): Promise<BorrowCycle[]> {
    return this.db.borrowCycles.where('bookId').equals(bookId).toArray() as Promise<BorrowCycle[]>
  }
  findBySourceId(sourceId: string): Promise<BorrowCycle[]> {
    return this.db.borrowCycles
      .where('sourceId')
      .equals(sourceId)
      .toArray() as Promise<BorrowCycle[]>
  }
  findBorrowed(): Promise<BorrowCycle[]> {
    return this.db.borrowCycles
      .where('status')
      .equals('borrowed')
      .toArray() as Promise<BorrowCycle[]>
  }
  timelineByBook(bookId: string): Promise<BorrowCycle[]> {
    return this.db.borrowCycles
      .where('[bookId+borrowedAt]')
      .between([bookId, new Date(-8640000000000000)], [bookId, new Date(8640000000000000)])
      .toArray() as Promise<BorrowCycle[]>
  }
  timelineBySource(sourceId: string): Promise<BorrowCycle[]> {
    return this.db.borrowCycles
      .where('[sourceId+borrowedAt]')
      .between([sourceId, new Date(-8640000000000000)], [sourceId, new Date(8640000000000000)])
      .toArray() as Promise<BorrowCycle[]>
  }
}

export class SourceRepository implements Repository<Source> {
  private db: ReadGraphDB
  constructor(db: ReadGraphDB) { this.db = db }

  get(id: string): Promise<Source | undefined> {
    return this.db.sources.get(id) as Promise<Source | undefined>
  }
  getAll(): Promise<Source[]> {
    return this.db.sources.toArray() as Promise<Source[]>
  }
  async put(entity: Source): Promise<string> {
    const valid = validate(sourceSchema, entity)
    return this.db.sources.put(valid)
  }
  async bulkPut(entities: Source[]): Promise<void> {
    const valid = entities.map((e) => validate(sourceSchema, e))
    await this.db.sources.bulkPut(valid)
  }
  async delete(id: string): Promise<void> {
    await this.db.sources.delete(id)
  }
  count(): Promise<number> {
    return this.db.sources.count() as Promise<number>
  }

  findByParserId(parserId: string): Promise<Source | undefined> {
    return this.db.sources.where('parserId').equals(parserId).first() as Promise<Source | undefined>
  }
  findByType(type: Source['type']): Promise<Source[]> {
    return this.db.sources.where('type').equals(type).toArray() as Promise<Source[]>
  }
}

export class RawRecordRepository implements Repository<RawRecord> {
  private db: ReadGraphDB
  constructor(db: ReadGraphDB) { this.db = db }

  get(id: string): Promise<RawRecord | undefined> {
    return this.db.rawRecords.get(id) as Promise<RawRecord | undefined>
  }
  getAll(): Promise<RawRecord[]> {
    return this.db.rawRecords.toArray() as Promise<RawRecord[]>
  }
  async put(entity: RawRecord): Promise<string> {
    const valid = validate(rawRecordSchema, entity)
    return this.db.rawRecords.put(valid)
  }
  async bulkPut(entities: RawRecord[]): Promise<void> {
    const valid = entities.map((e) => validate(rawRecordSchema, e))
    await this.db.rawRecords.bulkPut(valid)
  }
  async delete(id: string): Promise<void> {
    await this.db.rawRecords.delete(id)
  }
  count(): Promise<number> {
    return this.db.rawRecords.count() as Promise<number>
  }

  findByImportLog(importLogId: string): Promise<RawRecord[]> {
    return this.db.rawRecords
      .where('importLogId')
      .equals(importLogId)
      .toArray() as Promise<RawRecord[]>
  }
  findBySourceId(sourceId: string): Promise<RawRecord[]> {
    return this.db.rawRecords
      .where('sourceId')
      .equals(sourceId)
      .toArray() as Promise<RawRecord[]>
  }
  findByStatus(status: RawRecord['parseStatus']): Promise<RawRecord[]> {
    return this.db.rawRecords
      .where('parseStatus')
      .equals(status)
      .toArray() as Promise<RawRecord[]>
  }
}

export class ImportLogRepository implements Repository<ImportLog> {
  private db: ReadGraphDB
  constructor(db: ReadGraphDB) { this.db = db }

  get(id: string): Promise<ImportLog | undefined> {
    return this.db.importLogs.get(id) as Promise<ImportLog | undefined>
  }
  getAll(): Promise<ImportLog[]> {
    return this.db.importLogs.toArray() as Promise<ImportLog[]>
  }
  async put(entity: ImportLog): Promise<string> {
    const valid = validate(importLogSchema, entity)
    return this.db.importLogs.put(valid)
  }
  async bulkPut(entities: ImportLog[]): Promise<void> {
    const valid = entities.map((e) => validate(importLogSchema, e))
    await this.db.importLogs.bulkPut(valid)
  }
  async delete(id: string): Promise<void> {
    await this.db.importLogs.delete(id)
  }
  count(): Promise<number> {
    return this.db.importLogs.count() as Promise<number>
  }

  findBySourceId(sourceId: string): Promise<ImportLog[]> {
    return this.db.importLogs
      .where('sourceId')
      .equals(sourceId)
      .toArray() as Promise<ImportLog[]>
  }
  async recent(limit: number): Promise<ImportLog[]> {
    const all = await this.db.importLogs.orderBy('importedAt').toArray()
    return (all as ImportLog[]).slice(-Math.max(0, limit)).reverse()
  }
}

export interface Repositories {
  books: BookRepository
  catalogRecords: CatalogRecordRepository
  borrowCycles: BorrowCycleRepository
  sources: SourceRepository
  rawRecords: RawRecordRepository
  importLogs: ImportLogRepository
}

export function createRepositories(db: ReadGraphDB): Repositories {
  return {
    books: new BookRepository(db),
    catalogRecords: new CatalogRecordRepository(db),
    borrowCycles: new BorrowCycleRepository(db),
    sources: new SourceRepository(db),
    rawRecords: new RawRecordRepository(db),
    importLogs: new ImportLogRepository(db),
  }
}

export type RepositoryOf<T extends { id: string }> = Repository<T>
