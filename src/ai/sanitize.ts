// 脱敏管道：画像场景白名单装配（ai-features §3）。
// 纯函数：不读 Date.now()/IndexedDB/DOM；同入参产出深等价输出。
// 黑名单值（cardno/条码/馆名/借还时点/单条记录/ISBN/个人标签等）绝不进入装配产物，
// 由 sanitize.test.ts 逐值穷举断言强制（§3.3）。
import { z } from 'zod'
import { classificationFirstLevel } from '@/lib/classification'
import { resolveSystem } from '@/lib/profile-stats'
import type { ProfileStatsInput, ProfileStatsResult } from '@/lib/profile-stats'
import type { Book, CatalogRecord, ClassificationSystem } from '@/types/entities'

/** 全量书目直发阈值（ai-features §3.2 极端档案防护）：≤ 该值直接全发；超出降级分层采样（S-2 波次2实现）。 */
export const BOOKLIST_FULL_LIMIT = 3000

/** 画像场景白名单 payload 形状（ai-features §3.2 白名单表）：严格字段集（.strict() 拒未知字段），
 *  供测试与后续发送前校验。 */
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
  })
  .strict()

export type ProfilePayload = z.infer<typeof profilePayloadSchema>

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
 * 不含 gantt/calendar.days/money）+ 全量每书字段（设备书排除，借阅次数单遍 Map 计数）。
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

  const books = input.books
    .filter((book) => book.materialType !== 'device')
    .map((book) => ({
      title: book.title,
      subtitle: book.subtitle,
      authors: book.authors,
      publishYear: publishYearOf(book.publishDate),
      publisher: book.publisher,
      classification: classificationOf(book, system, recordsByBook),
      subjects: book.subjects,
      borrowCount: borrowCountByBook.get(book.id) ?? 0,
    }))

  return {
    summary: stats.summary,
    classification: stats.classification,
    borrowVolume: stats.borrowVolume,
    durationDistribution: stats.durationDistribution,
    calendar: { borrowDays: stats.calendar.borrowDays },
    books,
  }
}
