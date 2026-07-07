import { describe, it, expect } from 'vitest'

import { localToUtc } from '@/lib/time'

describe('localToUtc', () => {
  it('把 Asia/Shanghai 本地时间转 UTC（-8h）', () => {
    const d = localToUtc('2026-04-11T18:33:50', 'Asia/Shanghai')
    expect(d.toISOString()).toBe('2026-04-11T10:33:50.000Z')
  })

  it('对非法日期抛 Error', () => {
    expect(() => localToUtc('2026-02-30T10:00:00', 'Asia/Shanghai')).toThrow(Error)
  })

  it('对未知时区抛 Error', () => {
    expect(() => localToUtc('2026-04-11T18:33:50', 'Mars/Olympus')).toThrow(Error)
  })

  it('同输入跨调用返回等价 Date', () => {
    const a = localToUtc('20260630T100000'.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3T$4:$5:$6'), 'Asia/Shanghai')
    const b = localToUtc('2026-06-30T10:00:00', 'Asia/Shanghai')
    expect(a.toISOString()).toBe(b.toISOString())
  })
})
