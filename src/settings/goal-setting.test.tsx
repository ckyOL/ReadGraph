// 年度目标控件测试（data-layer §8：设置页偏好区，当前年数字步进器；Y-2）。
// 纯函数 stepAnnualGoals 封闭值域 1–999、0 值不接受、清除 = 删除该年条目；
// 组件渲染走 t() 取值路径断言（i18n-conventions §8：不硬编码中英文字面量）。
// 渲染环境 node（无 jsdom）：renderToStaticMarkup + createElement；偏好 mock 确定性。
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n, { changeLanguage } from '@/i18n'
import { readPreferences, writePreferences, type UserPreferencesParsed } from '@/lib/preferences'

import { GoalSetting, stepAnnualGoals } from './goal-setting'

// 偏好 mock：2026 目标 12、2025 目标 10；writePreferences 为 spy 供断言。
function parsedPreferences(annualGoals: UserPreferencesParsed['annualGoals']): UserPreferencesParsed {
  return {
    locale: 'zh-CN',
    theme: 'auto',
    displayTimezone: 'Asia/Shanghai',
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

describe('stepAnnualGoals（纯函数，data-layer §8 语义）', () => {
  it('未设置 +1 → 设为 1', () => {
    expect(stepAnnualGoals({}, 2026, 1)).toEqual({ goals: { 2026: 1 }, changed: true, value: 1 })
  })

  it('5 −1 → 4', () => {
    expect(stepAnnualGoals({ 2026: 5 }, 2026, -1)).toEqual({ goals: { 2026: 4 }, changed: true, value: 4 })
  })

  it('1 −1 → 删除该年条目（其余年保留，value=null 清除）', () => {
    const result = stepAnnualGoals({ 2025: 10, 2026: 1 }, 2026, -1)
    expect(result.value).toBeNull()
    expect(result.changed).toBe(true)
    expect(result.goals).not.toHaveProperty('2026')
    expect(result.goals[2025]).toBe(10)
  })

  it('未设置 −1 → 已是清除态，无变化', () => {
    expect(stepAnnualGoals({}, 2026, -1)).toEqual({ goals: {}, changed: false, value: null })
  })

  it('999 +1 → 封顶 999 且 changed=false', () => {
    expect(stepAnnualGoals({ 2026: 999 }, 2026, 1)).toEqual({ goals: { 2026: 999 }, changed: false, value: 999 })
  })

  it('入参对象不被 mutate（新对象返回，其余年条目原样保留）', () => {
    const goals = { 2025: 10, 2026: 5 }
    const snapshot = { ...goals }
    const up = stepAnnualGoals(goals, 2026, 1)
    const down = stepAnnualGoals(goals, 2026, -1)
    expect(goals).toEqual(snapshot)
    expect(up.goals).not.toBe(goals)
    expect(down.goals).not.toBe(goals)
    expect(up.goals[2025]).toBe(10)
    expect(down.goals[2025]).toBe(10)
  })
})

describe('GoalSetting 组件（设置页偏好区年度目标行）', () => {
  it('已设置目标 → 渲染数值与 t(settings.goal.label, {year}) 结果', () => {
    const html = renderToStaticMarkup(createElement(GoalSetting))
    expect(html).toContain(i18n.t('pages:settings.goal.label', { year: new Date().getUTCFullYear() }))
    expect(html).toContain('>12<')
    expect(html).toContain(`aria-label="${i18n.t('pages:settings.goal.decrease')}"`)
    expect(html).toContain(`aria-label="${i18n.t('pages:settings.goal.increase')}"`)
  })

  it('未设置目标 → 渲染占位文案与 aria-label（t() 取值路径）', () => {
    readPreferencesMock.mockImplementation(() => parsedPreferences({}))
    const html = renderToStaticMarkup(createElement(GoalSetting))
    expect(html).toContain(i18n.t('pages:settings.goal.placeholder'))
    expect(html).not.toContain('>12<')
    expect(html).toContain(`aria-label="${i18n.t('pages:settings.goal.decrease')}"`)
    expect(html).toContain(`aria-label="${i18n.t('pages:settings.goal.increase')}"`)
  })
})
