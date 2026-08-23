// AI Provider（src/ai/ai-provider.ts）单测：配置绑定 chat 门面 + SSE 解析纯函数（ai-features §1/§7）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { AiHttpError } from '@/ai/ai-client'
import { createAiProvider, parseSseEvents } from '@/ai/ai-provider'

/** 200 响应工厂：返回给定 JSON/文本 body。 */
function okResponse(body: unknown) {
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }))
}

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

const MESSAGES = [{ role: 'user' as const, content: '生成画像洞察' }]

describe('createAiProvider().chat', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('无 schema：走真实 ai-client 链路（URL/body 正确、无 Authorization）并返回 content 解析值', async () => {
    const fetchMock = okResponse({
      choices: [{ message: { content: JSON.stringify({ answer: 42 }) } }],
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createAiProvider({ baseUrl: 'https://api.example.com/', model: 'gpt-4o-mini' })

    const result = await provider.chat(MESSAGES)

    expect(result).toEqual({ answer: 42 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'gpt-4o-mini',
      messages: MESSAGES,
      stream: false,
      response_format: { type: 'json_object' },
    })
    expect(init.headers).not.toHaveProperty('Authorization')
  })

  it('有 apiKey → 携带 Authorization: Bearer <key>；temperature 绑定透传', async () => {
    const fetchMock = okResponse({ choices: [{ message: { content: '{"ok":true}' } }] })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createAiProvider({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      temperature: 0.2,
    })

    await provider.chat(MESSAGES)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' })
    expect(JSON.parse(init.body as string)).toMatchObject({ temperature: 0.2 })
  })

  it('schema 通过路径：content JSON 过 safeParse 返回解析后的值', async () => {
    const schema = z.object({ kind: z.enum(['fact', 'taste']), body: z.string() })
    const fetchMock = okResponse({
      choices: [{ message: { content: JSON.stringify({ kind: 'fact', body: '偏爱文学类' }) } }],
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createAiProvider({ baseUrl: 'https://api.example.com', model: 'm' })

    const result = await provider.chat(MESSAGES, { schema })

    expect(result).toEqual({ kind: 'fact', body: '偏爱文学类' })
  })

  it('schema 拒绝路径：content JSON 合法但结构不符 → 抛 ZodError', async () => {
    const schema = z.object({ kind: z.enum(['fact', 'taste']), body: z.string() })
    const fetchMock = okResponse({
      choices: [{ message: { content: JSON.stringify({ kind: 'other' }) } }],
    })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createAiProvider({ baseUrl: 'https://api.example.com', model: 'm' })

    await expect(provider.chat(MESSAGES, { schema })).rejects.toBeInstanceOf(z.ZodError)
  })

  it('stream:true → 抛明确错误（Phase 2 边界）且不发起请求', async () => {
    const fetchMock = okResponse({ choices: [{ message: { content: '{}' } }] })
    vi.stubGlobal('fetch', fetchMock)
    const provider = createAiProvider({ baseUrl: 'https://api.example.com', model: 'm' })

    await expect(provider.chat(MESSAGES, { stream: true })).rejects.toThrow(/Phase 2/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('HTTP 401 → AiHttpError 透传（带状态码）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 401, text: async () => '' })),
    )
    const provider = createAiProvider({ baseUrl: 'https://api.example.com', model: 'm' })

    const err: unknown = await provider.chat(MESSAGES).catch((e: unknown) => e)

    expect(err).toBeInstanceOf(AiHttpError)
    expect((err as AiHttpError).status).toBe(401)
  })

  it('外部 signal 中止 → AbortError 透传', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', hangingFetch())
    const provider = createAiProvider({ baseUrl: 'https://api.example.com', model: 'm' })

    const pending = provider.chat(MESSAGES, { signal: controller.signal })
    controller.abort()

    await expect(pending).rejects.toBeInstanceOf(DOMException)
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('parseSseEvents', () => {
  it('完整事件：单分片 data 行 + 空行分隔', () => {
    expect(parseSseEvents(['data: {"a":1}\n\n'])).toEqual(['{"a":1}'])
  })

  it('事件间空行分隔多个事件；事件内多行 data 以换行拼接', () => {
    const chunks = ['data: line1\ndata: line2\n\ndata: {"b":2}\n\n']
    expect(parseSseEvents(chunks)).toEqual(['line1\nline2', '{"b":2}'])
  })

  it('[DONE] 终止：后续分片/事件被忽略且不含在结果内', () => {
    const chunks = ['data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b":2}\n\n']
    expect(parseSseEvents(chunks)).toEqual(['{"a":1}'])
  })

  it('断行重组：单条 data 行跨多个分片拼接', () => {
    const chunks = ['data: {"a"', ':', '1}\n\nda', 'ta: {"b":2}\n', '\n']
    expect(parseSseEvents(chunks)).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('分片内部任意切分：多行 data 与事件间空行均可跨分片', () => {
    const chunks = ['data: h', 'ello\ndata: w', 'orld\n', '\n']
    expect(parseSseEvents(chunks)).toEqual(['hello\nworld'])
  })

  it('非 data 字段与注释忽略；data: 后前导空格剥离', () => {
    expect(parseSseEvents(['event: delta\n: comment\ndata: value\n\ndata:  spaced\n\n'])).toEqual([
      'value',
      ' spaced',
    ])
  })

  it('CRLF 行尾按同一规则解析', () => {
    expect(parseSseEvents(['data: {"a":1}\r\n\r\n'])).toEqual(['{"a":1}'])
  })

  it('末尾无换行的 data 行仍被收尾；[DONE] 无换行也终止', () => {
    expect(parseSseEvents(['data: {"a":1}\n\ndata: tail'])).toEqual(['{"a":1}', 'tail'])
    expect(parseSseEvents(['data: {"a":1}\n\ndata: [DONE]'])).toEqual(['{"a":1}'])
  })

  it('空流/无 data 事件 → 空数组', () => {
    expect(parseSseEvents([])).toEqual([])
    expect(parseSseEvents(['\n\n'])).toEqual([])
  })
})
