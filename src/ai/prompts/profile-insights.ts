import { z } from 'zod'

/**
 * 阅读画像分析（/profile「AI 解读」区）的响应校验与 prompt 装配。
 * 规格：docs/specs/ai-features.md §4.1 / §3.2。
 *
 * 注意：本文件是黑名单审计目标（测试强制断言源码不含任何黑名单字段名），
 * 新增文案/字段时不得引入黑名单字段名（含注释）。
 */

/** 单条洞察：fact 事实洞察（可带 title/dimension）+ taste 审美点评（不可带）。 */
export const insightSchema = z
  .object({
    kind: z.enum(['fact', 'taste']),
    title: z.string().optional(),
    body: z.string().min(1),
    dimension: z.string().optional(),
  })
  .superRefine((insight, ctx) => {
    if (
      insight.kind === 'taste' &&
      (insight.title !== undefined || insight.dimension !== undefined)
    ) {
      ctx.addIssue({ code: 'custom', message: 'taste 条目不允许携带 title 或 dimension' })
    }
  })

/** 顶层响应：2–4 条洞察，其中 taste 最多 1 条。 */
export const profileInsightsSchema = z.object({
  insights: z
    .array(insightSchema)
    .min(2, 'insights 至少 2 条')
    .max(4, 'insights 最多 4 条')
    .superRefine((insights, ctx) => {
      let tasteCount = 0
      for (const insight of insights) {
        if (insight.kind === 'taste') tasteCount += 1
      }
      if (tasteCount > 1) {
        ctx.addIssue({ code: 'custom', message: 'taste 条目最多 1 条' })
      }
    }),
})

export type AIInsight = z.infer<typeof insightSchema>
export type ProfileInsights = z.infer<typeof profileInsightsSchema>

/**
 * 生成请求温度：低值抑制发散、减少幻觉（规格 §4.1「temperature 低」）。
 */
export const PROFILE_TEMPERATURE = 0.2

type ProfileLocale = 'zh-CN' | 'en'

/** 输入仅声明为 unknown：白名单装配由脱敏管道（sanitize.ts）负责，此处直接序列化透传。 */
interface ProfileInsightsInput {
  summary: unknown
  books: unknown
  locale: ProfileLocale
}

export interface PromptMessage {
  role: 'system' | 'user'
  content: string
}

const LANGUAGE_INSTRUCTION: Record<ProfileLocale, string> = {
  'zh-CN': '输出语言：简体中文。',
  en: 'Output language: English.',
}

const toJson = (value: unknown): string => {
  if (value === undefined) return 'null'
  return JSON.stringify(value) ?? 'null'
}

/**
 * 装配画像分析 prompt。数据区只含白名单变量（summary 聚合统计 + books
 * 全量书目），字段结构由发送方保证；prompt 内只描述 8 个白名单书目字段，
 * 并显式约束引用边界与数字转译规则（幻觉控制）。
 */
export function buildProfileInsightsPrompt(input: ProfileInsightsInput): PromptMessage[] {
  const systemContent = [
    '你是 ReadGraph 的阅读画像分析师，负责根据用户发送的本地阅读数据生成画像洞察。',
    '任务：生成 2–4 条洞察，分为两类：',
    '- fact 事实洞察：客观陈述，可带标题（title）与维度（dimension），正文应引用本地统计中的数字。',
    '- taste 审美点评：一段评价性文字，最多 1 条，不允许携带 title 或 dimension。',
    '幻觉控制：',
    '仅引用发送书单内的书目，不虚构书名/作者/情节。',
    '数字只转译不生成：不得编造或推算任何统计数字，只能原样转述数据中的数值。',
    '输出格式：只输出合法 JSON：{"insights": [{"kind": "fact" | "taste", "title"?: string, "body": string, "dimension"?: string}]}，共 2–4 条，其中 taste 最多 1 条。',
    LANGUAGE_INSTRUCTION[input.locale],
  ].join('\n')

  const userContent = [
    '以下是本地阅读数据（已脱敏，仅含完成任务所需的最少字段）：',
    '— summary：聚合统计（数字由本地计算，仅供转译）—',
    toJson(input.summary),
    '— books：书单，每本书仅含题名/副标题/作者/出版年份/出版社/分类/subjects/借阅次数 8 个字段 —',
    toJson(input.books),
  ].join('\n')

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ]
}
