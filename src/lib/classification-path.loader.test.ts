// loadClcTree 懒加载缓存（规格 §8「树懒加载：fetch 一次并缓存」）。
// 独立文件：模块级 Promise 单例需 vi.resetModules 隔离，避免用例间状态泄漏。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type LoaderModule = typeof import('./classification-path')

async function freshModule(): Promise<LoaderModule> {
  vi.resetModules()
  return await import('./classification-path')
}

describe('loadClcTree', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('fetch 拉取一次并缓存 Promise（多次调用返回同一实例）', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [{ id: 'J', desc: '艺术' }] })
    vi.stubGlobal('fetch', fetchMock)
    const mod = await freshModule()
    const first = mod.loadClcTree()
    // 同一渲染周期的重复调用拿到同一 Promise → 只触发一次 fetch。
    expect(mod.loadClcTree()).toBe(first)
    await expect(first).resolves.toEqual([{ id: 'J', desc: '艺术' }])
    expect(mod.loadClcTree()).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith('classification/clc-tree.json')
  })

  it('404 → 降级空数组（一级表兜底）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const mod = await freshModule()
    await expect(mod.loadClcTree()).resolves.toEqual([])
  })

  it('网络失败 → 降级空数组', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    const mod = await freshModule()
    await expect(mod.loadClcTree()).resolves.toEqual([])
  })
})

describe('loadClcOverlay / loadClcAuxiliary', () => {
  beforeEach(() => vi.restoreAllMocks())
  afterEach(() => vi.unstubAllGlobals())

  it('overlay 404 → 空表（查不到不造名）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    const mod = await freshModule()
    await expect(mod.loadClcOverlay()).resolves.toEqual({})
  })

  it('auxiliary 成功拉取并缓存', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ '-39': '信息化建设、新技术的应用' }) })
    vi.stubGlobal('fetch', fetchMock)
    const mod = await freshModule()
    const first = mod.loadClcAuxiliary()
    expect(mod.loadClcAuxiliary()).toBe(first)
    await expect(first).resolves.toEqual({ '-39': '信息化建设、新技术的应用' })
    expect(fetchMock).toHaveBeenCalledWith('classification/clc-auxiliary.json')
  })
})
