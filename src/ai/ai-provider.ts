// AI Provider 抽象（ai-features §1 代码落点 / §7）：绑定配置的 chat 门面 + SSE 解析纯函数。
// 职责边界：绑定 baseUrl/apiKey/model/temperature 复用 ai-client.chat（15s 超时/Abort/HTTP
// 分级透传），对响应 content 做 JSON.parse 与可选 Zod 校验（失败抛 ZodError）；
// parseSseEvents 为 Phase 2 流式预留（本轮实现+测试，纯函数无网络/时钟/DOM）。
// 不做 prompt 装配 / 缓存 / UI 编排（相应模块职责）。

import type { AiChatMessage } from '@/ai/ai-client'
import { chat as clientChat } from '@/ai/ai-client'
import type { z } from 'zod'

export interface AiProviderConfig {
  baseUrl: string
  apiKey?: string
  model: string
  temperature?: number
}

export interface AiChatOptions {
  /** 响应 JSON 的 Zod schema；存在时 safeParse 失败抛 ZodError，缺省返回解析值。 */
  schema?: z.ZodType
  /** Phase 1 仅非流式（缺省 false）；true 抛明确错误（流式属 Phase 2）。 */
  stream?: boolean
  signal?: AbortSignal
}

export interface AiProvider {
  chat(messages: AiChatMessage[], opts?: AiChatOptions): Promise<unknown>
}

/**
 * 绑定配置的 AI Provider：chat 复用 ai-client 的 OpenAI 兼容请求链路
 * （15s 超时/外部 signal 中止/HTTP 错误分级），内容 JSON.parse 后可选过 Zod schema。
 */
export function createAiProvider(config: AiProviderConfig): AiProvider {
  return {
    async chat(messages, opts = {}) {
      if (opts.stream) {
        throw new Error('流式输出（stream:true）属 Phase 2，当前版本仅支持非流式（stream:false）')
      }
      const content = await clientChat({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        messages,
        temperature: config.temperature,
        signal: opts.signal,
      })
      const parsed: unknown = JSON.parse(content)
      if (opts.schema) {
        const result = opts.schema.safeParse(parsed)
        if (!result.success) {
          throw result.error
        }
        return result.data
      }
      return parsed
    },
  }
}

/**
 * 解析 SSE 事件流（Phase 2 流式预留，纯函数）。输入为网络分片（与 mock fetch 分片响应
 * 同构），data 行可跨分片断行——先重组完整行再按 SSE 规范解析：
 * `data:` 前缀取值（`data:` 后至多一个前导空格剥离，未知字段/注释忽略），空行结束一个
 * 事件，`data: [DONE]` 终止解析（不含在结果内），事件内多行 data 以换行（\n）拼接。
 * 返回每个事件的 data 值数组。
 */
export function parseSseEvents(chunks: Iterable<string>): string[] {
  const events: string[] = []
  let buffer = ''
  let current: string[] = []
  let done = false

  const flushEvent = (): void => {
    if (current.length > 0) {
      events.push(current.join('\n'))
      current = []
    }
  }

  const consumeLine = (line: string): void => {
    if (done) return
    if (line === '') {
      flushEvent()
      return
    }
    if (!line.startsWith('data:')) return
    let value = line.slice('data:'.length)
    if (value.startsWith(' ')) value = value.slice(1)
    if (value === '[DONE]') {
      done = true
      return
    }
    current.push(value)
  }

  for (const chunk of chunks) {
    buffer += chunk
    let nl = buffer.indexOf('\n')
    while (nl !== -1 && !done) {
      let line = buffer.slice(0, nl)
      if (line.endsWith('\r')) line = line.slice(0, -1)
      consumeLine(line)
      buffer = buffer.slice(nl + 1)
      nl = buffer.indexOf('\n')
    }
    if (done) break
  }
  if (!done && buffer.length > 0) {
    consumeLine(buffer)
  }
  flushEvent()
  return events
}
