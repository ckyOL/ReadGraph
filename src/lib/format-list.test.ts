import { describe, it, expect } from 'vitest'

import { formatList } from '@/lib/format-list'

describe('formatList', () => {
  it('zh-CN 用「、」连接', () => {
    expect(formatList('zh-CN', ['作者甲', '作者乙'])).toBe('作者甲、作者乙')
  })

  it('zh-CN 三项', () => {
    expect(formatList('zh-CN', ['甲', '乙', '丙'])).toBe('甲、乙、丙')
  })

  it('en 用「, 」连接', () => {
    expect(formatList('en', ['Alice', 'Bob', 'Carol'])).toBe('Alice, Bob, Carol')
  })

  it('en 两项', () => {
    expect(formatList('en', ['Alice', 'Bob'])).toBe('Alice, Bob')
  })

  it('单元素原样返回', () => {
    expect(formatList('en', ['solo'])).toBe('solo')
  })

  it('空数组返回空串', () => {
    expect(formatList('zh-CN', [])).toBe('')
  })
})
