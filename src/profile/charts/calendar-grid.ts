// 借阅日历网格纯函数（reading-profile §2.6/§4，bookology-benchmark §5.1）。
//
// GitHub 贡献图式网格：年视图（x=周列，y=7 行星期）与月视图（x=7 列星期，
// y=月内周行）均由本模块纯函数产格；不读 Date.now()/DOM/存储，同入参深等价。
// 日键为 UTC 'YYYY-MM-DD'（聚合层产），周起始日随 locale（zh 周一 / en 周日）
// 仅影响行列排布，不影响日→桶映射。
import type { CalendarDay } from '@/lib/profile-stats'

export interface CalendarCell extends CalendarDay {
  /** 列（年视图 = 周列；月视图 = 星期列） */
  x: number
  /** 行（年视图 = 星期行；月视图 = 月内周行） */
  y: number
}

export interface CalendarGrid {
  cells: CalendarCell[]
  /** x 轴标签：年视图 = 月初列月名；月视图 = 星期短名 */
  xLabels: { index: number; label: string }[]
  /** y 轴标签：年视图 = 星期短名；月视图 = 空串占位（无标签） */
  yLabels: string[]
  xCount: number
  yCount: number
}

const MS_PER_DAY = 86_400_000

const dayNumOf = (y: number, m: number, d: number): number =>
  Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY)

/** 星期索引：weekStartsOn=0（周日先行）→ getUTCDay()；=1（周一先行）→ 平移。 */
function weekdayIndex(
  y: number,
  m: number,
  d: number,
  weekStartsOn: 0 | 1,
): number {
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun
  return weekStartsOn === 1 ? (dow + 6) % 7 : dow
}

/** 星期短名（UTC 锚定固定周，避免 DST/时区扰动），按周起始顺序。 */
function weekdayNames(weekStartsOn: 0 | 1, locale: string): string[] {
  const fmt = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: 'UTC',
  })
  // 2024-01-07 是周日；+1..+6 依次为周一到周六。
  const sun = Date.UTC(2024, 0, 7)
  const byDow = Array.from({ length: 7 }, (_, i) =>
    fmt.format(new Date(sun + i * MS_PER_DAY)),
  ) // [Sun, Mon, Tue, Wed, Thu, Fri, Sat]
  return weekStartsOn === 1 ? [...byDow.slice(1), byDow[0]] : byDow
}

/** 月名短标（UTC），如 zh-CN '2月' / en 'Feb'。 */
function monthName(year: number, month: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

/** 年视图：全年网格（含无数据日 count=0），x=周列（含月初列月名标签）。 */
export function buildYearGrid(
  days: CalendarDay[],
  year: number,
  weekStartsOn: 0 | 1,
  locale: string,
): CalendarGrid {
  const firstDayNum = dayNumOf(year, 1, 1)
  const firstWeekday = weekdayIndex(year, 1, 1, weekStartsOn)
  const startColDayNum = firstDayNum - firstWeekday
  const lastDayNum = dayNumOf(year, 12, 31)
  const xCount = Math.ceil((lastDayNum - startColDayNum + 1) / 7)

  const dayByKey = new Map<string, CalendarDay>()
  for (const d of days) dayByKey.set(d.date, d)

  const cells: CalendarCell[] = []
  for (let n = firstDayNum; n <= lastDayNum; n++) {
    const key = new Date(n * MS_PER_DAY).toISOString().slice(0, 10)
    const hit = dayByKey.get(key)
    const x = Math.floor((n - startColDayNum) / 7)
    const dow = new Date(n * MS_PER_DAY).getUTCDay()
    const row = weekStartsOn === 1 ? (dow + 6) % 7 : dow
    cells.push({
      date: key,
      count: hit?.count ?? 0,
      bookIds: hit?.bookIds ?? [],
      x,
      y: row,
    })
  }

  // 月初列标签：每月 1 日所在周列标月名。
  const xLabels: { index: number; label: string }[] = []
  for (let m = 1; m <= 12; m++) {
    const col = Math.floor((dayNumOf(year, m, 1) - startColDayNum) / 7)
    xLabels.push({ index: col, label: monthName(year, m, locale) })
  }

  return {
    cells,
    xLabels,
    yLabels: weekdayNames(weekStartsOn, locale),
    xCount,
    yCount: 7,
  }
}

/** 月视图：单月网格（含无数据日 count=0），x=7 列星期，y=月内周行。 */
export function buildMonthGrid(
  days: CalendarDay[],
  year: number,
  month: number,
  weekStartsOn: 0 | 1,
  locale: string,
): CalendarGrid {
  const firstWeekday = weekdayIndex(year, month, 1, weekStartsOn)
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
  const yCount = Math.ceil((firstWeekday + daysInMonth) / 7)

  const dayByKey = new Map<string, CalendarDay>()
  for (const d of days) dayByKey.set(d.date, d)

  const cells: CalendarCell[] = []
  for (let d = 1; d <= daysInMonth; d++) {
    const key = new Date(Date.UTC(year, month - 1, d)).toISOString().slice(0, 10)
    const hit = dayByKey.get(key)
    cells.push({
      date: key,
      count: hit?.count ?? 0,
      bookIds: hit?.bookIds ?? [],
      x: weekdayIndex(year, month, d, weekStartsOn),
      y: Math.floor((d - 1 + firstWeekday) / 7),
    })
  }

  const weekdayLabels = weekdayNames(weekStartsOn, locale)
  return {
    cells,
    xLabels: weekdayLabels.map((label, index) => ({ index, label })),
    yLabels: Array.from({ length: yCount }, () => ''),
    xCount: 7,
    yCount,
  }
}

/** 十六进制 #RRGGBB → rgba()（ECharts heatmap 格色需要 alpha 阶）。 */
function hexToRgba(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = Number.parseInt(m[1], 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  return `rgba(${r},${g},${b},${alpha})`
}

/**
 * 格色：count=0 弱底格（border 低 alpha）；1–4+ 按松叶色分 alpha 阶
 * （0.25/0.45/0.65/0.85），绝对计数分阶保证跨视图稳定。
 */
export function calendarCellColor(
  count: number,
  chart2: string,
  border: string,
): string {
  if (count <= 0) return hexToRgba(border, 0.5)
  const alpha = Math.min(0.25 + 0.2 * (count - 1), 0.85)
  return hexToRgba(chart2, alpha)
}

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

export interface CalendarTooltipOptions {
  dateText: string
  countText: string
  moreText: (hidden: number) => string
  maxBooks?: number
}

/**
 * tooltip HTML（ECharts formatter 用）：日期 + 在借本数 + 题名列表
 * （含封面缩略图，≤ maxBooks 本折叠「另有 N 本」）；书名/URL 一律转义防注入。
 * count=0 返回空串（无数据日不显 tooltip）；bookIndex 缺失的 bookId 跳过。
 */
export function buildCalendarTooltip(
  cell: CalendarCell,
  bookIndex: Record<string, { title: string; coverUrl: string | null }>,
  opts: CalendarTooltipOptions,
): string {
  if (cell.count === 0) return ''
  const max = opts.maxBooks ?? 8
  const ids = cell.bookIds.slice(0, max)
  const hidden = cell.bookIds.length - ids.length
  const rows = ids
    .map((id) => {
      const book = bookIndex[id]
      if (!book) return ''
      const title = escapeHtml(book.title)
      const img = book.coverUrl
        ? `<img src="${escapeHtml(book.coverUrl)}" referrerpolicy="no-referrer" loading="lazy" class="inline-block h-6 w-4 shrink-0 rounded-[1px] border border-border object-cover" alt="" />`
        : ''
      return `<div class="flex items-center gap-1.5">${img}<span class="truncate">${title}</span></div>`
    })
    .filter((r) => r !== '')
    .join('')
  const more = hidden > 0
    ? `<div class="mt-1 text-muted-foreground">${escapeHtml(opts.moreText(hidden))}</div>`
    : ''
  return (
    `<div class="max-w-56 text-xs leading-5">` +
    `<div class="mb-1 font-semibold">${escapeHtml(opts.dateText)} · ${escapeHtml(opts.countText)}</div>` +
    rows +
    more +
    `</div>`
  )
}
