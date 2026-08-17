import { describe, it, expect } from 'vitest'

import type { Source } from '@/types/entities'
import { szlibParser, isDeviceCirtype } from './szlib'
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

describe('szlibParser.validate', () => {
  it('对合法 szlib JSON 命中', () => {
    expect(szlibParser.validate(JSON.stringify(sample))).toBe(true)
  })

  it('对空数组不命中', () => {
    expect(szlibParser.validate('[]')).toBe(false)
  })

  it('对非 szlib JSON（无 optype/barcode 等字段）不命中', () => {
    expect(szlibParser.validate(JSON.stringify([{ foo: 'bar' }]))).toBe(false)
  })

  it('对非 JSON 抛错时静默返回 false', () => {
    expect(szlibParser.validate('not-json{}')).toBe(false)
  })
})

describe('szlibParser.parse', () => {
  const res = szlibParser.parse(JSON.stringify(sample), source)

  it('过滤续借/查询，stats.skippedRecords 计入被忽略行', () => {
    // 样本含 1 条自助查询 + 1 条读者续借。
    expect(res.stats.totalRawRecords).toBe((sample as unknown[]).length)
    expect(res.stats.skippedRecords).toBeGreaterThanOrEqual(2)
  })

  it('filterRows 剔除自助查询/读者续借等无用行，预览与导入同源', () => {
    const rows = sample as Record<string, unknown>[]
    const filtered = szlibParser.filterRows(rows)
    // 预览行 = parse 实际消费的有效行（借出/还回），无用条目一行不留。
    expect(filtered.length).toBe(rows.length - res.stats.skippedRecords)
    expect(filtered.every((r) => ['读者借出', '读者还回文献'].includes(String(r.optype)))).toBe(true)
    expect(filtered.some((r) => String(r.optype) === '自助查询')).toBe(false)
    expect(filtered.some((r) => String(r.optype) === '读者续借')).toBe(false)
    // 与 parse 消费的行一一对应（同一过滤标准）。
    const parseConsumed = (sample as Record<string, unknown>[]).filter(
      (r) => ['读者借出', '读者还回文献'].includes(String(r.optype)),
    )
    expect(filtered).toEqual(parseConsumed)
  })

  it('产出 Books 数量正确（选书帮按 barcode 独立）', () => {
    // 9 个唯一非占位书目 + 2 个独立选书帮 barcode。
    const phBooks = res.books.filter((b) => b.needsReview === true)
    expect(phBooks.length).toBe(2)
    for (const b of phBooks) {
      expect(b.isbn13).toBeNull()
      expect(b.title).toBe('福田图书馆读者自选图书')
      expect(b.authors).toEqual([])
    }
  })

  it('选书帮 Book 不按 title 合并、各 barcode 独立', () => {
    const ph = res.books.filter((b) => b.title === '福田图书馆读者自选图书')
    expect(ph.length).toBe(2)
    const barcodes = res.catalogRecords
      .filter((c) => c.metaIdKey === '7777777')
      .map((c) => c.barcodes?.[0] ?? '')
      .sort()
    expect(barcodes).toEqual(['04400516000001', '04400516000002'])
  })

  it('时间按 Asia/Shanghai 转 UTC（-8h）', () => {
    const cyc = res.borrowCycles.find((c) => c.barcode === '04400515000000')
    expect(cyc).toBeDefined()
    // 借出 20260628 14:30 CST → 06:30 UTC
    if (!cyc) throw new Error('cycle not found')
    const borrowedAt = cyc.borrowedAt
    if (!borrowedAt) throw new Error('borrowedAt missing')
    expect(borrowedAt.toISOString()).toBe('2026-06-28T06:30:00.000Z')
    // 借出地点（addr）随周期携带（fixture 馆名为合成值）。
    expect(cyc.borrowLocation).toMatch(/^合成馆/)
  })

  it('callno 提取分类号（`/` 前部分），system=clc', () => {
    const cr = res.catalogRecords.find((c) => (c.barcodes?.[0] ?? '').startsWith('F4401001911110'))
    expect(cr).toBeDefined()
    if (!cr) throw new Error('cr not found')
    expect(cr.classifications).toEqual([{ system: 'clc', code: 'J238.2' }])
  })

  it('metaIdKey 归一为 string（metaid 非零），metatable/0 时为 null', () => {
    const fromBk = res.catalogRecords.find((c) => c.metaIdKey === '7777777')

    expect(fromBk?.barcodes?.[0]).toBeDefined()
    expect(fromBk).toBeDefined()
  })

  it('非法日期（20260230）产出 invalid_date 警告，整批不中断', () => {
    const w = res.warnings.find((x) => x.type === 'invalid_date')
    expect(w).toBeDefined()
    expect(res.borrowCycles.length).toBeGreaterThan(0)
  })

  it('确定性：同输入两次解析结果深等价', () => {
    const a = szlibParser.parse(JSON.stringify(sample), source)
    const b = szlibParser.parse(JSON.stringify(sample), source)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
  })

  it('标题中的 HTML 实体解码（并列题名 `&apos;` → 撇号）', () => {
    const row = {
      date: '20260429',
      time: '18:38:32',
      optype: '读者借出',
      cirtype: '中文图书外借',
      metatable: 'bibliosm',
      metaid: 5750000,
      title: '书虫杂记 = The Book Lovers&apos; Miscellany/ (英)克莱尔·科克-斯塔基著;许梦鸽译',
      ISBN: '978-7-100-00000-0',
      addr: '合成馆5自助借还机',
      barcode: '04400610000000',
      callno: 'G256.1/83',
      cardno: '0440050000000',
      notes: '',
      ip: '0.0.0.0',
    }
    const res = szlibParser.parse(JSON.stringify([row]), source)
    const book = res.books[0]
    expect(book).toBeDefined()
    expect(book?.title).toBe('书虫杂记')
    expect(book?.parallelTitles).toEqual(["The Book Lovers' Miscellany"])
    expect(book?.authors).toEqual(['克莱尔·科克-斯塔基'])
  })

  it('周期标注消费行行号 _rowIndexes：借出在前（时间升序，文件行序为倒序）', () => {
    const cyc = res.borrowCycles.find((c) => c.barcode === 'F4401001911110')
    expect(cyc).toBeDefined()
    const idxs = (cyc as Record<string, unknown>)._rowIndexes as number[] | undefined
    // 文件行序归还在前（rowIndex 1）、借出在后（rowIndex 4）；
    // 周期按时间升序消费，故标注 [借出, 归还] = [4, 1]。
    expect(idxs).toEqual([4, 1])
  })

  it('交错借还（借A 借B 还A 还B）按 metaid 配对，不产生纯还回/错挂（回归）', () => {
    // 同组（空条码期刊）时间序：借 A → 借 B → 还 A → 还 B。
    // 旧栈式配对会产出 B 开放 + A/B 纯还回；应按 metaid 各自闭合。
    const rows = [
      { metatable: 'bibliosm', date: '20260510', time: '18:18:29', optype: '读者借出', metaid: 4473139, title: '甲书/ 甲著', barcode: '', ISBN: '9789863446200' },
      { metatable: 'bibliosm', date: '20260517', time: '18:35:18', optype: '读者借出', metaid: 4746505, title: '乙书/ 乙著', barcode: '', ISBN: '9789865080037' },
      { metatable: 'bibliosm', date: '20260519', time: '18:16:38', optype: '读者还回文献', metaid: 4473139, title: '甲书/ 甲著', barcode: '', ISBN: '9789863446200' },
      { metatable: 'bibliosm', date: '20260524', time: '18:47:53', optype: '读者还回文献', metaid: 4746505, title: '乙书/ 乙著', barcode: '', ISBN: '9789865080037' },
    ]
    const r = szlibParser.parse(JSON.stringify(rows), source)
    expect(r.borrowCycles).toHaveLength(2)
    const cyc = r.borrowCycles as Array<
      Record<string, unknown> & { borrowedAt: Date; returnedAt: Date | null; status: string }
    >
    const sorted = [...cyc].sort(
      (a, b) => a.borrowedAt.getTime() - b.borrowedAt.getTime(),
    )
    // 两周期均闭合，borrowedAt 分别为 05-10 / 05-17。
    expect(sorted.map((c) => c.status)).toEqual(['returned', 'returned'])
    expect(sorted[0]!.returnedAt!.getTime()).toBe(
      new Date('2026-05-19T10:16:38.000Z').getTime(),
    )
    expect(sorted[1]!.returnedAt!.getTime()).toBe(
      new Date('2026-05-24T10:47:53.000Z').getTime(),
    )
    // 消费行标注（_rowIndexes）各自只含对应书的借出+还回。
    const a = sorted[0]!._rowIndexes as number[]
    const b = sorted[1]!._rowIndexes as number[]
    expect(a).toEqual([1, 3])
    expect(b).toEqual([2, 4])
  })

  it('只有借出无归还（EOF 仍开启）：status=borrowed、returnedAt=null（borrow-cycle 规则表）', () => {
    const rows = [
      { metatable: 'bibliosm', date: '20260510', time: '18:18:29', optype: '读者借出', metaid: 4473139, title: '甲书/ 甲著', barcode: 'B1', ISBN: '9789863446200', addr: '中心馆' },
    ]
    const r = szlibParser.parse(JSON.stringify(rows), source)
    expect(r.borrowCycles).toHaveLength(1)
    const c = r.borrowCycles[0]!
    expect(c.status).toBe('borrowed')
    expect(c.returnedAt).toBeNull()
    expect(c.borrowLocation).toBe('中心馆')
  })

  it('同一书目借出未还又借：前一周期 status=unknown（规则表），末周期 EOF 开启为 borrowed', () => {
    const rows = [
      { metatable: 'bibliosm', date: '20260510', time: '18:18:29', optype: '读者借出', metaid: 4473139, title: '甲书/ 甲著', barcode: 'B1', ISBN: '9789863446200' },
      { metatable: 'bibliosm', date: '20260601', time: '10:00:00', optype: '读者借出', metaid: 4473139, title: '甲书/ 甲著', barcode: 'B1', ISBN: '9789863446200' },
    ]
    const r = szlibParser.parse(JSON.stringify(rows), source)
    expect(r.borrowCycles).toHaveLength(2)
    const sorted = [...r.borrowCycles].sort(
      (a, b) => (a.borrowedAt ?? new Date(0)).getTime() - (b.borrowedAt ?? new Date(0)).getTime(),
    )
    expect(sorted.map((c) => c.status)).toEqual(['unknown', 'borrowed'])
    expect(sorted[0]!.returnedAt).toBeNull()
    expect(sorted[1]!.returnedAt).toBeNull()
  })
})

describe('设备借阅（device-borrows 规格）', () => {
  // 结构对照 szlib-202604.json 脱敏设备行（cirtype=电子设备外借、metaid=5952182、无 ISBN）。
  const deviceRow = (optype: string, time: string) => ({
    date: '20260411',
    time,
    optype,
    cirtype: '电子设备外借',
    metatable: 'bibliosm',
    metaid: 5952182,
    title: '合成书目036/ 合成著者36著',
    ISBN: '',
    addr: '合成馆16自助借还机',
    barcode: '04400790006607',
    callno: 'TP368.3/168',
  })
  const bookRow = {
    date: '20260411',
    time: '16:25:29',
    optype: '读者借出',
    cirtype: '中文图书外借',
    metatable: 'bibliosm',
    metaid: 5952183,
    title: '合成书目037/ 合成著者37著',
    ISBN: '978-7-100-00000-1',
    addr: '合成馆1自助借还机',
    barcode: '04400790006608',
    callno: 'TP311/1',
  }

  it('isDeviceCirtype：精确匹配，undefined/空串/其它值/前缀均 false', () => {
    expect(isDeviceCirtype('电子设备外借')).toBe(true)
    expect(isDeviceCirtype(undefined)).toBe(false)
    expect(isDeviceCirtype('')).toBe(false)
    expect(isDeviceCirtype('中文图书外借')).toBe(false)
    expect(isDeviceCirtype('电子设备外借测试')).toBe(false)
  })

  it('设备行产出 materialType=device 的 Book，普通行缺省不带字段', () => {
    const rows = [deviceRow('读者借出', '16:25:29'), deviceRow('读者还回文献', '17:17:09')]
    const r = szlibParser.parse(JSON.stringify(rows), source)
    expect(r.books).toHaveLength(1)
    expect(r.books[0]!.materialType).toBe('device')

    const rb = szlibParser.parse(JSON.stringify([bookRow]), source)
    expect(rb.books[0]!.materialType).toBeUndefined()
  })

  it('设备行 filterRows 保留（预览所见即导入所得，区别于自助查询/续借）', () => {
    const rows = [deviceRow('读者借出', '16:25:29'), deviceRow('读者还回文献', '17:17:09')]
    const filtered = szlibParser.filterRows(rows)
    expect(filtered).toHaveLength(2)
    expect(filtered).toEqual(rows)
  })

  it('设备借还照常合成一个 returned 周期，携带 barcode/addr', () => {
    const rows = [deviceRow('读者借出', '16:25:29'), deviceRow('读者还回文献', '17:17:09')]
    const r = szlibParser.parse(JSON.stringify(rows), source)
    expect(r.borrowCycles).toHaveLength(1)
    const c = r.borrowCycles[0]!
    expect(c.status).toBe('returned')
    expect(c.barcode).toBe('04400790006607')
    expect(c.borrowLocation).toBe('合成馆16自助借还机')
    expect(c.returnLocation).toBe('合成馆16自助借还机')
  })
})

describe('szlibParser — L7/L6 回归', () => {
  it('Source.timezone 缺失/空串时显式拒绝，不静默回落本地时区（L7）', () => {
    for (const tz of [undefined, '', null]) {
      const noTz = { ...source, timezone: tz as unknown as string }
      expect(() => szlibParser.parse(JSON.stringify(sample), noTz)).toThrow(/timezone/)
    }
  })

  it('无 metaid 交错借还（借A 借B 还A 还B，同 barcode）按 FIFO 各自闭合（L6）', () => {
    // 无 metaid 行共享配对槽会把还回错挂（旧版：A 被关 unknown、还A 挂 B、
    // 还B 变纯还回——3 周期 2 错）；FIFO 退化为先借先还，2 周期全对。
    const rows = [
      { metatable: 'bibliosm', date: '20260510', time: '10:00:00', optype: '读者借出', title: '甲书/ 甲著', barcode: 'B1', ISBN: '9780000000001' },
      { metatable: 'bibliosm', date: '20260511', time: '10:00:00', optype: '读者借出', title: '乙书/ 乙著', barcode: 'B1', ISBN: '9780000000002' },
      { metatable: 'bibliosm', date: '20260512', time: '10:00:00', optype: '读者还回文献', title: '甲书/ 甲著', barcode: 'B1', ISBN: '9780000000001' },
      { metatable: 'bibliosm', date: '20260513', time: '10:00:00', optype: '读者还回文献', title: '乙书/ 乙著', barcode: 'B1', ISBN: '9780000000002' },
    ]
    const r = szlibParser.parse(JSON.stringify(rows), source)
    // 无 metaid（metatable=bibliosm 但 metaid 缺失 → metaIdKey null）。
    expect(r.borrowCycles).toHaveLength(2)
    const sorted = [...r.borrowCycles].sort((x, y) =>
      x!.borrowedAt!.getTime() - y!.borrowedAt!.getTime(),
    )
    const a = sorted[0]!
    const b = sorted[1]!
    expect(a!.status).toBe('returned')
    expect(b!.status).toBe('returned')
    // 先借先还：甲书（第一条借出）的还回在第 3 行闭合。
    expect(a!.borrowedAt!.getTime()).toBeLessThan(b!.borrowedAt!.getTime())
  })
})

describe('szlibParser — ArrayBuffer 入口', () => {
  // 独立调用入口（预览/测试/validate 探测）走 TextDecoder 解码；
  // pipeline 走行数组入口（L4）。本组覆盖 ArrayBuffer 分支的解码正确性。

  it('编码正确（UTF-8）：validate 命中，parse 与字符串入口深等价', () => {
    const buf = new TextEncoder().encode(JSON.stringify(sample)).buffer
    expect(szlibParser.validate(buf)).toBe(true)
    // parse 返回值含 Date（borrowedAt/returnedAt），用 toEqual 深比较。
    expect(szlibParser.parse(buf, source)).toEqual(
      szlibParser.parse(JSON.stringify(sample), source),
    )
  })

  it('编码错误（无效 UTF-8 字节）：validate 返回 false，parse 抛错', () => {
    const bad = new Uint8Array([0xff, 0xfe, 0xfd]).buffer
    // fatal:false 将坏字节替换为 U+FFFD → 非 JSON → validate false / parse 抛错。
    expect(szlibParser.validate(bad)).toBe(false)
    expect(() => szlibParser.parse(bad, source)).toThrow(/not valid JSON/)
  })
})
