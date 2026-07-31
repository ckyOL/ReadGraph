import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import { ReadGraphDB, dedupeBorrowCycleRows } from '@/db/db'
import { createRepositories } from '@/db/repositories'
import type { Book, BorrowCycle, CatalogRecord } from '@/types/entities'
import {
  createTestDB, closeTestDB,
  makeBook, makeCatalog, makeCycle, makeSource, installFakeIndexedDB,
} from '@/db/test-helpers'

let db: ReadGraphDB
beforeEach(() => { db = createTestDB() })
afterEach(async () => { await closeTestDB(db) })

describe('dedupeBorrowCycleRows（v2 迁移纯函数）', () => {
  const t = new Date('2025-01-01T00:00:00.000Z')
  function mk(
    id: string,
    over: Partial<BorrowCycle> = {},
  ): BorrowCycle {
    return {
      id,
      bookId: 'b1',
      catalogRecordId: 'cr',
      sourceId: 'srcA',
      borrowedAt: t,
      returnedAt: new Date(t.getTime() + 86400000),
      status: 'returned' as const,
      borrowLocation: null,
      returnLocation: null,
      rawRecordIds: [],
      barcode: 'BC1',
      createdAt: t,
      updatedAt: t,
      ...over,
    }
  }

  it('无重复时原样保留', () => {
    const a = mk('c1', { borrowedAt: new Date('2025-01-01T00:00:00Z') })
    const b = mk('c2', { borrowedAt: new Date('2025-02-01T00:00:00Z') })
    const { kept, deleteIds, repoint } = dedupeBorrowCycleRows([a, b])
    expect(kept).toHaveLength(2)
    expect(deleteIds).toEqual([])
    expect(repoint.size).toBe(0)
  })

  it('同 (sourceId, barcode, borrowedAt) 保留 rawRecordIds 最全者并合并溯源', () => {
    const a = mk('c1', { rawRecordIds: ['r1'], barcode: 'BC1' })
    const b = mk('c2', { rawRecordIds: ['r2', 'r3'], barcode: 'BC1' })
    const { kept, deleteIds, repoint } = dedupeBorrowCycleRows([a, b])
    expect(deleteIds).toEqual(['c1'])
    expect(repoint.get('c1')).toBe('c2')
    expect(kept).toHaveLength(1)
    expect(kept[0]!.id).toBe('c2')
    expect(kept[0]!.rawRecordIds).toEqual(['r1', 'r2', 'r3'])
  })

  it('并列 rawRecordIds 时保留 id 较小者', () => {
    const a = mk('c1', { rawRecordIds: ['r1'] })
    const b = mk('c2', { rawRecordIds: ['r2'] })
    const { deleteIds, kept } = dedupeBorrowCycleRows([a, b])
    expect(deleteIds).toEqual(['c2'])
    expect(kept[0]!.id).toBe('c1')
  })

  it('不同 sourceId 或不同 barcode 不归并', () => {
    const a = mk('c1', { sourceId: 'srcA', barcode: 'BC1' })
    const b = mk('c2', { sourceId: 'srcB', barcode: 'BC1' })
    const c = mk('c3', { sourceId: 'srcA', barcode: 'BC2' })
    const { kept, deleteIds } = dedupeBorrowCycleRows([a, b, c])
    expect(kept).toHaveLength(3)
    expect(deleteIds).toEqual([])
  })
})

describe('DB schema', () => {
  it('exposes six tables', () => {
    expect([...db.tables.map((t) => t.name)].sort()).toEqual(
      ['books', 'borrowCycles', 'catalogRecords', 'importLogs', 'rawRecords', 'sources'].sort(),
    )
  })
  it('declares version 2', () => {
    expect(db.verno).toBe(2)
  })

  it('v1 → v2 升级清理存量重复周期并重指 rawRecords', async () => {
    installFakeIndexedDB()
    const name = `rg-mig-${Math.random().toString(36).slice(2)}`
    const t = new Date('2025-01-01T00:00:00.000Z')
    // 手工构造 v1 库：仅建两张表（Dexie 升级时会补齐其余表），写入重复周期。
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(name, 1)
      req.onupgradeneeded = () => {
        const raw = req.result
        raw.createObjectStore('borrowCycles', { keyPath: 'id' })
        raw.createObjectStore('rawRecords', { keyPath: 'id' })
      }
      req.onsuccess = () => {
        const raw = req.result
        const tx = raw.transaction(['borrowCycles', 'rawRecords'], 'readwrite')
        const mk = (id: string, rawIds: string[]) => ({
          id,
          bookId: 'b1',
          catalogRecordId: 'cr',
          sourceId: 'srcA',
          borrowedAt: t,
          returnedAt: new Date(t.getTime() + 86400000),
          status: 'returned',
          borrowLocation: null,
          returnLocation: null,
          rawRecordIds: rawIds,
          barcode: 'BC1',
          createdAt: t,
          updatedAt: t,
        })
        tx.objectStore('borrowCycles').add(mk('c1', ['r1']))
        tx.objectStore('borrowCycles').add(mk('c2', ['r2', 'r3']))
        tx.objectStore('rawRecords').add({
          id: 'rr1',
          importLogId: 'log1',
          sourceId: 'srcA',
          data: {},
          rowIndex: 1,
          borrowCycleId: 'c1',
          bookId: null,
          parseStatus: 'success',
          parseNote: null,
        })
        tx.oncomplete = () => {
          raw.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      req.onerror = () => reject(req.error)
    })

    const upgraded = new ReadGraphDB(name)
    await upgraded.open()
    const cycles = await upgraded.borrowCycles.toArray()
    expect(cycles).toHaveLength(1)
    expect(cycles[0]!.id).toBe('c2')
    expect(cycles[0]!.rawRecordIds).toEqual(['r1', 'r2', 'r3'])
    const rr = await upgraded.rawRecords.get('rr1')
    expect(rr!.borrowCycleId).toBe('c2')
    upgraded.close()
  })
  it('books indexes match internal-schema', () => {
    const idx = db.books.schema
    expect(idx.primKey.keyPath).toBe('id')
    const names = idx.indexes.map((i) => i.name)
    expect(names).toContain('isbn13')
    expect(names).toContain('sourceIds')
    expect(names).toContain('tags')
    expect(names).toContain('needsReview')
    const isbn = idx.indexes.find((i) => i.name === 'isbn13')
    expect(isbn?.unique).toBe(true)
  })
  it('catalogRecords has compound [sourceId+metaIdKey]', () => {
    const compound = db.catalogRecords.schema.indexes.find((i) => Array.isArray(i.keyPath))
    expect(compound?.keyPath).toEqual(['sourceId', 'metaIdKey'])
  })
  it('borrowCycles has [bookId+borrowedAt] compound', () => {
    const names = db.borrowCycles.schema.indexes.map((i) => i.name)
    expect(names).toContain('[bookId+borrowedAt]')
  })
  it('sources has unique parserId', () => {
    const p = db.sources.schema.indexes.find((i) => i.name === 'parserId')
    expect(p?.unique).toBe(true)
  })
})

describe('Repository CRUD', () => {
  it('put/get/getAll/delete/count for books', async () => {
    const r = createRepositories(db)
    const b = makeBook('b1', '9787111111111', 'A')
    await r.books.put(b)
    expect(await r.books.count()).toBe(1)
    expect((await r.books.get('b1'))?.title).toBe('A')
    expect(await r.books.getAll()).toHaveLength(1)
    await r.books.delete('b1')
    expect(await r.books.count()).toBe(0)
  })
  it('bulkPut writes multiple and count reflects', async () => {
    const r = createRepositories(db)
    await r.books.bulkPut([makeBook('b1', '9787000000001', 'A'), makeBook('b2', '9787000000002', 'B')])
    expect(await r.books.count()).toBe(2)
  })
  it('Zod-invalid entity throws and does not persist', async () => {
    const r = createRepositories(db)
    const bad = makeBook('b1', 'bad-isbn', 'A') as unknown as Book
    await expect(r.books.put(bad)).rejects.toBeDefined()
    expect(await r.books.count()).toBe(0)
  })
})

describe('Repository index queries', () => {
  it('findByIsbn13 hits', async () => {
    const r = createRepositories(db)
    await r.books.bulkPut([makeBook('b1', '9787000000001', 'A'), makeBook('b2', '9787000000002', 'B')])
    expect((await r.books.findByIsbn13('9787000000001'))?.id).toBe('b1')
    expect(await r.books.findByIsbn13('nope')).toBeUndefined()
  })
  it('findByBarcode multiEntry hits a record with that barcode', async () => {
    const r = createRepositories(db)
    await r.catalogRecords.bulkPut([
      makeCatalog('c1', 'b1', 'src-sz', 'BC001', 'K1', [{ system: 'clc', code: 'TP312' }]) as CatalogRecord,
      makeCatalog('c2', 'b2', 'src-sz', 'BC002', 'K2') as CatalogRecord,
    ])
    const hits = await r.catalogRecords.findByBarcode('BC001')
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('c1')
  })
  it('findClassCodes multiEntry returns records with that classification code', async () => {
    const r = createRepositories(db)
    await r.catalogRecords.bulkPut([
      makeCatalog('c1', 'b1', 'src-sz', 'BC001', 'K1', [{ system: 'clc', code: 'TP312' }, { system: 'clc', code: 'I242' }]) as CatalogRecord,
      makeCatalog('c2', 'b2', 'src-sz', 'BC002', 'K2', [{ system: 'clc', code: 'TP312' }]) as CatalogRecord,
    ])
    const hits = await r.catalogRecords.findClassCodes('TP312')
    expect(hits).toHaveLength(2)
    const iHits = await r.catalogRecords.findClassCodes('I242')
    expect(iHits).toHaveLength(1)
    expect(iHits[0].id).toBe('c1')
  })
  it('findBySourceMetaIdKey compound isolates per source', async () => {
    const r = createRepositories(db)
    await r.catalogRecords.bulkPut([
      makeCatalog('c1', 'b1', 'srcA', '', 'K1') as CatalogRecord,
      makeCatalog('c2', 'b2', 'srcB', '', 'K1') as CatalogRecord,
      makeCatalog('c3', 'b1', 'srcA', '', 'K2') as CatalogRecord,
    ])
    const hitsA = await r.catalogRecords.findBySourceMetaIdKey('srcA', 'K1')
    expect(hitsA).toHaveLength(1)
    expect(hitsA[0].id).toBe('c1')
    const hitsB = await r.catalogRecords.findBySourceMetaIdKey('srcB', 'K1')
    expect(hitsB).toHaveLength(1)
    expect(hitsB[0].id).toBe('c2')
  })
  it('timelineByBook returns sorted by borrowedAt', async () => {
    const r = createRepositories(db)
    const t1 = new Date('2025-01-01T00:00:00Z')
    const t2 = new Date('2025-02-01T00:00:00Z')
    const t3 = new Date('2025-03-01T00:00:00Z')
    await r.borrowCycles.bulkPut([
      makeCycle('c2', 'b1', 'srcA', t2) as BorrowCycle,
      makeCycle('c1', 'b1', 'srcA', t1) as BorrowCycle,
      makeCycle('c3', 'b1', 'srcA', t3) as BorrowCycle,
      makeCycle('x', 'b9', 'srcA', t1) as BorrowCycle,
    ])
    const tl = await r.borrowCycles.timelineByBook('b1')
    expect(tl.map((c) => c.id)).toEqual(['c1', 'c2', 'c3'])
  })
  it('findBorrowed returns only active borrows', async () => {
    const r = createRepositories(db)
    await r.borrowCycles.bulkPut([
      makeCycle('c1', 'b1', 'srcA', new Date('2025-01-01T00:00:00Z'), 'borrowed') as BorrowCycle,
      makeCycle('c2', 'b1', 'srcA', new Date('2025-01-02T00:00:00Z'), 'returned') as BorrowCycle,
    ])
    const active = await r.borrowCycles.findBorrowed()
    expect(active).toHaveLength(1)
    expect(active[0].id).toBe('c1')
  })
  it('SourceRepository.findByParserId hits unique index', async () => {
    const r = createRepositories(db)
    await r.sources.put(makeSource())
    expect((await r.sources.findByParserId('pid-src-sz'))?.id).toBe('src-sz')
  })
})
