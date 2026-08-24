// AI 客户端（src/ai/ai-client.ts）单测：OpenAI 兼容端点 fetch 薄封装（ai-features §5.4 / §7）。
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AiHttpError, AiNetworkError, buildRequestUrl, chat, testConnection } from '@/ai/ai-client'

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
describe('buildRequestUrl', () => {
  it('useProxy=true（dev）→ 完整目标 URL 编码后挂 /__ai-proxy/ 前缀', () => {
    expect(buildRequestUrl('https://api.example.com/v1/chat/completions', true)).toBe(
      '/__ai-proxy/https%3A%2F%2Fapi.example.com%2Fv1%2Fchat%2Fcompletions',
    )
  })

  it('useProxy=false（build/preview/test）→ 直连原 URL', () => {
    expect(buildRequestUrl('https://api.example.com/v1/chat/completions', false)).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })
})

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

  it.each(['https://api.example.com/v1', 'https://api.example.com/v1/'])(
    'baseUrl 已含 /v1 后缀（%s）→ 不重复拼接 /v1',
    async (baseUrl) => {
      const fetchMock = okResponse({ choices: [{ message: { content: 'ok' } }] })
      vi.stubGlobal('fetch', fetchMock)
      await chat({ ...BASE_OPTS, baseUrl })
      const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
      expect(url).toBe('https://api.example.com/v1/chat/completions')
    },
  )

  it('baseUrl 含网关前缀 /proxy/v1 → 保留前缀且不重复拼接 /v1', async () => {
    const fetchMock = okResponse({ choices: [{ message: { content: 'ok' } }] })
    vi.stubGlobal('fetch', fetchMock)
    await chat({ ...BASE_OPTS, baseUrl: 'https://gateway.example.com/proxy/v1' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gateway.example.com/proxy/v1/chat/completions')
  })

  it('fetch TypeError（端点不可达/CORS 拦截）→ 抛 AiNetworkError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(chat({ ...BASE_OPTS })).rejects.toBeInstanceOf(AiNetworkError)
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

  it('chat 挂起超过 60s（生成超时阈值）→ 抛 AbortError', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const p = chat({ ...BASE_OPTS })
    // 先挂断言再推进时钟：避免计时器触发拒绝时尚未挂 handler 的 unhandled rejection。
    const instanceCheck = expect(p).rejects.toBeInstanceOf(DOMException)
    const nameCheck = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(60_000)
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
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
    expect(ctrl.signal.aborted).toBe(false)
  })
})

describe('testConnection', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('GET {base}/v1/models，2xx → 返回模型 ID 列表；有 key 携带 Bearer 头', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '[]' }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(
      testConnection({ baseUrl: 'http://127.0.0.1:11434/', apiKey: 'k' }),
    ).resolves.toEqual([])
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://127.0.0.1:11434/v1/models')
    expect(init.method).toBe('GET')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer k' })
  })

  it('baseUrl 已含 /v1 后缀 → GET {base}/v1/models 不重复拼接', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => '[]' }))
    vi.stubGlobal('fetch', fetchMock)
    await testConnection({ baseUrl: 'https://api.example.com/v1' })
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/models')
  })

  it('fetch TypeError（CORS/不可达）→ 抛 AiNetworkError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )
    await expect(
      testConnection({ baseUrl: 'https://api.example.com' }),
    ).rejects.toBeInstanceOf(AiNetworkError)
  })
  it('连接测试保持 15s 超时（快速失败，区别于 chat 60s）', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', hangingFetch())
    const p = testConnection({ baseUrl: 'https://api.example.com' })
    const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(15_000)
    await assertion
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
  it('2xx 且响应含 data[].id → 返回去重后的模型 ID 列表', async () => {
    const body = JSON.stringify({
      object: 'list',
      data: [
        { id: 'gpt-4o-mini', object: 'model' },
        { id: 'gpt-4o', object: 'model' },
        { id: 'gpt-4o-mini', object: 'model' },
      ],
    })
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => body })))
    await expect(testConnection({ baseUrl: 'https://api.example.com' })).resolves.toEqual([
      'gpt-4o-mini',
      'gpt-4o',
    ])
  })

  it('2xx 且响应为顶层模型数组 → 同样解析', async () => {
    const body = JSON.stringify([{ id: 'llama3.2' }, { id: 'qwen2.5' }])
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, text: async () => body })))
    await expect(testConnection({ baseUrl: 'http://127.0.0.1:11434' })).resolves.toEqual([
      'llama3.2',
      'qwen2.5',
    ])
  })

  it('2xx 但响应非 JSON / 无模型结构 → 返回空数组（连接成功但端点未提供列表）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => '<html>gateway</html>' })),
    )
    await expect(testConnection({ baseUrl: 'https://api.example.com' })).resolves.toEqual([])

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, text: async () => '{"hello":"world"}' })),
    )
    await expect(testConnection({ baseUrl: 'https://api.example.com' })).resolves.toEqual([])
  })
})
