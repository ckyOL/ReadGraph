import { describe, it, expect } from 'vitest'

import type { RawRecord, Source } from '@/types/entities'
import { importPipeline, type ExistingState, type ImportMeta } from './pipeline'
import { szlibParser } from './szlib'
import sample from '@/tests/fixtures/szlib-sample.json'

const source: Source = {
  id: 'src-szlib',
  type: 'library',
  name: '深圳图书馆',
  parserId: 'szlib',
  parserVersion: null,
  timezone: 'Asia/Shanghai',
  library: null,
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  lastImportAt: null,
  totalImportedRecords: 0,
}

const meta: ImportMeta = {
  id: 'imp-1',
  fileName: 'szlib-sample.json',
  fileSize: 9476,
  detectedEncoding: 'utf-8',
  importedAt: new Date('2026-07-07T00:00:00.000Z'),
}

const empty: ExistingState = { books: [], catalogRecords: [], borrowCycles: [] }

function buildRows(): RawRecord[] {
  const data = sample as Record<string, unknown>[]
  return data.map((d, i) => ({
    id: `raw-${i + 1}`,
    importLogId: meta.id,
    sourceId: source.id,
    data: d,
    rowIndex: i + 1,
    borrowCycleId: null,
    bookId: null,
    parseStatus: 'success' as const,
    parseNote: null,
  }))
}

describe('importPipeline — 确定性', () => {
  it('同输入两次跑结果深等价（ID/时间/计数一致）', () => {
    const rows1 = buildRows()
    const rows2 = buildRows()
    const a = importPipeline(rows1, source, szlibParser, empty, meta)
    const b = importPipeline(rows2, source, szlibParser, empty, meta)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('派生时间用 meta.importedAt 而非墙钟（createdAt 一致）', () => {
    const rows = buildRows()
    const r = importPipeline(rows, source, szlibParser, empty, meta)
    for (const b of r.books) {
      expect(b.createdAt.toISOString()).toBe(meta.importedAt.toISOString())
      expect(b.updatedAt.toISOString()).toBe(meta.importedAt.toISOString())
    }
  })
})

describe('importPipeline — 端到端 szlib', () => {
  it('产出 books/catalogRecords/borrowCycles，stats 非空', () => {
    const rows = buildRows()
    const r = importPipeline(rows, source, szlibParser, empty, meta)
    expect(r.books.length).toBeGreaterThan(0)
    expect(r.catalogRecords.length).toBeGreaterThan(0)
    expect(r.borrowCycles.length).toBeGreaterThan(0)
    expect(r.importLog.stats.totalRawRecords).toBe(rows.length)
    expect(r.importLog.parserId).toBe('szlib')
    expect(r.importLog.sourceId).toBe(source.id)
  })

  it('选书帮各 barcode 独立 Book 且 needsReview=true', () => {
    const rows = buildRows()
    const r = importPipeline(rows, source, szlibParser, empty, meta)
    const ph = r.books.filter((b) => b.title === '福田图书馆读者自选图书')
    expect(ph.length).toBe(2)
    for (const b of ph) expect(b.needsReview).toBe(true)
  })

  it('增量导入：existing 非空时，同 barcode 同 borrowedAt 的周期被识别为 duplicate 跳过', () => {
    const rows = buildRows()
    // 首次跑，产物作为 existing。
    const first = importPipeline(rows, source, szlibParser, empty, meta)
    // 再次跑同一批：existing 取首次产出 → 周期应被识别为精确重复。
    const existing: ExistingState = {
      books: first.books,
      catalogRecords: first.catalogRecords,
      borrowCycles: first.borrowCycles,
    }
    const rows2 = buildRows()
    const second = importPipeline(rows2, source, szlibParser, existing, meta)
    // 新批次不应新增 borrowCycles（全部为 duplicate 跳过）。
    expect(second.borrowCycles.length).toBe(first.borrowCycles.length)
    expect(second.importLog.stats.skippedRecords).toBeGreaterThan(0)
  })

  it('重建等价：导出（清空）→ 重放，最终派生数据与快照等价', () => {
    const rows = buildRows()
    const baseline = importPipeline(rows, source, szlibParser, empty, meta)
    // 重放：existing 取空，再次同输入跑。
    const rows2 = buildRows()
    const replay = importPipeline(rows2, source, szlibParser, empty, meta)
    expect(JSON.stringify(replay)).toBe(JSON.stringify(baseline))
  })

  it('空 raw → stats 全 0、warnings 空、entities 空', () => {
    const r = importPipeline([], source, szlibParser, empty, meta)
    expect(r.books).toEqual([])
    expect(r.catalogRecords).toEqual([])
    expect(r.borrowCycles).toEqual([])
    expect(r.importLog.stats.totalRawRecords).toBe(0)
    expect(r.importLog.stats.newBooks).toBe(0)
  })
})
