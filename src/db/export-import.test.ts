import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import { ReadGraphDB } from '@/db/db'
import { exportDatabase, importDatabase } from '@/db/export-import'
import {
  createTestDB, closeTestDB, now,
  makeBook, makeCatalog, makeCycle, makeImportLog, makeRawRecord, makeSource,
} from '@/db/test-helpers'
import { uuid } from '@/db/uuid'

let db: ReadGraphDB
beforeEach(() => { db = createTestDB() })
afterEach(async () => { await closeTestDB(db) })

async function seedAll(d: ReadGraphDB): Promise<void> {
  const srcId = 'src-sz'
  await d.sources.put(makeSource(srcId))
  await d.books.put(makeBook('b1', '9787000000001', 'T'))
  await d.catalogRecords.put(
    makeCatalog('cr1', 'b1', srcId, 'BC1', 'K1', [{ system: 'clc', code: 'TP312' }]),
  )
  await d.borrowCycles.put(makeCycle('cyc1', 'b1', srcId, now()))
  await d.rawRecords.put(makeRawRecord(uuid(), 'log1', srcId))
  await d.importLogs.put(makeImportLog('log1', srcId))
}

describe('exportDatabase', () => {
  it('returns ExportData with all six arrays and version 1', async () => {
    await seedAll(db)
    const e = await exportDatabase(db)
    expect(e.version).toBe('1')
    expect(e.exportedAt).toBeInstanceOf(Date)
    expect(e.sources).toHaveLength(1)
    expect(e.books).toHaveLength(1)
    expect(e.catalogRecords).toHaveLength(1)
    expect(e.borrowCycles).toHaveLength(1)
    expect(e.rawRecords).toHaveLength(1)
    expect(e.importLogs).toHaveLength(1)
  })
  it('serializes Date as ISO via JSON.stringify', async () => {
    await seedAll(db)
    const str = JSON.stringify(await exportDatabase(db))
    expect(str).toContain(now().toISOString())
  })
})

describe('importDatabase snapshot', () => {
  it('round-trips: import then export is stable', async () => {
    await seedAll(db)
    const exported = JSON.parse(JSON.stringify(await exportDatabase(db))) as unknown
    await importDatabase(db, exported, { mode: 'snapshot' })
    const re = await exportDatabase(db)
    expect(re.books).toHaveLength(1)
    expect(re.borrowCycles).toHaveLength(1)
    expect(await db.books.count()).toBe(1)
  })
  it('overwrites existing data (reset + bulkPut)', async () => {
    await seedAll(db)
    // Add an extra book that will be preserved because export captures it then reset wipes.
    await db.books.put(makeBook('b2', '9787000000002', 'T'))
    expect(await db.books.count()).toBe(2)
    const exported = JSON.parse(JSON.stringify(await exportDatabase(db))) as unknown
    await importDatabase(db, exported, { mode: 'snapshot' })
    expect(await db.books.count()).toBe(2)
  })
  it('rejects unsupported version', async () => {
    await seedAll(db)
    const data = JSON.parse(JSON.stringify(await exportDatabase(db))) as { version: string }
    data.version = '999'
    await expect(importDatabase(db, data, { mode: 'snapshot' })).rejects.toThrow(/version/)
  })
  it('rejects when rawRecords field is missing entirely', async () => {
    const data = { version: '1', exportedAt: now().toISOString(), sources: [], books: [], catalogRecords: [], borrowCycles: [], importLogs: [] }
    await expect(importDatabase(db, data, { mode: 'snapshot' })).rejects.toThrow(/rawRecords/)
  })
  it('replay mode throws "not implemented" this milestone', async () => {
    await expect(importDatabase(db, { version: '1' }, { mode: 'replay' })).rejects.toThrow(/replay/)
  })
})
