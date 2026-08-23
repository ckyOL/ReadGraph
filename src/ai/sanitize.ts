// 脱敏管道：画像场景白名单装配（ai-features §3）。
// 纯函数：不读 Date.now()/IndexedDB/DOM；同入参产出深等价输出。
// 超阈值书目（> BOOKLIST_FULL_LIMIT）降级分层采样（SAMPLE_BOOKS_LIMIT 上限），顶层附 sampled 标记。
// 黑名单值（cardno/条码/馆名/借还时点/单条记录/ISBN/个人标签等）绝不进入装配产物，
// 由 sanitize.test.ts 逐值穷举断言强制（§3.3）。
import { z } from 'zod'
import { classificationFirstLevel } from '@/lib/classification'
import { resolveSystem } from '@/lib/profile-stats'
import type { ProfileStatsInput, ProfileStatsResult } from '@/lib/profile-stats'
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

  const recordsByBook = new Map<string, CatalogRecord[]>()
  for (const record of input.catalogRecords) {
    const arr = recordsByBook.get(record.bookId)
    if (arr) arr.push(record)
    else recordsByBook.set(record.bookId, [record])
  }

  const borrowCountByBook = new Map<string, number>()
  for (const cycle of input.borrowCycles) {
    borrowCountByBook.set(cycle.bookId, (borrowCountByBook.get(cycle.bookId) ?? 0) + 1)
  }

  const entries = input.books
    .filter((book) => book.materialType !== 'device')
    .map((book) => ({
      book,
      row: {
        title: book.title,
        subtitle: book.subtitle,
        authors: book.authors,
        publishYear: publishYearOf(book.publishDate),
        publisher: book.publisher,
        classification: classificationOf(book, system, recordsByBook),
        subjects: book.subjects,
        borrowCount: borrowCountByBook.get(book.id) ?? 0,
      },
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
