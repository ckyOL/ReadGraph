import { describe, it, expect } from 'vitest'

import type { RawRecord, Source } from '@/types/entities'
import { importPipeline, type ExistingState, type ImportMeta } from './pipeline'
import { szlibParser } from './szlib'
import sample from '@/tests/fixtures/szlib-sample.json'

type SzRow = {
  date: string
  time: string
  optype: string
  metaid?: number
  title: string
  barcode: string
  ISBN?: string
  addr?: string
}

/** 构造一条 szlib 形状原始行（文件行序即数组序）。 */
function mkRow(p: SzRow): Record<string, unknown> {
  return { metatable: 'bibliosm', callno: '', ...p }
}

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

describe('importPipeline — 同 ISBN 多条码（一书多册）批内合并（回归）', () => {
  it('同批同 ISBN 两副本 → 一个 Book、两个 CatalogRecord，周期均挂同一 Book', () => {
    const rows = [
      mkRow({ date: '20260501', time: '10:00:00', optype: '读者借出', metaid: 9001, title: '合成书目052 . 3/ 合成著者著', barcode: 'B9001', ISBN: '978-7-5740-1274-5' }),
      mkRow({ date: '20260510', time: '10:00:00', optype: '读者还回文献', metaid: 9001, title: '合成书目052 . 3/ 合成著者著', barcode: 'B9001', ISBN: '978-7-5740-1274-5' }),
      mkRow({ date: '20260520', time: '10:00:00', optype: '读者借出', metaid: 9002, title: '合成书目053 . 4/ 合成著者著', barcode: 'B9002', ISBN: '978-7-5740-1274-5' }),
      mkRow({ date: '20260525', time: '10:00:00', optype: '读者还回文献', metaid: 9002, title: '合成书目053 . 4/ 合成著者著', barcode: 'B9002', ISBN: '978-7-5740-1274-5' }),
    ]
    const r = importPipeline(
      rows.map((d, i) => ({
        id: `raw-${i + 1}`,
        importLogId: meta.id,
        sourceId: source.id,
        data: d,
        rowIndex: i + 1,
        borrowCycleId: null,
        bookId: null,
        parseStatus: 'success' as const,
        parseNote: null,
      })),
      source,
      szlibParser,
      empty,
      meta,
    )
    // 一书一册：两条目共享同一 Book（&isbn13 唯一索引约束）。
    expect(r.books).toHaveLength(1)
    expect(r.catalogRecords).toHaveLength(2)
    for (const cr of r.catalogRecords) {
      expect(cr.bookId).toBe(r.books[0]!.id)
    }
    // 同 ISBN 不同 metaid（卷 3/卷 4）→ 套装候选：Book 置 needsReview + duplicate 警告含双方 metaid。
    expect(r.books[0]!.needsReview).toBe(true)
    const setWarn = r.warnings.find(
      (w) => w.type === 'duplicate' && w.message.includes('9001') && w.message.includes('9002'),
    )
    expect(setWarn).toBeDefined()
    // 两借阅周期各挂到自己的编目（按条码，不串挂）。
    expect(r.borrowCycles).toHaveLength(2)
    const crByBc = new Map(r.catalogRecords.map((cr) => [cr.barcodes[0], cr]))
    for (const c of r.borrowCycles) {
      expect(c.bookId).toBe(r.books[0]!.id)
      expect(c.catalogRecordId).toBe(crByBc.get(c.barcode!)!.id)
    }
    // stats.newBooks 计唯一书目。
    expect(r.importLog.stats.newBooks).toBe(1)
  })
})

describe('importPipeline — 第二次导入不破坏既有周期（回归）', () => {
  function runBatch(rows: Record<string, unknown>[], impId: string) {
    const m: ImportMeta = {
      ...meta,
      id: impId,
      importedAt: new Date(`2026-07-01T00:00:00.000Z`),
    }
    return importPipeline(
      rows.map((d, i) => ({
        id: `${impId}-raw-${i + 1}`,
        importLogId: impId,
        sourceId: source.id,
        data: d,
        rowIndex: i + 1,
        borrowCycleId: null,
        bookId: null,
        parseStatus: 'success' as const,
        parseNote: null,
      })),
      source,
      szlibParser,
      empty,
      m,
    )
  }

  const bookA = mkRow({ date: '20260301', time: '10:00:00', optype: '读者借出', metaid: 1001, title: '甲书/ 甲著', barcode: 'B0001', ISBN: '9780000000001' })
  const bookARet = mkRow({ date: '20260305', time: '10:00:00', optype: '读者还回文献', metaid: 1001, title: '甲书/ 甲著', barcode: 'B0001', ISBN: '9780000000001' })
  const bookB = mkRow({ date: '20260302', time: '10:00:00', optype: '读者借出', metaid: 1002, title: '乙书/ 乙著', barcode: 'B0002', ISBN: '9780000000002' })
  const bookC = mkRow({ date: '20260303', time: '10:00:00', optype: '读者借出', metaid: 1003, title: '丙书/ 丙著', barcode: 'B0003', ISBN: '9780000000003' })

  it('批次 A 导入后，导入不含其 barcode 的批次 B：A 的周期保持原 bookId/catalogRecordId', () => {
    const first = runBatch([bookARet, bookA, bookB], 'imp-A')
    expect(first.borrowCycles).toHaveLength(2)
    const aCycles = first.borrowCycles.filter((c) => c.barcode === 'B0001')
    expect(aCycles).toHaveLength(1)
    expect(aCycles[0]!.bookId).not.toBe('')

    // 批次 B：只含丙书（与 A 无共享 barcode）。旧版会把 A 的周期错挂到丙书。
    const second = importPipeline(
      [bookC].map((d, i) => ({
        id: `imp-B-raw-${i + 1}`,
        importLogId: 'imp-B',
        sourceId: source.id,
        data: d,
        rowIndex: i + 1,
        borrowCycleId: null,
        bookId: null,
        parseStatus: 'success' as const,
        parseNote: null,
      })),
      source,
      szlibParser,
      {
        books: first.books,
        catalogRecords: first.catalogRecords,
        borrowCycles: first.borrowCycles,
      },
      { ...meta, id: 'imp-B' },
    )

    const afterA = second.borrowCycles.find((c) => c.id === aCycles[0]!.id)!
    expect(afterA.bookId).toBe(aCycles[0]!.bookId)
    expect(afterA.catalogRecordId).toBe(aCycles[0]!.catalogRecordId)
    // 丙书的周期必须挂到丙书，而不是兜底到本批次第一本书。
    const cBook = second.books.find((b) => b.title === '丙书')!
    const cCycle = second.borrowCycles.find((c) => c.barcode === 'B0003')!
    expect(cCycle.bookId).toBe(cBook.id)
  })

  it('修复：既有周期被旧版错挂后，重新导入即按唯一 barcode 修回正确书目', () => {
    const first = runBatch([bookARet, bookA, bookB], 'imp-A')
    const aCycle = first.borrowCycles.find((c) => c.barcode === 'B0001')!
    const otherBook = first.books.find((b) => b.title === '乙书')!
    const corrupted: ExistingState = {
      books: first.books,
      catalogRecords: first.catalogRecords,
      borrowCycles: first.borrowCycles.map((c) =>
        c.id === aCycle.id ? { ...c, bookId: otherBook!.id, catalogRecordId: '' } : c,
      ),
    }
    // 重新导入同一文件（existing 为损坏态）：周期应修回甲书。
    const third = importPipeline(
      [bookARet, bookA].map((d, i) => ({
        id: `imp-A2-raw-${i + 1}`,
        importLogId: 'imp-A2',
        sourceId: source.id,
        data: d,
        rowIndex: i + 1,
        borrowCycleId: null,
        bookId: null,
        parseStatus: 'success' as const,
        parseNote: null,
      })),
      source,
      szlibParser,
      corrupted,
      { ...meta, id: 'imp-A2' },
    )
    const aBook = third.books.find((b) => b.title === '甲书')!
    const after = third.borrowCycles.find((c) => c.id === aCycle.id)!
    expect(after.bookId).toBe(aBook.id)
    expect(after.catalogRecordId).not.toBe('')
  })

  it('空条码多书：同一空 barcode 不同 metaid 的行各自成书成周期，互不串挂', () => {
    // 两本书都无条码，文件行序与时间序相反（归还行在前），
    // 且混入自助查询行（空条码、metaid 0）——旧版会因行错位把周期串挂/漏挂。
    const rows = [
      mkRow({ date: '20260303', time: '09:00:00', optype: '自助查询', metaid: 0, title: '', barcode: '' }),
      mkRow({ date: '20260310', time: '10:00:00', optype: '读者还回文献', metaid: 2002, title: '乙书/ 乙著', barcode: '', ISBN: '9780000002002' }),
      mkRow({ date: '20260302', time: '08:00:00', optype: '自助查询', metaid: 0, title: '', barcode: '' }),
      mkRow({ date: '20260309', time: '10:00:00', optype: '读者借出', metaid: 2002, title: '乙书/ 乙著', barcode: '', ISBN: '9780000002002' }),
      mkRow({ date: '20260305', time: '10:00:00', optype: '读者还回文献', metaid: 2001, title: '甲书/ 甲著', barcode: '', ISBN: '9780000002001' }),
      mkRow({ date: '20260301', time: '10:00:00', optype: '读者借出', metaid: 2001, title: '甲书/ 甲著', barcode: '', ISBN: '9780000002001' }),
    ]
    const r = runBatch(rows, 'imp-empty')
    const bookByTitle = new Map(r.books.map((b) => [b.title, b]))
    expect(r.books).toHaveLength(2)
    expect(r.catalogRecords).toHaveLength(2)
    expect(r.borrowCycles).toHaveLength(2)
    for (const c of r.borrowCycles) {
      const cr = r.catalogRecords.find((x) => x.id === c.catalogRecordId)!
      const expectTitle = cr.metaIdKey === '2001' ? '甲书' : '乙书'
      expect(bookByTitle.get(expectTitle)!.id).toBe(c.bookId)
      // 借出/归还日期取自各自书的行：甲 03-01→03-05，乙 03-09→03-10。
      expect(c.borrowedAt.getTime()).toBe(
        new Date(expectTitle === '甲书' ? '2026-03-01T02:00:00.000Z' : '2026-03-09T02:00:00.000Z').getTime(),
      )
      expect(c.returnedAt!.getTime()).toBe(
        new Date(expectTitle === '甲书' ? '2026-03-05T02:00:00.000Z' : '2026-03-10T02:00:00.000Z').getTime(),
      )
      // rawRecordIds 只含借出/还回行（不含自助查询），且借出在前。
      const rawById = new Map(r.rawRecords.map((rr) => [rr.id, rr] as const))
      const rawRows = c.rawRecordIds.map((id) => rawById.get(id)!)
      expect(rawRows).toHaveLength(2)
      const optypes = rawRows.map((rr) => (rr.data as { optype?: string }).optype)
      expect(optypes[0]).toBe('读者借出')
      expect(optypes[1]).toBe('读者还回文献')
    }
  })

  it('文件行序与时间序相反时，rawRecordIds 仍按借出→归还对齐', () => {
    const borrow = mkRow({ date: '20260301', time: '10:00:00', optype: '读者借出', metaid: 3001, title: '丁书/ 丁著', barcode: 'B3001', ISBN: '9780000003001' })
    const ret = mkRow({ date: '20260310', time: '10:00:00', optype: '读者还回文献', metaid: 3001, title: '丁书/ 丁著', barcode: 'B3001', ISBN: '9780000003001' })
    // 文件序：归还在前、借出在后。
    const rows = [ret, borrow]
    const r = runBatch(rows, 'imp-order')
    const cyc = r.borrowCycles[0]!
    expect(r.rawRecords).toHaveLength(2)
    expect(cyc.rawRecordIds).toHaveLength(2)
    expect(cyc.rawRecordIds[0]).toBe(borrowRowId(r.rawRecords, '20260301'))
    expect(cyc.rawRecordIds[1]).toBe(borrowRowId(r.rawRecords, '20260310'))
    expect(cyc.borrowedAt.getTime()).toBe(new Date('2026-03-01T02:00:00.000Z').getTime())
    expect(cyc.returnedAt!.getTime()).toBe(new Date('2026-03-10T02:00:00.000Z').getTime())
  })

  it('跨文件闭合：后一批的纯还回行闭合并前一批的开放周期（同 barcode），不新建周期', () => {
    const borrow = mkRow({ date: '20260331', time: '13:04:36', optype: '读者借出', metaid: 4001, title: '日本设计六十年/ 内田繁著', barcode: 'B4001', ISBN: '9780000004001' })
    const ret = mkRow({ date: '20260425', time: '17:12:48', optype: '读者还回文献', metaid: 4001, title: '日本设计六十年/ 内田繁著', barcode: 'B4001', ISBN: '9780000004001' })
    const first = runBatch([borrow], 'imp-x1')
    expect(first.borrowCycles).toHaveLength(1)
    const openId = first.borrowCycles[0]!.id
    expect(first.borrowCycles[0]!.returnedAt).toBeNull()

    const second = importPipeline(
      [ret].map((d, i) => ({
        id: `imp-x2-raw-${i + 1}`,
        importLogId: 'imp-x2',
        sourceId: source.id,
        data: d,
        rowIndex: i + 1,
        borrowCycleId: null,
        bookId: null,
        parseStatus: 'success' as const,
        parseNote: null,
      })),
      source,
      szlibParser,
      { books: first.books, catalogRecords: first.catalogRecords, borrowCycles: first.borrowCycles },
      { ...meta, id: 'imp-x2' },
    )
    // 不新建零长度周期；既有开放周期被闭合为完整周期。
    expect(second.borrowCycles).toHaveLength(1)
    const c = second.borrowCycles[0]!
    expect(c.id).toBe(openId)
    expect(c.status).toBe('returned')
    expect(c.borrowedAt.getTime()).toBe(new Date('2026-03-31T05:04:36.000Z').getTime())
    expect(c.returnedAt!.getTime()).toBe(new Date('2026-04-25T09:12:48.000Z').getTime())
    expect(c.rawRecordIds).toHaveLength(2)
    // 还回行：不回填到新周期而是既有闭合周期。
    const retRow = second.rawRecords.find((r) => (r.data as { optype?: string }).optype === '读者还回文献')!
    expect(retRow.borrowCycleId).toBe(openId)
    expect(retRow.bookId).toBe(c.bookId)
  })
})

function borrowRowId(rows: RawRecord[], date: string): string {
  return rows.find((r) => (r.data as { date?: string }).date === date)!.id
}
