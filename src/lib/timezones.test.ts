import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { FALLBACK_TIMEZONES, getTimeZoneCandidates } from './timezones'

// settings 规格 §2：displayTimezone 候选取 Intl.supportedValuesOf('timeZone')
// （运行时），纯函数兜底为内置 IANA 列表。本测试覆盖回退路径与排序/去重契约。

const savedSupportedValuesOf = Intl.supportedValuesOf

beforeEach(() => {
  // 默认不 stub：node 运行时 Intl.supportedValuesOf 存在，测真实运行时路径。
})

afterEach(() => {
  Object.defineProperty(Intl, 'supportedValuesOf', {
    value: savedSupportedValuesOf,
    configurable: true,
    writable: true,
  })
})

function stubSupportedValuesOf(value: ((key: 'timeZone') => string[]) | undefined): void {
  Object.defineProperty(Intl, 'supportedValuesOf', {
    value,
    configurable: true,
    writable: true,
  })
}

describe('FALLBACK_TIMEZONES', () => {
  it('是内置 IANA 列表，含 UTC 与 Asia/Shanghai（默认 displayTimezone）', () => {
    expect(FALLBACK_TIMEZONES).toContain('UTC')
    expect(FALLBACK_TIMEZONES).toContain('Asia/Shanghai')
  })
})

describe('getTimeZoneCandidates', () => {
  it('运行时路径：返回 Intl.supportedValuesOf 列表（去重、排序）', () => {
    const zones = getTimeZoneCandidates()
    expect(zones.length).toBeGreaterThanOrEqual(FALLBACK_TIMEZONES.length)
    expect(zones).toContain('Asia/Shanghai')
    // 排序 + 无重复。
    const sorted = [...zones].sort((a, b) => a.localeCompare(b))
    expect(zones).toEqual(sorted)
    expect(new Set(zones).size).toBe(zones.length)
  })

  it('supportedValuesOf 缺失时回退内置 IANA 列表', () => {
    stubSupportedValuesOf(undefined)
    expect(getTimeZoneCandidates()).toEqual([...FALLBACK_TIMEZONES].sort((a, b) => a.localeCompare(b)))
  })

  it('supportedValuesOf 抛错时回退内置 IANA 列表且不抛', () => {
    stubSupportedValuesOf(() => {
      throw new Error('unsupported')
    })
    expect(getTimeZoneCandidates()).toContain('Asia/Shanghai')
  })

  it('current 不在候选内时被追加（非法持久值仍可显示并重选）', () => {
    stubSupportedValuesOf(() => ['UTC'])
    const zones = getTimeZoneCandidates('Mars/Olympus')
    expect(zones).toContain('Mars/Olympus')
    expect(zones[0]).toBe('Mars/Olympus') // 排序后 lexicographic 在前
    expect(zones).toContain('UTC')
  })
})
