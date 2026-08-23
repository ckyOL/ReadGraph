
import { describe, expect, it } from 'vitest'

import {
  buildProfileInsightsPrompt,
  insightSchema,
  PROFILE_TEMPERATURE,
  profileInsightsSchema,
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

const validFact = {
  kind: 'fact' as const,
  title: '偏爱文学类',
  body: '文学类占比 41%。',
  dimension: '分类偏好',
}
const validFactNoOptional = { kind: 'fact' as const, body: '平均每次借阅 2.3 本。' }
const validTaste = { kind: 'taste' as const, body: '选书整体偏文艺，值得尝试更多科幻。' }

function promptText(locale: 'zh-CN' | 'en'): string {
  return buildProfileInsightsPrompt({ summary: {}, books: [], locale })
    .map((message) => message.content)
    .join('\n')
}

describe('insightSchema', () => {
  it('接受合法 fact（含可选 title/dimension 与纯 body 两种形态）', () => {
    expect(insightSchema.safeParse(validFact).success).toBe(true)
    expect(insightSchema.safeParse(validFactNoOptional).success).toBe(true)
  })

  it('接受合法 taste（无 title/dimension）', () => {
    expect(insightSchema.safeParse(validTaste).success).toBe(true)
  })

  it('拒绝缺 kind', () => {
    expect(insightSchema.safeParse({ body: '缺 kind。' }).success).toBe(false)
  })

  it('拒绝缺 body 或空 body', () => {
    expect(insightSchema.safeParse({ kind: 'fact' }).success).toBe(false)
    expect(insightSchema.safeParse({ kind: 'fact', body: '' }).success).toBe(false)
  })

  it('拒绝非法 kind 值', () => {
    expect(insightSchema.safeParse({ kind: 'opinion', body: 'x' }).success).toBe(false)
  })

  it('拒绝 taste 携带 title 或 dimension', () => {
    expect(insightSchema.safeParse({ ...validTaste, title: '品味' }).success).toBe(false)
    expect(insightSchema.safeParse({ ...validTaste, dimension: '审美' }).success).toBe(false)
  })
})

describe('profileInsightsSchema', () => {
  it('接受 2–4 条、taste ≤ 1 的合法响应', () => {
    const twoFacts = { insights: [validFact, validFactNoOptional] }
    const twoFactsPlusTaste = { insights: [validFact, validFactNoOptional, validTaste] }
    expect(profileInsightsSchema.safeParse(twoFacts).success).toBe(true)
    expect(profileInsightsSchema.safeParse(twoFactsPlusTaste).success).toBe(true)
  })

  it('拒绝条数 < 2 或 > 4', () => {
    expect(profileInsightsSchema.safeParse({ insights: [validFact] }).success).toBe(false)
    const fiveFacts = { insights: [validFact, validFact, validFact, validFact, validFact] }
    expect(profileInsightsSchema.safeParse(fiveFacts).success).toBe(false)
  })

  it('拒绝 taste 超过 1 条', () => {
    const twoTastes = { insights: [validTaste, validTaste, validFact] }
    expect(profileInsightsSchema.safeParse(twoTastes).success).toBe(false)
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
