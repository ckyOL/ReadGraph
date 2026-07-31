import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import type { ReadGraphDB } from '@/db/db'
import type { Source } from '@/types/entities'
import {
  closeTestDB,
  createTestDB,
  installFakeIndexedDB,
} from '@/db/test-helpers'
import { executeImport, buildRawRecords } from './run-import'
import type { ImportMeta } from '@/parsers/pipeline'
import sample from '@/tests/fixtures/szlib-sample.json'

installFakeIndexedDB()

const SOURCE: Source = {
  id: 'src-szlib',
  type: 'library',
  name: '深圳图书馆',
  parserId: 'szlib',
  parserVersion: '1.0.0',
  timezone: 'Asia/Shanghai',
  library: {
    libraryType: 'public',
    city: '深圳市',
    province: '广东省',
    website: null,
    opacUrl: null,
    classificationSystem: 'clc',
  },
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  lastImportAt: null,
  totalImportedRecords: 0,
}

let db: ReadGraphDB

beforeEach(async () => {
  db = createTestDB()
  await db.sources.put(SOURCE)
})

afterEach(() => {
  closeTestDB(db)
})

function request(overrides: Partial<Parameters<typeof executeImport>[1]> = {}) {
  const text = JSON.stringify(sample)
  return {
    fileName: 'szlib-sample.json',
    fileSize: text.length,
    detectedEncoding: 'utf-8',
    text,
    sourceId: SOURCE.id,
    ...overrides,
  }
}

describe('buildRawRecords', () => {
  it('预分配 id/importLogId/sourceId/rowIndex，data 保留原始键值', () => {
    const meta: ImportMeta = {
      id: 'log-1',
      fileName: 'x.json',
      fileSize: 1,
      detectedEncoding: 'utf-8',
      importedAt: new Date('2026-07-31T00:00:00.000Z'),
    }
    const rows = buildRawRecords(sample as Record<string, unknown>[], meta, SOURCE.id)
    expect(rows).toHaveLength(sample.length)
    const first = rows[0]!
    expect(first.importLogId).toBe('log-1')
    expect(first.sourceId).toBe(SOURCE.id)
    expect(first.rowIndex).toBe(1)
    expect(first.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.parseNote).toBeNull()
    // data 与原始行一致（含未知字段，供溯源）。
    expect(first.data).toEqual(sample[0])
    // id 唯一。
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length)
  })
})

describe('executeImport — 向导执行装配（G-5/G-6 单元契约）', () => {
  it('整批落库：books/catalogRecords/borrowCycles/importLogs/rawRecords', async () => {
    const result = await executeImport(db, request())
    expect(result.books.length).toBeGreaterThan(0)
    expect(result.catalogRecords.length).toBeGreaterThan(0)
    expect(result.borrowCycles.length).toBeGreaterThan(0)

    const books = await db.books.toArray()
    const catalogs = await db.catalogRecords.toArray()
    const cycles = await db.borrowCycles.toArray()
    const logs = await db.importLogs.toArray()
    const raws = await db.rawRecords.toArray()
    expect(books.length).toBe(result.books.length)
    expect(catalogs.length).toBe(result.catalogRecords.length)
    expect(cycles.length).toBe(result.borrowCycles.length)
    expect(logs).toHaveLength(1)
    expect(raws).toHaveLength(sample.length)
    expect(logs[0]!.stats.totalRawRecords).toBe(sample.length)
    expect(logs[0]!.parserId).toBe('szlib')

    // 来源最后导入时间与累计记录数回写。
    const updated = await db.sources.get(SOURCE.id)
    expect(updated!.lastImportAt).toBeInstanceOf(Date)
    expect(updated!.totalImportedRecords).toBe(logs[0]!.stats.newBorrowCycles)
  })

  it('同一文件再次导入：借阅周期去重跳过，书目不变，批次记录 +1', async () => {
    await executeImport(db, request())
    const cyclesBefore = (await db.borrowCycles.toArray()).length
    const booksBefore = (await db.books.toArray()).length

    const second = await executeImport(db, request())
    expect(second.importLog.stats.skippedRecords).toBeGreaterThan(0)
    expect(second.borrowCycles.length).toBe(cyclesBefore)
    expect(second.books.length).toBe(booksBefore)
  })

  it('来源不存在抛错', async () => {
    await expect(executeImport(db, request({ sourceId: 'nope' }))).rejects.toThrow()
  })

  it('非法 JSON 抛错且不写库', async () => {
    await expect(
      executeImport(db, request({ text: '{not json' })),
    ).rejects.toThrow()
    expect(await db.importLogs.count()).toBe(0)
    expect(await db.books.count()).toBe(0)
  })

  it('Parser 不匹配（非 szlib 形状）抛错', async () => {
    const other = JSON.stringify([{ foo: 'bar' }])
    await expect(executeImport(db, request({ text: other }))).rejects.toThrow()
    expect(await db.importLogs.count()).toBe(0)
  })

  it('空数组文件被 validate 拒绝（无内容可导入）', async () => {
    await expect(executeImport(db, request({ text: '[]' }))).rejects.toThrow()
    expect(await db.importLogs.count()).toBe(0)
  })
})
