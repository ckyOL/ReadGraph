// AI 客户端（src/ai/ai-client.ts）单测：OpenAI 兼容端点 fetch 薄封装（ai-features §5.4 / §7）。
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiHttpError, chat, testConnection } from '@/ai/ai-client'

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

/** 200 响应工厂：返回给定 JSON/文本 body。 */
function okResponse(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }))
}

const MESSAGES = [{ role: 'user' as const, content: '你好' }]
const BASE_OPTS = { baseUrl: 'https://api.example.com', model: 'gpt-4o-mini', messages: MESSAGES }

describe('chat', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('baseUrl 去尾斜杠，POST {base}/v1/chat/completions，body 含 model/messages/stream:false/response_format', async () => {
    const fetchMock = okResponse({ choices: [{ message: { content: 'ok' } }] })
    vi.stubGlobal('fetch', fetchMock)
    await chat({ ...BASE_OPTS, baseUrl: 'https://api.example.com/' })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'gpt-4o-mini',
      messages: MESSAGES,
      stream: false,
      response_format: { type: 'json_object' },
    })
  })

  it('temperature 透传；缺省时不发送 temperature 字段', async () => {
    const fetchMock = okResponse({ choices: [{ message: { content: 'ok' } }] })
    vi.stubGlobal('fetch', fetchMock)
    await chat({ ...BASE_OPTS, temperature: 0.3 })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ temperature: 0.3 })

    const fetchMock2 = okResponse({ choices: [{ message: { content: 'ok' } }] })
    vi.stubGlobal('fetch', fetchMock2)
    await chat({ ...BASE_OPTS })
    const [, init2] = fetchMock2.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init2.body as string)).not.toHaveProperty('temperature')
  })

  it('无 apiKey → 请求不含 Authorization 头', async () => {
    const fetchMock = okResponse({ choices: [{ message: { content: 'ok' } }] })
    vi.stubGlobal('fetch', fetchMock)
    await chat({ ...BASE_OPTS })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('有 apiKey → 携带 Authorization: Bearer <key>', async () => {
    const fetchMock = okResponse({ choices: [{ message: { content: 'ok' } }] })
    vi.stubGlobal('fetch', fetchMock)
    await chat({ ...BASE_OPTS, apiKey: 'sk-test' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' })
  })

  it.each(['', '   ', '\t'])('空/空白 baseUrl → 直接抛错且不发起请求', async (baseUrl) => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(chat({ baseUrl, model: 'm', messages: MESSAGES })).rejects.toThrow(/baseUrl/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('正常 JSON 完成响应 → 返回 choices[0].message.content', async () => {
    vi.stubGlobal('fetch', okResponse({ choices: [{ message: { content: '洞察内容' } }] }))
    await expect(chat({ ...BASE_OPTS })).resolves.toBe('洞察内容')
  })

  it('结构非法（缺 choices / content 非字符串）→ 抛解析错误', async () => {
    vi.stubGlobal('fetch', okResponse({ foo: 'bar' }))
    await expect(chat({ ...BASE_OPTS })).rejects.toThrow(/AI 响应结构非法/)

    vi.stubGlobal('fetch', okResponse({ choices: [{ message: { content: 42 } }] }))
    await expect(chat({ ...BASE_OPTS })).rejects.toThrow(/AI 响应结构非法/)
  })

  it('body 非 JSON 但含 SSE data: 行 → 提取最后一条 data JSON 的 content（跳过 [DONE]）', async () => {
    const body =
      'data: {"choices":[{"message":{"content":"旧"}}]}\n\ndata: {"choices":[{"message":{"content":"新"}}]}\n\ndata: [DONE]\n'
    vi.stubGlobal('fetch', okResponse(body))
    await expect(chat({ ...BASE_OPTS })).resolves.toBe('新')
  })

  it('body 非 JSON 且无有效 data: 行 → 抛解析错误', async () => {
    vi.stubGlobal('fetch', okResponse('<html>Bad Gateway</html>'))
    await expect(chat({ ...BASE_OPTS })).rejects.toThrow(/AI 响应/)
  })

  it('HTTP 401 → AiHttpError status=401 且文案明确', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })))
    await expect(chat({ ...BASE_OPTS })).rejects.toMatchObject({
      name: 'AiHttpError',
      status: 401,
      message: expect.stringMatching(/401|鉴权/),
    })
  })

  it('HTTP 429 → AiHttpError status=429 且文案明确', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429 })))
    await expect(chat({ ...BASE_OPTS })).rejects.toMatchObject({
      name: 'AiHttpError',
      status: 429,
      message: expect.stringMatching(/429|频繁/),
    })
  })

  it('fetch 挂起超过默认 15s → 抛 AbortError', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const p = chat({ ...BASE_OPTS })
    // 先挂断言再推进时钟：避免计时器触发拒绝时尚未挂 handler 的 unhandled rejection。
    const instanceCheck = expect(p).rejects.toBeInstanceOf(DOMException)
    const nameCheck = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(15_000)
    await instanceCheck
    await nameCheck
  })

  it('外部 signal 中止 → 抛 AbortError；超时后外部 signal 未被中止', async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    vi.stubGlobal('fetch', hangingFetch())
    const p = chat({ ...BASE_OPTS, signal: ctrl.signal })
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    ctrl.abort()
    await vi.advanceTimersByTimeAsync(0)
    await assertion
  })

  it('超时后不再触发外部 signal（清理监听）', async () => {
    vi.useFakeTimers()
    const ctrl = new AbortController()
    vi.stubGlobal('fetch', hangingFetch())
    const p = chat({ ...BASE_OPTS, signal: ctrl.signal })
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
    expect(ctrl.signal.aborted).toBe(false)
  })
})

describe('testConnection', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('GET {base}/v1/models，2xx → resolve；有 key 携带 Bearer 头', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '[]' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      testConnection({ baseUrl: 'http://127.0.0.1:11434/', apiKey: 'k' }),
    ).resolves.toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:11434/v1/models')
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k' })
  })

  it('无 key → 请求不含 Authorization 头（本地无鉴权端点）', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '[]' }))
    vi.stubGlobal('fetch', fetchMock)
    await testConnection({ baseUrl: 'https://api.example.com' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('非 2xx → AiHttpError 带状态', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })))
    await expect(testConnection({ baseUrl: 'https://api.example.com' })).rejects.toMatchObject({
      name: 'AiHttpError',
      status: 500,
    })
    await expect(
      testConnection({ baseUrl: 'https://api.example.com' }),
    ).rejects.toBeInstanceOf(AiHttpError)
  })
})
