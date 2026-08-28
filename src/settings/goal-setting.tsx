// 年度目标控件（data-layer §8：设置页偏好区，当前年数字步进器；Y-2 阶段交付）。
// 语义：值域 1–999 封闭（0 值不被 schema 接受——清除 = 删除该年条目，不是写 0）；
// 变更即时写 writePreferences({ annualGoals })（对齐主题/locale 即时生效模式）；
// 年度视图目标卡只读展示、无编辑入口（设置入口唯一）。i18n 走 t()（i18n-conventions §8）。
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { readPreferences, writePreferences } from '@/lib/preferences'
import { toast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'

/** 步进结果：新 annualGoals（新对象）、是否发生变化、步进后的当前年值（null = 已清除）。 */
interface StepAnnualGoalsResult {
  goals: Record<number, number>
  changed: boolean
  value: number | null
}

/**
 * 年度目标步进纯函数（不依赖 React/存储，供单测）：
 * delta=+1 → 未设置→1，否则 min(current+1, 999)（999 时封顶不变）；
 * delta=-1 → 未设置或 current<=1 → 删除该年条目（清除，value=null），否则 current-1；
 * 其余年份条目原样保留（新对象返回，不 mutate 入参）。
 */
export function stepAnnualGoals(
  goals: Record<number, number>,
  year: number,
  delta: 1 | -1,
): StepAnnualGoalsResult {
  const next = { ...goals }
  const current = goals[year]
  if (delta === 1) {
    if (current === undefined) {
      next[year] = 1
      return { goals: next, changed: true, value: 1 }
    }
    if (current >= 999) return { goals: next, changed: false, value: current }
    next[year] = current + 1
    return { goals: next, changed: true, value: current + 1 }
  }
  // delta === -1
  if (current === undefined || current <= 1) {
    delete next[year]
    return { goals: next, changed: current !== undefined, value: null }
  }
  next[year] = current - 1
  return { goals: next, changed: true, value: current - 1 }
}

/**
 * 年度目标行：左标签（含年份）+ −/数值/＋ 步进器；行下描述文案（data-layer §8）。
 * currentYear 用挂载态 UTC 年（对齐页面只读挂载模式，避免跨年边界翻转）；
 * 初始 goal 一次性读取偏好（此后以本地状态为准，写回始终基于最新偏好合并）。
 */
export function GoalSetting() {
  const { t } = useTranslation('pages')
  const [currentYear] = useState(() => new Date().getUTCFullYear())
  const [goal, setGoal] = useState<number | null>(
    () => readPreferences().annualGoals[currentYear] ?? null,
  )

  const step = (delta: 1 | -1) => {
    const next = stepAnnualGoals(readPreferences().annualGoals, currentYear, delta)
    if (!next.changed) return
    writePreferences({ annualGoals: next.goals })
    setGoal(next.value)
    toast({ title: t(next.value === null ? 'settings.goal.cleared' : 'settings.goal.saved') })
  }

  return (
    <div data-slot="settings-goal" className="space-y-1">
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-32 shrink-0 text-sm text-muted-foreground">
          {t('settings.goal.label', { year: currentYear })}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label={t('settings.goal.decrease')}
          onClick={() => step(-1)}
        >
          −
        </Button>
        <span
          data-slot="settings-goal-value"
          className="min-w-12 text-center text-sm font-medium tabular-nums"
        >
          {goal != null ? goal : t('settings.goal.placeholder')}
        </span>
        <Button
          variant="outline"
          size="sm"
          aria-label={t('settings.goal.increase')}
          onClick={() => step(1)}
        >
          +
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('settings.goal.description')}</p>
    </div>
  )
}
