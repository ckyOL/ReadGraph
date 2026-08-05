// 书目统一编辑动作库（book-editing 规格 §2/§4；原 review/-review-actions.ts 迁移合流）。
// 运行时编排：读改写全部走 Dexie 事务，写前对实体过 Zod 校验（与 Repository 契约一致，
// 失败整体回滚）。派生逻辑（kind 判定、套装派生、编目题名溯源）在 src/lib/book-status.ts。
import type { ReadGraphDB } from '@/db/db'
import {
  bookSchema,
  borrowCycleSchema,
  catalogRecordSchema,
  rawRecordSchema,
} from '@/db/schemas'
import { uuid } from '@/db/uuid'
import { normalizeIsbn } from '@/lib/isbn'
import { catalogTitleByRecord } from '@/lib/book-status'
import { z } from 'zod'
import type { Book, CatalogRecord, ClassificationEntry } from '@/types/entities'

const now = (): Date => new Date()

function validated<S extends z.ZodType>(schema: S, value: z.input<S>): z.output<S> {
  const r = schema.safeParse(value)
  if (!r.success) throw r.error
  return r.data
}

/** ISBN 唯一冲突（book-editing 规格 §4.2）：另一 Book 已占用该 ISBN，保存阻断。 */
export class IsbnConflictError extends Error {
  readonly otherTitle: string

  constructor(otherTitle: string) {
    super('isbn-conflict')
    this.name = 'IsbnConflictError'
    this.otherTitle = otherTitle
  }
}

/** 书目可编辑字段（book-editing 规格 §3.2；sourceIds/needsReview/时间戳由动作层维护）。 */
export interface BookDraft {
  title: string
  subtitle: string | null
  parallelTitles: string[]
  authors: string[]
  translators: string[]
  publisher: string | null
  publishDate: string | null
  edition: string | null
  pages: number | null
  price: { amount: number; currency: string } | null
  isbn13: string | null
  isbn10: string | null
  subjects: string[]
  tags: string[]
  description: string | null
  coverUrl: string | null
}

/** 编目可编辑字段（book-editing 规格 §3.3；metaId 可编辑，metaIdKey 随其派生；
 *  sourceId/bookId 只读）。 */
export interface CatalogRecordDraft {
  id: string
  metaId: string | null
  volume: string | null
  barcodes: string[]
  classifications: ClassificationEntry[]
}

/** OPAC 补全保存载荷（opac-enrichment 规格 §7.2）：同一事务写目标编目 opacEnrichment。
 *  不参与字段合并（表单值即最终裁决）；Zod 失败整体回滚时状态一并回滚。 */
export interface EnrichmentSavePayload {
  recordId: string
  providerId: string
  status: 'fetched'
  fetchedAt: Date
  sourceUrl: string
}

/**
 * 统一保存（book-editing 规格 §2.1/§3.4）：单事务写 Book 全字段 + 各编目
 * metaId/volume/barcodes/classifications（metaIdKey 随 metaId 派生），成功即
 * needsReview=false、updatedAt=now。
 * 可选 enrichment 载荷（opac-enrichment §7.2）：同一事务写目标编目 opacEnrichment
 * （status='fetched'）；不传则行为与普通编辑完全一致。
 * 取代原 completePlaceholder（补全）与 saveSetBook（套装保存）。
 * ISBN 冲突预检：归一化后命中他书 → 抛 IsbnConflictError（整体回滚）。
 */
export async function updateBookWithRecords(
  db: ReadGraphDB,
  bookId: string,
  book: BookDraft,
  records: CatalogRecordDraft[],
  enrichment?: EnrichmentSavePayload,
): Promise<void> {
  await db.transaction('rw', [db.books, db.catalogRecords], async () => {
    const existing = await db.books.get(bookId)
    if (!existing) throw new Error(`updateBookWithRecords: book not found: ${bookId}`)

    if (book.isbn13) {
      const hit = await db.books.where('isbn13').equals(book.isbn13).first()
      if (hit && hit.id !== bookId) throw new IsbnConflictError(hit.title)
    }

    await db.books.put(
      validated(bookSchema, {
        ...existing,
        ...book,
        needsReview: false,
        updatedAt: now(),
      }),
    )

    const crs = await db.catalogRecords.where('bookId').equals(bookId).toArray()
    const draftById = new Map(records.map((r) => [r.id, r]))
    // enrichment 目标编目缺失 → 抛错整体回滚（防御；先于循环校验，避免误伤其它记录）。
    if (enrichment && !crs.some((c) => c.id === enrichment.recordId)) {
      throw new Error(`updateBookWithRecords: enrichment recordId not found: ${enrichment.recordId}`)
    }
    const updates = crs.map((c) => {
      const d = draftById.get(c.id)
      if (!d) return c
      // metaIdKey 由 metaId 派生（String(metaId).trim()，空白 → null），与
      // catalog-record.md 归一化约定一致：索引与去重始终走 metaIdKey。
      const metaId = d.metaId == null || d.metaId.trim() === '' ? null : d.metaId.trim()
      const next: z.input<typeof catalogRecordSchema> = {
        ...c,
        metaId,
        metaIdKey: metaId == null ? null : metaId,
        volume: d.volume,
        barcodes: d.barcodes,
        classifications: d.classifications,
        updatedAt: now(),
      }
      // enrichment 载荷不参与字段合并（表单值即最终裁决）。
      if (enrichment && c.id === enrichment.recordId) {
        next.opacEnrichment = {
          providerId: enrichment.providerId,
          status: enrichment.status,
          fetchedAt: enrichment.fetchedAt,
          sourceUrl: enrichment.sourceUrl,
        }
      }
      return validated(catalogRecordSchema, next)
    })
    if (updates.length > 0) {
      await db.catalogRecords.bulkPut(updates)
    }
  })
}

/**
 * 标记为已确认（book-editing 规格 §4.3）：仅 needsReview=false，title/volume 不动。
 * 承接原 markNotSet「不是套装」语义。
 */
export async function markReviewed(db: ReadGraphDB, bookId: string): Promise<void> {
  await db.transaction('rw', db.books, async () => {
    const book = await db.books.get(bookId)
    if (!book) throw new Error(`markReviewed: book not found: ${bookId}`)
    await db.books.put(validated(bookSchema, { ...book, needsReview: false, updatedAt: now() }))
  })
}

/**
 * 合并到已有书目（占位书）：占位 Book 删除，其 CatalogRecord 与 BorrowCycle
 * 重挂目标书（catalogRecordId 不变，仍指被移挂的编目），rawRecords 同步重指；
 * 目标书保持原状，needsReview 解除。
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
 * 拆为独立 Book（套装候选）：按 metaIdKey 分组拆为多 Book，title 取
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
 * 合并搜索：searchByTitle + findByIsbn13 合并去重，排除占位书自身。
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
