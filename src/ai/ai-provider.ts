// AI Provider 抽象（ai-features §1 代码落点 / §7）：绑定配置的 chat 门面 + SSE 解析纯函数。
// 职责边界：绑定 baseUrl/apiKey/model/temperature 复用 ai-client.chat/chatStream（60s
// 超时/Abort/HTTP 分级透传），对响应 content 做 JSON.parse 与可选 Zod 校验（失败抛 ZodError）；
// parseSseEvents 为 ai-client 增量解析器的聚合形态（re-export，兼容既有契约）。
// 不做 prompt 装配 / 缓存 / UI 编排（相应模块职责）。

import type { AiChatMessage } from '@/ai/ai-client'
import { chat as clientChat, chatStream as clientChatStream, parseSseEvents } from '@/ai/ai-client'
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
  /** true 走流式（chatStream 链路，增量拼接后同规则解析校验）；缺省 false 非流式。 */
  stream?: boolean
  signal?: AbortSignal
}

export interface AiProvider {
  chat(messages: AiChatMessage[], opts?: AiChatOptions): Promise<unknown>
  /** 流式 chat：绑定配置增量产出 content 文本（拼接 == 非流式 content）；不做 JSON/schema 处理（调用方自行渐进解析与最终校验）。 */
  chatStream(messages: AiChatMessage[], opts?: { signal?: AbortSignal }): AsyncIterable<string>
}

/**
 * 绑定配置的 AI Provider：chat 复用 ai-client 的 OpenAI 兼容请求链路
 * （60s 超时/外部 signal 中止/HTTP 错误分级），内容 JSON.parse 后可选过 Zod schema；
 * chatStream 增量产出 content（流式路径，调用方负责 JSON 渐进解析与最终校验）。
 */
export function createAiProvider(config: AiProviderConfig): AiProvider {
  return {
    async chat(messages, opts = {}) {
      if (opts.stream) {
        // 流式路径：增量拼接后走同一 JSON.parse + schema 校验语义。
        let text = ''
        for await (const chunk of clientChatStream({
          baseUrl: config.baseUrl,
          apiKey: config.apiKey,
          model: config.model,
          messages,
          temperature: config.temperature,
          signal: opts.signal,
        })) {
          text += chunk
        }
        const parsed: unknown = JSON.parse(text)
        if (opts.schema) {
          const result = opts.schema.safeParse(parsed)
          if (!result.success) {
            throw result.error
          }
          return result.data
        }
        return parsed
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
    async *chatStream(messages, opts = {}) {
      yield* clientChatStream({
        baseUrl: config.baseUrl,
        apiKey: config.apiKey,
        model: config.model,
        messages,
        temperature: config.temperature,
        signal: opts.signal,
      })
    },
  }
}

// parseSseEvents 归属 ai-client（增量解析器聚合形态）；在此 re-export 保持既有导入契约。
export { parseSseEvents }
