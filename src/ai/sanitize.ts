// 脱敏管道：画像场景白名单装配（ai-features §3）。
// 纯函数：不读 Date.now()/IndexedDB/DOM；同入参产出深等价输出。
// 超阈值书目（> BOOKLIST_FULL_LIMIT）降级分层采样（SAMPLE_BOOKS_LIMIT 上限），顶层附 sampled 标记。
// 黑名单值（cardno/条码/馆名/借还时点/单条记录/ISBN/个人标签等）绝不进入装配产物，
// 由 sanitize.test.ts 逐值穷举断言强制（§3.3）。
import { z } from 'zod'
import { classificationFirstLevel } from '@/lib/classification'
import { resolveSystem } from '@/lib/profile-stats'
import type { ProfileStatsInput, ProfileStatsResult, YearSliceResult } from '@/lib/profile-stats'
import type { Book, CatalogRecord, ClassificationSystem } from '@/types/entities'

/** 全量书目直发阈值（ai-features §3.2 极端档案防护）：≤ 该值直接全发；超出降级分层采样。 */
export const BOOKLIST_FULL_LIMIT = 3000

/** 分层采样总上限（ai-features §3.2 极端档案防护）：超阈值后至多发送该数。 */
export const SAMPLE_BOOKS_LIMIT = 500

/** 画像场景白名单 payload 形状（ai-features §3.2 白名单表）：严格字段集（.strict() 拒未知字段），
 *  供测试与后续发送前校验；超阈值采样时顶层附可选 sampled 标记。 */
export const profilePayloadSchema = z
  .object({
    summary: z
      .object({
        totalBooks: z.number(),
        totalCycles: z.number(),
        inBorrow: z.number(),
        avgDurationDays: z.number().nullable(),
        medianDurationDays: z.number().nullable(),
      })
      .strict(),
    classification: z.array(
      z
        .object({
          name: z.string(),
          code: z.string(),
          category: z.string().nullable(),
          value: z.number(),
        })
        .strict(),
    ),
    borrowVolume: z.array(z.object({ bucket: z.string(), count: z.number() }).strict()),
    durationDistribution: z.array(z.object({ range: z.string(), count: z.number() }).strict()),
    calendar: z.object({ borrowDays: z.number() }).strict(),
    books: z.array(
      z
        .object({
          title: z.string(),
          subtitle: z.string().nullable(),
          authors: z.array(z.string()),
          publishYear: z.string().nullable(),
          publisher: z.string().nullable(),
          classification: z.object({ code: z.string(), name: z.string() }).strict().nullable(),
          subjects: z.array(z.string()),
          borrowCount: z.number(),
        })
        .strict(),
    ),
    sampled: z
      .object({
        total: z.number(),
        sent: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type ProfilePayload = z.infer<typeof profilePayloadSchema>

/** payload 单书条目形状（白名单每书字段集，ai-features §3.2）。 */
type PayloadBook = ProfilePayload['books'][number]

/** 采样归并桶键：单书分类缺失/无匹配体系 → 未分类桶（与 computeProfileStats 同口径）。 */
const UNCLASSIFIED_KEY = '__unclassified__'

/** 采样条目全序比较：borrowCount 降序 → title 升序 → id 升序（全序保证确定性输出）。 */
function compareSampledEntries(
  a: { book: Book; row: PayloadBook },
  b: { book: Book; row: PayloadBook },
): number {
  return (
    b.row.borrowCount - a.row.borrowCount ||
    a.row.title.localeCompare(b.row.title) ||
    a.book.id.localeCompare(b.book.id)
  )
}

/** 分层采样（ai-features §3.2 极端档案防护）：按分类桶各取 ≥1 代表（无空桶），
 *  余量按全局 borrowCount 降序填充至 SAMPLE_BOOKS_LIMIT；纯函数、确定性。 */
function sampleEntries(
  entries: Array<{ book: Book; row: PayloadBook }>,
): { rows: PayloadBook[]; total: number } {
  const buckets = new Map<string, Array<{ book: Book; row: PayloadBook }>>()
  for (const entry of entries) {
    const key = entry.row.classification?.code ?? UNCLASSIFIED_KEY
    const bucket = buckets.get(key)
    if (bucket) bucket.push(entry)
    else buckets.set(key, [entry])
  }
  for (const bucket of buckets.values()) bucket.sort(compareSampledEntries)

  const picked: Array<{ book: Book; row: PayloadBook }> = []
  const pickedIds = new Set<string>()
  // 第一轮：每桶取代表（桶首）；桶数超上限时按代表强弱截断，硬上限不破。
  const heads = [...buckets.values()]
    .map((bucket) => bucket[0]!)
    .sort(compareSampledEntries)
  for (const head of heads) {
    if (picked.length >= SAMPLE_BOOKS_LIMIT) break
    picked.push(head)
    pickedIds.add(head.book.id)
  }
  // 第二轮：余量按全局 borrowCount 降序填充至上限。
  const ordered = [...entries].sort(compareSampledEntries)
  for (const entry of ordered) {
    if (picked.length >= SAMPLE_BOOKS_LIMIT) break
    if (pickedIds.has(entry.book.id)) continue
    picked.push(entry)
    pickedIds.add(entry.book.id)
  }
  picked.sort(compareSampledEntries)
  return { rows: picked.map((entry) => entry.row), total: entries.length }
}

/** publishDate（"YYYY"|"YYYY-MM"|"YYYY-MM-DD"）→ 前 4 位年份；非数字开头/空 → null。 */
function publishYearOf(publishDate: string | null): string | null {
  if (!publishDate) return null
  const match = /^\d{4}/.exec(publishDate)
  return match ? match[0] : null
}

/** 编目记录按 bookId 建索引（单遍 Map；画像与年度场景共用）。 */
function indexRecordsByBook(
  catalogRecords: CatalogRecord[],
): Map<string, CatalogRecord[]> {
  const recordsByBook = new Map<string, CatalogRecord[]>()
  for (const record of catalogRecords) {
    const arr = recordsByBook.get(record.bookId)
    if (arr) arr.push(record)
    else recordsByBook.set(record.bookId, [record])
  }
  return recordsByBook
}

/** 单书白名单条目（每书字段集，§3.2）：分类取首选体系一级归并，borrowCount 为调用方给定的
 *  聚合计数（画像 = 全量周期数；年度 = 年内周期数——数字同源，由调用方保证）。 */
function bookRowOf(
  book: Book,
  recordsByBook: Map<string, CatalogRecord[]>,
  borrowCount: number,
  system: ClassificationSystem,
): PayloadBook {
  return {
    title: book.title,
    subtitle: book.subtitle,
    authors: book.authors,
    publishYear: publishYearOf(book.publishDate),
    publisher: book.publisher,
    classification: classificationOf(book, system, recordsByBook),
    subjects: book.subjects,
    borrowCount,
  }
}

/** 单书首选体系一级归并（与 computeProfileStats 分类 treemap 同口径：命中体系条目取首条，
 *  归并失败（未知 code）继续下一编目）；无编目/无匹配条目 → null。 */
function classificationOf(
  book: Book,
  system: ClassificationSystem,
  recordsByBook: Map<string, CatalogRecord[]>,
): { code: string; name: string } | null {
  const records = recordsByBook.get(book.id)
  if (!records) return null
  for (const record of records) {
    const entry = record.classifications.find((c) => c.system === system)
    if (!entry) continue
    const merged = classificationFirstLevel(system, entry)
    if (merged) return { code: merged.code, name: merged.name }
  }
  return null
}

/**
 * 画像场景白名单装配器（ai-features §3.1 ②③）：
 * 聚合统计白名单子集透传（summary/classification/borrowVolume/durationDistribution/calendar.borrowDays；
 * 不含 gantt/calendar.days/money）+ 全量每书字段（设备书排除，借阅次数单遍 Map 计数）；
 * 书目数 > BOOKLIST_FULL_LIMIT 时降级分层采样（每分类 ≥1 代表、总上限 SAMPLE_BOOKS_LIMIT），
 * 顶层附 sampled: { total, sent } 标记（≤ 阈值时无 sampled 字段）。
 * 首选体系经 resolveSystem 解析（与 computeProfileStats 同口径）；opts 缺省取 Source 多数票。
 */
export function serializePayload(
  input: ProfileStatsInput,
  stats: ProfileStatsResult,
  opts: { classificationSystem: ClassificationSystem | null },
): ProfilePayload {
  const system = resolveSystem(opts.classificationSystem, input.sources)
  const recordsByBook = indexRecordsByBook(input.catalogRecords)

  const borrowCountByBook = new Map<string, number>()
  for (const cycle of input.borrowCycles) {
    borrowCountByBook.set(cycle.bookId, (borrowCountByBook.get(cycle.bookId) ?? 0) + 1)
  }

  const entries = input.books
    .filter((book) => book.materialType !== 'device')
    .map((book) => ({
      book,
      row: bookRowOf(book, recordsByBook, borrowCountByBook.get(book.id) ?? 0, system),
    }))

  const sampled = entries.length > BOOKLIST_FULL_LIMIT ? sampleEntries(entries) : null

  return {
    summary: stats.summary,
    classification: stats.classification,
    borrowVolume: stats.borrowVolume,
    durationDistribution: stats.durationDistribution,
    calendar: { borrowDays: stats.calendar.borrowDays },
    books: sampled ? sampled.rows : entries.map((entry) => entry.row),
    ...(sampled ? { sampled: { total: sampled.total, sent: sampled.rows.length } } : {}),
  }
}

// --- 年度场景（S-3，ai-features §9.1：切片替代全量，同一白名单形态） ---

/** 年度场景白名单 payload 形状（ai-features §9.1/§3.2）：year + yearSlice 聚合白名单子集
 *  （bookCount/topBooks/classification——bookIds 由 books 数组承载，不与书目重复发送）
 *  + 切片内全量每书字段（§3.2 同形态）。严格字段集（.strict() 拒未知字段）。
 *  年度目标值（用户偏好，非聚合统计）绝不出现在本结构——装配器不消费偏好，
 *  由 sanitize.test.ts 逐值穷举断言强制（§3.3 年度专项）。 */
export const yearPayloadSchema = z
  .object({
    year: z.number().int().min(1000).max(9999),
    slice: z
      .object({
        bookCount: z.number().int().min(0),
        topBooks: z.array(
          z
            .object({
              bookId: z.string(),
              count: z.number().int().min(0),
            })
            .strict(),
        ),
        classification: z.array(
          z
            .object({
              name: z.string(),
              code: z.string(),
              category: z.string().nullable(),
              value: z.number(),
            })
            .strict(),
        ),
      })
      .strict(),
    books: z.array(
      z
        .object({
          title: z.string(),
          subtitle: z.string().nullable(),
          authors: z.array(z.string()),
          publishYear: z.string().nullable(),
          publisher: z.string().nullable(),
          classification: z.object({ code: z.string(), name: z.string() }).strict().nullable(),
          subjects: z.array(z.string()),
          borrowCount: z.number(),
        })
        .strict(),
    ),
    sampled: z
      .object({
        total: z.number(),
        sent: z.number(),
      })
      .strict()
      .optional(),
  })
  .strict()

export type YearPayload = z.infer<typeof yearPayloadSchema>

/**
 * 年度场景白名单装配器（ai-features §9.1，S-3）：yearSlice 聚合白名单子集透传（数字同源——
 * 与目标卡/回顾共用同一 computeYearSlice 产物，LLM 只转译不生成）+ 切片内全量每书字段。
 * 借阅次数取年内口径（与 computeYearSlice 同口径：borrowedAt ∈ [y-01-01, (y+1)-01-01) UTC
 * 左闭右开、设备排除——叙事「复借最多」与 topBooks 数字同源）。
 * 采样降级复用画像同族逻辑（切片规模通常远低于 BOOKLIST_FULL_LIMIT，阈值保留兜底）；
 * 同一装配函数产物供发送预览与实际发送（§3.3 防漂移）。纯函数：不读偏好/存储/时钟。
 */
export function serializeYearPayload(
  input: ProfileStatsInput,
  slice: YearSliceResult,
  year: number,
  opts: { classificationSystem: ClassificationSystem | null },
): YearPayload {
  const system = resolveSystem(opts.classificationSystem, input.sources)
  const recordsByBook = indexRecordsByBook(input.catalogRecords)

  // 年内借阅计数（与 computeYearSlice 同口径 + 设备排除）。
  const fromMs = Date.UTC(year, 0, 1)
  const toMs = Date.UTC(year + 1, 0, 1)
  const deviceBookIds = new Set(
    input.books.filter((b) => b.materialType === 'device').map((b) => b.id),
  )
  const countByBook = new Map<string, number>()
  for (const cycle of input.borrowCycles) {
    if (deviceBookIds.has(cycle.bookId)) continue
    const t = cycle.borrowedAt.getTime()
    if (t < fromMs || t >= toMs) continue
    countByBook.set(cycle.bookId, (countByBook.get(cycle.bookId) ?? 0) + 1)
  }

  const scope = new Set(slice.bookIds)
  const entries = input.books
    .filter((book) => !deviceBookIds.has(book.id) && scope.has(book.id))
    .map((book) => ({
      book,
      row: bookRowOf(book, recordsByBook, countByBook.get(book.id) ?? 0, system),
    }))

  const sampled = entries.length > BOOKLIST_FULL_LIMIT ? sampleEntries(entries) : null

  return {
    year,
    slice: {
      bookCount: slice.bookCount,
      topBooks: slice.topBooks,
      classification: slice.classification,
    },
    books: sampled ? sampled.rows : entries.map((entry) => entry.row),
    ...(sampled ? { sampled: { total: sampled.total, sent: sampled.rows.length } } : {}),
  }
}
