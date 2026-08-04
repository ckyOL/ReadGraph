// book-editing 规格 §2/§4/§7：统一编辑动作库单测（fake-indexeddb，原 review/-review-actions.test.ts 迁移）。
import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import type { ReadGraphDB } from '@/db/db'
import {
  closeTestDB,
  createTestDB,
  installFakeIndexedDB,
  makeBook,
  makeCatalog,
  makeCycle,
  makeRawRecord,
} from '@/db/test-helpers'
import type { Book, BorrowCycle, CatalogRecord, RawRecord } from '@/types/entities'
import {
  IsbnConflictError,
  markReviewed,
  mergePlaceholderInto,
  searchMergeTargets,
  splitSetBook,
  updateBookWithRecords,
  type BookDraft,
  type CatalogRecordDraft,
} from './-edit-actions'

installFakeIndexedDB()

let db: ReadGraphDB

beforeEach(() => {
  db = createTestDB()
})

afterEach(() => {
  closeTestDB(db)
})

async function putAll(
  books: Book[],
  crs: CatalogRecord[] = [],
  cycles: BorrowCycle[] = [],
  raws: RawRecord[] = [],
): Promise<void> {
  if (books.length) await db.books.bulkPut(books)
  if (crs.length) await db.catalogRecords.bulkPut(crs)
  if (cycles.length) await db.borrowCycles.bulkPut(cycles)
  if (raws.length) await db.rawRecords.bulkPut(raws)
}

function draft(over: Partial<BookDraft> = {}): BookDraft {
  return {
    title: '真实的书',
    subtitle: null,
    parallelTitles: [],
    authors: ['作者甲'],
    translators: [],
    publisher: null,
    publishDate: null,
    edition: null,
    pages: null,
    price: null,
    isbn13: null,
    isbn10: null,
    subjects: [],
    tags: [],
    description: null,
    coverUrl: null,
    ...over,
  }
}

describe('updateBookWithRecords — 统一保存（补全/套装/普通编辑合流）', () => {
  it('写全字段 + needsReview=false，解除待审（占位补全语义）', async () => {
    const ph = makeBook('bk-ph', null, '福田图书馆读者自选图书', true)
    await putAll([ph])
    await updateBookWithRecords(
      db,
      'bk-ph',
      draft({
        title: '真实的书',
        authors: ['作者甲'],
        subtitle: '副题',
        parallelTitles: ['Parallel Title'],
        translators: ['译者乙'],
        publisher: '出版社',
        publishDate: '2024-05',
        edition: '第2版',
        pages: 320,
        price: { amount: 45.5, currency: 'CNY' },
        isbn13: '9780000000001',
        isbn10: null,
        subjects: ['文学'],
        tags: ['想重读'],
        description: '简介',
        coverUrl: 'https://example.com/cover.jpg',
      }),
      [],
    )
    const after = (await db.books.get('bk-ph'))!
    expect(after.title).toBe('真实的书')
    expect(after.authors).toEqual(['作者甲'])
    expect(after.subtitle).toBe('副题')
    expect(after.parallelTitles).toEqual(['Parallel Title'])
    expect(after.translators).toEqual(['译者乙'])
    expect(after.publisher).toBe('出版社')
    expect(after.publishDate).toBe('2024-05')
    expect(after.edition).toBe('第2版')
    expect(after.pages).toBe(320)
    expect(after.price).toEqual({ amount: 45.5, currency: 'CNY' })
    expect(after.isbn13).toBe('9780000000001')
    expect(after.subjects).toEqual(['文学'])
    expect(after.tags).toEqual(['想重读'])
    expect(after.description).toBe('简介')
    expect(after.coverUrl).toBe('https://example.com/cover.jpg')
    expect(after.needsReview).toBe(false)
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(after.createdAt.getTime())
  })

  it('写各编目 volume/barcodes/classifications（套装保存语义）', async () => {
    const set = makeBook('bk-set', '9787574012745', '合成书目052 : 合成副题 52 . 3', true)
    const cr3 = makeCatalog('cr-v3', 'bk-set', 'src-sz', 'B3', 7109377)
    const cr4 = makeCatalog('cr-v4', 'bk-set', 'src-sz', 'B4', 7109378)
    await putAll([set], [cr3, cr4])

    await updateBookWithRecords(
      db,
      'bk-set',
      draft({ title: '合成书目', isbn13: '9787574012745' }),
      [
        { id: 'cr-v3', metaId: '7109377', volume: '3', barcodes: ['B3', 'B3X'], classifications: [{ system: 'clc', code: 'I247' }] },
        { id: 'cr-v4', metaId: '7109378', volume: '4', barcodes: ['B4'], classifications: [] },
      ],
    )

    const book = (await db.books.get('bk-set'))!
    expect(book.title).toBe('合成书目')
    expect(book.needsReview).toBe(false)
    expect((await db.catalogRecords.get('cr-v3'))!.volume).toBe('3')
    expect((await db.catalogRecords.get('cr-v3'))!.barcodes).toEqual(['B3', 'B3X'])
    expect((await db.catalogRecords.get('cr-v3'))!.classifications).toEqual([
      { system: 'clc', code: 'I247' },
    ])
    expect((await db.catalogRecords.get('cr-v4'))!.volume).toBe('4')
  })

  it('volume 清空（null）；未出现在表单的编目不动', async () => {
    const set = makeBook('bk-set', '9787574012745', 'x', true)
    const cr3 = makeCatalog('cr-v3', 'bk-set', 'src-sz', 'B3', 7109377)
    const cr4 = makeCatalog('cr-v4', 'bk-set', 'src-sz', 'B4', 7109378)
    cr4.volume = '4'
    await putAll([set], [cr3, cr4])

    await updateBookWithRecords(db, 'bk-set', draft({ title: 'x', isbn13: '9787574012745' }), [
      { id: 'cr-v3', metaId: '7109377', volume: null, barcodes: ['B3'], classifications: [] },
    ])

    expect((await db.catalogRecords.get('cr-v3'))!.volume).toBeNull()
    expect((await db.catalogRecords.get('cr-v4'))!.volume).toBe('4')
  })

  it('metaId 可编辑：写入 + metaIdKey 派生（空白清空为 null）', async () => {
    const set = makeBook('bk-set', '9787574012745', 'x', true)
    const cr3 = makeCatalog('cr-v3', 'bk-set', 'src-sz', 'B3', 7109377)
    const cr4 = makeCatalog('cr-v4', 'bk-set', 'src-sz', 'B4', 7109378)
    await putAll([set], [cr3, cr4])

    // 改馆藏号（含首尾空白 → trim）+ 清空另一条 → metaId/metaIdKey 同步。
    await updateBookWithRecords(db, 'bk-set', draft({ title: 'x', isbn13: '9787574012745' }), [
      { id: 'cr-v3', metaId: '  8888888  ', volume: null, barcodes: ['B3'], classifications: [] },
      { id: 'cr-v4', metaId: '', volume: null, barcodes: ['B4'], classifications: [] },
    ])

    const after3 = (await db.catalogRecords.get('cr-v3'))!
    expect(after3.metaId).toBe('8888888')
    expect(after3.metaIdKey).toBe('8888888') // 派生：String(metaId).trim()
    const after4 = (await db.catalogRecords.get('cr-v4'))!
    expect(after4.metaId).toBeNull()
    expect(after4.metaIdKey).toBeNull()
  })

  it('非法 ISBN-13 经 zod 拒绝且不写库（回滚）', async () => {
    const ph = makeBook('bk-ph', null, '福田图书馆读者自选图书', true)
    await putAll([ph])
    await expect(
      updateBookWithRecords(db, 'bk-ph', draft({ isbn13: '123' }), []), // 非 13 位纯数字
    ).rejects.toThrow()
    const after = (await db.books.get('bk-ph'))!
    expect(after.title).toBe('福田图书馆读者自选图书')
    expect(after.needsReview).toBe(true)
  })

  it('ISBN 唯一冲突（他书占用）抛 IsbnConflictError 且回滚', async () => {
    const ph = makeBook('bk-ph', null, '福田图书馆读者自选图书', true)
    const other = makeBook('bk-other', '9780000000001', '已占用的书')
    await putAll([ph, other])
    await expect(
      updateBookWithRecords(db, 'bk-ph', draft({ title: '改了题名', isbn13: '9780000000001' }), []),
    ).rejects.toBeInstanceOf(IsbnConflictError)
    // 回滚：占位书未被修改。
    const after = (await db.books.get('bk-ph'))!
    expect(after.title).toBe('福田图书馆读者自选图书')
    expect(after.needsReview).toBe(true)
  })

  it('改自身 ISBN 为同值通过（不视为冲突）', async () => {
    const ph = makeBook('bk-ph', '9780000000001', '原题名', true)
    await putAll([ph])
    await updateBookWithRecords(db, 'bk-ph', draft({ isbn13: '9780000000001' }), [])
    expect((await db.books.get('bk-ph'))!.needsReview).toBe(false)
  })

  it('书不存在抛错', async () => {
    await expect(updateBookWithRecords(db, 'nope', draft(), [])).rejects.toThrow()
  })
})

describe('markReviewed — 标记为已确认（原「不是套装」）', () => {
  it('仅 needsReview=false，title/volume 不动', async () => {
    const set = makeBook('bk-set', '9787574012745', '原题名', true)
    const cr3 = makeCatalog('cr-v3', 'bk-set', 'src-sz', 'B3', 7109377)
    cr3.volume = '3'
    await putAll([set], [cr3])
    await markReviewed(db, 'bk-set')
    expect((await db.books.get('bk-set'))!.needsReview).toBe(false)
    expect((await db.books.get('bk-set'))!.title).toBe('原题名')
    expect((await db.catalogRecords.get('cr-v3'))!.volume).toBe('3')
  })
})

describe('mergePlaceholderInto — 合并到已有书目', () => {
  it('编目/周期/原始行重挂目标书，占位书删除，目标书 needsReview 解除', async () => {
    const ph = makeBook('bk-ph', null, '福田图书馆读者自选图书', true)
    const target = makeBook('bk-t', '9780000000002', '目标书')
    const cr1 = makeCatalog('cr-ph1', 'bk-ph', 'src-sz', 'PH1', 7777777)
    const cy1 = makeCycle('cy-ph1', 'bk-ph', 'src-sz', new Date('2026-05-01T00:00:00.000Z'))
    cy1.catalogRecordId = 'cr-ph1'
    const raw1 = makeRawRecord('raw-ph1')
    raw1.bookId = 'bk-ph'
    await putAll([ph, target], [cr1], [cy1], [raw1])

    await mergePlaceholderInto(db, 'bk-ph', 'bk-t')

    expect(await db.books.get('bk-ph')).toBeUndefined()
    const movedCr = (await db.catalogRecords.get('cr-ph1'))!
    expect(movedCr.bookId).toBe('bk-t')
    const movedCy = (await db.borrowCycles.get('cy-ph1'))!
    expect(movedCy.bookId).toBe('bk-t')
    // catalogRecordId 不变：仍指被移挂的编目（物理副本身份保留）。
    expect(movedCy.catalogRecordId).toBe('cr-ph1')
    const movedRaw = (await db.rawRecords.get('raw-ph1'))!
    expect(movedRaw.bookId).toBe('bk-t')
    const afterTarget = (await db.books.get('bk-t'))!
    expect(afterTarget.title).toBe('目标书') // 目标书保持原状
  })

  it('目标书 needsReview=true 时解除', async () => {
    const ph = makeBook('bk-ph', null, '福田图书馆读者自选图书', true)
    const target = makeBook('bk-t', '9787574012745', '套装书', true)
    await putAll([ph, target])
    await mergePlaceholderInto(db, 'bk-ph', 'bk-t')
    expect((await db.books.get('bk-t'))!.needsReview).toBe(false)
  })

  it('自合并（占位=目标）抛错', async () => {
    const ph = makeBook('bk-ph', null, '福田图书馆读者自选图书', true)
    await putAll([ph])
    await expect(mergePlaceholderInto(db, 'bk-ph', 'bk-ph')).rejects.toThrow()
  })
})

describe('splitSetBook — 拆为独立 Book', () => {
  it('按 metaIdKey 分组拆书：title 取编目题名原文、volume 保留、isbn 清空、周期/原始行重挂', async () => {
    const set = makeBook('bk-set', '9787574012745', '合成书目052 : 合成副题 52 . 3', true)
    const cr3 = makeCatalog('cr-v3', 'bk-set', 'src-sz', 'B3', 7109377)
    const cr4 = makeCatalog('cr-v4', 'bk-set', 'src-sz', 'B4', 7109378)
    const cy3 = makeCycle('cy-v3', 'bk-set', 'src-sz', new Date('2026-05-01T00:00:00.000Z'))
    cy3.catalogRecordId = 'cr-v3'
    const cy4 = makeCycle('cy-v4', 'bk-set', 'src-sz', new Date('2026-06-01T00:00:00.000Z'))
    cy4.catalogRecordId = 'cr-v4'
    const raw3 = makeRawRecord('raw-v3')
    raw3.bookId = 'bk-set'
    raw3.data = { metaid: 7109377, barcode: 'B3', title: '合成书目052 : 合成副题 52 . 3' }
    const raw4 = makeRawRecord('raw-v4')
    raw4.bookId = 'bk-set'
    raw4.data = { metaid: 7109378, barcode: 'B4', title: '合成书目053 : 合成副题 53 . 4' }
    await putAll([set], [cr3, cr4], [cy3, cy4], [raw3, raw4])

    await splitSetBook(db, 'bk-set')

    expect(await db.books.get('bk-set')).toBeUndefined()
    const books = await db.books.toArray()
    expect(books).toHaveLength(2)
    const b3 = books.find((b) => b.title === '合成书目052 : 合成副题 52 . 3')!
    const b4 = books.find((b) => b.title === '合成书目053 : 合成副题 53 . 4')!
    expect(b3).toBeDefined()
    expect(b4).toBeDefined()
    for (const b of books) {
      expect(b.isbn13).toBeNull() // 同 ISBN 无法进 &isbn13 唯一索引
      expect(b.isbn10).toBeNull()
      expect(b.needsReview).toBe(false)
    }
    expect((await db.catalogRecords.get('cr-v3'))!.bookId).toBe(b3.id)
    expect((await db.catalogRecords.get('cr-v4'))!.bookId).toBe(b4.id)
    expect((await db.borrowCycles.get('cy-v3'))!.bookId).toBe(b3.id)
    expect((await db.borrowCycles.get('cy-v4'))!.bookId).toBe(b4.id)
    // rawRecords 按 metaid 重指。
    expect((await db.rawRecords.get('raw-v3'))!.bookId).toBe(b3.id)
    expect((await db.rawRecords.get('raw-v4'))!.bookId).toBe(b4.id)
  })

  it('单组（无多卷证据）抛错，库不变', async () => {
    const set = makeBook('bk-set', '9787574012745', 'x', true)
    const cr3 = makeCatalog('cr-v3', 'bk-set', 'src-sz', 'B3', 7109377)
    await putAll([set], [cr3])
    await expect(splitSetBook(db, 'bk-set')).rejects.toThrow()
    expect(await db.books.count()).toBe(1)
  })
})

describe('searchMergeTargets — 合并搜索', () => {
  it('按书名子串命中；排除占位书自身；去重', async () => {
    const ph = makeBook('bk-ph', null, '福田图书馆读者自选图书', true)
    const a = makeBook('bk-a', null, '合成的书')
    const b = makeBook('bk-b', null, '合成二号')
    await putAll([ph, a, b])
    const hits = await searchMergeTargets(db, '合成', 'bk-ph')
    expect(hits.map((h) => h.id).sort()).toEqual(['bk-a', 'bk-b'])
  })

  it('ISBN 关键词归一化后精确命中', async () => {
    const ph = makeBook('bk-ph', null, '福田图书馆读者自选图书', true)
    const a = makeBook('bk-a', '9787111111115', '合成的书')
    await putAll([ph, a])
    // 带连字符的 ISBN 输入 → normalizeIsbn 后命中。
    const hits = await searchMergeTargets(db, '978-7-111-11111-5', 'bk-ph')
    expect(hits.map((h) => h.id)).toEqual(['bk-a'])
  })

  it('空查询 → 空数组', async () => {
    await putAll([makeBook('bk-a', null, '合成的书')])
    expect(await searchMergeTargets(db, '   ', 'bk-x')).toEqual([])
  })
})

// 类型健全性：CatalogRecordDraft 与动作签名对齐（无运行时行为）。
const _draftShape: CatalogRecordDraft = {
  id: 'cr-1',
  metaId: null,
  volume: null,
  barcodes: [],
  classifications: [],
}
void _draftShape
