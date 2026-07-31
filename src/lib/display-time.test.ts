import { describe, it, expect } from 'vitest'

import { formatDateInTz, formatDateTimeInTz, formatDayDuration } from './display-time'

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
