import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import {
  PROFILE_MARKDOWN_MAX_LENGTH,
  PROFILE_TEMPERATURE,
  buildProfileInsightsPrompt,
  validateProfileInsightsMarkdown,
} from './profile-insights'
import profileInsightsSource from './profile-insights.ts?raw'

/** 黑名单字段名（docs/specs/ai-features.md §3.2）：prompt 源码不得出现。 */
const BLACKLISTED_FIELD_NAMES = [
  'cardno',
  'barcode',
  'isbn13',
  'isbn10',
  'tags',
  'price',
  'borrowedAt',
  'returnedAt',
  'coverUrl',
  'metaId',
  'rawRecords',
  'gantt',
  'translators',
  'parallelTitles',
  'borrowLocation',
] as const

function promptText(locale: 'zh-CN' | 'en'): string {
  return buildProfileInsightsPrompt({ summary: {}, books: [], locale })
    .map((message) => message.content)
    .join('\n')
}

describe('validateProfileInsightsMarkdown（§4.1 弱校验）', () => {
  it('接受合法非空 markdown，返回 trim 后文本', () => {
    expect(validateProfileInsightsMarkdown('## 分类偏好\n\n正文')).toBe('## 分类偏好\n\n正文')
    expect(validateProfileInsightsMarkdown('  正文  ')).toBe('正文')
  })

  it('拒绝空串/纯空白（抛 ZodError → 管线 validation 分级）', () => {
    expect(() => validateProfileInsightsMarkdown('')).toThrow(ZodError)
    expect(() => validateProfileInsightsMarkdown('   \n\t ')).toThrow(ZodError)
  })

  it('拒绝超长文本（> PROFILE_MARKDOWN_MAX_LENGTH）；恰好等于上限可通过', () => {
    expect(() => validateProfileInsightsMarkdown('x'.repeat(PROFILE_MARKDOWN_MAX_LENGTH + 1))).toThrow(
      ZodError,
    )
    const atLimit = validateProfileInsightsMarkdown('x'.repeat(PROFILE_MARKDOWN_MAX_LENGTH))
    expect(atLimit).toHaveLength(PROFILE_MARKDOWN_MAX_LENGTH)
  })
})

describe('profile-insights.ts 源码审计（黑名单断言）', () => {
  it('源码文本不含任何黑名单字段名', () => {
    for (const name of BLACKLISTED_FIELD_NAMES) {
      expect(profileInsightsSource).not.toContain(name)
    }
  })
})

describe('buildProfileInsightsPrompt', () => {
  it('包含幻觉控制指令（仅引用书单书目、不虚构、数字只转译）', () => {
    const text = promptText('zh-CN')
    expect(text).toContain('仅引用发送书单内的书目')
    expect(text).toContain('不虚构书名/作者/情节')
    expect(text).toContain('数字只转译不生成')
  })

  it('输出语言随 locale：zh-CN → 中文，en → English', () => {
    expect(promptText('zh-CN')).toContain('简体中文')
    expect(promptText('en')).toContain('English')
  })

  it('输出契约为纯 Markdown：二级标题小节 + 一句话总结，禁代码围栏/表格，无 JSON 要求', () => {
    const text = promptText('zh-CN')
    expect(text).toContain('Markdown')
    expect(text).toContain('##')
    expect(text).toContain('一句话总结')
    expect(text).toContain('不使用代码围栏')
    expect(text).toContain('不使用表格')
    expect(text).not.toContain('JSON')
  })

  it('数据区只描述白名单变量（summary + books 每书 8 字段）', () => {
    const text = promptText('zh-CN')
    expect(text).toContain('summary')
    expect(text).toContain('books')
    expect(text).toContain('题名/副标题/作者/出版年份/出版社/分类/subjects/借阅次数')
  })

  it('PROFILE_TEMPERATURE 为低值（< 0.5）', () => {
    expect(PROFILE_TEMPERATURE).toBeLessThan(0.5)
  })
})
