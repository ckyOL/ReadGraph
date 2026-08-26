import { ZodError } from 'zod'

import type { PromptMessage } from './profile-insights'

/**
 * 年度叙事（/profile/$year「年度叙事」区）的响应校验与 prompt 装配。
 * 规格：docs/specs/ai-features.md §9.1 / §3.2。
 *
 * 注意：本文件是黑名单审计目标（测试强制断言源码不含任何黑名单字段名），
 * 新增文案/字段时不得引入黑名单字段名（含注释）。
 * 年度目标值（用户设置）不进 payload：叙事不提「距目标还差 N 本」（§9.1）。
 */

/** 输出上限：远超正常年度叙事段落（2–4 句约 0.5–1KB），防失控响应。 */
export const YEAR_NARRATIVE_MAX_LENGTH = 20_000

/**
 * 弱校验（对齐画像场景 §4.1）：非空 + 长度上限。
 * 空/纯空白或超长抛 ZodError（复用管线 validation 错误分级）；
 * 通过返回 trim 后文本（渲染与缓存均用返回值）。
 */
export function validateYearNarrative(text: string): string {
  const trimmed = text.trim()
  if (trimmed === '') {
    throw new ZodError([{ code: 'custom', path: [], message: 'AI 输出为空' }])
  }
  if (trimmed.length > YEAR_NARRATIVE_MAX_LENGTH) {
    throw new ZodError([
      {
        code: 'custom',
        path: [],
        message: `AI 输出超长（> ${YEAR_NARRATIVE_MAX_LENGTH} 字符）`,
      },
    ])
  }
  return trimmed
}

/**
 * 生成请求温度：低值抑制发散、减少幻觉（对齐画像场景 §4.1「temperature 低」）。
 */
export const YEAR_NARRATIVE_TEMPERATURE = 0.2

type YearLocale = 'zh-CN' | 'en'

/** 输入仅声明为 unknown：白名单装配由脱敏管道（sanitize.ts）负责，此处直接序列化透传。 */
interface YearNarrativeInput {
  year: number
  slice: unknown
  books: unknown
  locale: YearLocale
}

const LANGUAGE_INSTRUCTION: Record<YearLocale, string> = {
  'zh-CN': '输出语言：简体中文。',
  en: 'Output language: English.',
}

const toJson = (value: unknown): string => {
  if (value === undefined) return 'null'
  return JSON.stringify(value) ?? 'null'
}

/**
 * 装配年度叙事 prompt。数据区只含白名单变量（year + slice 聚合统计 + books
 * 全量书目），字段结构由发送方保证；prompt 内只描述 8 个白名单书目字段，
 * 并显式约束输出格式（纯 Markdown、无围栏/表格）、引用边界、数字转译规则
 * 与年度目标排除边界（幻觉控制，§9.1）。
 */
export function buildYearNarrativePrompt(input: YearNarrativeInput): PromptMessage[] {
  const systemContent = [
    '你是 ReadGraph 的年度叙事作者，负责根据用户发送的本地阅读数据，为指定年份生成年度阅读叙事。',
    '任务：生成一段 2–4 句的 Markdown 叙事段落，概述这一年的借阅概况：',
    '- 陈述借阅本数、分类偏好与复借最多的书（以发送的聚合统计与书单为准）。',
    '- 关键数字用加粗（**数字**）突出，如「今年借阅 **23** 本」。',
    '幻觉控制：',
    '仅引用发送书单内的书目，不虚构书名/作者/情节。',
    '数字只转译不生成：不得编造或推算任何统计数字，只能原样转述数据中的数值。',
    '边界约束：不得提及年度目标、目标进度、差量或任何设置类字段；叙事只陈述这一年实际发生的借阅情况。',
    '输出格式：纯 Markdown 文本，不使用代码围栏，不使用表格。',
    LANGUAGE_INSTRUCTION[input.locale],
  ].join('\n')

  const userContent = [
    '以下是本地阅读数据（已脱敏，仅含完成任务所需的最少字段）：',
    '— year + slice：年度聚合统计（数字由本地计算，仅供转译）—',
    toJson({ year: input.year, slice: input.slice }),
    '— books：书单，每本书仅含题名/副标题/作者/出版年份/出版社/分类/subjects/借阅次数 8 个字段 —',
    toJson(input.books),
  ].join('\n')

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent },
  ]
}
