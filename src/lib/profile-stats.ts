// 阅读画像纯函数聚合（§11.2 契约）。
// 不读 Date.now()/IndexedDB/DOM；同入参产出深等价输出。
import type {
  Book,
  BorrowCycle,
  BorrowStatus,
  CatalogRecord,
  ClassificationSystem,
  Source,
} from '@/types/entities'
import { classificationFirstLevel } from './classification'
import { isSetBook } from './book-status'
import { volumeOfCycle } from './volume'

export interface ProfileStatsInput {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  sources: Source[]
}

export interface ProfileStatsOptions {
  classificationSystem: ClassificationSystem | null
  range: { from: Date | null; to: Date | null } | null
  displayTimezone: string
  /** 借阅日历「今天」锚（调用方传入，不读 Date.now()）：开区间在借周期收敛到该日；null → 仅借出当日 */
  calendarAnchor: Date | null
}

interface ClassificationBucket {
  name: string
  code: string
  category: string | null
  value: number
}

interface BorrowVolumePoint {
  bucket: string
  count: number
}

interface DurationBucket {
  range: string
  count: number
}

interface GanttInterval {
  start: string
  end: string | null
  status: BorrowStatus
}

interface GanttLane {
  laneKey: string
  label: string
  /** 套装书该 lane 的编目卷号（cycle→编目解析）；非套装/未解析 → null。 */
  volume: string | null
  intervals: GanttInterval[]
}

export interface ProfileStatsResult {
  summary: {
    totalBooks: number
    totalCycles: number
    inBorrow: number
    avgDurationDays: number | null
    medianDurationDays: number | null
  }
  classification: ClassificationBucket[]
  borrowVolume: BorrowVolumePoint[]
  durationDistribution: DurationBucket[]
  gantt: GanttLane[]
  money: MoneyStats
  calendar: CalendarStats
}

/** 借阅日历单日格：当天处于在借期的独立 Book（reading-profile §2.6）。 */
export interface CalendarDay {
  /** UTC 日桶键 'YYYY-MM-DD'（日起点；displayTimezone 不影响桶归属） */
  date: string
  /** 当天在借的独立 Book 数（bookId 去重，设备排除） */
  count: number
  /** 当天在借的独立 bookId，升序 */
  bookIds: string[]
}

export interface CalendarStats {
  /** 去重 UTC 天格（升序）；range 口径——仅 borrowedAt ∈ range 的非设备周期计入 */
  days: CalendarDay[]
  /** 借阅天数（全量口径）：所有非设备周期天区间并集去重计数，与 range 无关 */
  borrowDays: number
  /** days 最早/最晚日；无数据 → null */
  minDate: string | null
  maxDate: string | null
  /** days 中出现过的 bookId → 题名/封面（tooltip 用） */
  bookIndex: Record<string, { title: string; coverUrl: string | null }>
}

/** 单币种金额聚合：整数「分」累计避免浮点误差；amount 为元，展示层格式化 */
interface MoneyAmount {
  currency: string
  amount: number
  count: number
}

interface MoneyStats {
  /** 馆藏总价值：全量非设备、有定价 Book 按币种合计；与 time range 无关 */
  collectionValue: MoneyAmount[]
  /** 借阅价值：range 内有 ≥1 个 BorrowCycle 的独立 Book（去重）按币种合计 */
  borrowedValue: MoneyAmount[]
  /** 平均书价：按币种（cents/count/100） */
  avgPrice: MoneyAmount[]
  /** 主导币种：有定价 Book 数最多的币种；无定价 → null */
  dominantCurrency: string | null
  /** 价格分布直方图（仅主导币种 Book） */
  distribution: { range: string; count: number }[]
  /** 有定价 Book 中是否出现 ≥2 种币种 */
  multiCurrency: boolean
}

const MS_PER_DAY = 86_400_000
// 月/年粒度切换阈值：数据跨度 > 2 年 → 年粒度。
const YEAR_MODE_SPAN_MS = 2 * 365 * MS_PER_DAY

const DURATION_BUCKETS: { range: string; max: number }[] = [
  { range: '0–7', max: 7 },
  { range: '8–14', max: 14 },
  { range: '15–30', max: 30 },
  { range: '31–60', max: 60 },
  { range: '>60', max: Number.POSITIVE_INFINITY },
]

// 价格分布分桶（主导币种单位）：[min, nextMin) 左闭右开；<20 桶 min=-∞
const PRICE_BUCKETS: { range: string; min: number }[] = [
  { range: '<20', min: Number.NEGATIVE_INFINITY },
  { range: '20–50', min: 20 },
  { range: '50–100', min: 50 },
  { range: '100–200', min: 100 },
  { range: '>200', min: 200 },
]

export function resolveSystem(
  opts: ClassificationSystem | null,
  sources: Source[],
): ClassificationSystem {
  if (opts) return opts
  const tally = new Map<ClassificationSystem, number>()
  for (const s of sources) {
    const sys = s.library?.classificationSystem ?? null
    if (sys) tally.set(sys, (tally.get(sys) ?? 0) + 1)
  }
  let best: ClassificationSystem | null = null
  let bestCount = -1
  for (const [sys, count] of tally) {
    if (count > bestCount) {
      best = sys
      bestCount = count
    }
  }
  return best ?? 'clc'
}

function inRange(date: Date, range: ProfileStatsOptions['range']): boolean {
  if (!range) return true
  if (range.from && date.getTime() < range.from.getTime()) return false
  if (range.to && date.getTime() >= range.to.getTime()) return false
  return true
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

/** 编目记录按 bookId 建索引（treemap 首选体系解析与甘特卷号共用）。 */
function indexRecordsByBook(
  catalogRecords: CatalogRecord[],
): Map<string, CatalogRecord[]> {
  const map = new Map<string, CatalogRecord[]>()
  for (const cr of catalogRecords) {
    const arr = map.get(cr.bookId)
    if (arr) arr.push(cr)
    else map.set(cr.bookId, [cr])
  }
  return map
}

/**
 * 分类法一级归并桶（reading-profile §2.1 treemap 口径）：每 Book 计一次，避免多
 * CatalogRecord 多副本重复计数；分类号取首选匹配体系条目的首条；无匹配归未分类。
 * scope 非空时仅统计集合内的 Book（年度切片 §2.7 用）。
 */
function buildClassificationBuckets(
  books: Book[],
  recordsByBook: Map<string, CatalogRecord[]>,
  deviceBookIds: Set<string>,
  system: ClassificationSystem,
  scope: Set<string> | null = null,
): ClassificationBucket[] {
  const classMap = new Map<string, ClassificationBucket>()
  for (const book of books) {
    if (deviceBookIds.has(book.id)) continue
    if (scope && !scope.has(book.id)) continue
    const records = recordsByBook.get(book.id) ?? []
    let merged: { code: string; category: string | null; name: string } | null = null
    for (const cr of records) {
      const entry = cr.classifications.find((c) => c.system === system)
      if (entry) {
        merged = classificationFirstLevel(system, entry)
        if (merged) break
      }
    }

    let key: string
    let bucket: ClassificationBucket
    if (merged) {
      key = merged.code
      bucket = classMap.get(key) ?? {
        name: merged.name,
        code: merged.code,
        category: merged.category,
        value: 0,
      }
    } else {
      key = '__unclassified__'
      bucket = classMap.get(key) ?? {
        name: '__unclassified__',
        code: '__unclassified__',
        category: null,
        value: 0,
      }
    }
    bucket.value += 1
    classMap.set(key, bucket)
  }
  return Array.from(classMap.values())
}

export function computeProfileStats(
  input: ProfileStatsInput,
  opts: ProfileStatsOptions,
): ProfileStatsResult {
  const { books, catalogRecords, borrowCycles, sources } = input

  // --- 设备排除（device-borrows 规格 §4）：材料类型为 device 的 Book 与其
  // 借阅周期不进入任何统计维度（藏书/周期/在借/时长/分类/借阅量/甘特）。 ---
  const deviceBookIds = new Set(
    books.filter((b) => b.materialType === 'device').map((b) => b.id),
  )
  const isDeviceCycle = (c: BorrowCycle): boolean => deviceBookIds.has(c.bookId)

  // --- 分类法分布（treemap 口径；年度切片 §2.7 共用同一 helper） ---
  const system = resolveSystem(opts.classificationSystem, sources)
  const bookById = new Map(books.map((b) => [b.id, b]))
  const recordsByBook = indexRecordsByBook(catalogRecords)
  const classification = buildClassificationBuckets(
    books,
    recordsByBook,
    deviceBookIds,
    system,
  )

  // --- 借阅量柱图（range 裁剪，UTC 桶） ---
  const volumeCycles = borrowCycles.filter(
    (c) => !isDeviceCycle(c) && inRange(c.borrowedAt, opts.range),
  )
  const volumeMap = new Map<string, number>()
  let yearMode = false
  if (volumeCycles.length > 0) {
    let minMs = volumeCycles[0].borrowedAt.getTime()
    let maxMs = minMs
    for (const c of volumeCycles) {
      const t = c.borrowedAt.getTime()
      if (t < minMs) minMs = t
      if (t > maxMs) maxMs = t
    }
    yearMode = maxMs - minMs > YEAR_MODE_SPAN_MS
    for (const c of volumeCycles) {
      const d = c.borrowedAt
      const y = d.getUTCFullYear()
      const key = yearMode
        ? `${y}`
        : `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
      volumeMap.set(key, (volumeMap.get(key) ?? 0) + 1)
    }
  }
  const borrowVolume: BorrowVolumePoint[] = [...volumeMap.entries()]
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => (a.bucket < b.bucket ? -1 : 1))

  // --- 借阅时长分布（全部周期，不 range 裁剪） ---
  const durations: number[] = []
  const durationCounts = [0, 0, 0, 0, 0]
  for (const c of borrowCycles) {
    if (isDeviceCycle(c)) continue
    if (c.status === 'returned' && c.returnedAt != null) {
      const dur = Math.ceil(
        (c.returnedAt.getTime() - c.borrowedAt.getTime()) / MS_PER_DAY,
      )
      durations.push(dur)
      for (let i = 0; i < DURATION_BUCKETS.length; i++) {
        if (dur <= DURATION_BUCKETS[i].max) {
          durationCounts[i] += 1
          break
        }
      }
    }
  }
  const durationDistribution: DurationBucket[] = durations.length
    ? DURATION_BUCKETS.map((b, i) => ({ range: b.range, count: durationCounts[i] }))
    : []
  const avgDurationDays =
    durations.length > 0
      ? durations.reduce((s, d) => s + d, 0) / durations.length
      : null
  const medianDurationDays = durations.length > 0 ? median(durations) : null

  // --- 甘特带（range 裁剪） ---
  const ganttCycles = borrowCycles.filter(
    (c) => !isDeviceCycle(c) && inRange(c.borrowedAt, opts.range),
  )
  const laneMap = new Map<string, GanttLane>()
  for (const c of ganttCycles) {
    const laneKey = `${c.bookId}:${c.barcode ?? '__noBarcode__'}`
    let lane = laneMap.get(laneKey)
    if (!lane) {
      const book = bookById.get(c.bookId)
      const records = recordsByBook.get(c.bookId) ?? []
      // 套装书（≥2 卷编目）题名后补卷号以区分各卷；非套装 lane 不携带。
      const isSet = isSetBook(c.bookId, records)
      lane = {
        laneKey,
        label: book?.title ?? c.bookId,
        volume: isSet ? volumeOfCycle(c, records) : null,
        intervals: [],
      }
      laneMap.set(laneKey, lane)
    }
    lane.intervals.push({
      start: c.borrowedAt.toISOString(),
      end: c.returnedAt ? c.returnedAt.toISOString() : null,
      status: c.status,
    })
  }
  for (const lane of laneMap.values()) {
    lane.intervals.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  }
  const gantt = Array.from(laneMap.values())

  // --- 借阅日历（bookology-benchmark §5.1 / reading-profile §2.6） ---
  // 天区间相交语义：cycle 覆盖 [dayNum(borrowedAt), end] 全部 UTC 整日；
  // end = dayNum(returnedAt - 1ms)（恰为日 00:00 时退一天）或锚点日（开区间）。
  // days 为 range 口径，borrowDays 为全量口径（allDays 与 range 无关）。
  const dayNum = (ts: number): number => Math.floor(ts / MS_PER_DAY)
  const dateKeyOf = (n: number): string =>
    new Date(n * MS_PER_DAY).toISOString().slice(0, 10)
  const anchorDayNum = opts.calendarAnchor
    ? dayNum(opts.calendarAnchor.getTime())
    : null

  const dayBooks = new Map<number, Set<string>>()
  const allDays = new Set<number>()
  const calendarBookIds = new Set<string>()

  for (const c of borrowCycles) {
    if (isDeviceCycle(c)) continue
    const start = dayNum(c.borrowedAt.getTime())
    const end =
      c.returnedAt != null
        ? dayNum(c.returnedAt.getTime() - 1)
        : (anchorDayNum ?? start)
    if (end < start) continue // 数据异常（锚早于借出日）：不产生天格
    const inScope = inRange(c.borrowedAt, opts.range)
    for (let d = start; d <= end; d++) {
      allDays.add(d)
      if (!inScope) continue
      let ids = dayBooks.get(d)
      if (!ids) {
        ids = new Set<string>()
        dayBooks.set(d, ids)
      }
      ids.add(c.bookId)
    }
    if (inScope) calendarBookIds.add(c.bookId)
  }

  const dayNums = Array.from(dayBooks.keys()).sort((a, b) => a - b)
  const days: CalendarDay[] = dayNums.map((n) => {
    const ids = Array.from(dayBooks.get(n) ?? []).sort()
    return { date: dateKeyOf(n), count: ids.length, bookIds: ids }
  })
  const bookIndex: CalendarStats['bookIndex'] = {}
  for (const id of calendarBookIds) {
    const book = bookById.get(id)
    if (!book) continue
    bookIndex[id] = { title: book.title, coverUrl: book.coverUrl }
  }
  const calendar: CalendarStats = {
    days,
    borrowDays: allDays.size,
    minDate: dayNums.length > 0 ? dateKeyOf(dayNums[0]) : null,
    maxDate: dayNums.length > 0 ? dateKeyOf(dayNums[dayNums.length - 1]) : null,
    bookIndex,
  }


  // --- 概览汇总 ---
  let inBorrow = 0
  for (const c of borrowCycles) {
    if (isDeviceCycle(c)) continue
    if (c.status === 'borrowed') inBorrow += 1
  }

  // --- 价值统计（reading-profile 规格 §2.5） ---
  // 有定价的非设备 Book（零定价 amount=0 仍计 count）
  const pricedBooks: { id: string; amount: number; currency: string }[] = []
  for (const book of books) {
    if (deviceBookIds.has(book.id) || book.price == null) continue
    pricedBooks.push({
      id: book.id,
      amount: book.price.amount,
      currency: book.price.currency,
    })
  }
  // 借阅价值口径：range 内有 ≥1 个周期（非设备）的独立 Book，去重
  const borrowedBookIds = new Set<string>()
  for (const c of borrowCycles) {
    if (isDeviceCycle(c)) continue
    if (inRange(c.borrowedAt, opts.range)) borrowedBookIds.add(c.bookId)
  }
  // 单遍累计：币种 → 整数分 / count
  const colMap = new Map<string, { cents: number; count: number }>()
  const borMap = new Map<string, { cents: number; count: number }>()
  for (const p of pricedBooks) {
    const cents = Math.round(p.amount * 100)
    let e = colMap.get(p.currency)
    if (!e) {
      e = { cents: 0, count: 0 }
      colMap.set(p.currency, e)
    }
    e.cents += cents
    e.count += 1
    if (borrowedBookIds.has(p.id)) {
      let be = borMap.get(p.currency)
      if (!be) {
        be = { cents: 0, count: 0 }
        borMap.set(p.currency, be)
      }
      be.cents += cents
      be.count += 1
    }
  }
  const collectionValue: MoneyAmount[] = [...colMap.entries()].map(
    ([currency, v]) => ({ currency, amount: v.cents / 100, count: v.count }),
  )
  const borrowedValue: MoneyAmount[] = [...borMap.entries()].map(
    ([currency, v]) => ({ currency, amount: v.cents / 100, count: v.count }),
  )
  const avgPrice: MoneyAmount[] = [...colMap.entries()].map(([currency, v]) => ({
    currency,
    amount: v.cents / v.count / 100,
    count: v.count,
  }))
  let dominantCurrency: string | null = null
  let dominantCount = -1
  for (const [currency, v] of colMap) {
    if (v.count > dominantCount) {
      dominantCount = v.count
      dominantCurrency = currency
    }
  }
  let distribution: { range: string; count: number }[] = []
  if (dominantCurrency != null) {
    const distCounts = new Array<number>(PRICE_BUCKETS.length).fill(0)
    for (const p of pricedBooks) {
      if (p.currency !== dominantCurrency) continue
      // 从后往前找第一个 min ≤ amount 的桶（[min, nextMin) 左闭右开语义）
      for (let i = PRICE_BUCKETS.length - 1; i >= 0; i--) {
        if (p.amount >= PRICE_BUCKETS[i].min) {
          distCounts[i] += 1
          break
        }
      }
    }
    distribution = PRICE_BUCKETS.map((b, i) => ({
      range: b.range,
      count: distCounts[i],
    }))
  }

  return {
    summary: {
      totalBooks: books.length - deviceBookIds.size,
      totalCycles: borrowCycles.filter((c) => !isDeviceCycle(c)).length,
      inBorrow,
      avgDurationDays,
      medianDurationDays,
    },
    classification,
    borrowVolume,
    durationDistribution,
    gantt,
    calendar,
    money: {
      collectionValue,
      borrowedValue,
      avgPrice,
      dominantCurrency,
      distribution,
      multiCurrency: colMap.size > 1,
    },
  }
}

// --- 年度切片（reading-profile 规格 §2.7；年度目标/回顾/叙事共用） ---

/** 年度视图「最常借 Top N」常量（G-1 裁定 N=5）。 */
export const YEAR_TOP_BOOKS_N = 5

export interface YearSliceOptions {
  /** 分类体系，缺省取 sources 多数票（resolveSystem 同款）；仍空取 'clc' */
  classificationSystem: ClassificationSystem | null
  /** Top N，缺省 YEAR_TOP_BOOKS_N */
  topN: number
}

export interface YearSliceResult {
  /** 该年借出独立 Book id，升序（年度书单 + AI 叙事书目装配源） */
  bookIds: string[]
  /** 独立 Book 数（年度目标进度口径） */
  bookCount: number
  /** 按年内借出次数降序 Top topN（复借最多口径；同 count 按 bookId 升序稳定） */
  topBooks: { bookId: string; count: number }[]
  /** 该年独立 Book 分类分布，与 treemap 同桶形态（§2.1） */
  classification: {
    name: string
    code: string
    category: string | null
    value: number
  }[]
}

/**
 * 年度切片：年内「曾借出」的独立 Book（reading-profile §2.7）。
 * 口径：borrowedAt ∈ [y-01-01T00:00:00.000Z, (y+1)-01-01T00:00:00.000Z) UTC 左闭右开；
 * 不依赖 status='returned'（在借周期计入）；同书多次借阅计 1；设备书排除；
 * 跨年周期只计入 borrowedAt 所在年；空年零值结构不抛错。
 * 纯函数：不读 Date.now()/DOM/存储，同输入两次调用深等价。
 */
export function computeYearSlice(
  books: Book[],
  records: {
    catalogRecords: CatalogRecord[]
    borrowCycles: BorrowCycle[]
    sources: Source[]
  },
  year: number,
  options?: Partial<YearSliceOptions>,
): YearSliceResult {
  const { catalogRecords, borrowCycles, sources } = records
  const topN = options?.topN ?? YEAR_TOP_BOOKS_N
  const system = resolveSystem(options?.classificationSystem ?? null, sources)

  // UTC 年桶（左闭右开）
  const fromMs = Date.UTC(year, 0, 1)
  const toMs = Date.UTC(year + 1, 0, 1)

  // 设备排除（§2.0 排除总则）：设备书的周期不进入任何维度
  const deviceBookIds = new Set(
    books.filter((b) => b.materialType === 'device').map((b) => b.id),
  )

  // 年内周期计数（按书）：bookIds 去重与 topBooks 次数同源
  const countByBook = new Map<string, number>()
  for (const c of borrowCycles) {
    if (deviceBookIds.has(c.bookId)) continue
    const t = c.borrowedAt.getTime()
    if (t < fromMs || t >= toMs) continue
    countByBook.set(c.bookId, (countByBook.get(c.bookId) ?? 0) + 1)
  }

  const bookIds = Array.from(countByBook.keys()).sort()
  const topBooks = Array.from(countByBook.entries())
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, topN)
    .map(([bookId, count]) => ({ bookId, count }))
  const classification = buildClassificationBuckets(
    books,
    indexRecordsByBook(catalogRecords),
    deviceBookIds,
    system,
    new Set(bookIds),
  )

  return { bookIds, bookCount: bookIds.length, topBooks, classification }
}
