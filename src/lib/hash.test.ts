import { describe, it, expect } from 'vitest'

import { stableHash } from '@/lib/hash'

describe('stableHash', () => {
  it('返回固定长度 8 位十六进制串', () => {
    expect(stableHash('')).toMatch(/^[0-9a-f]{8}$/)
    expect(stableHash('hello')).toMatch(/^[0-9a-f]{8}$/)
    expect(stableHash('深圳图书馆')).toMatch(/^[0-9a-f]{8}$/)
  })

  it('对相同输入确定等价', () => {
    expect(stableHash('szlib|F4401001911110')).toBe(stableHash('szlib|F4401001911110'))
  })

  it('对不同输入产出不同哈希', () => {
    expect(stableHash('a')).not.toBe(stableHash('b'))
  })

  it('空串哈希为 FNV-1a 的 offset basis', () => {
    // FNV-1a 32 空输入 = offset basis 0x811c9dc5
    expect(stableHash('')).toBe('811c9dc5')
  })

  it('对 ASCII 已知值产出稳定结果', () => {
    // 'a' 的 FNV-1a 32: 0xe40c292c
    expect(stableHash('a')).toBe('e40c292c')
  })
})
