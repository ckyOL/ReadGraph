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
    expect(fetchMock).toHaveBeenCalledWith('/classification/clc-tree.json')
  })

  it('URL 以 BASE_URL 开头（绝对路径），嵌套路由下不 404（H3 回归）', async () => {
    // 相对路径 fetch 在 /library/$bookId 下解析为 /library/classification/… → 404；
    // BASE_URL 前缀保证任何路由深度都解析到站点根。模拟嵌套路由场景：
    // URL 解析结果应不受当前页面路径影响。
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => [{ id: 'J', desc: '艺术' }] })
    vi.stubGlobal('fetch', fetchMock)
    const mod = await freshModule()
    await mod.loadClcTree()
    const url = String(fetchMock.mock.calls[0]![0])
    expect(url).toMatch(/^\/classification\/clc-tree\.json$/)
    // 相对字符串（无前导 /）会被嵌套路由解析到子目录——不允许。
    expect(url.startsWith('classification/')).toBe(false)
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
    expect(fetchMock).toHaveBeenCalledWith('/classification/clc-auxiliary.json')
  })
})
