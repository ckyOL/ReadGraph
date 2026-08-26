// /profile 概览行「年度目标」入口卡（reading-profile §4 入口导航）：当年 N/M 进度，
// 点击 → /profile/$year。数据 = 当年 computeYearSlice.bookCount + annualGoals 目标值
// （与年度视图同一产物，数字同源）；未设置目标 → 未设置文案。
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'

export function YearGoalSummaryCard({
  bookCount,
  goal,
  year,
}: {
  /** 当年独立 Book 数（computeYearSlice.bookCount）；未就绪 = null 显示 — */
  bookCount: number | null
  /** 当年目标值；未设置 = null */
  goal: number | null
  year: number
}) {
  const { t } = useTranslation('pages')
  return (
    <Link
      to="/profile/$year"
      params={{ year: String(year) }}
      className="rounded-lg border border-border p-3 transition-colors hover:bg-muted/50"
      data-slot="year-goal-summary"
    >
      <div className="text-xs text-muted-foreground">{t('profile.summary.goal')}</div>
      <div className="mt-1 font-heading text-xl tabular-nums">
        {bookCount == null
          ? '—'
          : goal != null
            ? `${bookCount}/${goal}`
            : t('profile.summary.goal.unset')}
      </div>
    </Link>
  )
}