import { describe, expect, it } from 'vitest'
import { isDeviceCirtype } from './device-cirtype'

describe('isDeviceCirtype', () => {
  it('精确匹配「电子设备外借」为 true', () => {
    expect(isDeviceCirtype('电子设备外借')).toBe(true)
  })

  it('undefined/空串/其它值/前缀均 false', () => {
    expect(isDeviceCirtype(undefined)).toBe(false)
    expect(isDeviceCirtype('')).toBe(false)
    expect(isDeviceCirtype('中文图书外借')).toBe(false)
    expect(isDeviceCirtype('电子设备外借测试')).toBe(false)
  })
})
