// /review 页数据库动作（review 规格 §5/§6）。运行时编排：读改写全部走 Dexie
// 事务，写前对实体过 Zod 校验（与 Repository 契约一致，失败整体回滚）。
// 派生逻辑（kind 判定、行聚合、编目题名溯源）在 src/lib/review.ts（纯函数）。
import type { ReadGraphDB } from '@/db/db'
import {
  bookSchema,
  borrowCycleSchema,
  catalogRecordSchema,
  rawRecordSchema,
} from '@/db/schemas'
import { uuid } from '@/db/uuid'
import { normalizeIsbn } from '@/lib/isbn'
import { catalogTitleByRecord } from '@/lib/review'
import { z } from 'zod'
import type { Book, CatalogRecord } from '@/types/entities'

const now = (): Date => new Date()

function validated<S extends z.ZodType>(schema: S, value: z.input<S>): z.output<S> {
  const r = schema.safeParse(value)
  if (!r.success) throw r.error
  return r.data
}

/** 选书帮补全字段（§5 保存：补全 + needsReview=false）。 */
export interface PlaceholderCompletion {
  title: string
  authors: string[]
  isbn13: string | null
  isbn10: string | null
}

/** 补全书目：写补全字段 + needsReview=false。 */
export async function completePlaceholder(
  db: ReadGraphDB,
  bookId: string,
  input: PlaceholderCompletion,
): Promise<void> {
  await db.transaction('rw', db.books, async () => {
    const book = await db.books.get(bookId)
    if (!book) throw new Error(`completePlaceholder: book not found: ${bookId}`)
    const updated: Book = {
      ...book,
      title: input.title,
      authors: input.authors,
      isbn13: input.isbn13,
      isbn10: input.isbn10,
      needsReview: false,
      updatedAt: now(),
    }
    await db.books.put(validated(bookSchema, updated))
  })
}

/**
 * 合并到已有书目（§5 合并确认流）：占位 Book 删除，其 CatalogRecord 与
 * BorrowCycle 重挂目标书（catalogRecordId 不变，仍指被移挂的编目），
 * rawRecords 同步重指；目标书保持原状，needsReview 解除。
 */
export async function mergePlaceholderInto(
  db: ReadGraphDB,
  placeholderId: string,
  targetBookId: string,
): Promise<void> {
  if (placeholderId === targetBookId) {
    throw new Error('mergePlaceholderInto: target must differ from placeholder')
  }
  await db.transaction(
    'rw',
    [db.books, db.catalogRecords, db.borrowCycles, db.rawRecords],
    async () => {
      const placeholder = await db.books.get(placeholderId)
      const target = await db.books.get(targetBookId)
      if (!placeholder) throw new Error(`mergePlaceholderInto: placeholder not found: ${placeholderId}`)
      if (!target) throw new Error(`mergePlaceholderInto: target not found: ${targetBookId}`)

      const crs = await db.catalogRecords.where('bookId').equals(placeholderId).toArray()
      if (crs.length > 0) {
        await db.catalogRecords.bulkPut(
          crs.map((c) => validated(catalogRecordSchema, { ...c, bookId: targetBookId, updatedAt: now() })),
        )
      }
      const cycles = await db.borrowCycles.where('bookId').equals(placeholderId).toArray()
      if (cycles.length > 0) {
        await db.borrowCycles.bulkPut(
          cycles.map((c) => validated(borrowCycleSchema, { ...c, bookId: targetBookId, updatedAt: now() })),
        )
      }
      const raws = await db.rawRecords
        .filter((r) => r.bookId === placeholderId)
        .toArray()
      if (raws.length > 0) {
        await db.rawRecords.bulkPut(
          raws.map((r) => validated(rawRecordSchema, { ...r, bookId: targetBookId })),
        )
      }
      await db.books.delete(placeholderId)
      if (target.needsReview) {
        await db.books.put(
          validated(bookSchema, { ...target, needsReview: false, updatedAt: now() }),
        )
      }
    },
  )
}

/**
 * 保存为套装（§6 保存）：写入各编目 volume（null 清空）+ Book.title +
 * needsReview=false。volumes 键为编目 id；未出现的编目不动。
 */
export async function saveSetBook(
  db: ReadGraphDB,
  bookId: string,
  title: string,
  volumes: ReadonlyMap<string, string | null>,
): Promise<void> {
  await db.transaction('rw', [db.books, db.catalogRecords], async () => {
    const book = await db.books.get(bookId)
    if (!book) throw new Error(`saveSetBook: book not found: ${bookId}`)
    await db.books.put(validated(bookSchema, { ...book, title, needsReview: false, updatedAt: now() }))
    const crs = await db.catalogRecords.where('bookId').equals(bookId).toArray()
    if (crs.length > 0) {
      await db.catalogRecords.bulkPut(
        crs.map((c) => {
          if (!volumes.has(c.id)) return c
          const v = volumes.get(c.id)!
          return validated(catalogRecordSchema, {
            ...c,
            volume: v === '' ? null : v,
            updatedAt: now(),
          })
        }),
      )
    }
  })
}

/** 不是套装（§6）：仅 needsReview=false，title/volume 不动。 */
export async function markNotSet(db: ReadGraphDB, bookId: string): Promise<void> {
  await db.transaction('rw', db.books, async () => {
    const book = await db.books.get(bookId)
    if (!book) throw new Error(`markNotSet: book not found: ${bookId}`)
    await db.books.put(validated(bookSchema, { ...book, needsReview: false, updatedAt: now() }))
  })
}

/**
 * 拆为独立 Book（§6 拆书确认流）：按 metaIdKey 分组拆为多 Book，title 取
 * 各自编目题名原文、volume 保留、needsReview=false；CatalogRecord 与
 * BorrowCycle 按编目重挂；rawRecords 按 metaid/条码重指。
 * 同 ISBN 无法拆分进 books 表 &isbn13 唯一索引 → 拆分书 isbn13/isbn10 置 null
 * （卷级 ISBN 属整套，重导时由去重重新判定）。
 */
export async function splitSetBook(db: ReadGraphDB, bookId: string): Promise<void> {
  await db.transaction(
    'rw',
    [db.books, db.catalogRecords, db.borrowCycles, db.rawRecords],
    async () => {
      const book = await db.books.get(bookId)
      if (!book) throw new Error(`splitSetBook: book not found: ${bookId}`)
      const crs = await db.catalogRecords.where('bookId').equals(bookId).toArray()
      const raws = await db.rawRecords
        .filter((r) => r.bookId === bookId)
        .toArray()
      const titleByCr = catalogTitleByRecord(bookId, crs, raws)

      // 按 metaIdKey 分组；无 metaIdKey 的编目各自独立成组（无法消歧，不合并）。
      const groups = new Map<string, CatalogRecord[]>()
      for (const cr of crs) {
        const key = cr.metaIdKey ?? cr.id
        const arr = groups.get(key) ?? []
        arr.push(cr)
        groups.set(key, arr)
      }
      if (groups.size < 2) {
        throw new Error('splitSetBook: fewer than 2 catalog groups, cannot split')
      }

      const t = now()
      const newBooks: Book[] = []
      const newCrs: CatalogRecord[] = []
      const bookIdByCrId = new Map<string, string>()
      for (const group of groups.values()) {
        const newId = uuid()
        const firstCr = group[0]!
        newBooks.push(
          validated(bookSchema, {
            ...book,
            id: newId,
            title: titleByCr.get(firstCr.id) ?? book.title,
            isbn13: null,
            isbn10: null,
            needsReview: false,
            updatedAt: t,
          }),
        )
        for (const cr of group) {
          bookIdByCrId.set(cr.id, newId)
          newCrs.push(validated(catalogRecordSchema, { ...cr, bookId: newId, updatedAt: t }))
        }
      }
      const cycles = await db.borrowCycles.where('bookId').equals(bookId).toArray()

      await db.books.bulkPut(newBooks)
      await db.catalogRecords.bulkPut(newCrs)
      if (cycles.length > 0) {
        await db.borrowCycles.bulkPut(
          cycles.map((c) =>
            validated(borrowCycleSchema, {
              ...c,
              bookId: bookIdByCrId.get(c.catalogRecordId) ?? c.bookId,
              updatedAt: t,
            }),
          ),
        )
      }
      if (raws.length > 0) {
        const groupKeyOf = (r: (typeof raws)[number]): string | null => {
          const meta = (r.data as { metaid?: unknown }).metaid
          if (meta != null && meta !== 0) return String(meta)
          const bc = String((r.data as { barcode?: unknown }).barcode ?? '')
          return bc !== '' ? bc : null
        }
        // metaIdKey 组键与 raw 的 metaid/条码对应；无键的 raw 保持原 bookId（悬空，溯源只读）。
        const newIdByGroupKey = new Map<string, string>()
        for (const cr of newCrs) {
          const key = cr.metaIdKey ?? cr.barcodes[0] ?? null
          if (key != null) newIdByGroupKey.set(key, cr.bookId)
        }
        await db.rawRecords.bulkPut(
          raws.map((r) => {
            const key = groupKeyOf(r)
            const newBookId = key != null ? newIdByGroupKey.get(key) : undefined
            return validated(rawRecordSchema, {
              ...r,
              bookId: newBookId ?? r.bookId,
            })
          }),
        )
      }
      await db.books.delete(bookId)
    },
  )
}

/**
 * 合并搜索（§5）：searchByTitle + findByIsbn13 合并去重，排除占位书自身。
 * 空查询返回 []；ISBN 关键词先归一化再精确命中。
 */
export async function searchMergeTargets(
  db: ReadGraphDB,
  query: string,
  excludeBookId: string,
): Promise<Book[]> {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const byTitle = await db.books
    .filter((b) => b.title.toLowerCase().includes(needle))
    .toArray()
  const byIsbn: Book[] = []
  const { isbn13 } = normalizeIsbn(query)
  if (isbn13) {
    const hit = await db.books.where('isbn13').equals(isbn13).first()
    if (hit) byIsbn.push(hit)
  }
  const seen = new Set<string>()
  const out: Book[] = []
  for (const b of [...byTitle, ...byIsbn]) {
    if (b.id === excludeBookId || seen.has(b.id)) continue
    seen.add(b.id)
    out.push(b)
  }
  return out
}
