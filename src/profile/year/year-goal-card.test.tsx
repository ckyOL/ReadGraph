// 年度目标卡内联编辑测试（reading-profile §4/§7 目标卡内联编辑；data-layer §8；E-4 裁定）。
// 纯函数 parseGoalInput / stepGoalValue / applyGoalValue 封闭值域 1–999、
// 清除 = 删除该年条目（0/空值不落 schema）；组件渲染走 t() 取值路径断言
// （i18n-conventions §8：不硬编码中英文字面量）。渲染环境 node（无 jsdom）：
// renderToStaticMarkup + createElement；交互逻辑以纯函数 + 编辑态子组件静态渲染覆盖。
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n, { changeLanguage } from '@/i18n'
import type { UserPreferencesParsed } from '@/lib/preferences'
import { readPreferences, writePreferences } from '@/lib/preferences'

import { YearGoalCard, GoalEditor, parseGoalInput, stepGoalValue, applyGoalValue } from './year-goal-card'

// 偏好 mock：2026 目标 12、2025 目标 10；writePreferences 为 spy 供断言。
function parsedPreferences(annualGoals: UserPreferencesParsed['annualGoals']): UserPreferencesParsed {
  return {
    locale: 'zh-CN',
    theme: 'auto',
    displayTimezone: 'UTC',
    ai: { enabled: false, baseUrl: '', model: '', sendPreview: true },
    annualGoals,
  }
}

vi.mock('@/lib/preferences', () => ({
  readPreferences: vi.fn(() => parsedPreferences({ 2025: 10, 2026: 12 })),
  writePreferences: vi.fn(),
}))

const readPreferencesMock = vi.mocked(readPreferences)
const writePreferencesMock = vi.mocked(writePreferences)

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init()
  await changeLanguage('zh-CN')
})

beforeEach(() => {
  readPreferencesMock.mockReset()
  readPreferencesMock.mockImplementation(() => parsedPreferences({ 2025: 10, 2026: 12 }))
  writePreferencesMock.mockClear()
})

describe('parseGoalInput（编辑输入解析纯函数，data-layer §8 值域语义）', () => {
  it('数字字符串 → 该值（trim 空白）', () => {
    expect(parseGoalInput('12')).toBe(12)
    expect(parseGoalInput('  45 ')).toBe(45)
    expect(parseGoalInput('999')).toBe(999)
    expect(parseGoalInput('1')).toBe(1)
  })

  it('空串/纯空白 → null（清除语义）', () => {
    expect(parseGoalInput('')).toBeNull()
    expect(parseGoalInput('   ')).toBeNull()
  })

  it('0/负数/小数/越界/非数字 → undefined（不写偏好，schema 兜底）', () => {
    expect(parseGoalInput('0')).toBeUndefined()
    expect(parseGoalInput('-3')).toBeUndefined()
    expect(parseGoalInput('12.5')).toBeUndefined()
    expect(parseGoalInput('1000')).toBeUndefined()
    expect(parseGoalInput('abc')).toBeUndefined()
    expect(parseGoalInput('12a')).toBeUndefined()
  })
})

describe('stepGoalValue（步进纯函数，data-layer §8 语义）', () => {
  it('未设置 +1 → 设为 1', () => {
    expect(stepGoalValue(null, 1)).toBe(1)
  })

  it('5 −1 → 4', () => {
    expect(stepGoalValue(5, -1)).toBe(4)
  })

  it('1 −1 → 清除态（null）', () => {
    expect(stepGoalValue(1, -1)).toBeNull()
  })

  it('未设置 −1 → 保持清除态（null）', () => {
    expect(stepGoalValue(null, -1)).toBeNull()
  })

  it('999 +1 → 封顶 999', () => {
    expect(stepGoalValue(999, 1)).toBe(999)
  })
})

describe('applyGoalValue（落值纯函数，data-layer §8 清除语义）', () => {
  it('设值 → 该年条目更新，其余年原样保留（新对象返回，不 mutate 入参）', () => {
    const goals = { 2025: 10, 2026: 12 }
    const snapshot = { ...goals }
    const next = applyGoalValue(goals, 2027, 30)
    expect(next).toEqual({ 2025: 10, 2026: 12, 2027: 30 })
    expect(next).not.toBe(goals)
    expect(goals).toEqual(snapshot)
  })

  it('null → 删除该年条目（清除 = 删条目，不是写 0），其余年保留', () => {
    const next = applyGoalValue({ 2025: 10, 2026: 12 }, 2026, null)
    expect(next).not.toHaveProperty('2026')
    expect(next[2025]).toBe(10)
  })

  it('设值覆盖同年前值', () => {
    expect(applyGoalValue({ 2026: 12 }, 2026, 24)).toEqual({ 2026: 24 })
  })
})

describe('YearGoalCard 展示态（reading-profile §4 目标卡内联编辑裁定）', () => {
  it('有目标 → 进度/差量同源数字 + 编辑按钮（t() 取值路径），无设置链接', () => {
    const html = renderToStaticMarkup(
      createElement(YearGoalCard, { bookCount: 3, goal: 12, year: 2026 }),
    )
    expect(html).toContain(i18n.t('pages:profile.year.goal.title'))
    expect(html).toContain(i18n.t('pages:profile.year.goal.progress', { current: 3, goal: 12 }))
    expect(html).toContain(i18n.t('pages:profile.year.goal.remaining', { count: 9 }))
    expect(html).toContain(i18n.t('pages:profile.year.goal.edit'))
    expect(html).not.toContain('#/settings')
  })

  it('未设置目标 → 未设置文案 + 编辑按钮（原「去设置」入口被内联编辑替代）', () => {
    const html = renderToStaticMarkup(
      createElement(YearGoalCard, { bookCount: 3, goal: null, year: 2027 }),
    )
    expect(html).toContain(i18n.t('pages:profile.year.goal.unset'))
    expect(html).toContain(i18n.t('pages:profile.year.goal.edit'))
    expect(html).not.toContain(i18n.t('pages:profile.year.goal.set'))
    expect(html).not.toContain('#/settings')
  })
})

describe('GoalEditor 编辑态（数字输入 + −/+ 步进辅助，静态渲染断言）', () => {
  it('渲染数字输入框（aria 走 t() 取值路径）与步进按钮 aria', () => {
    const html = renderToStaticMarkup(
      createElement(GoalEditor, { initial: 12, onWrite: () => undefined, onDone: () => undefined }),
    )
    expect(html).toContain('data-slot="year-goal-editor"')
    expect(html).toContain('data-slot="year-goal-input"')
    expect(html).toContain(`aria-label="${i18n.t('pages:profile.year.goal.inputLabel')}"`)
    expect(html).toContain(`aria-label="${i18n.t('pages:profile.year.goal.decrease')}"`)
    expect(html).toContain(`aria-label="${i18n.t('pages:profile.year.goal.increase')}"`)
    expect(html).toContain('value="12"')
  })

  it('未设置初始值 → 空输入框 + 值域提示文案', () => {
    const html = renderToStaticMarkup(
      createElement(GoalEditor, { initial: null, onWrite: () => undefined, onDone: () => undefined }),
    )
    expect(html).toContain('value=""')
    expect(html).toContain(i18n.t('pages:profile.year.goal.hint'))
  })
})
