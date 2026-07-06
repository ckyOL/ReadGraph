import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import { ReadGraphDB } from '@/db/db'
import { createRepositories } from '@/db/repositories'
import type { Book, BorrowCycle, CatalogRecord } from '@/types/entities'
import {
  createTestDB, closeTestDB,
  makeBook, makeCatalog, makeCycle, makeSource,
} from '@/db/test-helpers'

let db: ReadGraphDB
beforeEach(() => { db = createTestDB() })
afterEach(async () => { await closeTestDB(db) })

describe('DB schema', () => {
  it('exposes six tables', () => {
    expect([...db.tables.map((t) => t.name)].sort()).toEqual(
      ['books', 'borrowCycles', 'catalogRecords', 'importLogs', 'rawRecords', 'sources'].sort(),
    )
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
