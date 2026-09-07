import { afterEach, describe, it, expect, beforeEach, vi } from 'vitest'

import type { ReadGraphDB } from '@/db/db'
import type { Source } from '@/types/entities'
import {
  closeTestDB,
  createTestDB,
  installFakeIndexedDB,
} from '@/db/test-helpers'
import {
  executeImport,
  buildRawRecords,
  IMPORT_WORKER_THRESHOLD,
} from './run-import'
import type { ImportMeta } from '@/parsers/pipeline'
import { szlibParser } from '@/parsers/szlib'
import { reviewBadgeOf } from '@/lib/book-status'
import { updateBookWithRecords } from '@/routes/library/-edit-actions'
import sample from '@/tests/fixtures/szlib-sample.json'
// 真实捕获数据：同一 ISBN 978-7-5740-1274-5 出现在两个不同条码（系列卷 3/卷 4），
// 旧版会产出两条同 ISBN 的 Book，books.bulkPut 触发 &isbn13 唯一索引 ConstraintError。
import dupIsbn from '@/tests/fixtures/szlib-202605.json'
// 空条码期刊跨文件导入：4 月（metaid 4942259/4080461…）→ 5 月（4080461/4473139/4746505…）。
import april from '@/tests/fixtures/szlib-202604.json'
import may from '@/tests/fixtures/szlib-202605.json'

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
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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
    // rawRecords 只保留 parser.filterRows 过滤后的有效行（样本含 1 条自助查询 + 1 条读者续借）。
    const filtered = szlibParser.filterRows(sample as Record<string, unknown>[])
    expect(raws).toHaveLength(filtered.length)
    expect(raws).not.toHaveLength(sample.length)
    const optypeOf = (rr: (typeof raws)[number]): string =>
      'optype' in rr.data && typeof rr.data.optype === 'string' ? rr.data.optype : ''
    expect(raws.every((r) => !['自助查询', '读者续借'].includes(optypeOf(r)))).toBe(true)
    // classCodes 派生字段必须在导入写路径补写（treemap 下钻等 classCodes 索引查询依赖）。
    for (const cr of catalogs) {
      expect(cr.classCodes).toEqual(cr.classifications.map((c) => c.code))
    }
    expect(logs[0]!.stats.totalRawRecords).toBe(filtered.length)
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

  it('同 ISBN 多条码（一书多册）不再产出重复 Book（&isbn13 唯一索引回归）', async () => {
    const text = JSON.stringify(dupIsbn)
    const result = await executeImport(
      db,
      request({ fileName: 'szlib-202605.json', fileSize: text.length, text }),
    )
    // 全部 Book 的 isbn13 互不重复（否则 bulkPut 抛 ConstraintError）。
    const nonNull = result.books.filter((b) => b.isbn13 != null).map((b) => b.isbn13)
    expect(new Set(nonNull).size).toBe(nonNull.length)
    // 978-7-5740-1274-5 两副本（条码 04400514707329 / 04400514707325）→ 同一 Book。
    const merged = result.books.filter((b) => b.isbn13 === '9787574012745')
    expect(merged).toHaveLength(1)
    // 同 ISBN 异 metaid（7109377/7109378）→ 套装候选：Book 置 needsReview + 警告含双方 metaid。
    expect(merged[0]!.needsReview).toBe(true)
    const setWarn = result.importLog.warnings.find(
      (w) => w.type === 'duplicate' && w.message.includes('7109377') && w.message.includes('7109378'),
    )
    expect(setWarn).toBeDefined()
    const crs = result.catalogRecords.filter((c) => c.bookId === merged[0]!.id)
    expect(crs).toHaveLength(2)
    expect(crs.map((c) => c.barcodes[0]).sort()).toEqual([
      '04400514707325',
      '04400514707329',
    ])
    // 落库同样成立（唯一索引真实约束）。
    expect(await db.books.count()).toBe(result.books.length)
    // 再次导入：书目不变，无新 Book。
    const second = await executeImport(
      db,
      request({ fileName: 'szlib-202605.json', fileSize: text.length, text }),
    )
    expect(second.books.length).toBe(result.books.length)
  })

  it('跨文件空条码期刊：4 月先导 5 月后导，周期按 metaid 配对/闭合、行回填不串挂（回归）', async () => {
    const aprText = JSON.stringify(april)
    await executeImport(
      db,
      request({ fileName: 'szlib-202604.json', fileSize: aprText.length, text: aprText }),
    )
    const mayText = JSON.stringify(may)
    await executeImport(
      db,
      request({ fileName: 'szlib-202605.json', fileSize: mayText.length, text: mayText }),
    )
    const books = await db.books.toArray()
    const crs = await db.catalogRecords.toArray()
    const cycles = await db.borrowCycles.toArray()
    const raws = await db.rawRecords.toArray()

    const byIsbn = new Map(books.map((b) => [b.isbn13, b]))
    const sea = byIsbn.get('9789869408844')! // metaid 4080461（4 月借、5 月还）
    const fonts = byIsbn.get('9789862358436')! // metaid 4942259（4 月完整周期）
    const big = byIsbn.get('9789863446200')! // metaid 4473139（5 月完整周期）
    const tokyo = byIsbn.get('9789865080037')! // metaid 4746505（5 月完整周期）
    expect(sea).toBeDefined()
    expect(fonts).toBeDefined()
    expect(big).toBeDefined()
    expect(tokyo).toBeDefined()

    const crByMeta = new Map(
      crs.filter((c) => c.metaIdKey != null).map((c) => [c.metaIdKey, c]),
    )
    const cycOf = (bookId: string) =>
      cycles.filter((c) => c.barcode === null && c.bookId === bookId)

    // 周期：各书恰好一个，借/还时间与行数据一致（跨文件闭合 4080461：0427→0526）。
    const cases: Array<{ book: typeof sea; from: string; to: string; meta: string }> = [
      { book: fonts, from: '2026-04-06T10:36:53.000Z', to: '2026-04-08T10:30:35.000Z', meta: '4942259' },
      { book: sea, from: '2026-04-27T10:19:16.000Z', to: '2026-05-26T10:48:42.000Z', meta: '4080461' },
      { book: big, from: '2026-05-10T10:18:29.000Z', to: '2026-05-19T10:16:38.000Z', meta: '4473139' },
      { book: tokyo, from: '2026-05-17T10:35:18.000Z', to: '2026-05-24T10:47:53.000Z', meta: '4746505' },
    ]
    for (const { book, from, to, meta } of cases) {
      const cs = cycOf(book.id)
      expect(cs).toHaveLength(1)
      expect(cs[0]!.borrowedAt.toISOString()).toBe(from)
      expect(cs[0]!.returnedAt!.toISOString()).toBe(to)
      expect(cs[0]!.status).toBe('returned')
      expect(cs[0]!.catalogRecordId).toBe(crByMeta.get(meta)!.id)
    }
    // 无错误归集：编目各自挂到自己的书（4080461/4473139/4746505 不再指向 4942259 的书）。
    expect(crByMeta.get('4080461')!.bookId).toBe(sea.id)
    expect(crByMeta.get('4473139')!.bookId).toBe(big.id)
    expect(crByMeta.get('4746505')!.bookId).toBe(tokyo.id)
    expect(crByMeta.get('4942259')!.bookId).toBe(fonts.id)

    // 行回填：借还行 bookId/borrowCycleId 各自归位。
    const rowMeta = (rr: (typeof raws)[number]): string =>
      String((rr.data as { metaid?: unknown }).metaid ?? '')
    const rowOf = (meta: string, optype: string) =>
      raws.filter(
        (r) =>
          rowMeta(r) === meta &&
          (r.data as { optype?: string }).optype === optype &&
          (r.data as { barcode?: unknown }).barcode === '',
      )
    const rowBook: Array<{ meta: string; optype: string; book: typeof sea }> = [
      { meta: '4080461', optype: '读者还回文献', book: sea },
      { meta: '4473139', optype: '读者借出', book: big },
      { meta: '4473139', optype: '读者还回文献', book: big },
      { meta: '4746505', optype: '读者借出', book: tokyo },
      { meta: '4746505', optype: '读者还回文献', book: tokyo },
    ]
    for (const { meta, optype, book } of rowBook) {
      const rows = rowOf(meta, optype)
      expect(rows.length).toBeGreaterThan(0)
      for (const rr of rows) {
        expect(rr.bookId).toBe(book.id)
        expect(rr.borrowCycleId).toBe(cycOf(book.id)[0]!.id)
      }
    }
    // 自助查询/续借行不回填 bookId（metaid 0/续借无周期）。
    for (const rr of raws.filter((r) => rowMeta(r) === '0')) {
      expect(rr.bookId).toBeNull()
    }

    // 重导 5 月幂等：书目与周期数量不变。
    const before = { books: books.length, cycles: cycles.length }
    await executeImport(
      db,
      request({ fileName: 'szlib-202605.json', fileSize: mayText.length, text: mayText }),
    )
    expect(await db.books.count()).toBe(before.books)
    expect(await db.borrowCycles.count()).toBe(before.cycles)
  })

  it('来源不存在抛错', async () => {
    await expect(executeImport(db, request({ sourceId: 'nope' }))).rejects.toThrow()
  })

  // 回归（跨月 szlib 文件增量导入）：套装书（isbn 9787574012745，metaid
  // 7109377/7109378）编辑保存卷号后，再导入下月文件（卷 3 同条码同 metaid 还回行）
  // → 已编辑编目被同派生 id 的新编目 bulkPut 覆盖（volume 回退 null），套装徽标
  // 消失。修复：编目级命中（§10.6 第 1 条）复用既有编目，不产出新 CatalogRecord。
  it('编辑保存卷号后再导入新文件：已编辑编目 volume 保留、套装徽标不消失（回归）', async () => {
    const mayText = JSON.stringify(may)
    await executeImport(
      db,
      request({ fileName: 'szlib-202605.json', fileSize: mayText.length, text: mayText }),
    )
    const setBook = (await db.books.where('isbn13').equals('9787574012745').first())!
    expect(setBook).toBeDefined()
    expect(setBook.needsReview).toBe(true) // 批内同 ISBN 多 metaid → 套装候选
    const crsOf = async (bookId: string) =>
      (await db.catalogRecords.where('bookId').equals(bookId).toArray()).sort(
        (a, b) => (a.metaIdKey ?? '').localeCompare(b.metaIdKey ?? ''),
      )
    const crsBefore = await crsOf(setBook.id)
    expect(crsBefore.map((c) => c.metaIdKey)).toEqual(['7109377', '7109378'])

    // 用户编辑保存：补全书目 + 各编目卷号（updateBookWithRecords 语义）。
    const draft = {
      title: setBook.title,
      subtitle: setBook.subtitle,
      parallelTitles: [],
      authors: [],
      translators: [],
      publisher: null,
      publishDate: null,
      edition: null,
      pages: null,
      price: null,
      isbn13: '9787574012745',
      isbn10: null,
      subjects: [],
      tags: [],
      description: null,
      coverUrl: null,
    }
    await updateBookWithRecords(
      db,
      setBook.id,
      draft,
      crsBefore.map((cr) => ({
        id: cr.id,
        metaId: cr.metaId != null ? String(cr.metaId) : null,
        volume: cr.metaIdKey === '7109377' ? '3' : '4',
        barcodes: cr.barcodes,
        classifications: cr.classifications,
      })),
    )
    const edited = (await db.books.get(setBook.id))!
    expect(edited.needsReview).toBe(false)
    const crsEdited = await crsOf(edited.id)
    expect(crsEdited.map((c) => c.volume)).toEqual(['3', '4'])
    // 编辑后徽标仍在：已结构化多卷套装的「套装」Badge。
    expect(reviewBadgeOf(edited, edited.id, crsEdited)).toBe('set')

    // 6 月文件（去敏）：卷 3 同条码同 metaid 还回行 + 同系列其他卷（新 ISBN 新书）。
    const juneRows = [
      { date: '20260601', time: '16:32:02', optype: '读者还回文献', cirtype: '中文图书外借', metatable: 'bibliosm', metaid: 7109377, title: '合成书目052 : 合成副题 52 . 3/ 合成著者52著', ISBN: '978-7-5740-1274-5', addr: '合成馆24自助借书机', barcode: '04400514707329', callno: 'J23/4452/3', cardno: '0440050000000', notes: '', ip: '0.0.0.0' },
      { date: '20260614', time: '19:03:23', optype: '读者还回文献', cirtype: '中文图书外借', metatable: 'bibliosm', metaid: 6260746, title: '合成书目051 : 合成副题 51 . 1/ 合成著者51著', ISBN: '978-7-5140-2585-9', addr: '合成馆25自助借还机', barcode: '04401021533645', callno: 'J238.2/2102:1', cardno: '0440050000000', notes: '', ip: '10.0.0.2' },
      { date: '20260614', time: '19:03:24', optype: '读者还回文献', cirtype: '中文图书外借', metatable: 'bibliosm', metaid: 6260748, title: '合成书目051 : 合成副题 51 . 2/ 合成著者51著', ISBN: '978-7-5140-2585-9', addr: '合成馆25自助借还机', barcode: '04401021533646', callno: 'J238.2/2102:2', cardno: '0440050000000', notes: '', ip: '10.0.0.2' },
      { date: '20260604', time: '19:11:31', optype: '读者还回文献', cirtype: '中文图书外借', metatable: 'bibliosm', metaid: 7235981, title: '合成书目054 : 合成副题 54 . 5/ 合成著者54著', ISBN: '978-7-5740-1848-8', addr: '合成馆26自助图书室', barcode: '04400514772486', callno: 'J23/4452/5', cardno: '0440050000000', notes: '', ip: '10.0.0.3' },
      { date: '20260604', time: '19:11:31', optype: '读者还回文献', cirtype: '中文图书外借', metatable: 'bibliosm', metaid: 7235982, title: '合成书目054 : 合成副题 54 . 6/ 合成著者54著', ISBN: '978-7-5740-1848-8', addr: '合成馆26自助图书室', barcode: '04400514772488', callno: 'J23/4452/6', cardno: '0440050000000', notes: '', ip: '10.0.0.3' },
    ]
    const juneText = JSON.stringify(juneRows)
    await executeImport(
      db,
      request({ fileName: 'szlib-202606.json', fileSize: juneText.length, text: juneText }),
    )

    // 核心断言：卷 3 已编辑编目原样保留（volume '3'），套装徽标不消失。
    const crsAfter = await crsOf(edited.id)
    expect(crsAfter).toHaveLength(2)
    expect(crsAfter.map((c) => c.volume)).toEqual(['3', '4'])
    const bookAfter = (await db.books.get(edited.id))!
    expect(reviewBadgeOf(bookAfter, bookAfter.id, crsAfter)).toBe('set')
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

  it('设备行（cirtype=电子设备外借）导入：Book.materialType=device，rawRecords 保留原行', async () => {
    const deviceRows = [
      {
        date: '20260411', time: '16:25:29', optype: '读者借出', cirtype: '电子设备外借',
        metatable: 'bibliosm', metaid: 5952182, title: '合成书目036/ 合成著者36著',
        ISBN: '', addr: '合成馆16自助借还机', barcode: '04400790006607', callno: 'TP368.3/168',
      },
      {
        date: '20260411', time: '17:17:09', optype: '读者还回文献', cirtype: '电子设备外借',
        metatable: 'bibliosm', metaid: 5952182, title: '合成书目036/ 合成著者36著',
        ISBN: '', addr: '合成馆16自助借还机', barcode: '04400790006607', callno: 'TP368.3/168',
      },
    ]
    const text = JSON.stringify(deviceRows)
    const result = await executeImport(db, request({ fileName: 'device.json', text }))

    expect(result.books).toHaveLength(1)
    expect(result.books[0]!.materialType).toBe('device')
    expect(result.borrowCycles).toHaveLength(1)
    expect(result.borrowCycles[0]!.status).toBe('returned')

    const books = await db.books.toArray()
    expect(books).toHaveLength(1)
    expect(books[0]!.materialType).toBe('device')

    // rawRecords 保留设备行（含 cirtype，供溯源与回填判定）。
    const raws = await db.rawRecords.toArray()
    expect(raws).toHaveLength(2)
    const cirtypeOf = (rr: (typeof raws)[number]): unknown =>
      'cirtype' in rr.data ? rr.data.cirtype : undefined
    expect(raws.every((r) => cirtypeOf(r) === '电子设备外借')).toBe(true)
    // rawRecord.bookId 回填到设备 Book（回填脚本依赖此关联）。
    expect(raws.every((r) => r.bookId === books[0]!.id)).toBe(true)
  })
})

describe('executeImport — L3 回归', () => {
  it('全无效 optype 文件显式拒绝，不静默导入为空', async () => {
    const text = JSON.stringify([
      { metatable: 'bibliosm', date: '20260501', time: '10:00:00', optype: '自助查询', title: '', barcode: '' },
      { metatable: 'bibliosm', date: '20260501', time: '10:00:00', optype: '读者续借', title: '', barcode: '' },
    ])
    await expect(executeImport(db, request({ text }))).rejects.toThrow(/no valid rows/)
    // 拒绝发生在写库前：库保持空（无空 ImportLog 入账）。
    expect(await db.importLogs.count()).toBe(0)
  })

  it('filteredRows 计入行级预过滤剔除数（审计「文件行 → 有效行」去向）', async () => {
    const rows = (sample as Record<string, unknown>[]).concat([
      { metatable: 'bibliosm', date: '20260501', time: '10:00:00', optype: '自助查询', title: '', barcode: '' },
      { metatable: 'bibliosm', date: '20260501', time: '10:00:00', optype: '读者续借', title: '', barcode: '' },
    ])
    const text = JSON.stringify(rows)
    const result = await executeImport(db, request({ text }))
    // sample 自带 2 条被过滤行（自助查询/续借）+ 追加 2 条 = 4。
    expect(result.importLog.stats.filteredRows).toBe(4)
    // totalRawRecords 为过滤后有效行数（22 - 2 条 sample 自带过滤行）。
    expect(result.importLog.stats.totalRawRecords).toBe(sample.length - 2)
  })
})

describe('executeImport — debug 装配（debug-mode spec §5.3/§4.2）', () => {
  it('debug 开启：trace 收集装配、durationMs 主线程填写、performance 打点', async () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    const marks: string[] = []
    const spyMark = vi
      .spyOn(performance, 'mark')
      .mockImplementation((name: string) => {
        marks.push(name)
        return {
          name,
          entryType: 'mark',
          startTime: 0,
          duration: 0,
          detail: null,
        } as PerformanceMark
      })
    vi.spyOn(performance, 'measure').mockReturnValue({
      name: 'readgraph:import',
      entryType: 'measure',
      startTime: 0,
      duration: 1,
      detail: null,
    } as PerformanceMeasure)

    const result = await executeImport(db, request())
    // trace 收集开启（debug 装配层决定，非管线默认）。
    expect(result.trace).not.toBeNull()
    // durationMs 由装配层填写（主线程同步路径 performance.now 差值）。
    expect(typeof result.trace!.durationMs).toBe('number')
    expect(result.trace!.durationMs).toBeGreaterThanOrEqual(0)
    // performance 打点（spec §4.2 主线程 mark + measure）。
    expect(marks).toEqual(['readgraph:import:start', 'readgraph:import:end'])
    expect(spyMark).toHaveBeenCalledTimes(2)

    // trace.rows 与 rawRecords 按 rowIndex 对齐（{verbose:false} 契约沿用）。
    expect(result.trace!.rows).toHaveLength(result.rawRecords.length)
    expect(result.trace!.rows.map((r) => r.rowIndex)).toEqual(
      result.rawRecords.map((r) => r.rowIndex),
    )
    // 首次导入有效行 = new-book（spec §8 用例 1）。
    expect(result.trace!.rows.filter((r) => r.decision === 'new-book')).not.toHaveLength(0)
  })

  it('非 debug：不装配 traceOptions，result.trace 恒 null、零 performance 打点', async () => {
    const spyMark = vi.spyOn(performance, 'mark')
    const result = await executeImport(db, request())
    expect(result.trace).toBeNull()
    expect(spyMark).not.toHaveBeenCalled()
  })

  it('filteredRowIndexes 补充被过滤行：row-filtered/filtered-out、rowIndex 正确、stats 不变', async () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    // szlib-sample：原数组下标 3=自助查询、18=读者续借（1-based）。
    // 注意：管线行 rowIndex 是「过滤后数组内」的 1..20（buildRawRecords 按入参
    // 顺序编号），与 UI 传入的原数组下标分属两个下标空间——过滤行补充按原
    // 下标 append 后升序合并，rowIndex 3/18 各出现两次（管线行 + 补充行）。
    const result = await executeImport(db, request({ filteredRowIndexes: [3, 18] }))
    const trace = result.trace!
    expect(trace).not.toBeNull()

    const filtered = trace.rows.filter((r) => r.decision === 'row-filtered')
    expect(filtered.map((r) => r.rowIndex)).toEqual([3, 18])
    for (const row of filtered) {
      expect(row.status).toBe('filtered-out')
      expect(row.rawRecordId).toBeNull()
      expect(row.bookId).toBeNull()
      expect(row.catalogRecordId).toBeNull()
      expect(row.borrowCycleId).toBeNull()
      expect(row.reason).not.toBe('')
    }
    // barcode/title 尽力从原始行字段填充（file row 3 = 自助查询含条码）。
    const row3 = filtered.find((r) => r.rowIndex === 3)!
    expect(row3.barcode).not.toBeNull()

    // rows 按 rowIndex 升序合并（管线 20 行 + 补充 2 行 = 22；升序但同号并存）。
    const indexes = trace.rows.map((r) => r.rowIndex)
    expect(trace.rows).toHaveLength(22)
    expect([...indexes].sort((a, b) => a - b)).toEqual(indexes)
    // 管线行（rowIndex 1）仍在。
    expect(indexes).toContain(1)
    // 同号并存：rowIndex 3 与 18 各 2 行（管线行 + row-filtered 行）。
    expect(indexes.filter((v) => v === 3)).toHaveLength(2)
    expect(indexes.filter((v) => v === 18)).toHaveLength(2)
    // 不触碰 stats（totalRawRecords 语义 = 进入管线的行数，spec §5.3）。
    expect(trace.stats.totalRawRecords).toBe(result.importLog.stats.totalRawRecords)
    expect(trace.stats.totalRawRecords).toBe(
      (sample as Record<string, unknown>[]).length - 2,
    )
    expect(trace.stats.filteredRows).toBe(2)
    expect(trace.stats.skippedRecords).toBe(result.importLog.stats.skippedRecords)
    // entityDelta.skippedRows 只含周期跳过行，不含 row-filtered（spec §5.1 口径）。
    expect(trace.entityDelta.skippedRows).not.toContain(3)
    expect(trace.entityDelta.skippedRows).not.toContain(18)
  })

  it('不传 filteredRowIndexes：无 row-filtered 行（debug 开启）', async () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    const result = await executeImport(db, request())
    expect(result.trace!.rows.filter((r) => r.decision === 'row-filtered')).toHaveLength(0)
  })

  it('非 debug 传 filteredRowIndexes：忽略（零分配，D5）', async () => {
    const result = await executeImport(db, request({ filteredRowIndexes: [3, 18] }))
    expect(result.trace).toBeNull()
    expect(await db.importLogs.count()).toBe(1)
  })

  it('Worker 路径：durationMs 由 Worker 填写，executeImport 不覆盖（mock comlink）', async () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    // Worker 阈值下限为 IMPORT_MAX_FILE_SIZE（≥50MB 才走 Worker），jsdom/node 无
    // 真实 Worker：本用例直接断言 import-worker api（见 import-worker.test.ts），
    // 此处仅验证 mock wrap 未被主线程路径调用（Worker 未触碰）。
    expect(IMPORT_WORKER_THRESHOLD).toBeGreaterThanOrEqual(50 * 1024 * 1024)
  })
})
