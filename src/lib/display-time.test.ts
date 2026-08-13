import { describe, it, expect } from 'vitest'

import { formatBucketLabel, formatDateInTz, formatDateTimeInTz, formatDayDuration } from './display-time'

describe('formatDateInTz（UTC → displayTimezone）', () => {
  it('Asia/Shanghai：UTC 日期跨零点后按 +8 显示次日', () => {
    // 2024-01-09T16:30:00Z = 2024-01-10 00:30 Asia/Shanghai
    const d = new Date('2024-01-09T16:30:00.000Z')
    expect(formatDateInTz(d, 'Asia/Shanghai')).toBe('2024-01-10')
  })

  it('America/New_York（冬令时 UTC-5）：同日展示', () => {
    const d = new Date('2024-01-10T05:30:00.000Z')
    expect(formatDateInTz(d, 'America/New_York')).toBe('2024-01-10')
  })

  it('同一天内 UTC 与 displayTimezone 一致', () => {
    const d = new Date('2024-01-10T02:00:00.000Z')
    expect(formatDateInTz(d, 'UTC')).toBe('2024-01-10')
  })
})

describe('formatDateTimeInTz', () => {
  it('输出本地墙上时间（含时分）', () => {
    const d = new Date('2024-01-09T16:30:00.000Z')
    expect(formatDateTimeInTz(d, 'Asia/Shanghai')).toBe('2024-01-10 00:30')
  })

  it('非法时区降级为 UTC 且不抛错', () => {
    const d = new Date('2024-01-10T05:00:00.000Z')
    expect(formatDateTimeInTz(d, 'Not/AZone')).toBe('2024-01-10 05:00')
  })
})

describe('formatDayDuration', () => {
  it('整数天直接呈现', () => {
    expect(formatDayDuration(5)).toBe('5')
  })

  it('不足一天按 1 天向上取整（无 0 天）', () => {
    expect(formatDayDuration(0)).toBe('1')
    expect(formatDayDuration(0.5)).toBe('1')
  })
})

describe('formatBucketLabel（M6：UTC 桶名不受时区偏移）', () => {
  it('月桶：UTC− 时区下仍显示桶名月份（旧版错显上月）', () => {
    // 旧实现用 displayTimezone 格式化桶起点：America/New_York 下
    // 2026-05-01T00:00Z 落在 4 月 → 标签错显 "Apr"；桶是 UTC 日历单位，
    // 标签必须恒为桶名月份（May / 5月）。
    expect(formatBucketLabel('2026-05', 'en')).toContain('May')
    expect(formatBucketLabel('2026-05', 'en')).toContain('2026')
    expect(formatBucketLabel('2026-05', 'zh-CN')).toContain('5月')
  })

  it('年桶：显示桶年（UTC− 下旧版错显上年）', () => {
    // Date.UTC(2020,0,1) 在 America/New_York 下为 2019-12-31 → 旧版错显 2019。
    expect(formatBucketLabel('2020', 'en')).toContain('2020')
    expect(formatBucketLabel('2020', 'zh-CN')).toContain('2020')
  })
})
