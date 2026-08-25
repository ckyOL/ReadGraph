// AI Provider（src/ai/ai-provider.ts）单测：配置绑定 chat 门面 + SSE 解析纯函数（ai-features §1/§7）。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { AiHttpError } from '@/ai/ai-client'
import { createAiProvider, parseSseEvents } from '@/ai/ai-provider'
import type { ChatStreamDelta } from '@/ai/ai-client'

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

  it('stream:true → 走 chatStream 链路：流式增量拼接后 JSON.parse + schema 校验', async () => {
    const schema = z.object({ kind: z.enum(['fact', 'taste']), body: z.string() })
    const content = JSON.stringify({ kind: 'fact', body: '偏爱文学类' })
    const encoder = new TextEncoder()
    const parts = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(0, 8) } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(8) } }] })}\n\n`,
      'data: [DONE]\n\n',
    ]
    const fetchMock = vi.fn(
      async () =>
        ({
          ok: true,
          status: 200,
          body: new ReadableStream<Uint8Array>({
            start(controller) {
              for (const part of parts) controller.enqueue(encoder.encode(part))
              controller.close()
            },
          }),
        }) as Response,
    )
    vi.stubGlobal('fetch', fetchMock)
    const provider = createAiProvider({ baseUrl: 'https://api.example.com', model: 'm' })

    const result = await provider.chat(MESSAGES, { stream: true, schema })

    expect(result).toEqual({ kind: 'fact', body: '偏爱文学类' })
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({ stream: true })
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

  it('行独立事件：连续 data 行（单换行分隔）各自产出', () => {
    const chunks = ['data: line1\ndata: line2\n\ndata: {"b":2}\n\n']
    expect(parseSseEvents(chunks)).toEqual(['line1', 'line2', '{"b":2}'])
  })

  it('[DONE] 终止：后续分片/事件被忽略且不含在结果内', () => {
    const chunks = ['data: {"a":1}\n\ndata: [DONE]\n\ndata: {"b":2}\n\n']
    expect(parseSseEvents(chunks)).toEqual(['{"a":1}'])
  })

  it('断行重组：单条 data 行跨多个分片拼接', () => {
    const chunks = ['data: {"a"', ':', '1}\n\nda', 'ta: {"b":2}\n', '\n']
    expect(parseSseEvents(chunks)).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('分片内部任意切分：data 行跨分片重组为行独立事件', () => {
    const chunks = ['data: h', 'ello\ndata: w', 'orld\n', '\n']
    expect(parseSseEvents(chunks)).toEqual(['hello', 'world'])
  })

  it('非 data 字段与注释忽略；data: 后前导空格剥离', () => {
    expect(parseSseEvents(['event: delta\n: comment\ndata: value\n\ndata:  spaced\n\n'])).toEqual([
      'value',
      ' spaced',
    ])
  })
  it('单换行分隔（无空行）→ 每行 data 独立产出（非标准端点容错）', () => {
    expect(parseSseEvents(['data: {"a":1}\ndata: {"b":2}\n'])).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('裸 JSON 行（无 data: 前缀）容错为事件值（整体 JSON 分块传输端点）', () => {
    expect(parseSseEvents(['{"a":1}\n{"b":2}\n'])).toEqual(['{"a":1}', '{"b":2}'])
  })


  it('CRLF 行尾按同一规则解析', () => {
    expect(parseSseEvents(['data: {"a":1}\r\n\r\n'])).toEqual(['{"a":1}'])
  })

  it('末尾无换行的 data 行仍被收尾；[DONE] 无换行也终止', () => {
    expect(parseSseEvents(['data: {"a":1}\n\ndata: tail'])).toEqual(['{"a":1}', 'tail'])
    expect(parseSseEvents(['data: {"a":1}\n\ndata: [DONE]'])).toEqual(['{"a":1}'])
  })

})
describe('createAiProvider().chatStream', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** SSE 分片响应工厂：每段一个 delta.content 事件。 */
  function streamResponse(contents: string[]): { ok: true; status: 200; body: ReadableStream<Uint8Array> } {
    const encoder = new TextEncoder()
    const parts: Uint8Array[] = []
    for (const content of contents) {
      parts.push(
        encoder.encode(
          `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
        ),
      )
    }
    parts.push(encoder.encode('data: [DONE]\n\n'))
    return {
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const part of parts) controller.enqueue(part)
          controller.close()
        },
      }),
    }
  }

  it('绑定配置：流拼接产出 == 非流式 content（temperature 透传、Authorization 携带）', async () => {
    const content = '{"insights":[{"kind":"fact","body":"a"}]}'
    const fetchMock = vi.fn(async () => streamResponse([content.slice(0, 10), content.slice(10)]))
    vi.stubGlobal('fetch', fetchMock)
    const provider = createAiProvider({
      baseUrl: 'https://api.example.com',
      apiKey: 'sk-test',
      model: 'gpt-4o-mini',
      temperature: 0.2,
    })

    const chunks: ChatStreamDelta[] = []
    for await (const chunk of provider.chatStream(MESSAGES)) chunks.push(chunk)
    expect(chunks.map((c) => c.text).join('')).toBe(content)

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'gpt-4o-mini',
      stream: true,
      temperature: 0.2,
    })
    expect(init.headers).toMatchObject({ Authorization: 'Bearer sk-test' })
  })

  it('外部 signal 中止 → 抛 AbortError（透传 ai-client 链路）', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', hangingFetch())
    const provider = createAiProvider({ baseUrl: 'https://api.example.com', model: 'm' })

    const iter = provider.chatStream(MESSAGES, { signal: controller.signal })[Symbol.asyncIterator]()
    const pending = iter.next()
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await assertion
  })
})
