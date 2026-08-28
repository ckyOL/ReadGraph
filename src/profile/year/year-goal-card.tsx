// 年度目标进度卡 + 内联编辑（reading-profile §4 年度视图概览窄卡；data-layer §8；E-4 裁定
// 2026-08-28：编辑入口 = 本卡内联，设置页控件已移除）。展示态：目标值 M vs
// yearSlice.bookCount N；数字同源（进度/差量全部来自 computeYearSlice 产物 + 偏好目标值）；
// 差量三态：未达标「还差 K 本」/ 已达标「已达标」/ 未设置「未设置目标」。编辑态：
// 点「编辑」→ 数字输入框（直接键入）+ −/+ 步进辅助；值域 1–999（清除 = 删除该年条目，
// 0/空值不落 schema）；变更即时写 writePreferences({ annualGoals })（对齐主题/locale 即时
// 生效模式）。按年编辑：$year 在哪年编辑哪年，历年/来年均可设，无跨年边界问题。
// i18n 走 t()（i18n-conventions §8）。
import { useState, type FormEvent } from 'react'
import { Progress } from '@/components/ui/progress'
import { useTranslation } from 'react-i18next'

import { readPreferences, writePreferences } from '@/lib/preferences'
import { toast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/** 输入解析结果：数值 | null = 清除 | undefined = 非法（不写偏好）。 */
export function parseGoalInput(raw: string): number | null | undefined {
  const text = raw.trim()
  if (text === '') return null
  if (!/^\d+$/.test(text)) return undefined
  const value = Number(text)
  if (value < 1 || value > 999) return undefined
  return value
}

/** 编辑态步进纯函数：null +1 → 1；1 −1 → null（清除）；999 +1 封顶；无状态外写。 */
export function stepGoalValue(current: number | null, delta: 1 | -1): number | null {
  if (delta === 1) {
    if (current == null) return 1
    return Math.min(current + 1, 999)
  }
  if (current == null || current <= 1) return null
  return current - 1
}

/** 落值纯函数：value=null → 删除该年条目（清除），其余年原样保留（新对象，不 mutate）。 */
export function applyGoalValue(
  goals: Record<number, number>,
  year: number,
  value: number | null,
): Record<number, number> {
  const next = { ...goals }
  if (value == null) {
    delete next[year]
  } else {
    next[year] = value
  }
  return next
}

/**
 * 编辑态：数字输入框（提交/失焦落值）+ −/+ 步进辅助。
 * initial = 该年当前目标（null = 未设置，空输入框）。落值 = parseGoalInput：
 * null → 清除；undefined → 非法 toast 不写；数值 → 即时写偏好（成功 toast）。
 */
export function GoalEditor({
  initial,
  onWrite,
  onDone,
}: {
  /** 该年当前目标值；null = 未设置（空输入框） */
  initial: number | null
  /** 落值回调（含清除 null；非法值不回调） */
  onWrite: (value: number | null) => void
  /** 结束编辑回调 */
  onDone: () => void
}) {
  const { t } = useTranslation('pages')
  const [text, setText] = useState(initial != null ? String(initial) : '')

  const commit = (delta?: 1 | -1) => {
    const base = delta != null ? stepGoalValue(parseGoalInput(text) ?? null, delta) : parseGoalInput(text)
    if (base === undefined) {
      toast({ title: t('profile.year.goal.invalid'), variant: 'destructive' })
      return
    }
    if (delta != null) setText(base != null ? String(base) : '')
    else onWrite(base)
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    commit()
    onDone()
  }

  return (
    <form
      data-slot="year-goal-editor"
      className="flex flex-wrap items-center gap-2"
      onSubmit={onSubmit}
    >
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t('profile.year.goal.decrease')}
        onClick={() => commit(-1)}
      >
        −
      </Button>
      <Input
        data-slot="year-goal-input"
        type="text"
        inputMode="numeric"
        className="h-8 w-20 text-center tabular-nums"
        aria-label={t('profile.year.goal.inputLabel')}
        value={text}
        onChange={(e) => setText(e.target.value)}
        autoFocus
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-label={t('profile.year.goal.increase')}
        onClick={() => commit(1)}
      >
        +
      </Button>
      <Button type="submit" size="sm">
        {t('profile.year.goal.save')}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>
        {t('profile.year.goal.cancel')}
      </Button>
      <p className="w-full text-xs text-muted-foreground">{t('profile.year.goal.hint')}</p>
    </form>
  )
}

/** 年度目标进度卡（展示态 + 内联编辑态）。页面挂载态 year；编辑即时写偏好。 */
export function YearGoalCard({
  bookCount,
  goal,
  year,
}: {
  bookCount: number
  /** 目标值（UserPreferences.annualGoals 该年条目），未设置 = null */
  goal: number | null
  /** 编辑目标年（$year 参数；按年编辑，跨年导航后各年独立） */
  year: number
}) {
  const { t } = useTranslation('pages')
  const [editing, setEditing] = useState(false)
  const pct = goal != null && goal > 0 ? Math.min(Math.round((bookCount / goal) * 100), 100) : 0
  const remaining = goal != null ? Math.max(goal - bookCount, 0) : 0

  const write = (value: number | null) => {
    const nextGoals = applyGoalValue(readPreferences().annualGoals, year, value)
    writePreferences({ annualGoals: nextGoals })
    toast({ title: t(value == null ? 'profile.year.goal.cleared' : 'profile.year.goal.saved') })
  }

  if (editing) {
    return (
      <div className="rounded-lg border border-border p-3" data-slot="year-goal-card">
        <div className="text-xs text-muted-foreground">{t('profile.year.goal.title')}</div>
        <div className="mt-2">
          <GoalEditor initial={goal} onWrite={write} onDone={() => setEditing(false)} />
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border p-3" data-slot="year-goal-card">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{t('profile.year.goal.title')}</div>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-xs"
          aria-label={t('profile.year.goal.edit')}
          onClick={() => setEditing(true)}
        >
          {t('profile.year.goal.edit')}
        </Button>
      </div>
      <div className="mt-1 font-heading text-xl tabular-nums">
        {goal != null
          ? t('profile.year.goal.progress', { current: bookCount, goal })
          : '—'}
      </div>
      {goal != null ? (
        <>
          <Progress value={pct} className="mt-2 h-1.5" />
          <p className="mt-1 text-xs text-muted-foreground">
            {bookCount >= goal
              ? t('profile.year.goal.reached')
              : t('profile.year.goal.remaining', { count: remaining })}
          </p>
        </>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">{t('profile.year.goal.unset')}</p>
      )}
    </div>
  )
}
