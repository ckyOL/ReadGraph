import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import { ReadGraphDB } from '@/db/db'
import { exportDatabase, importDatabase, EXPORT_VERSION } from '@/db/export-import'
import {
  createTestDB, closeTestDB, now,
  makeBook, makeCatalog, makeCycle, makeImportLog, makeRawRecord, makeSource,
} from '@/db/test-helpers'
import { uuid } from '@/db/uuid'
import { getParser } from '@/parsers/registry'
import { importPipeline, type ImportMeta } from '@/parsers/pipeline'
import { buildRawRecords } from '@/import/run-import'
import sample from '@/tests/fixtures/szlib-sample.json'
import type { ExportData, Source } from '@/types/entities'

let db: ReadGraphDB
beforeEach(() => { db = createTestDB() })
afterEach(async () => { await closeTestDB(db) })

async function seedAll(d: ReadGraphDB): Promise<void> {
  const srcId = 'src-sz'
  await d.sources.put(makeSource(srcId))
  await d.books.put(makeBook('b1', '9787000000001', 'T'))
  // 编目 id 与 makeCycle 派生的 catalogRecordId（`cr-${id}`）对齐，满足参照完整性。
  await d.catalogRecords.put(
    makeCatalog('cr-cyc1', 'b1', srcId, 'BC1', 'K1', [{ system: 'clc', code: 'TP312' }]),
  )
  await d.borrowCycles.put(makeCycle('cyc1', 'b1', srcId, now()))
  await d.rawRecords.put(makeRawRecord(uuid(), 'log1', srcId))
  await d.importLogs.put(makeImportLog('log1', srcId))
}

/** Date 按 getTime 比较的深等价（ExportData 实体含 Date 实例）。 */
function deepEqualDates(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((x, i) => deepEqualDates(x, b[i]))
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>)
    const kb = Object.keys(b as Record<string, unknown>)
    if (ka.length !== kb.length) return false
    return ka.every((k) =>
      deepEqualDates(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
      ),
    )
  }
  return false
}

/** 剥离每次导出都不同的 exportedAt（导出时间戳不属重放契约）。
 * classCodes 为索引派生字段，恢复路径统一补写——旧快照/构造数据不含该字段，
 * 深比较前归一（内容等价不依赖派生字段）。
 * 实体数组按 id 排序：Dexie toArray 按主键序，导出快照按插入序，
 * 深比较前归一顺序（内容等价不依赖顺序）。 */
function sortById<T extends { id: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function bodyOf(e: ExportData): Omit<ExportData, 'exportedAt'> {
  const { exportedAt: _exportedAt, ...rest } = e
  return {
    ...rest,
    sources: sortById(rest.sources),
    rawRecords: sortById(rest.rawRecords),
    books: sortById(rest.books),
    catalogRecords: sortById(rest.catalogRecords).map(({ classCodes: _classCodes, ...cr }) => cr),
    borrowCycles: sortById(rest.borrowCycles),
    importLogs: sortById(rest.importLogs),
  }
}

/** szlib 可用来源（parserId 必须命中默认注册表）。 */
function makeSzSource(): Source {
  return { ...makeSource('src-szlib'), parserId: 'szlib', name: '深圳图书馆' }
}

/** 经真实管线跑一遍脱敏 szlib 样本，产出一份可回放的 ExportData。 */
function buildReplayableExport(): ExportData {
  const source = makeSzSource()
  const meta: ImportMeta = {
    id: 'log-1',
    fileName: 'szlib-sample.json',
    fileSize: JSON.stringify(sample).length,
    detectedEncoding: 'utf-8',
    importedAt: new Date('2026-07-07T00:00:00.000Z'),
  }
  const rows = buildRawRecords(sample as Record<string, unknown>[], meta, source.id)
  const result = importPipeline(
    rows,
    source,
    getParser('szlib'),
    { books: [], catalogRecords: [], borrowCycles: [] },
    meta,
  )
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date('2026-07-08T00:00:00.000Z'),
    sources: [source],
    // 用管线产出的回填后克隆（L9：管线不再变异入参 rows）。
    rawRecords: result.rawRecords,
    books: result.books,
    catalogRecords: result.catalogRecords,
    borrowCycles: result.borrowCycles,
    importLogs: [result.importLog],
  }
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
    // classCodes 派生字段由恢复路径补写（旧备份/校验后对象不含该字段，索引查询依赖它）。
    expect(re.catalogRecords[0]!.classCodes).toEqual(['TP312'])
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
})

describe('importDatabase replay（settings 规格 §4/§9-5：rawRecords 重放重建）', () => {
  it('从 sources + rawRecords 重放重建派生数据，与旧快照等价', async () => {
    const exportData = buildReplayableExport()
    // JSON 往返：模拟外部备份文件（Date → ISO 串）。
    const fileText = JSON.stringify(exportData)
    await importDatabase(db, JSON.parse(fileText), { mode: 'replay' })

    const rebuilt = await exportDatabase(db)
    expect(rebuilt.books).toHaveLength(exportData.books.length)
    expect(rebuilt.catalogRecords).toHaveLength(exportData.catalogRecords.length)
    expect(rebuilt.borrowCycles).toHaveLength(exportData.borrowCycles.length)
    expect(rebuilt.rawRecords).toHaveLength(exportData.rawRecords.length)
    expect(rebuilt.importLogs).toHaveLength(exportData.importLogs.length)
    expect(deepEqualDates(bodyOf(rebuilt), bodyOf(exportData))).toBe(true)
    // 重放重建同样补写 classCodes 派生字段（treemap 下钻等 classCodes 索引查询依赖）。
    for (const cr of rebuilt.catalogRecords) {
      expect(cr.classCodes).toEqual(cr.classifications.map((c) => c.code))
    }
    // 实体时间锚取 ImportLog.importedAt（不得读 Date.now()）：书目 createdAt 即导入锚点。
    expect(rebuilt.books[0]?.createdAt).toEqual(new Date('2026-07-07T00:00:00.000Z'))
  })

  it('同一 (sources, rawRecords) 两次重放产出深等价派生数据（确定性）', async () => {
    const exportData = buildReplayableExport()
    const fileText = JSON.stringify(exportData)

    const dbA = createTestDB()
    const dbB = createTestDB()
    try {
      await importDatabase(dbA, JSON.parse(fileText), { mode: 'replay' })
      await importDatabase(dbB, JSON.parse(fileText), { mode: 'replay' })
      const a = await exportDatabase(dbA)
      const b = await exportDatabase(dbB)
      expect(deepEqualDates(bodyOf(a), bodyOf(b))).toBe(true)
      expect(await dbA.books.count()).toBe(await dbB.books.count())
    } finally {
      await closeTestDB(dbA)
      await closeTestDB(dbB)
    }
  })

  it('重放失败（来源缺失）时拒绝且不触碰既有数据', async () => {
    await seedAll(db)
    const before = await exportDatabase(db)
    const exportData = buildReplayableExport()
    exportData.sources = [] // rawRecords 引用的来源缺失
    await expect(
      importDatabase(db, JSON.parse(JSON.stringify(exportData)), { mode: 'replay' }),
    ).rejects.toThrow(/source/)
    // 库保持原状（校验先于任何写操作）。
    const after = await exportDatabase(db)
    expect(deepEqualDates(bodyOf(after), bodyOf(before))).toBe(true)
  })

  it('重放失败（parser 未注册）时拒绝且不触碰既有数据', async () => {
    await seedAll(db)
    const before = await exportDatabase(db)
    const exportData = buildReplayableExport()
    exportData.sources = [{ ...exportData.sources[0]!, parserId: 'no-such-parser' }]
    await expect(
      importDatabase(db, JSON.parse(JSON.stringify(exportData)), { mode: 'replay' }),
    ).rejects.toThrow(/parser/)
    expect(deepEqualDates(bodyOf(await exportDatabase(db)), bodyOf(before))).toBe(true)
  })
})

describe('importDatabase — 参照完整性（M2/M3 回归）', () => {
  it('snapshot：孤儿 bookId 的编目拒绝入库，且不触碰既有数据', async () => {
    await seedAll(db)
    const data = JSON.parse(JSON.stringify(await exportDatabase(db))) as ExportData
    data.catalogRecords[0]!.bookId = 'bk-ghost'
    await expect(importDatabase(db, data, { mode: 'snapshot' })).rejects.toThrow(
      /unknown book/,
    )
    // 校验先于清库：既有数据保持原样（M2：坏数据不得成为唯一状态）。
    expect(await db.books.count()).toBe(1)
    expect(await db.catalogRecords.count()).toBe(1)
  })

  it('snapshot：孤儿 catalogRecordId 的周期拒绝入库', async () => {
    await seedAll(db)
    const data = JSON.parse(JSON.stringify(await exportDatabase(db))) as ExportData
    data.borrowCycles[0]!.catalogRecordId = 'cr-ghost'
    await expect(importDatabase(db, data, { mode: 'snapshot' })).rejects.toThrow(
      /unknown catalogRecord/,
    )
  })

  it('snapshot：孤儿 sourceId（importLog）拒绝入库', async () => {
    await seedAll(db)
    const data = JSON.parse(JSON.stringify(await exportDatabase(db))) as ExportData
    data.importLogs[0]!.sourceId = 'src-ghost'
    await expect(importDatabase(db, data, { mode: 'snapshot' })).rejects.toThrow(
      /unknown source/,
    )
  })

  it('replay：rawRecord.sourceId 与 ImportLog.sourceId 不一致 → 拒绝（M3 不静默归错来源）', async () => {
    await seedAll(db)
    const before = await exportDatabase(db)
    const exportData = buildReplayableExport()
    exportData.rawRecords[0]!.sourceId = 'src-other'
    await expect(
      importDatabase(db, JSON.parse(JSON.stringify(exportData)), { mode: 'replay' }),
    ).rejects.toThrow(/does not match importLog/)
    expect(deepEqualDates(bodyOf(await exportDatabase(db)), bodyOf(before))).toBe(true)
  })

  it('replay：空批次 ImportLog 保留（与 snapshot 恢复结果一致，M3）', async () => {
    const exportData = buildReplayableExport()
    // 空批次：有 ImportLog、无对应 rawRecords（导入文件全被行级过滤剔除的产物）。
    const emptyLog = {
      ...exportData.importLogs[0]!,
      id: 'log-empty',
      fileName: 'empty.json',
    }
    const data = JSON.parse(JSON.stringify(exportData)) as ExportData
    data.importLogs.push(emptyLog)
    await importDatabase(db, data, { mode: 'replay' })
    const logs = await db.importLogs.toArray()
    expect(logs.map((l) => l.id).sort()).toEqual(['log-1', 'log-empty'].sort())
  })
})

describe('导出后重置库为空（S-3 对齐 reset.test.ts）', () => {
  it('seed → export → resetDatabase → 六表全空', async () => {
    await seedAll(db)
    const exported = await exportDatabase(db)
    expect(exported.sources).toHaveLength(1)
    const { resetDatabase } = await import('@/db/reset')
    await resetDatabase(db)
    for (const t of db.tables) expect(await t.count()).toBe(0)
  })
})
