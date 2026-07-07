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
})
