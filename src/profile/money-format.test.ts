// 价值统计展示格式化（reading-profile 规格 §2.5 / §8）。
// M7 回归：非法币种码不得令 Intl.NumberFormat 抛 RangeError 拖垮 profile 页。
import { describe, it, expect } from 'vitest'

import { formatCurrency } from './money-format'

describe('formatCurrency', () => {
  it('合法币种正常输出货币串', () => {
    expect(formatCurrency(35, 'CNY', 'zh-CN')).toContain('35')
    expect(formatCurrency(12.5, 'USD', 'en')).toContain('12.5')
  })

  it('非法币种码（如 US）降级为纯数字格式，不抛 RangeError（M7）', () => {
    // parsePrice 正则可产出、编辑表单自由文本可输入的非法币种码，
    // 旧版直接抛 RangeError → MoneyCards 无 ErrorBoundary → profile 整页崩溃。
    expect(() => formatCurrency(35, 'US', 'zh-CN')).not.toThrow()
    expect(formatCurrency(35, 'US', 'zh-CN')).toContain('35')
    expect(() => formatCurrency(0, 'NOT-A-CURRENCY', 'en')).not.toThrow()
  })
})
