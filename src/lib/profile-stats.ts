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

  // --- 分类法分布 ---
  const system = resolveSystem(opts.classificationSystem, sources)
  const classMap = new Map<string, ClassificationBucket>()
  const bookById = new Map(books.map((b) => [b.id, b]))
  const recordsByBook = new Map<string, CatalogRecord[]>()
  for (const cr of catalogRecords) {
    const arr = recordsByBook.get(cr.bookId)
    if (arr) arr.push(cr)
    else recordsByBook.set(cr.bookId, [cr])
  }

  for (const book of books) {
    if (deviceBookIds.has(book.id)) continue
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

  const classification = Array.from(classMap.values())

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

  // --- 概览汇总 ---
  let inBorrow = 0
  for (const c of borrowCycles) {
    if (isDeviceCycle(c)) continue
    if (c.status === 'borrowed') inBorrow += 1
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
  }
}
