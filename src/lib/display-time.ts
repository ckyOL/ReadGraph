// UTC 存储时间 → displayTimezone 展示的纯函数（ui-navigation §6 数据契约）。
// 时间以 UTC 存储；UI 显示按 UserPreferences.displayTimezone（IANA）转换。
// 无 Date.now()；非法时区降级为 UTC 格式输出，不抛错。
const DATE_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()
const DATETIME_FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

function dateFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = DATE_FORMATTER_CACHE.get(timezone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    DATE_FORMATTER_CACHE.set(timezone, fmt)
  }
  return fmt
}

/**
 * UTC Date → displayTimezone 的日期串（"YYYY-MM-DD"）。
 * 跨零点偏移由 IANA 时区规则决定（如 Asia/Shanghai +8）。
 * 非法时区抛 RangeError 时降级按 UTC 输出。
 */
export function formatDateInTz(date: Date, timezone: string): string {
  try {
    return dateFormatter(timezone).format(date)
  } catch {
    return dateFormatter('UTC').format(date)
  }
}

function dateTimeFormatter(timezone: string): Intl.DateTimeFormat {
  let fmt = DATETIME_FORMATTER_CACHE.get(timezone)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    DATETIME_FORMATTER_CACHE.set(timezone, fmt)
  }
  return fmt
}

/** "YYYY-MM-DD HH:mm"（24h）。仅保留数字字段，规避 locale 分隔符差异。 */
function partsToDateTime(parts: Intl.DateTimeFormatPart[]): string {
  const p: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') p[part.type] = part.value
  }
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`
}

/**
 * UTC Date → displayTimezone 的日期时间串（"YYYY-MM-DD HH:mm"，24h）。
 * 非法时区降级为 UTC 输出，不抛错。
 */
export function formatDateTimeInTz(date: Date, timezone: string): string {
  try {
    return partsToDateTime(dateTimeFormatter(timezone).formatToParts(date))
  } catch {
    return partsToDateTime(dateTimeFormatter('UTC').formatToParts(date))
  }
}

/**
 * 借阅时长（天）呈现：整数天原样；不足一天按 1 天（无 0 天）。
 * 与阅读画像时长分布（ceil）口径一致。
 */
export function formatDayDuration(days: number): string {
  return String(Math.max(1, Math.ceil(days)))
}
