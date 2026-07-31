import { useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '@/db/db-instance'
import { readPreferences } from '@/lib/preferences'
import { formatDateInTz } from '@/lib/display-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'

export const Route = createFileRoute('/')({
  component: DashboardPage,
})

const RECENT_LIMIT = 5

/** 概览统计卡片（data-stat 供 E2E 定位，ui-navigation §3.1）。 */
function StatCard({
  stat,
  label,
  value,
}: {
  stat: string
  label: string
  value: string | number
}) {
  return (
    <Card data-stat={stat}>
      <CardHeader>
        <CardTitle className="text-2xl font-bold tabular-nums">{value}</CardTitle>
        <CardDescription>{label}</CardDescription>
      </CardHeader>
    </Card>
  )
}

function DashboardPage() {
  const { t } = useTranslation('pages')
  const data = useLiveQuery(
    () =>
      Promise.all([
        db.books.toArray(),
        db.borrowCycles.toArray(),
        db.importLogs.toArray(),
      ]),
    [],
  )
  const displayTimezone = useMemo(() => readPreferences().displayTimezone, [])

  const loading = data === undefined
  const [books, borrowCycles, importLogs] = data ?? [[], [], []]

  const isEmpty = books.length === 0 && borrowCycles.length === 0
  const inBorrow = borrowCycles.filter((c) => c.status === 'borrowed').length

  const lastImport = useMemo(() => {
    const sorted = [...importLogs].sort((a, b) => b.importedAt.getTime() - a.importedAt.getTime())
    return sorted[0] ?? null
  }, [importLogs])

  const recent = useMemo(() => {
    const bookById = new Map(books.map((b) => [b.id, b]))
    return [...borrowCycles]
      .sort((a, b) => b.borrowedAt.getTime() - a.borrowedAt.getTime())
      .slice(0, RECENT_LIMIT)
      .map((c) => ({ cycle: c, book: bookById.get(c.bookId) }))
  }, [books, borrowCycles])

  if (loading) return <div className="p-6" />

  return (
    <div className="flex flex-col p-6">
      <h1 className="text-2xl font-bold">{t('dashboard.title')}</h1>
      <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>

      {isEmpty ? (
        <Empty className="mt-8 min-h-[360px]">
          <EmptyHeader>
            <EmptyTitle>{t('dashboard.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('dashboard.empty.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/import">{t('dashboard.empty.action')}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
            <StatCard stat="books" label={t('dashboard.stats.books')} value={books.length} />
            <StatCard
              stat="cycles"
              label={t('dashboard.stats.cycles')}
              value={borrowCycles.length}
            />
            <StatCard stat="inBorrow" label={t('dashboard.stats.inBorrow')} value={inBorrow} />
            <StatCard
              stat="lastImport"
              label={t('dashboard.stats.lastImport')}
              value={lastImport ? formatDateInTz(lastImport.importedAt, displayTimezone) : '—'}
            />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('dashboard.recent.title')}</CardTitle>
              </CardHeader>
              <CardContent>
                {recent.length === 0 ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : (
                  <ul className="divide-y">
                    {recent.map(({ cycle, book }) => (
                      <li key={cycle.id} className="flex items-center gap-3 py-2">
                        {book ? (
                          <Link
                            to="/library/$bookId"
                            params={{ bookId: book.id }}
                            className="min-w-0 flex-1 truncate hover:underline"
                          >
                            {book.title}
                          </Link>
                        ) : (
                          <span className="min-w-0 flex-1 truncate text-muted-foreground">
                            {cycle.bookId}
                          </span>
                        )}
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {formatDateInTz(cycle.borrowedAt, displayTimezone)}
                        </span>
                        {cycle.status === 'borrowed' && (
                          <Badge variant="secondary">{t('timeline.status.borrowed')}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('dashboard.quick.title')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <Button asChild>
                  <Link to="/import">{t('import.title')}</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link to="/library">{t('dashboard.quick.library')}</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
