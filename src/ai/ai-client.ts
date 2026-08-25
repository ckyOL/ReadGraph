// 职责边界：URL/headers/body 构造、超时与中止、HTTP 状态分级、SSE 解析（一次性
// 兜底 extractLastSseData / 增量解析器 createSseParser / chatStream 流式产出）。
// 职责边界：URL/headers/body 构造、超时与中止、HTTP 状态分级、SSE 兜底解析。
// 不做 schema 校验 / Provider 抽象（C-2 波次2）。错误分级：网络失败/超时 → AbortError，
// HTTP 非 2xx → AiHttpError（401/429 显式文案），响应结构非法 → 解析错误；
// fetch TypeError（端点不可达 / CORS 拦截）→ AiNetworkError（区别于超时中止）。
/** `pnpm dev` 下 AI 请求走 Vite 同源代理（vite.config.ts aiDevProxyPlugin）消除 CORS；构建期由 define 静态注入，build/preview/test 为 false。 */
declare const __AI_DEV_PROXY__: boolean

/** dev 同源代理路径前缀（vite.config.ts aiDevProxyPlugin 中间件）。 */
export const AI_PROXY_PREFIX = '/__ai-proxy/'

/** 构造实际请求 URL：useProxy（dev）时将完整目标 URL 编码挂同源代理路径，否则直连。 */
export function buildRequestUrl(target: string, useProxy = __AI_DEV_PROXY__): string {
  return useProxy ? `${AI_PROXY_PREFIX}${encodeURIComponent(target)}` : target
}

/** 默认请求超时（ai-features §5.4：AbortController 15s 默认超时）。 */
export const DEFAULT_TIMEOUT_MS = 15_000
/**
 * 流式请求超时（ai-features §4.1）：TTFB 与「无字节空闲」双窗口 60s——收到响应
 * 字节即重置计时器；thinking 模型思考期间持续输出 reasoning_content 不断流，
 * 不误杀长思考。非流式 chat() 仍为总时长超时（一次性响应）。
 */
export const CHAT_TIMEOUT_MS = 60_000
/** HTTP 非 2xx 响应错误：携带状态码；401/429 附显式文案。 */
export class AiHttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'AiHttpError'
    this.status = status
  }
}

/** 网络层失败（fetch TypeError）：端点不可达或跨域（CORS）被浏览器拦截；与超时/中止（AbortError）区分。 */
export class AiNetworkError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AiNetworkError'
  }
}

/**
 * SSE 增量解析器（ai-features §4.1 流式）：逐 chunk 喂入，返回本 chunk 内完成的
 * 事件 data 值数组。`data:` 行可跨 chunk 断行——内部缓冲重组；**每行独立成事件**：
 * 空行/`event:`/`id:`/`retry:`/注释行/下一个 data 行均结束当前事件——兼容
 * 单换行分隔与非标准端点（OpenAI 兼容端点均为单行 data 事件，规范多行 data
 * 拼接语义不做支持）；裸 JSON 行（无 `data:` 前缀）容错为事件值（兼容整体
 * JSON 被分块传输的端点）；`data: [DONE]` 终止解析（此后输入忽略）。
 * `end()` 收尾无换行结尾的残余行（幂等）。纯函数无网络/时钟/DOM。
 */
export function createSseParser(): { next(chunk: string): string[]; end(): string[] } {
  let buffer = ''
  let current: string[] = []
  let done = false

  const flushEvent = (): string[] => {
    if (current.length === 0) return []
    const event = current.join('\n')
    current = []
    return [event]
  }

  const consumeLine = (line: string, events: string[]): void => {
    if (done) return
    // 空行（规范分隔）/字段行/注释：结束当前事件（字段行宽松视为分隔，兼容单换行端点）。
    if (
      line === '' ||
      line.startsWith('event:') ||
      line.startsWith('id:') ||
      line.startsWith('retry:') ||
      line.startsWith(':')
    ) {
      events.push(...flushEvent())
      return
    }
    let value: string
    if (line.startsWith('data:')) {
      value = line.slice('data:'.length)
      if (value.startsWith(' ')) value = value.slice(1)
    } else {
      // 容错：裸 JSON 行（无 data: 前缀）也作为事件值。
      value = line
    }
    if (value === '[DONE]') {
      events.push(...flushEvent())
      done = true
      return
    }
    // 行独立语义：data 行本身也结束上一事件（无空行分隔时逐事件产出）。
    events.push(...flushEvent())
    current.push(value)
  }

  const next = (chunk: string): string[] => {
    if (done) return []
    buffer += chunk
    const events: string[] = []
    let nl = buffer.indexOf('\n')
    while (nl !== -1 && !done) {
      let line = buffer.slice(0, nl)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      buffer = buffer.slice(nl + 1)
      consumeLine(line, events)
      nl = buffer.indexOf('\n')
    }
    return events
  }

  const end = (): string[] => {
    if (done) return []
    const events: string[] = []
    if (buffer.length > 0) {
      consumeLine(buffer, events)
      buffer = ''
    }
    // 残余行无空行终止：收尾 flush 未闭合事件（与「末尾无换行 data 行仍收尾」语义一致）。
    events.push(...flushEvent())
    return events
  }

  return { next, end }
}

/** 一次性 SSE 解析（兼容既有契约）：输入网络分片，返回全部事件 data 值（含末尾无换行行）。 */
export function parseSseEvents(chunks: Iterable<string>): string[] {
  const parser = createSseParser()
  const events: string[] = []
  for (const chunk of chunks) events.push(...parser.next(chunk))
  events.push(...parser.end())
  return events
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiChatOptions {
  baseUrl: string
  apiKey?: string
  model: string
  messages: AiChatMessage[]
  temperature?: number
  signal?: AbortSignal
}

export interface AiTestConnectionOptions {
  baseUrl: string
  apiKey?: string
  signal?: AbortSignal
}

/** HTTP 状态显式文案：401/429 给出可操作提示，其余走通用文案。 */
const HTTP_STATUS_MESSAGES: Record<number, string> = {
  401: '鉴权失败（401）：API Key 无效或缺失',
  429: '请求过于频繁（429）：请稍后重试',
}

/** 校验并规范化 baseUrl：去尾斜杠；空/空白直接抛错（连接测试除外由调用方先行校验）。 */
function normalizeBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  if (!trimmed) {
    throw new Error('AI 端点 baseUrl 不能为空')
  }
  return trimmed.replace(/\/+$/, '')
}

/**
 * 拼接 OpenAI 兼容端点路径：baseUrl 已含 `/v1` 后缀（如 placeholder `https://api.example.com/v1`）
 * 时不重复拼接，否则补上 `/v1`；保留 baseUrl 中网关前缀路径（如 `/proxy/v1`）。
 */
function endpointUrl(baseUrl: string, path: string): string {
  const base = normalizeBaseUrl(baseUrl)
  const versionSegment = /\/v1$/.test(base) ? '' : '/v1'
  return `${base}${versionSegment}/${path}`
}

/** Authorization 仅在 apiKey 非空时携带（本地无鉴权端点支持）。 */
function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

/**
 * fetch + 超时/中止封装：内部 AbortController 兜底 15s 超时，外部 signal 透传；
 * 超时或外部中止统一归一为 DOMException AbortError；fetch TypeError（端点不可达 /
 * CORS 拦截）归一为 AiNetworkError；其余网络错误透传原错误。
 */
/** fetch 异常归一：内部超时/外部 signal 中止 → AbortError；TypeError（端点不可达/CORS 拦截）→ AiNetworkError；其余透传。 */
function throwFetchError(e: unknown, signal: AbortSignal): never {
  if (signal.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  if (e instanceof TypeError) {
    // fetch 网络失败/跨域拦截统一抛 TypeError：给用户可操作诊断文案。
    throw new AiNetworkError(
      'AI 端点网络请求失败：端点不可达，或跨域（CORS）被浏览器拦截。' +
        '云端端点需支持 CORS；本地服务（如 Ollama）需放行来源；或改用自托管反向代理。',
    )
  }
  throw e
}

/**
 * fetch + 超时/中止封装：内部 AbortController 兜底 15s 超时，外部 signal 透传；
 * 超时或外部中止统一归一为 DOMException AbortError；fetch TypeError（端点不可达 /
 * CORS 拦截）归一为 AiNetworkError；其余网络错误透传原错误。
 */
async function request(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const controller = new AbortController()
  if (externalSignal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const onOuterAbort = (): void => controller.abort()
  externalSignal?.addEventListener('abort', onOuterAbort, { once: true })
  const timer: ReturnType<typeof setTimeout> = setTimeout(
    () => controller.abort(),
    timeoutMs,
  )
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (e) {
    return throwFetchError(e, controller.signal)
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', onOuterAbort)
  }
}

/** 解析 chat/completions 响应结构：缺 choices[0].message.content（或非字符串）抛解析错误。 */
function parseChatContent(payload: unknown): string {
  const obj = payload as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = obj?.choices?.[0]?.message?.content
  if (typeof content !== 'string') {
    throw new Error('AI 响应结构非法：缺少 choices[0].message.content')
  }
  return content
}

/** SSE 兜底：body 非 JSON 时提取最后一条 `data: {...}` JSON（跳过空行与 [DONE]）。 */
function extractLastSseData(body: string): unknown {
  let last: unknown
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue
    const data = line.slice('data:'.length).trim()
    if (!data || data === '[DONE]') continue
    try {
      last = JSON.parse(data)
    } catch {
      // 忽略无法解析的数据行，仅保留最后一条合法 JSON。
    }
  }
  if (last === undefined) {
    throw new Error('AI 响应既非 JSON 也无有效 SSE data 行')
  }
  return last
}

/** 解析 /v1/models 响应中的模型 ID 列表：兼容 OpenAI 标准 `{data:[{id}]}` 与顶层 `[{id}]`；缺结构返回空数组（连接成功但端点未提供列表）。 */
export function parseModelList(payload: unknown): string[] {
  let list: unknown = null
  if (Array.isArray(payload)) {
    list = payload
  } else if (payload && typeof payload === 'object' && 'data' in payload) {
    const data = payload.data
    if (Array.isArray(data)) list = data
  }
  if (!Array.isArray(list)) return []
  const ids = new Set<string>()
  for (const item of list) {
    const id = item && typeof item === 'object' && 'id' in item ? item.id : undefined
    if (typeof id === 'string' && id.trim()) ids.add(id.trim())
  }
  return [...ids]
}

/**
 * chat/completions 调用（ai-features §3.1 ⑤：stream:false + response_format JSON 模式）。
 * 返回 choices[0].message.content（string）；结构非法抛解析错误。
 */
export async function chat(opts: AiChatOptions): Promise<string> {
  const base = normalizeBaseUrl(opts.baseUrl)
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: false,
    response_format: { type: 'json_object' },
  }
  if (opts.temperature !== undefined) {
    body.temperature = opts.temperature
  }
  const res = await request(
    buildRequestUrl(endpointUrl(base, 'chat/completions')),
    {
      method: 'POST',
      headers: buildHeaders(opts.apiKey),
      body: JSON.stringify(body),
    },
    CHAT_TIMEOUT_MS,
    opts.signal,
  )
  if (!res.ok) {
    throw new AiHttpError(
      res.status,
      HTTP_STATUS_MESSAGES[res.status] ?? `AI 端点请求失败（HTTP ${res.status}）`,
    )
  }
  const text = await res.text()
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    payload = extractLastSseData(text)
  }
  return parseChatContent(payload)
}

/** chatStream 流式增量：thinking 模型思考过程（reasoning_content）与最终内容分通道产出。 */
export interface ChatStreamDelta {
  kind: 'reasoning' | 'content'
  text: string
}

/**
 * SSE 事件 → 流式增量：解析 choices[0].delta.content（kind='content'）与
 * reasoning_content（kind='reasoning'，thinking 模型思考过程）；容错
 * message.content/message.reasoning_content（整体 JSON 被分块传输的端点）；
 * role 等无字段分块跳过；结构非法抛解析错误。
 */
function* sseEventsToDeltas(events: string[]): Generator<ChatStreamDelta> {
  for (const event of events) {
    let payload: unknown
    try {
      payload = JSON.parse(event)
    } catch {
      throw new Error('AI 响应结构非法：SSE data 行非 JSON')
    }
    const obj = payload as {
      choices?: Array<{
        delta?: { content?: unknown; reasoning_content?: unknown }
        message?: { content?: unknown; reasoning_content?: unknown }
      }>
    }
    const delta = obj?.choices?.[0]?.delta
    const message = obj?.choices?.[0]?.message
    const content = delta?.content ?? message?.content
    if (content !== undefined && content !== null) {
      if (typeof content !== 'string') {
        throw new Error('AI 响应结构非法：content 非字符串')
      }
      yield { kind: 'content', text: content }
      continue
    }
    const reasoning = delta?.reasoning_content ?? message?.reasoning_content
    if (reasoning !== undefined && reasoning !== null) {
      if (typeof reasoning !== 'string') {
        throw new Error('AI 响应结构非法：reasoning_content 非字符串')
      }
      yield { kind: 'reasoning', text: reasoning }
    }
  }
}

/**
 * chat/completions 流式调用（ai-features §4.1）：`stream:true` 增量产出
 * ChatStreamDelta——content（**markdown 文本流**，拼接即完整响应文本）与
 * reasoning_content（thinking 模型思考过程）分通道；不携带 `response_format`
 * （纯文本输出无需 JSON 模式）。超时 = TTFB/空闲双窗口 60s（收到字节即重置，
 * 长思考不断流不误杀）；内部 AbortController 中止、外部 signal 透传，错误归一
 * 与 `chat` 一致（AbortError/AiHttpError/AiNetworkError）。
 */
export async function* chatStream(opts: AiChatOptions): AsyncIterable<ChatStreamDelta> {
  const base = normalizeBaseUrl(opts.baseUrl)
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: opts.messages,
    stream: true,
  }
  if (opts.temperature !== undefined) {
    body.temperature = opts.temperature
  }
  const controller = new AbortController()
  if (opts.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
  const onOuterAbort = (): void => controller.abort()
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true })
  // TTFB 窗口：请求发出起 60s 无响应字节即中止；收到字节后转空闲窗口（每次重置）。
  let timer: ReturnType<typeof setTimeout> = setTimeout(
    () => controller.abort(),
    CHAT_TIMEOUT_MS,
  )
  const resetIdleTimer = (): void => {
    clearTimeout(timer)
    timer = setTimeout(() => controller.abort(), CHAT_TIMEOUT_MS)
  }
  let res: Response
  try {
    res = await fetch(buildRequestUrl(endpointUrl(base, 'chat/completions')), {
      method: 'POST',
      headers: buildHeaders(opts.apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (e) {
    throwFetchError(e, controller.signal)
  }
  try {
    if (!res.ok) {
      throw new AiHttpError(
        res.status,
        HTTP_STATUS_MESSAGES[res.status] ?? `AI 端点请求失败（HTTP ${res.status}）`,
      )
    }
    if (!res.body) {
      throw new Error('AI 响应结构非法：流式响应无 body')
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    const parser = createSseParser()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        resetIdleTimer()
        yield* sseEventsToDeltas(parser.next(decoder.decode(value, { stream: true })))
      }
      // 收尾：decoder 残余多字节 + parser 残余无换行 data 行（端点未发 [DONE] 直接关流）。
      const tailText = decoder.decode()
      if (tailText.length > 0) yield* sseEventsToDeltas(parser.next(tailText))
      yield* sseEventsToDeltas(parser.end())
    } finally {
      reader.releaseLock()
    }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}

/** 连接测试（ai-features §4.2）：GET {base}/v1/models；2xx → 返回模型 ID 列表（端点未提供时为空数组），否则抛带状态错误。 */

/** 连接测试（ai-features §4.2）：GET {base}/v1/models；2xx → 返回模型 ID 列表（端点未提供时为空数组），否则抛带状态错误。 */
export async function testConnection(opts: AiTestConnectionOptions): Promise<string[]> {
  const base = normalizeBaseUrl(opts.baseUrl)
  const res = await request(
    buildRequestUrl(endpointUrl(base, 'models')),
    {
      method: 'GET',
      headers: buildHeaders(opts.apiKey),
    },
    DEFAULT_TIMEOUT_MS,
    opts.signal,
  )
  if (!res.ok) {
    throw new AiHttpError(
      res.status,
      HTTP_STATUS_MESSAGES[res.status] ?? `AI 端点连接失败（HTTP ${res.status}）`,
    )
  }
  let payload: unknown
  try {
    payload = JSON.parse(await res.text())
  } catch {
    return []
  }
  return parseModelList(payload)
}
