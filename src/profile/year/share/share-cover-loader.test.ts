// 封面渐进加载纯编排测试（reading-profile §4.1「封面加载时序」）。
// node 环境无 Image：vi.stubGlobal 注入记录型 MockImage 构造器，onload/onerror
// 手动触发；超时用 vi.useFakeTimers 推进（cheap stand-ins 模式，同 locale.test.ts）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SHARE_COVER_TIMEOUT_MS, loadShareCovers } from './share-cover-loader'
import type { YearBookIndexEntry } from '@/profile/year/year-book-index'

/** 记录型 Image stub：记录 crossOrigin 与 src 赋值历史，onload/onerror 手动触发。 */
class MockImage {
  static instances: MockImage[] = []
  crossOrigin = ''
  /** src 赋值历史（含全部写入；断言中断置空与不重试） */
  srcLog: string[] = []
  #src = ''
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    MockImage.instances.push(this)
  }
  get src(): string {
    return this.#src
  }
  set src(v: string) {
    this.srcLog.push(v)
    this.#src = v
  }
}

const covers = (urls: Record<string, string | null>): Record<string, YearBookIndexEntry> =>
  Object.fromEntries(
    Object.entries(urls).map(([id, coverUrl]) => [
      id,
      { title: `书${id}`, authors: ['作者'], coverUrl },
    ]),
  )

beforeEach(() => {
  vi.stubGlobal('Image', MockImage)
  MockImage.instances = []
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('loadShareCovers（封面渐进加载）', () => {
  it('成功回调逐张触发：bookId 与实例对应，顺序 = topBookIds 顺序', async () => {
    const onEach = vi.fn()
    const promise = loadShareCovers(
      covers({ b1: 'https://cdn.example/1.jpg', b2: 'https://cdn.example/2.jpg' }),
      ['b1', 'b2'],
      { onEach },
    )
    expect(onEach).not.toHaveBeenCalled()

    MockImage.instances[0]!.onload!()
    MockImage.instances[1]!.onload!()
    await promise
    expect(onEach).toHaveBeenCalledTimes(2)
    expect(onEach.mock.calls[0]).toEqual(['b1', MockImage.instances[0]])
    expect(onEach.mock.calls[1]).toEqual(['b2', MockImage.instances[1]])
  })

  it('crossOrigin 属性 = anonymous（每实例断言）', async () => {
    const promise = loadShareCovers(covers({ b1: 'https://cdn.example/1.jpg' }), ['b1'], {
      onEach: () => undefined,
    })
    MockImage.instances[0]!.onload!()
    await promise
    expect(MockImage.instances).toHaveLength(1)
    expect(MockImage.instances[0]!.crossOrigin).toBe('anonymous')
  })

  it('CORS 失败（error 事件）→ 跳过不重试，整体仍 resolve', async () => {
    const onEach = vi.fn()
    const promise = loadShareCovers(
      covers({ b1: 'https://cdn.example/1.jpg', b2: 'https://cdn.example/2.jpg' }),
      ['b1', 'b2'],
      { onEach },
    )
    MockImage.instances[0]!.onerror!()
    MockImage.instances[1]!.onload!()
    await expect(promise).resolves.toBeUndefined()
    expect(onEach).toHaveBeenCalledTimes(1)
    expect(onEach).toHaveBeenCalledWith('b2', MockImage.instances[1])
    // 不重试：src 赋值仅初始 url 一次 + 中断置空一次
    expect(MockImage.instances[0]!.srcLog).toEqual(['https://cdn.example/1.jpg', ''])
  })

  it('全部失败 → resolve 不抛错，onEach 不触发', async () => {
    const onEach = vi.fn()
    const promise = loadShareCovers(
      covers({ b1: 'https://cdn.example/1.jpg', b2: 'https://cdn.example/2.jpg' }),
      ['b1', 'b2'],
      { onEach },
    )
    MockImage.instances[0]!.onerror!()
    MockImage.instances[1]!.onerror!()
    await expect(promise).resolves.toBeUndefined()
    expect(onEach).not.toHaveBeenCalled()
  })

  it('超时（默认 3s）→ src 置空中断，onEach 不触发，整体 resolve', async () => {
    vi.useFakeTimers()
    const onEach = vi.fn()
    const promise = loadShareCovers(covers({ b1: 'https://cdn.example/1.jpg' }), ['b1'], {
      onEach,
    })
    vi.advanceTimersByTime(SHARE_COVER_TIMEOUT_MS)
    await expect(promise).resolves.toBeUndefined()
    expect(onEach).not.toHaveBeenCalled()
    expect(MockImage.instances[0]!.srcLog).toEqual(['https://cdn.example/1.jpg', ''])
  })

  it('无 coverUrl / entry 缺失 → 不发起加载（零实例），立即 resolve', async () => {
    const onEach = vi.fn()
    await loadShareCovers(
      covers({ b1: null, b2: undefined as unknown as string }),
      ['b1', 'b2', 'b3'],
      { onEach },
    )
    expect(MockImage.instances).toHaveLength(0)
    expect(onEach).not.toHaveBeenCalled()
  })

  it('covers 整体 undefined → resolve 且零实例', async () => {
    const onEach = vi.fn()
    await loadShareCovers(undefined, ['b1'], { onEach })
    expect(MockImage.instances).toHaveLength(0)
    expect(onEach).not.toHaveBeenCalled()
  })
})
