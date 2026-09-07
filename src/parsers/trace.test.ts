// 导入决策 trace 收集测试（debug-mode spec §8）：七场景决策正确性 + 确定性 +
// 默认关闭。夹具复用 szlib-sample.json（合成数据）。
import { describe, expect, it } from 'vitest'

import type { RawRecord, Source } from '@/types/entities'
import { importPipeline, type ExistingState, type ImportMeta } from './pipeline'
import { szlibParser } from './szlib'
import type { ImportTrace } from './trace'
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

/** 开 trace 跑管线（verbose 可选）。 */
function runTrace(
  rows: RawRecord[],
  existing: ExistingState = empty,
  verbose = false,
) {
  return importPipeline(rows, source, szlibParser, existing, meta, {
    verbose,
  })
}

/** 按 rowIndex 查 trace 行。 */
function rowOf(trace: ImportTrace, rowIndex: number) {
  const row = trace.rows.find((r) => r.rowIndex === rowIndex)
  if (!row) throw new Error(`trace row ${rowIndex} not found`)
  return row
}

describe('importPipeline trace — 决策正确性（§8 场景）', () => {
  it('场景 1 首次导入：有效行 new-book，实体 ID 与管线产物一致', () => {
    const r = runTrace(buildRows())
    const trace = r.trace!
    // 行 4（借出 6092919 书）：新建书 + 周期 created。
    const row4 = rowOf(trace, 4)
    expect(row4.decision).toBe('new-book')
    expect(row4.status).toBe('imported')
    // bookId 为管线真实 id（bk- 派生，非 new: token）。
    expect(row4.bookId).toMatch(/^bk-/)
    expect(r.books.some((b) => b.id === row4.bookId)).toBe(true)
    // 周期行（行 1 还回 + 行 4 借出合成一周期）：两行都挂 borrowCycleId。
    const row1 = rowOf(trace, 1)
    expect(row1.decision).toBe('new-book')
    expect(row1.borrowCycleId).toMatch(/^cy-/)
    const cyc = r.borrowCycles.find((c) => c.id === row1.borrowCycleId)
    expect(cyc).toBeDefined()
    expect(row4.borrowCycleId).toBe(row1.borrowCycleId)
    expect(row1.catalogRecordId).toMatch(/^cr-/)
    // entityDelta：新建书含该书。
    expect(trace.entityDelta.newBooks).toContain(row4.bookId!)
    expect(trace.entityDelta.newBorrowCycles).toContain(row1.borrowCycleId!)
  })

  it('场景 2 增量重导同文件：重复周期行 cycle-skipped-duplicate、status skipped', () => {
    const first = runTrace(buildRows())
    const existing: ExistingState = {
      books: first.books,
      catalogRecords: first.catalogRecords,
      borrowCycles: first.borrowCycles,
    }
    const second = runTrace(buildRows(), existing)
    const trace = second.trace!
    // 行 1（还回 F4401001911110）所属周期在首次导入已闭合 → 精确重复跳过。
    const row1 = rowOf(trace, 1)
    expect(row1.decision).toBe('cycle-skipped-duplicate')
    expect(row1.status).toBe('skipped')
    // 溯源语义：跳过行记录其归属的既有周期 id。
    expect(
      first.borrowCycles.some((c) => c.id === row1.borrowCycleId),
    ).toBe(true)
    expect(trace.entityDelta.skippedRows.length).toBe(
      second.importLog.stats.skippedRecords,
    )
    expect(trace.entityDelta.skippedRows).toContain(1)
  })

  it('场景 3 增量同 ISBN 不同条码：merged-book-isbn，bookId 复用既有', () => {
    const first = runTrace(buildRows())
    const existing: ExistingState = {
      books: first.books,
      catalogRecords: first.catalogRecords,
      borrowCycles: first.borrowCycles,
    }
    // 新批次：同 ISBN（978-7-5217-4823-9）但新条码+新 metaid → 编目不命中、
    // ISBN 命中既有书（merged-book-isbn）。
    const rows: RawRecord[] = [
      {
        id: 'raw-new-1',
        importLogId: 'imp-2',
        sourceId: source.id,
        data: {
          date: '20260701',
          time: '10:00:00',
          optype: '读者借出',
          cirtype: '大学城中文图书',
          metatable: 'bibliosm',
          metaid: 6093000,
          title: '合成书目001 = Synthetic title 1/ 合成著者1著',
          ISBN: '978-7-5217-4823-9',
          barcode: 'F4401001777001',
        },
        rowIndex: 1,
        borrowCycleId: null,
        bookId: null,
        parseStatus: 'success',
        parseNote: null,
      },
    ]
    const second = runTrace(rows, existing)
    const trace = second.trace!
    const row1 = rowOf(trace, 1)
    expect(row1.decision).toBe('merged-book-isbn')
    expect(row1.status).toBe('imported')
    const isbnBook = first.books.find((b) => b.isbn13 === '9787521748239')
    expect(isbnBook).toBeDefined()
    expect(row1.bookId).toBe(isbnBook!.id)
    // US2：mergedBooks 列出被并入的既有 Book id。
    expect(trace.entityDelta.mergedBooks).toContain(isbnBook!.id)
    expect(trace.entityDelta.newBooks).not.toContain(row1.bookId!)
  })

  it('场景 4 无 ISBN 同题名作者：merged-book-fuzzy + warningType duplicate', () => {
    // 首次：无 ISBN 书（合成书目003，行 5 还回、条码空）。
    const first = runTrace(buildRows())
    const fuzzyBook = first.books.find(
      (b) => b.title.includes('合成书目003') && b.isbn13 === null,
    )
    expect(fuzzyBook).toBeDefined()
    const existing: ExistingState = {
      books: first.books,
      catalogRecords: first.catalogRecords,
      borrowCycles: first.borrowCycles,
    }
    // 新批次：同题同著者、无 ISBN、新 metaid。
    const rows: RawRecord[] = [
      {
        id: 'raw-new-2',
        importLogId: 'imp-3',
        sourceId: source.id,
        data: {
          date: '20260701',
          time: '11:00:00',
          optype: '读者借出',
          cirtype: '大学城中文图书',
          metatable: 'bibliosm',
          metaid: 8000001,
          title: '合成书目003/ 合成著者3著',
          barcode: 'F4401001888888',
        },
        rowIndex: 1,
        borrowCycleId: null,
        bookId: null,
        parseStatus: 'success',
        parseNote: null,
      },
    ]
    const second = runTrace(rows, existing)
    const trace = second.trace!
    const row1 = rowOf(trace, 1)
    expect(row1.decision).toBe('merged-book-fuzzy')
    expect(row1.bookId).toBe(fuzzyBook!.id)
    expect(row1.warningType).toBe('duplicate')
    expect(trace.entityDelta.mergedBooks).toContain(fuzzyBook!.id)
  })

  it('场景 5 选书帮占位：placeholder-isolated，各 barcode 独立 bookId', () => {
    const r = runTrace(buildRows())
    const trace = r.trace!
    const row6 = rowOf(trace, 6)
    const row7 = rowOf(trace, 7)
    expect(row6.decision).toBe('placeholder-isolated')
    expect(row7.decision).toBe('placeholder-isolated')
    expect(row6.bookId).toMatch(/^bk-/)
    expect(row7.bookId).toMatch(/^bk-/)
    // 占位行回填的 bookId 与管线 rawRecords.bookId 一致（既有限制：占位行
    // metaid 相同时按 metaid 消歧 last-wins；trace 如实记录管线行为）。
    const rr6 = r.rawRecords.find((x) => x.rowIndex === 6)!
    const rr7 = r.rawRecords.find((x) => x.rowIndex === 7)!
    expect(row6.bookId).toBe(rr6.bookId)
    expect(row7.bookId).toBe(rr7.bookId)
    // 占位独立书不入 mergedBooks（US2 口径）。
    expect(trace.entityDelta.mergedBooks).not.toContain(row6.bookId!)
  })

  it('场景 6 非法日期行：warningType invalid_date、status warning', () => {
    const r = runTrace(buildRows())
    const trace = r.trace!
    // 行 22 date=20260230 → parser invalid_date 警告。
    const row22 = rowOf(trace, 22)
    expect(row22.warningType).toBe('invalid_date')
    expect(row22.status).toBe('warning')
    expect(row22.decision).toBe('new-book')
    expect(row22.borrowCycleId).toBeNull()
  })

  it('场景 7 format_error 行：row-error、status error、无实体产出', () => {
    const rows = buildRows().slice(0, 1)
    rows.push({
      id: 'raw-err',
      importLogId: meta.id,
      sourceId: source.id,
      data: {
        date: '20260601',
        time: '09:00:00',
        optype: '未知操作',
        title: '合成书目Err/ 作者E著',
        barcode: 'F4401001777777',
      },
      rowIndex: 2,
      borrowCycleId: null,
      bookId: null,
      parseStatus: 'success',
      parseNote: null,
    })
    const r = runTrace(rows)
    const trace = r.trace!
    const row2 = rowOf(trace, 2)
    expect(row2.decision).toBe('row-error')
    expect(row2.status).toBe('error')
    expect(row2.warningType).toBe('format_error')
    expect(row2.bookId).toBeNull()
    expect(row2.borrowCycleId).toBeNull()
  })

  it('unpaired_record（时间重叠）行：cycle-unpaired', () => {
    // 首次导入：行 1（还回）+行 4（借出）→ 闭合周期 0620~0630。
    const first = runTrace(buildRows())
    const existing: ExistingState = {
      books: first.books,
      catalogRecords: first.catalogRecords,
      borrowCycles: first.borrowCycles,
    }
    // 新批次：同 barcode/metaid 在既有闭合周期（0620~0630）内再借出
    // （0625 落在开区间）→ 时间重叠警告、周期仍建。
    const rows: RawRecord[] = [
      {
        id: 'raw-new-3',
        importLogId: 'imp-4',
        sourceId: source.id,
        data: {
          date: '20260625',
          time: '12:00:00',
          optype: '读者借出',
          cirtype: '大学城中文图书',
          metatable: 'bibliosm',
          metaid: 6092919,
          title: '合成书目001 = Synthetic title 1/ 合成著者1著',
          ISBN: '978-7-5217-4823-9',
          barcode: 'F4401001911110',
        },
        rowIndex: 1,
        borrowCycleId: null,
        bookId: null,
        parseStatus: 'success',
        parseNote: null,
      },
    ]
    const second = runTrace(rows, existing)
    const trace = second.trace!
    const row1 = rowOf(trace, 1)
    expect(row1.decision).toBe('cycle-unpaired')
    expect(row1.warningType).toBe('unpaired_record')
    expect(row1.status).toBe('warning')
    // 周期仍被创建。
    expect(row1.borrowCycleId).toMatch(/^cy-/)
  })
})

describe('importPipeline trace — 确定性与默认关闭', () => {
  it('同输入两次跑 trace 深等价（排除 durationMs）', () => {
    const a = runTrace(buildRows()).trace!
    const b = runTrace(buildRows()).trace!
    const { durationMs: _da, ...ra } = a
    const { durationMs: _db, ...rb } = b
    expect(JSON.stringify(ra)).toBe(JSON.stringify(rb))
    // durationMs 纯函数内恒 null（装配层填写）。
    expect(a.durationMs).toBeNull()
    expect(b.durationMs).toBeNull()
  })

  it('默认关闭：不传 traceOptions → trace === null', () => {
    const r = importPipeline(buildRows(), source, szlibParser, empty, meta)
    expect(r.trace).toBeNull()
  })

  it('verbose:false → 有 trace 且 rows 与 rawRecords 按 rowIndex 对齐', () => {
    const r = runTrace(buildRows())
    const trace = r.trace!
    expect(trace.rows).toHaveLength(r.rawRecords.length)
    for (const rr of r.rawRecords) {
      const tr = trace.rows.find((t) => t.rowIndex === rr.rowIndex)
      expect(tr).toBeDefined()
      expect(tr!.rawRecordId).toBe(rr.id)
    }
    // 行 status 与 rawRecord.parseStatus 一致（success/skipped/warning/error 映射）。
    for (const rr of r.rawRecords) {
      const tr = rowOf(trace, rr.rowIndex)
      const expected =
        rr.parseStatus === 'success'
          ? 'imported'
          : rr.parseStatus === 'skipped'
            ? 'skipped'
            : rr.parseStatus
      expect(tr.status).toBe(expected)
    }
  })

  it('verbose:true → 命中派生 ID 的行补 idDerivation；非 verbose 不分配', () => {
    const quiet = runTrace(buildRows()).trace!
    expect(quiet.rows.every((t) => t.idDerivation === undefined)).toBe(true)
    const verbose = runTrace(buildRows(), empty, true).trace!
    const derived = verbose.rows.filter((t) => t.idDerivation !== undefined)
    expect(derived.length).toBeGreaterThan(0)
    // 推导串口径：cr-/bk- 前缀 + fnv1a32(派生输入)（spec §7 会话态细化）。
    for (const t of derived) {
      expect(t.idDerivation).toMatch(/^(cr|bk)-\{fnv1a32\(.+\)\}$/)
    }
    // 除 idDerivation 外，verbose 与非 verbose trace 相同（确定性不破坏）。
    const strip = (t: ImportTrace) =>
      JSON.stringify({ ...t, rows: t.rows.map(({ idDerivation: _i, ...r }) => r) })
    expect(strip(verbose)).toBe(strip(quiet))
  })

  it('trace 头部字段与 meta/source 一致；warnings 为扁平数组', () => {
    const r = runTrace(buildRows())
    const trace = r.trace!
    expect(trace.importLogId).toBe(meta.id)
    expect(trace.sourceId).toBe(source.id)
    expect(trace.parserId).toBe(source.parserId)
    expect(trace.importedAt).toBe(meta.importedAt)
    expect(trace.fileName).toBe(meta.fileName)
    expect(trace.fileSize).toBe(meta.fileSize)
    expect(trace.detectedEncoding).toBe(meta.detectedEncoding)
    expect(trace.stats).toEqual(r.importLog.stats)
    expect(trace.warnings).toEqual(r.importLog.warnings)
  })

  it('newCatalogRecords / newBorrowCycles 与管线产物计数一致', () => {
    const r = runTrace(buildRows())
    const trace = r.trace!
    expect(trace.entityDelta.newCatalogRecords.length).toBe(
      r.catalogRecords.length,
    )
    expect(trace.entityDelta.newBorrowCycles.length).toBe(
      r.borrowCycles.length,
    )
    expect(trace.entityDelta.newBooks.length).toBe(r.books.length)
  })
})
