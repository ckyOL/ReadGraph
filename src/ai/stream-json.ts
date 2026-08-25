// 流式响应增量 JSON 解析（ai-features §4.1 条目级渐进渲染）纯函数。
// 输入为流式累积的响应文本（可能截断、可带 markdown 围栏前缀），输出当前已闭合的
// 完整 insight 条目数组；无完整条目返回 null。字符串感知扫描——`}`/`[`/`"` 出现在
// 字符串值内（如 body 含特殊字符）不误判为结构符；转义引号 `\"` 安全。
// 调用方（use-ai.ts）逐 chunk 累积文本并调用，产物只增不减（渐进单调）。
import type { AIInsight } from '@/ai/prompts/profile-insights'

/**
 * 从累积响应文本中提取已闭合的完整 insight 条目。
 * - 文本未到达 `"insights"` 键/数组起点 → null；
 * - 无任何已闭合条目（首条字段截断）→ null；
 * - 至少一条完整闭合（数组未闭合同样提取）→ 条目数组；
 * - 数组已闭合 → 全部条目（与最终 JSON.parse 结果一致）。
 */
export function extractCompletedInsights(text: string): AIInsight[] | null {
  // 定位 "insights" 键后的数组起点：容错围栏前缀；body 内容里的 "insights" 字样
  // 只可能出现在键之后，不干扰定位。
  const keyIdx = text.indexOf('"insights"')
  if (keyIdx === -1) return null
  const arrStart = text.indexOf('[', keyIdx)
  if (arrStart === -1) return null

  // 字符串感知扫描：栈记录结构开符位置，找最后一个已闭合的顶层闭符。
  const stack: number[] = []
  let inString = false
  let escaped = false
  let lastItemEnd = -1 // 数组内最后一条完整条目 `}` 的位置（未闭合数组形态）
  let lastArrayEnd = -1 // 数组 `]` 的位置（数组已闭合形态）
  for (let i = arrStart; i < text.length; i++) {
    const ch = text[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{' || ch === '[') {
      stack.push(i)
      continue
    }
    if (ch === '}' || ch === ']') {
      if (stack.length === 0) continue
      stack.pop()
      if (stack.length === 0) {
        // 数组开符出栈：insights 数组已闭合，其后无需扫描。
        lastArrayEnd = i
        break
      }
      if (stack.length === 1 && ch === '}') {
        // 栈里只剩数组开符 → 刚闭合的是顶层条目。
        lastItemEnd = i
      }
    }
  }

  let candidate: string
  if (lastArrayEnd !== -1) {
    candidate = text.slice(arrStart, lastArrayEnd + 1)
  } else if (lastItemEnd !== -1) {
    candidate = text.slice(arrStart, lastItemEnd + 1) + ']'
  } else {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(candidate)
    return Array.isArray(parsed) ? (parsed as AIInsight[]) : null
  } catch {
    return null
  }
}
