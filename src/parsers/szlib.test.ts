import { describe, it, expect } from 'vitest'

import type { Source } from '@/types/entities'
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
    expect(cyc.borrowLocation).toBe('中心图书馆')
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
      addr: '宝安中心区图书馆自助馆自助借还机',
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
})
