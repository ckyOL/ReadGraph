import { describe, expect, it } from 'vitest'
import { ZodError } from 'zod'

import { PROFILE_MARKDOWN_MAX_LENGTH } from './profile-insights'
import {
  YEAR_NARRATIVE_MAX_LENGTH,
  YEAR_NARRATIVE_TEMPERATURE,
  buildYearNarrativePrompt,
  validateYearNarrative,
} from './year-narrative'
import yearNarrativeSource from './year-narrative.ts?raw'

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

/** §9.1 白名单边界专项：年度目标值（用户设置）不进 payload，标识符不得出现。 */
const ANNUAL_GOALS_FIELD_NAME = 'annualGoals' as const

function promptText(locale: 'zh-CN' | 'en'): string {
  return buildYearNarrativePrompt({ year: 2025, slice: {}, books: [], locale })
    .map((message) => message.content)
    .join('\n')
}

describe('validateYearNarrative（§9.1 弱校验，对齐画像 §4.1）', () => {
  it('接受合法非空叙事段落，返回 trim 后文本', () => {
    expect(validateYearNarrative('今年借阅 **23** 本，最爱文学类。')).toBe(
      '今年借阅 **23** 本，最爱文学类。',
    )
    expect(validateYearNarrative('  正文  ')).toBe('正文')
  })

  it('拒绝空串/纯空白（抛 ZodError → 管线 validation 分级）', () => {
    expect(() => validateYearNarrative('')).toThrow(ZodError)
    expect(() => validateYearNarrative('   \n\t ')).toThrow(ZodError)
  })

  it('拒绝超长文本（> YEAR_NARRATIVE_MAX_LENGTH）；恰好等于上限可通过', () => {
    expect(() => validateYearNarrative('x'.repeat(YEAR_NARRATIVE_MAX_LENGTH + 1))).toThrow(
      ZodError,
    )
    const atLimit = validateYearNarrative('x'.repeat(YEAR_NARRATIVE_MAX_LENGTH))
    expect(atLimit).toHaveLength(YEAR_NARRATIVE_MAX_LENGTH)
  })

  it('长度上限与画像场景对齐（20_000）', () => {
    expect(YEAR_NARRATIVE_MAX_LENGTH).toBe(20_000)
    expect(YEAR_NARRATIVE_MAX_LENGTH).toBe(PROFILE_MARKDOWN_MAX_LENGTH)
  })
})

describe('year-narrative.ts 源码审计（黑名单断言）', () => {
  it('源码文本不含任何黑名单字段名', () => {
    for (const name of BLACKLISTED_FIELD_NAMES) {
      expect(yearNarrativeSource).not.toContain(name)
    }
  })

  it('专项：年度目标字段名 annualGoals 不得出现（§9.1 白名单边界）', () => {
    expect(yearNarrativeSource).not.toContain(ANNUAL_GOALS_FIELD_NAME)
  })
})

describe('buildYearNarrativePrompt', () => {
  it('返回 system + user 两条消息', () => {
    const messages = buildYearNarrativePrompt({ year: 2025, slice: {}, books: [], locale: 'zh-CN' })
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
  })

  it('user 消息含 year + slice 与 books 的 JSON 透传（原样序列化）', () => {
    const slice = { bookCount: 23, topBooks: [{ title: '《三体》', borrowCount: 3 }] }
    const books = [{ title: '《三体》' }, { title: '《小王子》' }]
    const messages = buildYearNarrativePrompt({ year: 2025, slice, books, locale: 'zh-CN' })
    const user = messages[1].content

    expect(user).toContain(JSON.stringify({ year: 2025, slice }))
    expect(user).toContain(JSON.stringify(books))
    expect(user).toContain('year + slice')
    expect(user).toContain('books')
    expect(user).toContain('题名/副标题/作者/出版年份/出版社/分类/subjects/借阅次数')
  })

  it('包含幻觉控制指令（仅引用书单书目、不虚构、数字只转译）', () => {
    const text = promptText('zh-CN')
    expect(text).toContain('仅引用发送书单内的书目')
    expect(text).toContain('不虚构书名/作者/情节')
    expect(text).toContain('数字只转译不生成')
  })

  it('包含年度目标排除指令（§9.1：不提目标/进度/差量/设置类字段，且不含 annualGoals 标识符）', () => {
    const text = promptText('zh-CN')
    expect(text).toContain('不得提及年度目标')
    expect(text).toContain('目标进度')
    expect(text).toContain('差量')
    expect(text).not.toContain(ANNUAL_GOALS_FIELD_NAME)
  })

  it('任务契约为一段 2–4 句 Markdown 叙事，关键数字加粗，禁代码围栏/表格', () => {
    const text = promptText('zh-CN')
    expect(text).toContain('2–4 句')
    expect(text).toContain('借阅概况')
    expect(text).toContain('加粗')
    expect(text).toContain('不使用代码围栏')
    expect(text).toContain('不使用表格')
  })

  it('装配产物文本不含任何黑名单字段名', () => {
    for (const locale of ['zh-CN', 'en'] as const) {
      const text = promptText(locale)
      for (const name of BLACKLISTED_FIELD_NAMES) {
        expect(text).not.toContain(name)
      }
      expect(text).not.toContain(ANNUAL_GOALS_FIELD_NAME)
    }
  })

  it('输出语言随 locale：zh-CN → 中文，en → English', () => {
    expect(promptText('zh-CN')).toContain('简体中文')
    expect(promptText('en')).toContain('English')
  })

  it('YEAR_NARRATIVE_TEMPERATURE 为低值（< 0.5，对齐画像场景）', () => {
    expect(YEAR_NARRATIVE_TEMPERATURE).toBeLessThan(0.5)
  })
})
