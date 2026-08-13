// 编目条码前缀归属馆解析纯函数测试（branch-library 规格 §3）。
// 覆盖：注册表结构、szlib 全量 11 前缀命中、恰好 6 位、字母前缀大小写归一、
// 空值/长度不足/未知前缀降级、未知来源（parserId）降级（均不抛错）。
import { describe, it, expect } from 'vitest'
import {
  BRANCH_PREFIX_TABLES,
  SZ_BRANCH_PREFIXES,
  branchOfBarcode,
} from './branch-prefix'

describe('BRANCH_PREFIX_TABLES', () => {
  it('注册表按 parserId 组织，含 szlib 参考实现', () => {
    expect(BRANCH_PREFIX_TABLES['szlib']).toBe(SZ_BRANCH_PREFIXES)
  })

  it('szlib 表恰好 11 条，键长均为 6（无前缀包含歧义）', () => {
    const keys = Object.keys(SZ_BRANCH_PREFIXES)
    expect(keys).toHaveLength(11)
    for (const key of keys) expect(key).toHaveLength(6)
  })
})

describe('branchOfBarcode', () => {
  it('前 6 位命中 → 返回归属馆名（szlib 全量 11 前缀）', () => {
    const cases: Array<[string, string]> = [
      ['04400514707325', '市馆'],
      ['04400611745052', '南山区'],
      ['04400790006607', '宝安区'],
      ['04400800000000', '福田区'],
      ['04400900000000', '盐田区'],
      ['04401021533645', '罗湖区'],
      ['04412000000000', '龙岗区'],
      ['04413200000000', '光明区'],
      ['04413600000000', '坪山区'],
      ['04413700000000', '龙华区'],
      ['F440101234567', '大学城'],
    ]
    for (const [barcode, expected] of cases) {
      expect(branchOfBarcode(barcode, 'szlib')).toBe(expected)
    }
  })

  it('恰好 6 位的前缀同样命中', () => {
    expect(branchOfBarcode('044005', 'szlib')).toBe('市馆')
    expect(branchOfBarcode('F44010', 'szlib')).toBe('大学城')
  })

  it('字母前缀大小写归一（f44010 → 大学城）', () => {
    expect(branchOfBarcode('f440101234567', 'szlib')).toBe('大学城')
  })

  it('空值/长度不足 → null', () => {
    expect(branchOfBarcode(null, 'szlib')).toBeNull()
    expect(branchOfBarcode(undefined, 'szlib')).toBeNull()
    expect(branchOfBarcode('', 'szlib')).toBeNull()
    expect(branchOfBarcode('04400', 'szlib')).toBeNull()
    expect(branchOfBarcode('F4401', 'szlib')).toBeNull()
  })

  it('非 szlib 条码/未知前缀 → null（不抛错）', () => {
    expect(branchOfBarcode('BC001', 'szlib')).toBeNull()
    expect(branchOfBarcode('9787111000000', 'szlib')).toBeNull()
    expect(branchOfBarcode('04401100000000', 'szlib')).toBeNull()
    expect(branchOfBarcode('F44011', 'szlib')).toBeNull()
    expect(branchOfBarcode('x44010123456', 'szlib')).toBeNull()
  })

  it('未知来源（parserId 未注册）/缺失 parserId → null（不抛错）', () => {
    expect(branchOfBarcode('04400514707325', 'no-such-parser')).toBeNull()
    expect(branchOfBarcode('04400514707325', null)).toBeNull()
    expect(branchOfBarcode('04400514707325', undefined)).toBeNull()
    // 其他来源即使条码形似 szlib，未注册规则也不解析。
    expect(branchOfBarcode('04400514707325', 'libby')).toBeNull()
  })
})
