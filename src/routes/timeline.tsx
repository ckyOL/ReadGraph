import { useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'

import { db } from '@/db/db-instance'
import { readPreferences } from '@/lib/preferences'
import { formatDateInTz } from '@/lib/display-time'
import { setBookIdsOf } from '@/lib/book-status'
import { volumeOfCycle } from '@/lib/volume'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import type { BorrowStatus } from '@/types/entities'

export const Route = createFileRoute('/timeline')({
  component: TimelinePage,
})

type StatusFilter = 'all' | BorrowStatus

function StatusBadge({ status }: { status: BorrowStatus }) {
  const { t } = useTranslation('pages')
  if (status === 'borrowed') {
    return (
      <Badge variant="secondary" className="border-primary/40">
        {t('timeline.status.borrowed')}
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="rounded-none">
      {t(`timeline.status.${status}`)}
    </Badge>
  )
}

function TimelinePage() {
  const { t } = useTranslation('pages')
  const data = useLiveQuery(
    () =>
      Promise.all([
        db.borrowCycles.toArray(),
        db.books.toArray(),
        db.sources.toArray(),
        db.catalogRecords.toArray(),
      ]),
    [],
  )

  const [sourceFilter, setSourceFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const loading = data === undefined
  const [borrowCycles, books, sources, catalogRecords] = data ?? [[], [], [], []]

  const displayTimezone = useMemo(() => readPreferences().displayTimezone, [])

  const bookById = useMemo(() => new Map(books.map((b) => [b.id, b])), [books])

  // 套装书（≥2 卷编目）id 集合与各借阅周期 → 卷号：题名后补卷号以区分套装各卷。
  const setBookIds = useMemo(() => setBookIdsOf(catalogRecords), [catalogRecords])
  const cycleVolumes = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of borrowCycles) {
      if (!setBookIds.has(c.bookId)) continue
      const v = volumeOfCycle(c, catalogRecords)
      if (v !== null) m.set(c.id, v)
    }
    return m
  }, [borrowCycles, setBookIds, catalogRecords])

  const cycles = useMemo(() => {
    let out = borrowCycles
    if (sourceFilter !== 'all') {
      out = out.filter((c) => c.sourceId === sourceFilter)
    }
    if (statusFilter !== 'all') {
      out = out.filter((c) => c.status === statusFilter)
    }
    return [...out].sort((a, b) => a.borrowedAt.getTime() - b.borrowedAt.getTime())
  }, [borrowCycles, sourceFilter, statusFilter])

  if (loading) return <div className="p-6" />

  return (
    <div className="flex flex-col p-6">
      <h1 className="text-2xl font-bold">{t('timeline.title')}</h1>
      <p className="text-muted-foreground">{t('timeline.subtitle')}</p>

      {borrowCycles.length === 0 ? (
        <Empty className="mt-8 min-h-[360px]">
          <EmptyHeader>
            <EmptyTitle>{t('timeline.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('timeline.empty.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/import">{t('timeline.empty.action')}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t('timeline.filter.source')}
              </span>
              <Select value={sourceFilter} onValueChange={setSourceFilter}>
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('timeline.filter.allSources')}</SelectItem>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t('timeline.filter.status')}
              </span>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('timeline.filter.allStatus')}</SelectItem>
                  <SelectItem value="borrowed">{t('timeline.status.borrowed')}</SelectItem>
                  <SelectItem value="returned">{t('timeline.status.returned')}</SelectItem>
                  <SelectItem value="unknown">{t('timeline.status.unknown')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* 竖向时间轴脊柱：上 → 下按 borrowedAt 递增。 */}
          <div className="mt-6">
            <div className="relative">
              <div className="absolute top-0 bottom-0 left-[19px] w-px bg-border" />
              <ol className="relative space-y-4">
                {cycles.map((c) => {
                  const book = bookById.get(c.bookId)
                  const vol = cycleVolumes.get(c.id)
                  const borrowed = formatDateInTz(c.borrowedAt, displayTimezone)
                  const returned = c.returnedAt
                    ? formatDateInTz(c.returnedAt, displayTimezone)
                    : null
                  return (
                    <li
                      key={c.id}
                      className="relative pl-12"
                      data-status={c.status}
                    >
                      <span
                        className={
                          c.status === 'borrowed'
                            ? 'absolute top-4 left-[19px] z-10 size-2.5 -translate-x-1/2 rounded-full bg-primary ring-4 ring-background'
                            : 'absolute top-4 left-[19px] z-10 size-2.5 -translate-x-1/2 rounded-full bg-muted-foreground ring-4 ring-background'
                        }
                      />
                      <div
                        className={
                          c.status === 'borrowed'
                            ? 'w-full rounded-none border border-primary/50 bg-primary/5 p-3'
                            : 'w-full rounded-none border border-border bg-card p-3'
                        }
                      >
                        {book ? (
                          <Link
                            to="/library/$bookId"
                            params={{ bookId: book.id }}
                            className="line-clamp-2 text-sm font-medium hover:underline"
                          >
                            {book.title}
                            {vol != null && (
                              <span className="text-muted-foreground"> · {vol}</span>
                            )}
                          </Link>
                        ) : (
                          <span className="line-clamp-2 text-sm text-muted-foreground">
                            {c.bookId}
                          </span>
                        )}
                        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                          {borrowed}
                          {returned ? ` → ${returned}` : ''}
                        </p>
                        <div className="mt-1.5">
                          <StatusBadge status={c.status} />
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
