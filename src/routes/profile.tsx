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
import { formatTimeZoneDisplay } from '@/lib/timezones'
import { useProfileStats } from '@/profile/use-profile-stats'
import { resolveSystem } from '@/lib/profile-stats'
import type { ProfileStatsResult } from '@/lib/profile-stats'
import type { ClassificationSystem } from '@/types/entities'
import { CLASSIFICATION_SYSTEMS } from '@/lib/classification'
import { formatCurrency } from '@/profile/money-format'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
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
const PriceDistribution = lazy(() =>
  import('@/profile/charts/PriceDistribution').then((m) => ({
    default: m.PriceDistribution,
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
  const { t, i18n } = useTranslation('pages')

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

  // 生效分类体系（与 computeProfileStats 内 resolveSystem 同源），treemap 下钻门控。
  const effectiveSystem = resolveSystem(classificationSystem, sources ?? [])

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
          {t('profile.toolbar.timezone')}:{' '}
          {formatTimeZoneDisplay(i18n.language, displayTimezone)}
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
          {/* M7 回归：MoneyCards 渲染 formatCurrency，非法币种等数据异常不得
              拖垮整页（图表区已有 ErrorBoundary，卡片区补齐）。 */}
          <ErrorBoundary title={errorTitle} description={errorDesc}>
            <MoneyCards
              result={result}
              rangeKey={rangeKey}
              pending={isPending || computing}
            />
          </ErrorBoundary>
          {/* 图表区 Tabs：每次激活一个图谱块，独占全幅视口，互不挤压（reading-profile §4）。 */}
          <Tabs defaultValue="classification" className="mt-4 gap-3">
            <TabsList className="overflow-x-auto">
              <TabsTrigger value="classification">
                {t('profile.chart.classification.title')}
              </TabsTrigger>
              <TabsTrigger value="gantt">
                {t('profile.chart.gantt.title')}
              </TabsTrigger>
              <TabsTrigger value="volume">
                {t('profile.chart.volume.title')}
              </TabsTrigger>
              <TabsTrigger value="duration">
                {t('profile.chart.duration.title')}
              </TabsTrigger>
              <TabsTrigger value="price">
                {t('profile.chart.price.title')}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="classification">
              {isPending || computing ? (
                <Skeleton className="h-[480px] w-full" />
              ) : (
                <ErrorBoundary title={errorTitle} description={errorDesc}>
                  <Suspense fallback={<Skeleton className="h-[480px] w-full" />}>
                    <ClassificationTreemap
                      data={result?.classification ?? []}
                      system={effectiveSystem}
                      emptyTitle={partialTitle}
                      emptyDescription={partialDesc}
                    />
                  </Suspense>
                </ErrorBoundary>
              )}
            </TabsContent>

            <TabsContent value="gantt">
              {isPending || computing ? (
                <Skeleton className="h-[624px] w-full" />
              ) : (
                <ErrorBoundary title={errorTitle} description={errorDesc}>
                  <Suspense fallback={<Skeleton className="h-[624px] w-full" />}>
                    <BorrowGantt
                      data={result?.gantt ?? []}
                      displayTimezone={displayTimezone}
                      emptyTitle={partialTitle}
                      emptyDescription={partialDesc}
                    />
                  </Suspense>
                </ErrorBoundary>
              )}
            </TabsContent>

            <TabsContent value="volume">
              {isPending || computing ? (
                <Skeleton className="h-[360px] w-full" />
              ) : (
                <ErrorBoundary title={errorTitle} description={errorDesc}>
                  <Suspense fallback={<Skeleton className="h-[360px] w-full" />}>
                    <BorrowVolumeBar
                      data={result?.borrowVolume ?? []}
                      emptyTitle={partialTitle}
                      emptyDescription={partialDesc}
                    />
                  </Suspense>
                </ErrorBoundary>
              )}
            </TabsContent>

            <TabsContent value="duration">
              {isPending || computing ? (
                <Skeleton className="h-[360px] w-full" />
              ) : (
                <ErrorBoundary title={errorTitle} description={errorDesc}>
                  <Suspense fallback={<Skeleton className="h-[360px] w-full" />}>
                    <DurationDistribution
                      data={result?.durationDistribution ?? []}
                      summary={result?.summary ?? EMPTY_SUMMARY}
                      emptyTitle={partialTitle}
                      emptyDescription={partialDesc}
                    />
                  </Suspense>
                </ErrorBoundary>
              )}
            </TabsContent>

            <TabsContent value="price">
              {isPending || computing ? (
                <Skeleton className="h-[360px] w-full" />
              ) : (
                <ErrorBoundary title={errorTitle} description={errorDesc}>
                  <Suspense fallback={<Skeleton className="h-[360px] w-full" />}>
                    <PriceDistribution
                      data={result?.money.distribution ?? []}
                      currency={result?.money.dominantCurrency ?? null}
                      emptyTitle={partialTitle}
                      emptyDescription={partialDesc}
                    />
                  </Suspense>
                </ErrorBoundary>
              )}
            </TabsContent>
          </Tabs>
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

// 价值统计卡行（reading-profile §2.5/§4）：馆藏总价值 / 借阅图书价值 /
// 平均书价。头条取主导币种；借阅价值随 range 联动（副标签标注当前 range）；
// 多币种时脚注列出其余币种；全库无定价 → 全部 `—`。
const MoneyCards = memo(function MoneyCards({
  result,
  rangeKey,
  pending,
}: {
  result: ProfileStatsResult | null
  rangeKey: RangeKey
  pending: boolean
}) {
  const { t, i18n } = useTranslation('pages')
  const m = result?.money
  const dominant = m?.dominantCurrency ?? null
  const byCurrency = (arr: MoneyAmountArr) =>
    dominant ? arr.find((a) => a.currency === dominant) : undefined
  const fmt = (a: MoneyAmount | undefined): string =>
    a ? formatCurrency(a.amount, a.currency, i18n.language) : '—'
  const others =
    m != null && m.multiCurrency && dominant
      ? m.collectionValue.filter((a) => a.currency !== dominant)
      : []
  const cards = [
    {
      label: t('profile.money.collectionValue'),
      sub: null as string | null,
      value: fmt(byCurrency(m?.collectionValue ?? [])),
    },
    {
      label: t('profile.money.borrowedValue'),
      sub: t(`profile.toolbar.range.${rangeKey}`),
      value: fmt(byCurrency(m?.borrowedValue ?? [])),
    },
    {
      label: t('profile.money.avgPrice'),
      sub: null as string | null,
      value: fmt(byCurrency(m?.avgPrice ?? [])),
    },
  ]
  return (
    <div className="relative mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
      {pending && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
          <Progress value={50} className="w-32" />
        </div>
      )}
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-border p-3">
          <div className="text-xs text-muted-foreground">
            {c.label}
            {c.sub && (
              <span className="ml-1.5 text-muted-foreground/70">{c.sub}</span>
            )}
          </div>
          <div className="mt-1 font-heading text-xl tabular-nums">{c.value}</div>
        </div>
      ))}
      {others.length > 0 && (
        <div className="col-span-full text-xs text-muted-foreground">
          {t('profile.money.otherCurrencies', {
            list: others
              .map((a) => formatCurrency(a.amount, a.currency, i18n.language))
              .join(' · '),
          })}
        </div>
      )}
    </div>
  )
})

type MoneyAmount = ProfileStatsResult['money']['collectionValue'][number]
type MoneyAmountArr = ProfileStatsResult['money']['collectionValue']

function ProfileSkeleton() {
  return (
    <div className="mt-4 space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
      {/* tab 栏 + 当前 tab 视口（与 Tabs 布局对齐）。 */}
      <Skeleton className="h-8 w-full max-w-md" />
      <Skeleton className="h-[480px] w-full" />
    </div>
  )
}
