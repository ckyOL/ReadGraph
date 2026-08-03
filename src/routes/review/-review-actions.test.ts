// review 规格 §5/§6：/review 数据库动作单测（fake-indexeddb，复用 run-import 测试模式）。
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
  completePlaceholder,
  markNotSet,
  mergePlaceholderInto,
  saveSetBook,
  searchMergeTargets,
  splitSetBook,
} from './-review-actions'

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

describe('completePlaceholder — 补全书目', () => {
  it('写补全字段 + needsReview=false，解除待审', async () => {
    const ph = makeBook('bk-ph', null, '福田图书馆读者自选图书', true)
    await putAll([ph])
    await completePlaceholder(db, 'bk-ph', {
      title: '真实的书',
      authors: ['作者甲'],
      isbn13: '9780000000001',
      isbn10: null,
    })
    const after = (await db.books.get('bk-ph'))!
    expect(after.title).toBe('真实的书')
    expect(after.authors).toEqual(['作者甲'])
    expect(after.isbn13).toBe('9780000000001')
    expect(after.needsReview).toBe(false)
  })

  it('非法 ISBN-13 经 zod 拒绝且不写库（回滚）', async () => {
    const ph = makeBook('bk-ph', null, '福田图书馆读者自选图书', true)
    await putAll([ph])
    await expect(
      completePlaceholder(db, 'bk-ph', {
        title: '坏 ISBN',
        authors: [],
        isbn13: '123', // 非 13 位纯数字
        isbn10: null,
      }),
    ).rejects.toThrow()
    const after = (await db.books.get('bk-ph'))!
    expect(after.title).toBe('福田图书馆读者自选图书')
    expect(after.needsReview).toBe(true)
  })

  it('书不存在抛错', async () => {
    await expect(
      completePlaceholder(db, 'nope', { title: 'x', authors: [], isbn13: null, isbn10: null }),
    ).rejects.toThrow()
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

describe('saveSetBook — 保存为套装', () => {
  it('写各编目 volume + Book.title + needsReview=false', async () => {
    const set = makeBook('bk-set', '9787574012745', '合成书目052 : 合成副题 52 . 3')
    set.needsReview = true
    const cr3 = makeCatalog('cr-v3', 'bk-set', 'src-sz', 'B3', 7109377)
    const cr4 = makeCatalog('cr-v4', 'bk-set', 'src-sz', 'B4', 7109378)
    await putAll([set], [cr3, cr4])

    await saveSetBook(
      db,
      'bk-set',
      '合成书目',
      new Map([
        ['cr-v3', '3'],
        ['cr-v4', '4'],
      ]),
    )

    const book = (await db.books.get('bk-set'))!
    expect(book.title).toBe('合成书目')
    expect(book.needsReview).toBe(false)
    expect((await db.catalogRecords.get('cr-v3'))!.volume).toBe('3')
    expect((await db.catalogRecords.get('cr-v4'))!.volume).toBe('4')
  })

  it('volume 清空（空串 → null）；未出现在表单的编目不动', async () => {
    const set = makeBook('bk-set', '9787574012745', 'x', true)
    const cr3 = makeCatalog('cr-v3', 'bk-set', 'src-sz', 'B3', 7109377)
    const cr4 = makeCatalog('cr-v4', 'bk-set', 'src-sz', 'B4', 7109378)
    cr4.volume = '4'
    await putAll([set], [cr3, cr4])

    await saveSetBook(db, 'bk-set', 'x', new Map([['cr-v3', '']]))

    expect((await db.catalogRecords.get('cr-v3'))!.volume).toBeNull()
    expect((await db.catalogRecords.get('cr-v4'))!.volume).toBe('4')
  })
})

describe('markNotSet — 不是套装', () => {
  it('仅 needsReview=false，title/volume 不动', async () => {
    const set = makeBook('bk-set', '9787574012745', '原题名', true)
    const cr3 = makeCatalog('cr-v3', 'bk-set', 'src-sz', 'B3', 7109377)
    cr3.volume = '3'
    await putAll([set], [cr3])
    await markNotSet(db, 'bk-set')
    expect((await db.books.get('bk-set'))!.needsReview).toBe(false)
    expect((await db.books.get('bk-set'))!.title).toBe('原题名')
    expect((await db.catalogRecords.get('cr-v3'))!.volume).toBe('3')
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
