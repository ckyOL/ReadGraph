// loadClcTree 懒加载缓存（规格 §8「树懒加载：动态 import 一次并缓存」）。
// 独立文件：需要 mock clc-tree.json 模块，避免污染解析层测试的真实树导入。
import { describe, it, expect, vi } from 'vitest'

import { loadClcTree } from './classification-path'

vi.mock('@/data/classification/clc-tree.json', () => ({
  default: [{ id: 'J', desc: '艺术' }],
}))

describe('loadClcTree', () => {
  it('动态 import 一次并缓存 Promise（多次调用返回同一实例）', async () => {
    const first = loadClcTree()
    // 同一渲染周期的重复调用拿到同一 Promise → 只触发一次动态 import。
    expect(loadClcTree()).toBe(first)
    await expect(first).resolves.toEqual([{ id: 'J', desc: '艺术' }])
    // 解析完成后仍命中缓存。
    expect(loadClcTree()).toBe(first)
  })
})
