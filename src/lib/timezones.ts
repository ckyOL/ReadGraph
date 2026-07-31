// displayTimezone 候选纯函数（settings 规格 §2）。
// 候选数据源 @vvo/tzdb（随 IANA tzdata 发版维护，含国家/主要城市/别名元数据）；
// getTimeZones() 调用时用 Intl 计算各时区**当前**偏移（夏令时正确），未知时区被其过滤。
// 本地化名称/偏移/国家名按当前 locale 由 Intl 生成（i18n-conventions §6 无硬编码文案）。
// 无 Date.now() 于模块顶层，时间锚经 now 参数注入（默认调用时刻）。
// 本模块只提供候选与标签，不写存储；非法持久值由 readPreferences 降级。
import { getTimeZones } from '@vvo/tzdb'

export interface TimeZoneCandidate {
  /** IANA 标识（写入 UserPreferences.displayTimezone 的值） */
  iana: string
  /** 本地化名称：zh 下 Asia/Shanghai → 中国标准时间 */
  localizedName: string
  /** 当前偏移标签：GMT+8（夏令时期间自动变化） */
  offsetLabel: string
  /** ISO 3166-1 alpha-2；UTC 等无国家归属时为空串 */
  countryCode: string
  /** tzdb 英文国家名（仅作搜索词，显示用 group.countryLabel） */
  countryName: string
  /** 搜索词：别名/缩写/国家（含本地化名）/大洲/主要城市/IANA 别名组 */
  searchTerms: string[]
}

export interface TimeZoneGroup {
  countryCode: string
  /** 本地化国家名；无国家归属时为首个时区的本地化名（如「协调世界时」） */
  countryLabel: string
  zones: TimeZoneCandidate[]
}

const LONG_NAME_CACHE = new Map<string, Intl.DateTimeFormat>()
const OFFSET_CACHE = new Map<string, Intl.DateTimeFormat>()
const REGION_NAMES = new Map<string, Intl.DisplayNames>()

function timeZoneName(
  locale: string,
  iana: string,
  style: 'long' | 'shortOffset',
  now: Date,
): string {
  const cache = style === 'long' ? LONG_NAME_CACHE : OFFSET_CACHE
  const key = `${locale}\u0000${iana}`
  let fmt = cache.get(key)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(locale, { timeZone: iana, timeZoneName: style })
    cache.set(key, fmt)
  }
  return fmt.formatToParts(now).find((p) => p.type === 'timeZoneName')?.value ?? ''
}

/**
 * UTC Date 的时区标签（本地化名 + 当前偏移）。
 * 偏移由 IANA 规则在 now 时刻决定（如 Berlin 夏季 GMT+2 / 冬季 GMT+1）。
 * 非法时区（Intl 抛 RangeError）→ 原样展示 IANA 标识，偏移为空，不抛错。
 */
export function formatTimeZoneLabel(
  locale: string,
  iana: string,
  now: Date = new Date(),
): { localizedName: string; offsetLabel: string } {
  let localizedName = iana
  let offsetLabel = ''
  try {
    const name = timeZoneName(locale, iana, 'long', now)
    if (name) localizedName = name
    offsetLabel = timeZoneName(locale, iana, 'shortOffset', now)
  } catch {
    // 非法时区 → 兜底展示 IANA
  }
  return { localizedName, offsetLabel }
}

function localizedCountryLabel(locale: string, code: string, fallback: string): string {
  if (!code) return fallback
  try {
    let dn = REGION_NAMES.get(locale)
    if (!dn) {
      dn = new Intl.DisplayNames(locale, { type: 'region' })
      REGION_NAMES.set(locale, dn)
    }
    return dn.of(code) || fallback
  } catch {
    return fallback
  }
}

/**
 * 按国家分组的时区候选（去重、UTC 组优先、组内保持 tzdb 偏移序）。
 * current 不在候选内时被追加（非法/旧持久值仍可显示并重选），自成一组。
 */
export function getTimeZoneGroups(
  locale: string,
  current?: string,
  now: Date = new Date(),
): TimeZoneGroup[] {
  const zones = new Map<string, TimeZoneCandidate>()
  for (const tz of getTimeZones({ includeUtc: true })) {
    if (zones.has(tz.name)) continue
    const { localizedName, offsetLabel } = formatTimeZoneLabel(locale, tz.name, now)
    zones.set(tz.name, {
      iana: tz.name,
      localizedName,
      offsetLabel,
      countryCode: tz.countryCode ?? '',
      countryName: tz.countryName ?? '',
      searchTerms: [localizedName, tz.alternativeName, tz.abbreviation, tz.countryName, tz.continentName, ...tz.mainCities, ...tz.group].filter(Boolean),
    })
  }
  if (current && !zones.has(current)) {
    const { localizedName, offsetLabel } = formatTimeZoneLabel(locale, current, now)
    zones.set(current, {
      iana: current,
      localizedName,
      offsetLabel,
      countryCode: '',
      countryName: '',
      searchTerms: [localizedName],
    })
  }

  const groups = new Map<string, TimeZoneGroup>()
  for (const zone of zones.values()) {
    const key = zone.countryCode || zone.iana
    let group = groups.get(key)
    if (!group) {
      group = {
        countryCode: zone.countryCode,
        countryLabel: localizedCountryLabel(locale, zone.countryCode, zone.localizedName),
        zones: [],
      }
      groups.set(key, group)
    }
    group.zones.push(zone)
    for (const term of [zone.countryName, group.countryLabel]) {
      if (term && !zone.searchTerms.includes(term)) zone.searchTerms.push(term)
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.countryCode && !b.countryCode) return 1
    if (!a.countryCode && b.countryCode) return -1
    return a.countryLabel.localeCompare(b.countryLabel, locale)
  })
}
