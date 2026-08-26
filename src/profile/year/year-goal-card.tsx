// 年度目标进度卡（reading-profile §4 年度视图概览窄卡）：目标值 M vs yearSlice.bookCount N。
// 数字同源（进度/差量全部来自 computeYearSlice 产物 + 偏好目标值）；差量三态：
// 未达标「还差 K 本」/ 已达标「已达标」/ 未设置「未设置目标」+ 跳 /settings 设置链接。
// 页面只读：目标编辑在设置页（data-layer §8，E-4），本卡不提供编辑。
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'

export function YearGoalCard({
  bookCount,
  goal,
}: {
  bookCount: number
  /** 目标值（UserPreferences.annualGoals 该年条目），未设置 = null */
  goal: number | null
}) {
  const { t } = useTranslation('pages')
  const pct = goal != null && goal > 0 ? Math.min(Math.round((bookCount / goal) * 100), 100) : 0
  const remaining = goal != null ? Math.max(goal - bookCount, 0) : 0

  return (
    <div className="rounded-lg border border-border p-3" data-slot="year-goal-card">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">{t('profile.year.goal.title')}</div>
        {goal == null && (
          <Button asChild variant="outline" size="sm" className="h-6 px-2 text-xs">
            <Link to="/settings">{t('profile.year.goal.set')}</Link>
          </Button>
        )}
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