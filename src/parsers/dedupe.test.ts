import { describe, it, expect } from 'vitest'

import type { Book, CatalogRecord } from '@/types/entities'
import { dedupeCatalogsAndBooks, dedupeBorrowCycles } from './dedupe'
import { szlibParser } from './szlib'

type DedupeState = {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: never[]
}

function mkBook(p: Partial<Book>): Book {
  return {
    id: 'bk-existing',
    isbn13: null,
    isbn10: null,
    title: '',
    subtitle: null,
    authors: [],
    translators: [],
    publisher: null,
    publishDate: null,
    edition: null,
    pages: null,
    price: null,
    subjects: [],
    tags: [],
    coverUrl: null,
    description: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    needsReview: false,
    sourceIds: [],
    parallelTitles: [],
    ...p,
  } as Book
}

function mkCatalog(p: Partial<CatalogRecord>): CatalogRecord {
  return {
    id: 'cr-existing',
    bookId: 'bk-existing',
    sourceId: 'szlib',
    metaId: null,
    metaIdKey: null,
    barcodes: [],
    classifications: [],
    volume: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...p,
  } as CatalogRecord
}

describe('dedupeCatalogsAndBooks', () => {
  it('编目级 sourceId+barcode 命中：沿用 existing bookId', () => {
    const existing: DedupeState = {
      books: [mkBook({ id: 'bk-A', isbn13: '97877521748239' })],
      catalogRecords: [mkCatalog({ id: 'cr-A', bookId: 'bk-A', barcodes: ['B1'] })],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'szlib', barcodes: ['B1'], metaIdKey: null },
          bookPartial: { isbn13: '97877521748239', title: 'A', sourceIds: ['szlib'] },
          isPlaceholder: false,
        },
      ],
      ['B1'],
      existing,
      szlibParser,
    )
    expect(r.bookIdByBarcode.get('B1')).toBe('bk-A')
    expect(r.warnings).toEqual([])
  })

  it('ISBN 命中：新 CatalogRecord 挂到 existing Book', () => {
    const existing: DedupeState = {
      books: [mkBook({ id: 'bk-ISBN', isbn13: '97877116000009' })],
      catalogRecords: [],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'szlib', barcodes: ['B9'], metaIdKey: '7000001' },
          bookPartial: { isbn13: '97877116000009', title: '合成编程指南', sourceIds: ['szlib'] },
          isPlaceholder: false,
        },
      ],
      ['B9'],
      existing,
      szlibParser,
    )
    expect(r.bookIdByBarcode.get('B9')).toBe('bk-ISBN')
  })

  it('无 ISBN 模糊命中（title+author）置 needsReview 并记 duplicate 警告', () => {
    const existing: DedupeState = {
      books: [
        mkBook({ id: 'bk-fuzzy', isbn13: null, title: '合成图解手册', authors: ['合成作者乙'] }),
      ],
      catalogRecords: [],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'szlib', barcodes: ['BX'], metaIdKey: '42' },
          bookPartial: { isbn13: null, title: '合成图解手册', authors: ['合成作者乙'], sourceIds: ['szlib'] },
          isPlaceholder: false,
        },
      ],
      ['BX'],
      existing,
      szlibParser,
    )
    expect(r.bookIdByBarcode.get('BX')).toBe('bk-fuzzy')
    expect(r.warnings.some((w) => w.type === 'duplicate')).toBe(true)
  })

  it('选书帮分支：各 barcode 独立、不与 existing 合并（含其它选书帮 Book）', () => {
    const existing: DedupeState = {
      books: [mkBook({ id: 'bk-ph-old', needsReview: true, title: '福田图书馆读者自选图书' })],
      catalogRecords: [],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        { partial: { sourceId: 'szlib', barcodes: ['PH1'] }, bookPartial: { title: '福田图书馆读者自选图书', needsReview: true, isbn13: null }, isPlaceholder: true },
        { partial: { sourceId: 'szlib', barcodes: ['PH2'] }, bookPartial: { title: '福田图书馆读者自选图书', needsReview: true, isbn13: null }, isPlaceholder: true },
      ],
      ['PH1', 'PH2'],
      existing,
      szlibParser,
    )
    expect(r.bookIdByBarcode.get('PH1')).not.toBe('bk-ph-old')
    expect(r.bookIdByBarcode.get('PH2')).not.toBe('bk-ph-old')
    expect(r.bookIdByBarcode.get('PH1')).not.toBe(r.bookIdByBarcode.get('PH2'))
  })

  it('批次内同 ISBN/同题同著者候选复用同一 token；不同书 token 互不相同（&isbn13 唯一索引回归）', () => {
    const r = dedupeCatalogsAndBooks(
      [
        { partial: { sourceId: 'szlib', barcodes: ['C1'], metaIdKey: '11' }, bookPartial: { isbn13: '9780000000001', title: '甲书', authors: ['甲著'] }, isPlaceholder: false },
        { partial: { sourceId: 'szlib', barcodes: ['C2'], metaIdKey: '12' }, bookPartial: { isbn13: '9780000000001', title: '甲书', authors: ['甲著'] }, isPlaceholder: false },
        { partial: { sourceId: 'szlib', barcodes: ['C3'], metaIdKey: '13' }, bookPartial: { isbn13: '9780000000002', title: '乙书', authors: ['乙著'] }, isPlaceholder: false },
        { partial: { sourceId: 'szlib', barcodes: ['C4'], metaIdKey: '14' }, bookPartial: { isbn13: null, title: '丙书', authors: ['丙著'] }, isPlaceholder: false },
        { partial: { sourceId: 'szlib', barcodes: ['C5'], metaIdKey: '15' }, bookPartial: { isbn13: null, title: '丙书', authors: ['丙著'] }, isPlaceholder: false },
      ],
      ['C1', 'C2', 'C3', 'C4', 'C5'],
      { books: [], catalogRecords: [], borrowCycles: [] },
      szlibParser,
    )
    // bookIds 与候选逐位对齐：同 ISBN 两副本同一 token，不同 ISBN 不同 token，
    // 无 ISBN 同题同著者同一 token。
    expect(r.bookIds).toEqual([
      'new:isbn:9780000000001',
      'new:isbn:9780000000001',
      'new:isbn:9780000000002',
      'new:noisbn:丙书|丙著',
      'new:noisbn:丙书|丙著',
    ])
    // barcode 映射与逐位结果一致。
    expect(r.bookIdByBarcode.get('C1')).toBe('new:isbn:9780000000001')
    expect(r.bookIdByBarcode.get('C3')).toBe('new:isbn:9780000000002')
    expect(r.bookIdByBarcode.get('C4')).toBe('new:noisbn:丙书|丙著')
  })

  it('同 ISBN 合并已有 Book：同源异 metaid → 合并 + 置标 + 警告含双方 metaid', () => {
    const existing: DedupeState = {
      books: [
        mkBook({
          id: 'bk-set',
          isbn13: '9787574012745',
          title: '合成书目052 : 合成副题 52 . 3',
        }),
      ],
      catalogRecords: [
        mkCatalog({ id: 'cr-v3', bookId: 'bk-set', barcodes: ['B3'], metaIdKey: '7109377' }),
      ],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'szlib', barcodes: ['B4'], metaIdKey: '7109378' },
          bookPartial: {
            isbn13: '9787574012745',
            title: '合成书目053 : 合成副题 53 . 4',
            sourceIds: ['szlib'],
          },
          isPlaceholder: false,
        },
      ],
      ['B4'],
      existing,
      szlibParser,
    )
    expect(r.bookIdByBarcode.get('B4')).toBe('bk-set')
    expect(r.reviewFlags).toEqual([true])
    const flagged = r.state.books.find((b) => b.id === 'bk-set')!
    expect(flagged.needsReview).toBe(true)
    const w = r.warnings.find((x) => x.type === 'duplicate')
    expect(w?.message).toContain('7109377')
    expect(w?.message).toContain('7109378')
  })

  it('同 ISBN 合并已有 Book：同源同 metaid 多复本 → 不置标', () => {
    const existing: DedupeState = {
      books: [mkBook({ id: 'bk-copy', isbn13: '9780000000001', title: '甲书' })],
      catalogRecords: [
        mkCatalog({ id: 'cr-a', bookId: 'bk-copy', barcodes: ['A1'], metaIdKey: '9001' }),
      ],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'szlib', barcodes: ['A2'], metaIdKey: '9001' },
          bookPartial: { isbn13: '9780000000001', title: '甲书', sourceIds: ['szlib'] },
          isPlaceholder: false,
        },
      ],
      ['A2'],
      existing,
      szlibParser,
    )
    expect(r.reviewFlags).toEqual([false])
    expect(r.state.books.find((b) => b.id === 'bk-copy')!.needsReview).toBe(false)
    expect(r.warnings).toEqual([])
  })

  it('同 ISBN 合并已有 Book：跨源异题名 → 置标；跨源同题名 → 不置标', () => {
    const existing: DedupeState = {
      books: [mkBook({ id: 'bk-cross', isbn13: '9780000000002', title: '甲书' })],
      catalogRecords: [
        mkCatalog({ id: 'cr-a', bookId: 'bk-cross', barcodes: ['A1'], metaIdKey: '1' }),
      ],
      borrowCycles: [],
    }
    // 跨源异题名（乙书）：合并但置标。
    const diff = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'srcB', barcodes: ['B1'], metaIdKey: '2' },
          bookPartial: { isbn13: '9780000000002', title: '乙书', sourceIds: ['srcB'] },
          isPlaceholder: false,
        },
      ],
      ['B1'],
      existing,
      szlibParser,
    )
    expect(diff.reviewFlags).toEqual([true])
    expect(diff.state.books.find((b) => b.id === 'bk-cross')!.needsReview).toBe(true)
    // 跨源同题名（甲书）：正常跨馆合并，不置标。
    const same = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'srcB', barcodes: ['B2'], metaIdKey: '3' },
          bookPartial: { isbn13: '9780000000002', title: '甲书', sourceIds: ['srcB'] },
          isPlaceholder: false,
        },
      ],
      ['B2'],
      existing,
      szlibParser,
    )
    expect(same.reviewFlags).toEqual([false])
    expect(same.state.books.find((b) => b.id === 'bk-cross')!.needsReview).toBe(false)
  })

  it('批内同 ISBN 不同 metaid（卷 3/卷 4）→ 组首候选置标 + 警告含双方 metaid', () => {
    const r = dedupeCatalogsAndBooks(
      [
        { partial: { sourceId: 'szlib', barcodes: ['V3'], metaIdKey: '7109377' }, bookPartial: { isbn13: '9787574012745', title: '合成书目052', authors: ['甲'] }, isPlaceholder: false },
        { partial: { sourceId: 'szlib', barcodes: ['V4'], metaIdKey: '7109378' }, bookPartial: { isbn13: '9787574012745', title: '合成书目053', authors: ['甲'] }, isPlaceholder: false },
      ],
      ['V3', 'V4'],
      { books: [], catalogRecords: [], borrowCycles: [] },
      szlibParser,
    )
    expect(r.bookIds).toEqual(['new:isbn:9787574012745', 'new:isbn:9787574012745'])
    // 置标传播到组首候选（pipeline 在组首建 Book 时置 needsReview）。
    expect(r.reviewFlags).toEqual([true, true])
    const w = r.warnings.find((x) => x.type === 'duplicate')
    expect(w?.message).toContain('7109377')
    expect(w?.message).toContain('7109378')
  })

  it('批内同 ISBN 同 metaid 多副本（一书多册）→ 不置标', () => {
    const r = dedupeCatalogsAndBooks(
      [
        { partial: { sourceId: 'szlib', barcodes: ['C1'], metaIdKey: '9001' }, bookPartial: { isbn13: '9780000000001', title: '甲书', authors: ['甲著'] }, isPlaceholder: false },
        { partial: { sourceId: 'szlib', barcodes: ['C2'], metaIdKey: '9001' }, bookPartial: { isbn13: '9780000000001', title: '甲书', authors: ['甲著'] }, isPlaceholder: false },
      ],
      ['C1', 'C2'],
      { books: [], catalogRecords: [], borrowCycles: [] },
      szlibParser,
    )
    expect(r.reviewFlags).toEqual([false, false])
    expect(r.warnings).toEqual([])
  })

  it('空条码候选不命中 barcode 索引（多书共享空键 last-wins 会错挂到别的书），按 metaIdKey 消歧（回归）', () => {
    // existing 两个空条码编目：metaIdKey 4942259（挂 bk-A）后写 → crByBarcode['szlib|'] = 4942259。
    // 新候选 metaIdKey 4080461 若命中 barcode 索引会错挂到 bk-A；必须按 metaIdKey 命中 bk-B。
    const existing: DedupeState = {
      books: [
        mkBook({ id: 'bk-A', isbn13: '9789862358436' }),
        mkBook({ id: 'bk-B', isbn13: '9789869408844' }),
      ],
      catalogRecords: [
        mkCatalog({ id: 'cr-4942259', bookId: 'bk-A', barcodes: [''], metaIdKey: '4942259' }),
        mkCatalog({ id: 'cr-4080461', bookId: 'bk-B', barcodes: [''], metaIdKey: '4080461' }),
      ],
      borrowCycles: [],
    }
    const r = dedupeCatalogsAndBooks(
      [
        {
          partial: { sourceId: 'szlib', barcodes: [''], metaIdKey: '4080461' },
          bookPartial: { isbn13: '9789869408844', title: '测试书目', sourceIds: ['szlib'] },
          isPlaceholder: false,
        },
      ],
      [''],
      existing,
      szlibParser,
    )
    expect(r.bookIds).toEqual(['bk-B'])
    expect(r.bookIdByBarcode.get('')).toBe('bk-B')
  })
})

describe('dedupeBorrowCycles', () => {
  const t = new Date('2026-05-01T01:00:00.000Z')
  const t2 = new Date('2026-06-01T02:00:00.000Z')

  it('精确重复（sourceId+barcode+borrowedAt）跳过，记 duplicate 警告', () => {
    const existing = [{ id: 'cy-1', bookId: 'bk', catalogRecordId: 'cr', sourceId: 'szlib', barcode: 'B1', borrowedAt: t, returnedAt: t2, status: 'returned' as const, borrowLocation: null, returnLocation: null, rawRecordIds: ['r1'], createdAt: t, updatedAt: t }]
    const r = dedupeBorrowCycles(
      [{ sourceId: 'szlib', barcode: 'B1', borrowedAt: t, returnedAt: t2, status: 'returned', borrowLocation: null, returnLocation: null, rawRecordIds: ['r2'] }],
      existing,
    )
    expect(r.skippedFlags).toEqual([true])
    expect(r.cycles.length).toBe(1)
    expect(r.warnings.some((w) => w.type === 'duplicate')).toBe(true)
  })

  it('批次内重复（同批两条相同行）仅保留一条，记 duplicate 警告', () => {
    const cand: Parameters<typeof dedupeBorrowCycles>[0][number] = {
      sourceId: 'szlib',
      barcode: 'B1',
      borrowedAt: t,
      returnedAt: t2,
      status: 'returned',
      borrowLocation: null,
      returnLocation: null,
      rawRecordIds: ['r2'],
    }
    const r = dedupeBorrowCycles([cand, { ...cand, rawRecordIds: ['r9'] }], [])
    expect(r.skippedFlags).toEqual([false, true])
    expect(r.cycles).toHaveLength(1)
    expect(r.warnings.filter((w) => w.type === 'duplicate')).toHaveLength(1)
  })

  it('批次内重复不干扰不同 borrowedAt 的合法周期', () => {
    const cand: Parameters<typeof dedupeBorrowCycles>[0][number] = {
      sourceId: 'szlib',
      barcode: 'B1',
      borrowedAt: t,
      returnedAt: t2,
      status: 'returned',
      borrowLocation: null,
      returnLocation: null,
      rawRecordIds: ['r2'],
    }
    const later = new Date('2026-07-01T00:00:00.000Z')
    const r = dedupeBorrowCycles(
      [cand, { ...cand, borrowedAt: later, rawRecordIds: ['r7'] }],
      [],
    )
    expect(r.skippedFlags).toEqual([false, false])
    expect(r.cycles).toHaveLength(2)
    expect(r.warnings).toEqual([])
  })

  it('时间重叠（同 barcode 同 borrowedAt 但 status 返回）记 unpaired_record', () => {
    const existing = [{ id: 'cy-1', bookId: 'bk', catalogRecordId: 'cr', sourceId: 'szlib', barcode: 'B1', borrowedAt: t, returnedAt: t2, status: 'returned' as const, borrowLocation: null, returnLocation: null, rawRecordIds: ['r1'], createdAt: t, updatedAt: t }]
    const tMid = new Date('2026-05-15T01:00:00.000Z')
    const r = dedupeBorrowCycles(
      [{ sourceId: 'szlib', barcode: 'B1', borrowedAt: tMid, returnedAt: null, status: 'borrowed', borrowLocation: null, returnLocation: null, rawRecordIds: ['r3'] }],
      existing,
    )
    expect(r.skippedFlags).toEqual([false])
    expect(r.warnings.some((w) => w.type === 'unpaired_record')).toBe(true)
  })

  it('跨文件闭合：纯还回候选（borrowedAt==returnedAt）闭合同 barcode 既有开放周期，不新建周期', () => {
    const tB = new Date('2026-03-31T05:04:36.000Z')
    const tR = new Date('2026-04-25T09:12:48.000Z')
    const existing = [{ id: 'cy-1', bookId: 'bk', catalogRecordId: 'cr', sourceId: 'szlib', barcode: 'B1', borrowedAt: tB, returnedAt: null, status: 'borrowed' as const, borrowLocation: '测试馆', returnLocation: null, rawRecordIds: ['r1'], createdAt: tB, updatedAt: tB }]
    const r = dedupeBorrowCycles(
      [{ sourceId: 'szlib', barcode: 'B1', borrowedAt: tR, returnedAt: tR, status: 'unknown', borrowLocation: null, returnLocation: '中心馆', rawRecordIds: ['r2'] }],
      existing,
    )
    expect(r.skippedFlags).toEqual([true])
    expect(r.cycles).toHaveLength(1)
    const c = r.cycles[0]!
    expect(c.id).toBe('cy-1')
    expect(c.borrowedAt.getTime()).toBe(tB.getTime())
    expect(c.returnedAt!.getTime()).toBe(tR.getTime())
    expect(c.status).toBe('returned')
    expect(c.returnLocation).toBe('中心馆')
    expect(c.borrowLocation).toBe('测试馆')
    expect(c.rawRecordIds).toEqual(['r1', 'r2'])
    // 跨文件闭合是正常配对，不产生警告。
    expect(r.warnings).toEqual([])
  })

  it('跨文件闭合不误伤：无既有开放周期时，纯还回候选仍新建周期', () => {
    const tR = new Date('2026-04-25T09:12:48.000Z')
    const r = dedupeBorrowCycles(
      [{ sourceId: 'szlib', barcode: 'B9', borrowedAt: tR, returnedAt: tR, status: 'unknown', borrowLocation: null, returnLocation: null, rawRecordIds: ['r5'] }],
      [],
    )
    expect(r.skippedFlags).toEqual([false])
    expect(r.cycles).toHaveLength(1)
    expect(r.cycles[0]!.status).toBe('unknown')
  })

  it('跨文件闭合按 bookId 配对：空条码纯还回不找「第一个」开放周期（回归）', () => {
    // 空条码多书：existing 有三个开放周期（borrowedAt 依次 0401/0510/0517）。
    // 纯还回候选（0526，归属 bookId=bk-C）必须闭合同 bk-C 的开放周期（0517），
    // 而不是旧逻辑按条码找到的第一个开放周期（0401，bk-A）。
    const mk = (id: string, bookId: string, at: string): Parameters<typeof dedupeBorrowCycles>[1][number] => ({
      id,
      bookId,
      catalogRecordId: id,
      sourceId: 'szlib',
      barcode: null,
      borrowedAt: new Date(at),
      returnedAt: null,
      status: 'borrowed' as const,
      borrowLocation: null,
      returnLocation: null,
      rawRecordIds: [],
      createdAt: new Date(at),
      updatedAt: new Date(at),
    })
    const existing = [
      mk('cy-A', 'bk-A', '2026-04-01T02:00:00.000Z'),
      mk('cy-B', 'bk-B', '2026-05-10T02:00:00.000Z'),
      mk('cy-C', 'bk-C', '2026-05-17T02:00:00.000Z'),
    ]
    const tR = new Date('2026-05-26T02:00:00.000Z')
    const r = dedupeBorrowCycles(
      [{ sourceId: 'szlib', barcode: null, metaIdKey: 'C', bookId: 'bk-C', borrowedAt: tR, returnedAt: tR, status: 'unknown', borrowLocation: null, returnLocation: null, rawRecordIds: ['r2'] }],
      existing,
    )
    expect(r.skippedFlags).toEqual([true])
    expect(r.cycles).toHaveLength(3)
    const c = r.cycles.find((x) => x.id === 'cy-C')!
    expect(c.returnedAt!.getTime()).toBe(tR.getTime())
    expect(c.status).toBe('returned')
    expect(c.rawRecordIds).toEqual(['r2'])
    // bk-A / bk-B 的开放周期保持开放（未被误闭合）。
    expect(r.cycles.find((x) => x.id === 'cy-A')!.returnedAt).toBeNull()
    expect(r.cycles.find((x) => x.id === 'cy-B')!.returnedAt).toBeNull()
  })

  it('跨文件闭合：空条码且无书目身份的纯还回不配对（无法消歧，宁可不挂）', () => {
    const tB = new Date('2026-04-01T02:00:00.000Z')
    const tR = new Date('2026-05-26T02:00:00.000Z')
    const existing = [{ id: 'cy-1', bookId: 'bk-A', catalogRecordId: 'cr', sourceId: 'szlib', barcode: null, borrowedAt: tB, returnedAt: null, status: 'borrowed' as const, borrowLocation: null, returnLocation: null, rawRecordIds: ['r1'], createdAt: tB, updatedAt: tB }]
    const r = dedupeBorrowCycles(
      [{ sourceId: 'szlib', barcode: null, borrowedAt: tR, returnedAt: tR, status: 'unknown', borrowLocation: null, returnLocation: null, rawRecordIds: ['r2'] }],
      existing,
    )
    // 候选无 bookId/metaIdKey 且空条码：旧逻辑会错配到 bk-A，现在保留纯还回。
    expect(r.skippedFlags).toEqual([false])
    expect(r.cycles).toHaveLength(2)
  })
})
