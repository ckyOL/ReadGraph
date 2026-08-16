import { describe, it, expect } from 'vitest'

import { isDateRangeInverted } from '@/profile/date-range'

/**
 * 日期范围倒置校验（阶段 2 A-2，WCAG 3.3.1 错误标识）。
 * 输入为 `<input type="date">` 的 YYYY-MM-DD 字符串：两端均填且 from > to 即倒置。
 * YYYY-MM-DD 定长字典序等价于时间序，直接字符串比较即可，无需解析为 Date。
 */
describe('isDateRangeInverted', () => {
  it('returns false when either end is empty', () => {
    expect(isDateRangeInverted('', '')).toBe(false)
    expect(isDateRangeInverted('2025-06-01', '')).toBe(false)
    expect(isDateRangeInverted('', '2025-01-01')).toBe(false)
  })

  it('returns false for a valid range (from <= to)', () => {
    expect(isDateRangeInverted('2025-01-01', '2025-12-31')).toBe(false)
    expect(isDateRangeInverted('2025-06-01', '2025-06-01')).toBe(false)
  })

  it('returns true when from > to (inverted range)', () => {
    expect(isDateRangeInverted('2025-06-01', '2025-01-01')).toBe(true)
    expect(isDateRangeInverted('2026-01-01', '2025-12-31')).toBe(true)
  })
})
