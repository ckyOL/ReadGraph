import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import { ReadGraphDB } from '@/db/db'
import { resetDatabase } from '@/db/reset'
import {
  createTestDB, closeTestDB, now,
  makeBook, makeCatalog, makeCycle, makeImportLog, makeRawRecord, makeSource,
} from '@/db/test-helpers'
import { uuid } from '@/db/uuid'
import { readPreferences } from '@/lib/preferences'

let db: ReadGraphDB
beforeEach(() => { db = createTestDB() })
afterEach(async () => { await closeTestDB(db) })

async function seedAll(d: ReadGraphDB): Promise<void> {
  const srcId = 'src'
  await d.sources.put(makeSource(srcId))
  await d.books.put(makeBook('b1', '9787000000001', 'T'))
  await d.catalogRecords.put(
    makeCatalog('cr1', 'b1', srcId, 'BC1', 'K1', [{ system: 'clc', code: 'TP312' }]),
  )
  await d.borrowCycles.put(makeCycle('cyc1', 'b1', srcId, now()))
  await d.rawRecords.put(makeRawRecord(uuid(), 'log1', srcId))
  await d.importLogs.put(makeImportLog('log1', srcId))
}

function makeStorage(store: Map<string, string>): Storage {
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    length: store.size,
  } as Storage
}

describe('resetDatabase', () => {
  it('clears all six tables in a single transaction', async () => {
    await seedAll(db)
    for (const t of db.tables) expect(await t.count()).toBeGreaterThan(0)
    await resetDatabase(db)
    for (const t of db.tables) expect(await t.count()).toBe(0)
  })
  it('Dexie rw transaction rolls back on throw, leaving all tables intact (explains resetDatabase atomicity)', async () => {
    await seedAll(db)
    const before = await Promise.all(db.tables.map((t) => t.count()))
    await expect(
      db.transaction(
        'rw',
        db.tables.map((t) => t.name),
        async () => {
          await db.books.clear()
          await db.catalogRecords.clear()
          throw new Error('abort-mid-clear')
        },
      ),
    ).rejects.toThrow('abort-mid-clear')
    const after = await Promise.all(db.tables.map((t) => t.count()))
    const names = db.tables.map((t) => t.name)
    for (let i = 0; i < names.length; i++) {
      expect(after[i]).toBe(before[i])
    }
  })
  it('clears readgraph:* localStorage keys when clearPreferences is set', async () => {
    const store = new Map<string, string>([
      ['readgraph:preferences', '{"locale":"zh-CN"}'],
      ['readgraph:db-version', '1'],
      ['unrelated', 'keep'],
    ])
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = makeStorage(store)
    await resetDatabase(db, { clearPreferences: true })
    expect(store.get('readgraph:preferences')).toBeUndefined()
    expect(store.get('readgraph:db-version')).toBeUndefined()
    expect(store.get('unrelated')).toBe('keep')
  })
  it('clears the ai api key and ai preferences when clearPreferences is set', async () => {
    const store = new Map<string, string>([
      ['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', ai: { enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o' } })],
      ['readgraph:ai-api-key', JSON.stringify('sk-secret')],
      ['unrelated', 'keep'],
    ])
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = makeStorage(store)
    await resetDatabase(db, { clearPreferences: true })
    expect(store.get('readgraph:preferences')).toBeUndefined()
    expect(store.get('readgraph:ai-api-key')).toBeUndefined()
    expect(store.get('unrelated')).toBe('keep')
  })

  it('preserves the ai api key and ai preferences when clearPreferences is not set', async () => {
    const prefs = JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', ai: { enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o' } })
    const key = JSON.stringify('sk-secret')
    const store = new Map<string, string>([
      ['readgraph:preferences', prefs],
      ['readgraph:ai-api-key', key],
    ])
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = makeStorage(store)
    await resetDatabase(db, {})
    expect(store.get('readgraph:preferences')).toBe(prefs)
    expect(store.get('readgraph:ai-api-key')).toBe(key)
  })

  it('clears annualGoals along with preferences when clearPreferences is set', async () => {
    const store = new Map<string, string>([
      ['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', annualGoals: { 2025: 10, 2026: 12 } })],
    ])
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = makeStorage(store)
    await resetDatabase(db, { clearPreferences: true })
    expect(store.get('readgraph:preferences')).toBeUndefined()
    expect(readPreferences().annualGoals).toEqual({})
  })

  it('preserves annualGoals when clearPreferences is not set', async () => {
    const prefs = JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', annualGoals: { 2025: 10, 2026: 12 } })
    const store = new Map<string, string>([['readgraph:preferences', prefs]])
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = makeStorage(store)
    await resetDatabase(db, {})
    expect(store.get('readgraph:preferences')).toBe(prefs)
    expect(readPreferences().annualGoals).toEqual({ 2025: 10, 2026: 12 })
  })
})
