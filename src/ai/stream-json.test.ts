// 流式响应增量 JSON 解析（ai-features §4.1 流式条目级渐进渲染）单测。
// 纯函数：输入累积响应文本（流式逐 chunk 到达、可能截断），输出已闭合的完整
// insight 条目数组（无完整条目 → null）。字符串感知扫描——`}`/`[` 出现在字符串
// 值内（如 body 含特殊字符）不误判为结构符。
import { describe, expect, it } from 'vitest'

import { extractCompletedInsights } from '@/ai/stream-json'

/** 单条 fact 的合法序列化文本（供拼接）。 */
const FACT1 = '{"kind": "fact", "title": "偏爱文学类", "body": "文学类占比最高，共 2 本。", "dimension": "classification"}'
const FACT2 = '{"kind": "fact", "body": "最近 30 天内借阅了 2 本。", "dimension": "volume"}'
const TASTE = '{"kind": "taste", "body": "整体书单以虚构类为主。"}'

describe('extractCompletedInsights', () => {
  it('无 insights 数组（文本未到达）→ null', () => {
    expect(extractCompletedInsights('')).toBeNull()
    expect(extractCompletedInsights('{"insights"')).toBeNull()
    expect(extractCompletedInsights('{"insights": ')).toBeNull()
  })

  it('第一条未闭合（字段截断中间态）→ null', () => {
    expect(extractCompletedInsights('{"insights": [{"kind": "fact"')).toBeNull()
    expect(
      extractCompletedInsights('{"insights": [{"kind": "fact", "body": "文'),
    ).toBeNull()
  })

  it('单条已闭合、数组未闭合 → 1 条（含 title/dimension 完整字段）', () => {
    expect(extractCompletedInsights(`{"insights": [${FACT1}`)).toEqual([JSON.parse(FACT1)])
  })

  it('首条完整 + 第二条截断 → 仅首条', () => {
    const text = `{"insights": [${FACT1}, {"kind": "taste"`
    expect(extractCompletedInsights(text)).toEqual([JSON.parse(FACT1)])
  })

  it('数组闭合（缺顶层 }）→ 全部已闭合条目', () => {
    expect(extractCompletedInsights(`{"insights": [${FACT1}, ${FACT2}]`)).toEqual([
      JSON.parse(FACT1),
      JSON.parse(FACT2),
    ])
  })

  it('完整 JSON（含顶层 }）→ 全部条目', () => {
    const text = `{"insights": [${FACT1}, ${FACT2}, ${TASTE}]}`
    expect(extractCompletedInsights(text)).toEqual([JSON.parse(FACT1), JSON.parse(FACT2), JSON.parse(TASTE)])
  })

  it('逐 chunk 喂入：产出序列与 JSON.parse 全集一致（渐进单调）', () => {
    const full = `{"insights": [${FACT1}, ${TASTE}]}`
    const seen: unknown[][] = []
    let acc = ''
    for (const ch of full) {
      acc += ch
      const current = extractCompletedInsights(acc)
      if (current !== null) seen.push(current)
    }
    // 最终形态与全集一致；过程中无回退（每步条目数单调不减）。
    expect(seen.at(-1)).toEqual([JSON.parse(FACT1), JSON.parse(TASTE)])
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!.length).toBeGreaterThanOrEqual(seen[i - 1]!.length)
    }
    expect(seen[0]![0]).toEqual(JSON.parse(FACT1))
  })

  it('body 字符串内含 } 与 [ 不误判为结构符', () => {
    const text = '{"insights": [{"kind": "fact", "body": "含 } 和 [ 字符", "dimension": "x"}, {"kind": "taste"'
    expect(extractCompletedInsights(text)).toEqual([
      { kind: 'fact', body: '含 } 和 [ 字符', dimension: 'x' },
    ])
  })

  it('字符串内转义引号 \\" 不影响扫描', () => {
    const body = 'say \\"hi\\" }'
    const text = `{"insights": [{"kind": "fact", "body": "${body}"}, {"kind": "taste"`
    expect(extractCompletedInsights(text)).toEqual([{ kind: 'fact', body: 'say "hi" }' }])
  })

  it('空数组已闭合 → []（非 null）', () => {
    expect(extractCompletedInsights('{"insights": []}')).toEqual([])
  })

  it('markdown 围栏前缀（网关忽略 response_format 时）不影响条目提取', () => {
    const text = '```json\n{"insights": [{"kind": "fact", "body": "a"}]}\n```'
    expect(extractCompletedInsights(text)).toEqual([{ kind: 'fact', body: 'a' }])
  })

  it('body 含 "insights" 字样不干扰数组定位（取 key 后的首个 [）', () => {
    const text = '{"insights": [{"kind": "fact", "body": "提到 insights 字段"}, {"kind": "taste"'
    expect(extractCompletedInsights(text)).toEqual([
      { kind: 'fact', body: '提到 insights 字段' },
    ])
  })
})
