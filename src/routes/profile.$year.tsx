// 年度视图路由（/profile/$year，Phase 2 静态骨架：reading-profile §4/§2.7）。
// 静态骨架（非 AI，本地直出）：年份导航 → 概览窄卡行（年度目标进度卡 + 本年借阅卡）
// → 最常借 Top 5 → 年度书单封面网格；数字全部来自单次 computeYearSlice 产物（数字同源）。
// AI 叙事区为 U-2 落点（本波未实现：无叙事痕迹）。页面只读（目标编辑在设置页）。
// 性能（§8）：组件按需 import（src/profile/year/ 无 barrel）；年份切换走 useTransition。
import { memo, useMemo, useTransition } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { z } from 'zod'

import { db } from '@/db/db-instance'
import { readPreferences } from '@/lib/preferences'
import { computeYearSlice } from '@/lib/profile-stats'
import type { Book, BorrowCycle, CatalogRecord, Source } from '@/types/entities'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { YearGoalCard } from '@/profile/year/year-goal-card'
import { YearTopBooks } from '@/profile/year/year-top-books'
import { YearBookGrid } from '@/profile/year/year-book-grid'
import type { YearBookIndexEntry } from '@/profile/year/year-book-index'

const yearParamSchema = z.string().regex(/^\d{4}$/)

/** $year 参数校验（G-1 裁定，reading-profile §4 路由参数）：z.string().regex(/^\d{4}$/)；
 *  非法/非 4 位数字 → 返回 false 使路由不匹配（notFound()/404 路径）。独立导出供单测。 */
export function parseYearParams(raw: { year: string }): { year: string } | false {
  const parsed = yearParamSchema.safeParse(raw.year)
  return parsed.success ? { year: parsed.data } : false
}

export const Route = createFileRoute('/profile/$year')({
  parseParams: parseYearParams,
  component: ProfileYearRoute,
})

function ProfileYearRoute() {
  const { year } = Route.useParams()
  const navigate = Route.useNavigate()
  return (
    <ProfileYearPage
      year={Number(year)}
      navigateYear={(delta) =>
        navigate({
          to: '/profile/$year',
          params: { year: String(Number(year) + delta) },
        })
      }
    />
  )
}

interface YearEntities {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  sources: Source[]
}

/**
 * 年度视图页面（export 供渲染测试注入 mock 数据源；navigateYear 由路由包装注入）。
 * 全库空 → 整页 Empty + 导入入口；空年 → 区块 Empty 变体 + 目标卡 0/M；
 * useLiveQuery 未就绪 → Skeleton；聚合/渲染异常由区块级 ErrorBoundary 捕获降级。
 */
export function ProfileYearPage({
  year,
  navigateYear,
}: {
  year: number
  navigateYear: (delta: number) => void
}) {
  const { t, i18n } = useTranslation('pages')
  const [isPending, startTransition] = useTransition()

  const entities = useLiveQuery<YearEntities | undefined>(
    () =>
      Promise.all([
        db.books.toArray(),
        db.catalogRecords.toArray(),
        db.borrowCycles.toArray(),
        db.sources.toArray(),
      ]).then(([books, catalogRecords, borrowCycles, sources]) => ({
        books,
        catalogRecords,
        borrowCycles,
        sources,
      })),
    [],
  )
  const loading = entities === undefined

  // 年切片：单次 computeYearSlice 产物，目标卡/Top 5/书单/叙事共用（§2.7 数字同源）；
  // 分类体系取 Source 多数票（缺省）。
  const slice = useMemo(() => {
    if (!entities) return null
    return computeYearSlice(
      entities.books,
      {
        catalogRecords: entities.catalogRecords,
        borrowCycles: entities.borrowCycles,
        sources: entities.sources,
      },
      year,
      { classificationSystem: null },
    )
  }, [entities, year])

  const bookById = useMemo(() => {
    const map = new Map<string, Book>()
    for (const book of entities?.books ?? []) map.set(book.id, book)
    return map
  }, [entities])

  // bookIndex 式索引（题名/作者/封面，不携带整本 Book）：书单网格与 Top 5 共用。
  const bookIndex = useMemo<Record<string, YearBookIndexEntry>>(() => {
    const idx: Record<string, YearBookIndexEntry> = {}
    if (!slice) return idx
    for (const id of slice.bookIds) {
      const book = bookById.get(id)
      if (!book) continue
      idx[id] = { title: book.title, authors: book.authors, coverUrl: book.coverUrl }
    }
    return idx
  }, [slice, bookById])

  const goal = readPreferences().annualGoals[year] ?? null

  const yearLabel = new Intl.NumberFormat(i18n.language).format(year)
  const yearEmptyTitle = t('profile.year.empty.title')
  const yearEmptyDesc = t('profile.year.empty.description')
  const errorTitle = t('profile.empty.error.title')
  const errorDesc = t('profile.empty.error.description')

  if (loading) {
    return <YearPageSkeleton />
  }

  const isEmptyLibrary =
    (entities?.books.length ?? 0) === 0 && (entities?.borrowCycles.length ?? 0) === 0

  // 年份切换走 useTransition（rerender-transitions）：工具条保持稳定，内容区挂 loading 态。
  const onNav = (delta: number) => startTransition(() => navigateYear(delta))

  if (isEmptyLibrary) {
    return (
      <div className="flex flex-col p-6">
        <div className="flex flex-wrap items-center gap-3">
          <YearNav yearLabel={yearLabel} isPending={isPending} onNav={onNav} />
        </div>
        <Empty className="mt-8 min-h-[360px]">
          <EmptyHeader>
            <EmptyTitle>{t('profile.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('profile.empty.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/import">{t('profile.empty.action')}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  return (
    <div className="flex flex-col p-6">
      <YearNav yearLabel={yearLabel} isPending={isPending} onNav={onNav} />

      {/* 概览窄卡行：年度目标进度卡 + 本年借阅卡（与 /profile 概览行同款窄卡） */}
      <div className="relative mt-4 grid grid-cols-2 gap-3" aria-busy={isPending}>
        {isPending && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
            <Progress value={50} className="w-32" />
          </div>
        )}
        <ErrorBoundary title={errorTitle} description={errorDesc}>
          <YearGoalCard bookCount={slice?.bookCount ?? 0} goal={goal} />
        </ErrorBoundary>
        <div className="rounded-lg border border-border p-3" data-slot="year-summary-card">
          <div className="text-xs text-muted-foreground">{t('profile.year.summary.title')}</div>
          <div className="mt-1 font-heading text-xl tabular-nums">
            {slice != null ? t('profile.year.summary.books', { count: slice.bookCount }) : '—'}
          </div>
        </div>
      </div>

      {/* 最常借 Top 5 区块 */}
      <ErrorBoundary title={errorTitle} description={errorDesc}>
        <YearTopBooks
          topBooks={slice?.topBooks ?? []}
          bookIndex={bookIndex}
          emptyTitle={yearEmptyTitle}
          emptyDescription={yearEmptyDesc}
        />
      </ErrorBoundary>

      {/* 年度书单区块（全幅封面网格） */}
      <ErrorBoundary title={errorTitle} description={errorDesc}>
        <YearBookGrid
          bookIds={slice?.bookIds ?? []}
          bookIndex={bookIndex}
          emptyTitle={yearEmptyTitle}
          emptyDescription={yearEmptyDesc}
        />
      </ErrorBoundary>
    </div>
  )
}

/** 顶部工具条行：年份导航（‹/›） + 标题「{year} 年度回顾」（年号随 locale 数字格式）。 */
const YearNav = memo(function YearNav({
  yearLabel,
  isPending,
  onNav,
}: {
  yearLabel: string
  isPending: boolean
  onNav: (delta: number) => void
}) {
  const { t } = useTranslation('pages')
  // 导航已由页面层 startTransition 包装（rerender-transitions）；此处仅做 in-flight 门控。
  const go = (delta: number) => {
    if (isPending) return
    onNav(delta)
  }
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="flex items-center gap-1">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('profile.year.nav.prev')}
          data-slot="year-nav-prev"
          onClick={() => go(-1)}
        >
          ‹
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          aria-label={t('profile.year.nav.next')}
          data-slot="year-nav-next"
          onClick={() => go(1)}
        >
          ›
        </Button>
      </span>
      <h1 className="text-2xl font-bold">{t('profile.year.title', { year: yearLabel })}</h1>
    </div>
  )
})

function YearPageSkeleton() {
  return (
    <div className="p-6" aria-busy>
      <div className="flex items-center gap-3">
        <Skeleton className="h-8 w-20" />
        <Skeleton className="h-8 w-48" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
      <Skeleton className="mt-4 h-48 w-full" />
    </div>
  )
}