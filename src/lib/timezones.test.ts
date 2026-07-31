import { describe, it, expect } from 'vitest'

import { formatTimeZoneLabel, getTimeZoneGroups } from './timezones'

// settings 规格 §2：displayTimezone 候选取 @vvo/tzdb（随 IANA tzdata 发版维护），
// 运行时经 Intl 计算当前偏移（DST 正确）；本地化名称/偏移/国家名按 locale 生成。
// 本测试覆盖分组/去重/排序契约与 DST 偏移正确性。

/** 固定 UTC 时刻，避免本地时区与「当前时刻」污染断言（DST 边界确定）。 */
const SUMMER = new Date('2026-07-01T12:00:00Z')
const WINTER = new Date('2026-01-01T12:00:00Z')

describe('getTimeZoneGroups', () => {
  it('含 Asia/Shanghai（默认 displayTimezone）与 UTC，且全局无重复', () => {
    const groups = getTimeZoneGroups('zh-CN', undefined, SUMMER)
    const all = groups.flatMap((g) => g.zones)
    expect(all.some((z) => z.iana === 'Asia/Shanghai')).toBe(true)
    expect(all.some((z) => z.iana === 'Etc/UTC')).toBe(true)
    expect(new Set(all.map((z) => z.iana)).size).toBe(all.length)
    expect(all.length).toBeGreaterThan(100)
  })

  it('按国家分组：CN 组含 Asia/Shanghai，国家名按 locale 本地化', () => {
    const zh = getTimeZoneGroups('zh-CN', undefined, SUMMER).find((g) => g.countryCode === 'CN')
    expect(zh?.countryLabel).toContain('中国')
    expect(zh?.zones.map((z) => z.iana)).toContain('Asia/Shanghai')
    expect(zh?.zones.find((z) => z.iana === 'Asia/Shanghai')?.localizedName).toContain('中国')

    const en = getTimeZoneGroups('en', undefined, SUMMER).find((g) => g.countryCode === 'CN')
    expect(en?.countryLabel).toBe('China')
  })

  it('UTC（无国家归属）组排在首位，组标签取时区本地化名', () => {
    const groups = getTimeZoneGroups('zh-CN', undefined, SUMMER)
    const utcGroup = groups[0]
    expect(utcGroup.countryCode).toBe('')
    expect(utcGroup.zones.some((z) => z.iana === 'Etc/UTC')).toBe(true)
    expect(utcGroup.countryLabel).toBe(utcGroup.zones[0].localizedName)
  })

  it('组按本地化国家名排序（UTC 组除外），组内保持 tzdb 偏移序（确定性）', () => {
    const groups = getTimeZoneGroups('zh-CN', undefined, SUMMER)
    // UTC（无国家归属）组固定首位，其余组按本地化国家名排序。
    expect(groups[0].countryCode).toBe('')
    const restLabels = groups.slice(1).map((g) => g.countryLabel)
    const sorted = [...restLabels].sort((a, b) => a.localeCompare(b, 'zh-CN'))
    expect(restLabels).toEqual(sorted)
  })

  it('current 不在候选内时被追加为独立组（非法持久值仍可显示并重选）', () => {
    const groups = getTimeZoneGroups('zh-CN', 'Mars/Olympus', SUMMER)
    const group = groups.find((g) => g.zones.some((z) => z.iana === 'Mars/Olympus'))
    expect(group?.zones[0].iana).toBe('Mars/Olympus')
    expect(group?.zones[0].localizedName).toBe('Mars/Olympus') // 非法时区原样展示
    expect(group?.zones[0].offsetLabel).toBe('')
  })

  it('搜索词含 IANA 别名/主要城市/本地化国家名', () => {
    const groups = getTimeZoneGroups('zh-CN', undefined, SUMMER)
    const shanghai = groups.flatMap((g) => g.zones).find((z) => z.iana === 'Asia/Shanghai')
    expect(shanghai?.searchTerms).toContain('Shenzhen') // mainCities
    expect(shanghai?.searchTerms).toContain('China') // tzdb 英文国家名
    expect(shanghai?.searchTerms).toContain('中国') // 本地化国家名
  })

  it('macOS 式城市标签：zh 经 CLDR 本地化，en 回退 tzdb 英文城市', () => {
    const zh = getTimeZoneGroups('zh-CN', undefined, SUMMER)
    const zhShanghai = zh.flatMap((g) => g.zones).find((z) => z.iana === 'Asia/Shanghai')
    expect(zhShanghai?.city).toBe('上海')
    expect(zhShanghai?.searchTerms).toContain('上海')
    const zhBerlin = zh.flatMap((g) => g.zones).find((z) => z.iana === 'Europe/Berlin')
    expect(zhBerlin?.city).toBe('柏林')
    const zhNy = zh.flatMap((g) => g.zones).find((z) => z.iana === 'America/New_York')
    expect(zhNy?.city).toBe('纽约')

    const en = getTimeZoneGroups('en', undefined, SUMMER)
    const enShanghai = en.flatMap((g) => g.zones).find((z) => z.iana === 'Asia/Shanghai')
    expect(enShanghai?.city).toBe('Shanghai') // tzdb mainCities[0]
  })

  it('zh 未覆盖时区回退 tzdb 英文城市；UTC 与非法持久值无城市', () => {
    const zh = getTimeZoneGroups('zh-CN', undefined, SUMMER)
    const atikokan = zh.flatMap((g) => g.zones).find((z) => z.iana === 'America/Atikokan')
    expect(atikokan?.city).toBe('Atikokan')
    const utc = zh.flatMap((g) => g.zones).find((z) => z.iana === 'Etc/UTC')
    expect(utc?.city).toBe('')

    const legacy = getTimeZoneGroups('zh-CN', 'Mars/Olympus', SUMMER)
    const mars = legacy.flatMap((g) => g.zones).find((z) => z.iana === 'Mars/Olympus')
    expect(mars?.city).toBe('')
  })
})

describe('formatTimeZoneLabel', () => {
  it('en：Asia/Shanghai 固定偏移 GMT+8，本地化名为 China 系', () => {
    const { localizedName, offsetLabel } = formatTimeZoneLabel('en', 'Asia/Shanghai', SUMMER)
    expect(localizedName).toContain('China')
    expect(offsetLabel).toBe('GMT+8')
  })

  it('zh：Asia/Shanghai 本地化名含「中国」', () => {
    expect(formatTimeZoneLabel('zh-CN', 'Asia/Shanghai', SUMMER).localizedName).toContain('中国')
  })

  it('DST：Berlin 夏季 GMT+2、冬季 GMT+1（偏移随 IANA 规则变化）', () => {
    expect(formatTimeZoneLabel('en', 'Europe/Berlin', SUMMER).offsetLabel).toBe('GMT+2')
    expect(formatTimeZoneLabel('en', 'Europe/Berlin', WINTER).offsetLabel).toBe('GMT+1')
  })

  it('非法时区原样展示 IANA 标识、偏移为空，不抛错', () => {
    const { localizedName, offsetLabel } = formatTimeZoneLabel('zh-CN', 'Not/AZone', SUMMER)
    expect(localizedName).toBe('Not/AZone')
    expect(offsetLabel).toBe('')
  })
})
