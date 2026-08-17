import { describe, it, expect } from 'vitest'

import { normalizePublishDate } from '@/lib/publish-date'

describe('normalizePublishDate', () => {
  it('字符串原样透传', () => {
    expect(normalizePublishDate('2024-01-10')).toBe('2024-01-10')
  })

  it('Date 对象归一为 UTC 日期串（e2e-seed DATE_KEYS revive 场景）', () => {
    expect(normalizePublishDate(new Date('2024-01-10T02:00:00.000Z'))).toBe('2024-01-10')
  })

  it('null 透传', () => {
    expect(normalizePublishDate(null)).toBeNull()
  })

  it('undefined 透传', () => {
    expect(normalizePublishDate(undefined)).toBeUndefined()
  })
})
