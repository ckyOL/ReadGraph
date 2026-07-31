// displayTimezone 候选纯函数（settings 规格 §2）。
// 候选取浏览器 Intl.supportedValuesOf('timeZone')（运行时），
// 纯函数兜底为内置 IANA 列表。非法持久值由 readPreferences 降级；
// 本模块只负责提供候选，不写存储。
// 无 Date.now()、无副作用（收集运行时列表为只读调用）。

/** 内置 IANA 时区兜底列表（Intl.supportedValuesOf 不可用时的纯函数回退）。 */
export const FALLBACK_TIMEZONES: readonly string[] = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const

function collectRuntimeZones(): string[] {
  try {
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      const zones = Intl.supportedValuesOf('timeZone')
      if (Array.isArray(zones) && zones.length > 0) return [...zones]
    }
  } catch {
    // 运行时 API 抛错 → 回退内置列表
  }
  return [...FALLBACK_TIMEZONES]
}

/**
 * 时区候选列表（去重、排序）。current 一定在列（即使非法持久值），
 * 保证设置页 Select 始终能显示当前值并可重选。
 */
export function getTimeZoneCandidates(current?: string): string[] {
  const zones = collectRuntimeZones()
  if (current && !zones.includes(current)) zones.push(current)
  return zones.sort((a, b) => a.localeCompare(b))
}
