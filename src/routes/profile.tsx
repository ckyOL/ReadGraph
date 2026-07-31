import {
  lazy,
  Suspense,
  memo,
  useDeferredValue,
  useMemo,
  useState,
  useTransition,
} from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '@/db/db-instance'
import { readPreferences } from '@/lib/preferences'
import { useProfileStats } from '@/profile/use-profile-stats'
import type { ClassificationSystem } from '@/types/entities'
import { CLASSIFICATION_SYSTEMS } from '@/lib/classification'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import { ErrorBoundary } from '@/components/ui/error-boundary'

// 图表组件按需动态加载（bundle-dynamic-imports / bundle-conditional）。
const ClassificationTreemap = lazy(() =>
  import('@/profile/charts/ClassificationTreemap').then((m) => ({
    default: m.ClassificationTreemap,
  })),
)
const BorrowGantt = lazy(() =>
  import('@/profile/charts/BorrowGantt').then((m) => ({ default: m.BorrowGantt })),
)
const BorrowVolumeBar = lazy(() =>
  import('@/profile/charts/BorrowVolumeBar').then((m) => ({
    default: m.BorrowVolumeBar,
  })),
)
const DurationDistribution = lazy(() =>
  import('@/profile/charts/DurationDistribution').then((m) => ({
    default: m.DurationDistribution,
  })),
)

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

const MS_PER_DAY = 86_400_000

type RangeKey = 'all' | 'last1y' | 'last3y' | 'custom'
type SystemKey = 'auto' | ClassificationSystem

const SYSTEM_ORDER: ClassificationSystem[] = CLASSIFICATION_SYSTEMS

function ProfilePage() {
  const { t } = useTranslation('pages')

  const [systemKey, setSystemKey] = useState<SystemKey>('auto')
  const [rangeKey, setRangeKey] = useState<RangeKey>('all')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [isPending, startTransition] = useTransition()

  // 工具条可用分类体系：来自实际 Source（仅列数据中出现的体系）。
  const sources = useLiveQuery(() => db.sources.toArray(), [])
  const availableSystems = useMemo(() => {
    const set = new Set<ClassificationSystem>()
    for (const s of sources ?? []) {
      const sys = s.library?.classificationSystem ?? null
      if (sys) set.add(sys)
    }
    return SYSTEM_ORDER.filter((s) => set.has(s))
  }, [sources])

  const displayTimezone = useMemo(
    () => readPreferences().displayTimezone,
    [],
  )

  const sessionNow = useState(() => Date.now())[0]

  const range = useMemo(
    () => {
      if (rangeKey === 'all') return null
      if (rangeKey === 'last1y')
        return { from: new Date(sessionNow - 365 * MS_PER_DAY), to: null as Date | null }
      if (rangeKey === 'last3y')
        return { from: new Date(sessionNow - 3 * 365 * MS_PER_DAY), to: null as Date | null }
      return {
        from: customFrom ? new Date(`${customFrom}T00:00:00Z`) : null,
        to: customTo ? new Date(`${customTo}T00:00:00Z`) : null,
      }
    },
    [rangeKey, customFrom, customTo, sessionNow],
  )

  const classificationSystem: ClassificationSystem | null =
    systemKey === 'auto' ? null : systemKey

  // opts 经 hook 内 useDeferredValue 延迟重算；这里也 deferred 一份给派生显示。
  const opts = useMemo(
    () => ({ classificationSystem, range, displayTimezone }),
    [classificationSystem, range, displayTimezone],
  )
  const deferredOpts = useDeferredValue(opts)

  const state = useProfileStats(deferredOpts)
  const { loading, computing, result } = state

  const isEmpty =
    !!result && result.summary.totalBooks === 0 && result.summary.totalCycles === 0

  const systemOptions = useMemo(
    () => [
      { value: 'auto' as const, label: t('profile.toolbar.classification.auto') },
      ...availableSystems.map((s) => ({
        value: s as SystemKey,
        label: t(`profile.toolbar.classification.${s}`),
      })),
    ],
    [t, availableSystems],
  )

  const partialTitle = t('profile.empty.partial.title')
  const partialDesc = t('profile.empty.partial.description')
  const errorTitle = t('profile.empty.error.title')
  const errorDesc = t('profile.empty.error.description')

  return (
    <div className="flex flex-col p-6">
      <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
      <p className="text-muted-foreground">{t('profile.subtitle')}</p>

      {/* 工具条 */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t('profile.toolbar.classification')}
          </span>
          <SegmentedControl
            value={systemKey}
            onValueChange={(v) =>
              startTransition(() => setSystemKey(v as SystemKey))
            }
            options={systemOptions}
            aria-label={t('profile.toolbar.classification')}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">
            {t('profile.toolbar.range')}
          </span>
          <Select
            value={rangeKey}
            onValueChange={(v) => startTransition(() => setRangeKey(v as RangeKey))}
          >
            <SelectTrigger className="h-7 w-32 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('profile.toolbar.range.all')}</SelectItem>
              <SelectItem value="last1y">
                {t('profile.toolbar.range.last1y')}
              </SelectItem>
              <SelectItem value="last3y">
                {t('profile.toolbar.range.last3y')}
              </SelectItem>
              <SelectItem value="custom">
                {t('profile.toolbar.range.custom')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        {rangeKey === 'custom' && (
          <div className="flex items-center gap-1.5 text-xs">
            <label className="text-muted-foreground">
              {t('profile.toolbar.range.from')}
            </label>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
            />
            <label className="text-muted-foreground">
              {t('profile.toolbar.range.to')}
            </label>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-7 rounded-md border border-border bg-background px-1.5 text-xs"
            />
          </div>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {t('profile.toolbar.timezone')}: {displayTimezone}
        </span>
      </div>

      {/* 主体 */}
      {loading ? (
        <ProfileSkeleton />
      ) : isEmpty ? (
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
      ) : (
        <>
          <SummaryCards result={result} pending={isPending || computing} />
          <div className="mt-4 space-y-6">
            {isPending || computing ? (
              <ProfileSkeleton />
            ) : (
              <>
                <ChartSection title={t('profile.chart.classification.title')}>
                  <ErrorBoundary title={errorTitle} description={errorDesc}>
                    <Suspense fallback={<Skeleton className="h-[360px] w-full" />}>
                      <ClassificationTreemap
                        data={result?.classification ?? []}
                        emptyTitle={partialTitle}
                        emptyDescription={partialDesc}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </ChartSection>

                <ChartSection title={t('profile.chart.gantt.title')}>
                  <ErrorBoundary title={errorTitle} description={errorDesc}>
                    <Suspense fallback={<Skeleton className="h-[320px] w-full" />}>
                      <BorrowGantt
                        data={result?.gantt ?? []}
                        emptyTitle={partialTitle}
                        emptyDescription={partialDesc}
                      />
                    </Suspense>
                  </ErrorBoundary>
                </ChartSection>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                  <ChartSection title={t('profile.chart.volume.title')}>
                    <ErrorBoundary title={errorTitle} description={errorDesc}>
                      <Suspense fallback={<Skeleton className="h-[260px] w-full" />}>
                        <BorrowVolumeBar
                          data={result?.borrowVolume ?? []}
                          displayTimezone={displayTimezone}
                          emptyTitle={partialTitle}
                          emptyDescription={partialDesc}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  </ChartSection>

                  <ChartSection title={t('profile.chart.duration.title')}>
                    <ErrorBoundary title={errorTitle} description={errorDesc}>
                      <Suspense fallback={<Skeleton className="h-[240px] w-full" />}>
                        <DurationDistribution
                          data={result?.durationDistribution ?? []}
                          summary={result?.summary ?? EMPTY_SUMMARY}
                          emptyTitle={partialTitle}
                          emptyDescription={partialDesc}
                        />
                      </Suspense>
                    </ErrorBoundary>
                  </ChartSection>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const EMPTY_SUMMARY = {
  totalBooks: 0,
  totalCycles: 0,
  inBorrow: 0,
  avgDurationDays: null as number | null,
  medianDurationDays: null as number | null,
}

function ChartSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="border-t border-border pt-4">
      <h2 className="mb-2 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}

const SummaryCards = memo(function SummaryCards({
  result,
  pending,
}: {
  result: ReturnType<typeof useProfileStats>['result']
  pending: boolean
}) {
  const { t } = useTranslation('pages')
  const s = result?.summary ?? EMPTY_SUMMARY
  const unit = t('profile.summary.days')
  const fmtDays = (v: number | null): string =>
    v === null ? '—' : `${v.toFixed(1)} ${unit}`
  const cards = [
    { label: t('profile.summary.totalBooks'), value: String(s.totalBooks) },
    { label: t('profile.summary.totalCycles'), value: String(s.totalCycles) },
    { label: t('profile.summary.inBorrow'), value: String(s.inBorrow) },
    { label: t('profile.summary.avgDuration'), value: fmtDays(s.avgDurationDays) },
  ]
  return (
    <div className="relative mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
      {pending && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
          <Progress value={50} className="w-32" />
        </div>
      )}
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">{c.label}</div>
          <div className="mt-1 font-heading text-xl tabular-nums">{c.value}</div>
        </div>
      ))}
    </div>
  )
})

function ProfileSkeleton() {
  return (
    <div className="mt-4 space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <Skeleton className="h-[360px] w-full" />
      <Skeleton className="h-[320px] w-full" />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Skeleton className="h-[260px] w-full" />
        <Skeleton className="h-[240px] w-full" />
      </div>
    </div>
  )
}
