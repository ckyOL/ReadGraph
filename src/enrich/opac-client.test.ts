// 传输基元 fetchWithTimeout 测试（opac-enrichment §2.3：超时/中止、CORS TypeError 捕获）。
import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchWithTimeout, OpacFetchError } from '@/enrich/opac-client'

/** mock fetch：挂起直到 signal abort（与真实 fetch 行为一致）。 */
function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true },
        )
      }),
  )
}

describe('fetchWithTimeout', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('成功返回响应文本', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ text: async () => 'payload' })))
    await expect(fetchWithTimeout('https://example.test/api', { timeoutMs: 1000 })).resolves.toBe(
      'payload',
    )
  })

  it('超时 → OpacFetchError reason=timeout', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const p = fetchWithTimeout('https://example.test/api', { timeoutMs: 500 })
    // 先挂断言再推进时钟：避免计时器触发拒绝时尚未挂 handler 的 unhandled rejection。
    const instanceCheck = expect(p).rejects.toBeInstanceOf(OpacFetchError)
    const reasonCheck = expect(p).rejects.toMatchObject({ reason: 'timeout' })
    await vi.advanceTimersByTimeAsync(500)
    await instanceCheck
    await reasonCheck
  })

  it('CORS TypeError（无 ACAO 头被浏览器拦截）→ reason=cors', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(fetchWithTimeout('https://example.test/api', { timeoutMs: 1000 })).rejects.toMatchObject({
      reason: 'cors',
    })
  })

  it('外部 signal 中止 → reason=aborted', async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    vi.stubGlobal('fetch', hangingFetch())
    const p = fetchWithTimeout('https://example.test/api', { timeoutMs: 5000, signal: ctrl.signal })
    const assertion = expect(p).rejects.toMatchObject({ reason: 'aborted' })
    ctrl.abort()
    await vi.advanceTimersByTimeAsync(0)
    await assertion
  })

  it('其它网络错误 → reason=network', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('boom'))))
    await expect(fetchWithTimeout('https://example.test/api', { timeoutMs: 1000 })).rejects.toMatchObject({
      reason: 'network',
    })
  })

  it('超时后不再触发外部 signal 处理器（清理监听）', async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    vi.stubGlobal('fetch', hangingFetch())
    const p = fetchWithTimeout('https://example.test/api', { timeoutMs: 100, signal: ctrl.signal })
    const assertion = expect(p).rejects.toMatchObject({ reason: 'timeout' })
    await vi.advanceTimersByTimeAsync(100)
    await assertion
    expect(ctrl.signal.aborted).toBe(false)
  })
})
