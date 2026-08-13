// 书库视图派生测试（opac-enrichment §10 翻页 + ui-navigation §3 列表共用管线）。
// buildLibraryRows / filterAndSortRows / adjacentBookIds 纯函数契约；
// 列表页与详情页翻页共用同一实现，防两处排序/过滤漂移。
import { describe, expect, it } from 'vitest'
import { makeBook, makeCatalog, makeCycle, makeSource } from '@/db/test-helpers'
import {
  adjacentBookIds,
  buildLibraryRows,
  filterAndSortRows,
  type LibraryViewParams,
} from '@/lib/library-view'

const srcA = makeSource('src-a')
const srcB = makeSource('src-b')

const bookA = makeBook('bk-a', '9780000000001', 'Alpha 书', false, ['src-a', 'src-b'])
bookA.authors = ['Zed']
const bookB = makeBook('bk-b', null, 'Beta 书', false, ['src-a'])
bookB.authors = ['Ann']
const bookC = makeBook('bk-c', '9780000000003', 'Gamma 书', true, ['src-a'])
bookC.authors = ['Mia']

/** makeCatalog 分类参数形态（无 category 字段，helper 与 db schemas 同款窄型）。 */
const clc = (code: string): { system: 'clc'; code: string } => ({ system: 'clc', code })

/** 多来源合并书：bookA 同时挂 src-a（有分类）与 src-b（无分类）两条编目。 */
const catalogRecords = [
  makeCatalog('cr-a1', 'bk-a', 'src-a', 'BC1', 1, [clc('I247.5')]),
  makeCatalog('cr-a2', 'bk-a', 'src-b', 'BC2', 2),
  makeCatalog('cr-b1', 'bk-b', 'src-a', 'BC3', 3),
]

const borrowCycles = [
  makeCycle('c1', 'bk-a', 'src-a', new Date('2026-01-10T00:00:00Z'), 'returned'),
  makeCycle('c2', 'bk-a', 'src-a', new Date('2026-01-05T00:00:00Z'), 'returned'),
  makeCycle('c3', 'bk-b', 'src-a', new Date('2026-02-01T00:00:00Z'), 'returned'),
]

const books = [bookA, bookB, bookC]

const rows = buildLibraryRows(books, catalogRecords, borrowCycles, [srcA, srcB])

describe('buildLibraryRows（行派生）', () => {
  it('来源名取首条编目的来源；分类取首条编目首个条目', () => {
    expect(rows).toHaveLength(3)
    const rowA = rows.find((r) => r.book.id === 'bk-a')!
    expect(rowA.sourceName).toBe('深圳图书馆')
    expect(rowA.classification).toEqual({ system: 'clc', code: 'I247.5' })
    expect(rowA.authors).toBe('Zed')
    expect(rowA.isbn13).toBe('9780000000001')
  })

  it('借阅计数 = 该书借阅周期数；lastBorrowedAt = 最大 borrowedAt', () => {
    const rowA = rows.find((r) => r.book.id === 'bk-a')!
    expect(rowA.borrowCount).toBe(2)
    expect(rowA.lastBorrowedAt?.toISOString()).toBe('2026-01-10T00:00:00.000Z')
    const rowB = rows.find((r) => r.book.id === 'bk-b')!
    expect(rowB.borrowCount).toBe(1)
  })

  it('无编目的书：来源回退 book.sourceIds[0]，分类/计数为空', () => {
    const rowC = rows.find((r) => r.book.id === 'bk-c')!
    expect(rowC.sourceName).toBe('深圳图书馆')
    expect(rowC.classification).toBeNull()
    expect(rowC.borrowCount).toBe(0)
    expect(rowC.lastBorrowedAt).toBeNull()
  })
})

describe('filterAndSortRows（列表管线）', () => {
  const order = (params: LibraryViewParams) =>
    filterAndSortRows(rows, params).map((r) => r.book.id)

  it('缺省 = 全量 title 升序', () => {
    expect(order({})).toEqual(['bk-a', 'bk-b', 'bk-c'])
  })

  it('q 匹配题名/作者/ISBN（大小写不敏感）', () => {
    expect(order({ q: 'beta' })).toEqual(['bk-b'])
    expect(order({ q: '9780000000003' })).toEqual(['bk-c'])
    expect(order({ q: 'zzz' })).toEqual([])
  })

  it('source 过滤按 book.sourceIds（多来源书命中任一组）', () => {
    expect(order({ source: 'src-b' })).toEqual(['bk-a'])
    expect(order({ source: 'src-a' })).toEqual(['bk-a', 'bk-b', 'bk-c'])
  })

  it('status 过滤走待审语义（needsReview/placeholder/set）', () => {
    // bookC：needsReview=true 且有 ISBN → 套装候选（set）；无 ISBN 的待审才属占位
    expect(order({ status: 'needsReview' })).toEqual(['bk-c'])
    expect(order({ status: 'set' })).toEqual(['bk-c'])
    expect(order({ status: 'placeholder' })).toEqual([])
  })

  it('sort=author/isbn/title 双向；isbn 空值排前（asc）', () => {
    expect(order({ sort: 'author' })).toEqual(['bk-b', 'bk-c', 'bk-a'])
    expect(order({ sort: 'author', dir: 'desc' })).toEqual(['bk-a', 'bk-c', 'bk-b'])
    expect(order({ sort: 'isbn' })).toEqual(['bk-b', 'bk-a', 'bk-c'])
    expect(order({ sort: 'isbn', dir: 'desc' })).toEqual(['bk-c', 'bk-a', 'bk-b'])
  })

  it('sort=borrowed：无借阅恒排末尾（不随方向翻转）；borrows 按计数', () => {
    // borrowed asc = 最早借阅在前（既有列表语义）；desc = 最近在前；无借阅恒末尾
    expect(order({ sort: 'borrowed' })).toEqual(['bk-a', 'bk-b', 'bk-c'])
    expect(order({ sort: 'borrowed', dir: 'desc' })).toEqual(['bk-b', 'bk-a', 'bk-c'])
    expect(order({ sort: 'borrows' })).toEqual(['bk-c', 'bk-b', 'bk-a'])
    expect(order({ sort: 'borrows', dir: 'desc' })).toEqual(['bk-a', 'bk-b', 'bk-c'])
  })
})

describe('adjacentBookIds（详情页翻页）', () => {
  const sorted = filterAndSortRows(rows, {}) // [bk-a, bk-b, bk-c]

  it('中间行 prev/next 正确；首/末行边界为 null', () => {
    expect(adjacentBookIds(sorted, 'bk-b')).toEqual({ prevId: 'bk-a', nextId: 'bk-c' })
    expect(adjacentBookIds(sorted, 'bk-a')).toEqual({ prevId: null, nextId: 'bk-b' })
    expect(adjacentBookIds(sorted, 'bk-c')).toEqual({ prevId: 'bk-b', nextId: null })
  })

  it('未知 bookId → 双 null（防翻页死链）', () => {
    expect(adjacentBookIds(sorted, 'bk-unknown')).toEqual({ prevId: null, nextId: null })
  })

  it('单行 → 双 null', () => {
    expect(adjacentBookIds([sorted[0]!], 'bk-a')).toEqual({ prevId: null, nextId: null })
  })
})
