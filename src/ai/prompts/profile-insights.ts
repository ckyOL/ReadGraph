import { ZodError } from 'zod'

/**
 * 阅读画像分析（/profile「AI 解读」区）的响应校验与 prompt 装配。
 * 规格：docs/specs/ai-features.md §4.1 / §3.2。
 *
 * 注意：本文件是黑名单审计目标（测试强制断言源码不含任何黑名单字段名），
 * 新增文案/字段时不得引入黑名单字段名（含注释）。
 */

/** 输出上限：远超正常画像文本（2–4 小节 + 总结约 1–2KB），防失控响应。 */
export const PROFILE_MARKDOWN_MAX_LENGTH = 20_000

/**
 * 弱校验（2026-08-25 markdown 切换，规格 §4.1）：非空 + 长度上限。
 * 空/纯空白或超长抛 ZodError（复用管线 validation 错误分级）；
 * 通过返回 trim 后文本（渲染与缓存均用返回值）。
 */
export function validateProfileInsightsMarkdown(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') {
    throw new ZodError([{ code: 'custom', path: [], message: 'AI 输出为空' }])
  }
  if (trimmed.length > PROFILE_MARKDOWN_MAX_LENGTH) {
    throw new ZodError([
      {
        code: 'custom',
        path: [],
        message: `AI 输出超长（> ${PROFILE_MARKDOWN_MAX_LENGTH} 字符）`,
      },
    ])
  }
  return trimmed
}

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
 * 并显式约束输出格式（纯 Markdown、无围栏/表格）、引用边界与数字转译规则
 * （幻觉控制）。
 */
export function buildProfileInsightsPrompt(input: ProfileInsightsInput): PromptMessage[] {
  const systemContent = [
    '你是 ReadGraph 的阅读画像分析师，负责根据用户发送的本地阅读数据生成画像洞察。',
    '任务：生成 2–4 个小节 + 结尾一句话总结，用 Markdown 呈现：',
    '- 小节标题用二级标题（##），如「## 分类偏好」「## 借阅节奏」，每节 1–3 句话，客观陈述并引用本地统计数字。',
    '- 关键数字用加粗（**数字**）突出，如「文学类占比 **41%**」。',
    '- 结尾一节固定为「## 一句话总结」，给出整体审美评价（可引用书单内书目，保持克制）。',
    '幻觉控制：',
    '仅引用发送书单内的书目，不虚构书名/作者/情节。',
    '数字只转译不生成：不得编造或推算任何统计数字，只能原样转述数据中的数值。',
    '输出格式：纯 Markdown 文本，不使用代码围栏，不使用表格。',
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
