import { useMemo, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { z } from 'zod'

import { db } from '@/db/db-instance'
import { readPreferences } from '@/lib/preferences'
import { formatDateInTz } from '@/lib/display-time'
import { CatalogRecordCard } from '@/components/catalog-record'
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
import type { BorrowCycle } from '@/types/entities'

const bookIdSchema = z.string().min(1)

export const Route = createFileRoute('/library/$bookId')({
  // $bookId 走 z.string() 校验 loader 入参（ui-navigation §2）；非法 id 路由不匹配。
  parseParams: (raw) => {
    const parsed = bookIdSchema.safeParse(raw.bookId)
    return parsed.success ? { bookId: parsed.data } : false
  },
  component: BookDetailPage,
})

function BookDetailPage() {
  const { t } = useTranslation('pages')
  const { bookId } = Route.useParams()
  const displayTimezone = useMemo(() => readPreferences().displayTimezone, [])

  const data = useLiveQuery(
    () =>
      Promise.all([
        db.books.get(bookId),
        db.catalogRecords.where('bookId').equals(bookId).toArray(),
        db.borrowCycles.where('bookId').equals(bookId).toArray(),
        db.sources.toArray(),
      ]),
    [bookId],
  )

  const loading = data === undefined
  const [book, catalogRecords, borrowCycles, sources] = data ?? [
    undefined,
    [],
    [],
    [],
  ]

  const sourceById = useMemo(
    () => new Map(sources.map((s) => [s.id, s])),
    [sources],
  )

  const sortedCycles = useMemo(
    () =>
      [...borrowCycles].sort(
        (a, b) => b.borrowedAt.getTime() - a.borrowedAt.getTime(),
      ),
    [borrowCycles],
  )

  if (loading) return <div className="p-6" />

  if (!book) {
    return (
      <div className="p-6">
        <Empty className="mt-8 min-h-[360px]">
          <EmptyHeader>
            <EmptyTitle>{t('bookDetail.notFound.title')}</EmptyTitle>
            <EmptyDescription>{t('bookDetail.notFound.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild variant="outline">
              <Link to="/library">{t('bookDetail.notFound.back')}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    )
  }

  const metaField = (label: string, value: ReactNode) =>
    value == null || value === '' ? null : (
      <div className="flex gap-2 text-sm">
        <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
        <span className="min-w-0">{value}</span>
      </div>
    )

  // 旧导出/夹具中 publishDate 可能被 revive 为 Date（e2e-seed DATE_KEYS）；统一归一为字符串。
  const publishDateRaw = book.publishDate
  const publishDate =
    publishDateRaw != null && typeof publishDateRaw === 'object'
      ? formatDateInTz(publishDateRaw as Date, 'UTC')
      : publishDateRaw

  return (
    <div className="flex flex-col p-6">
      <h1 className="text-2xl font-bold">{book.title}</h1>
      {book.authors.length > 0 && (
        <p className="text-muted-foreground">{book.authors.join(' / ')}</p>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('bookDetail.metadata.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {book.subtitle && (
              <p className="text-sm text-muted-foreground">{book.subtitle}</p>
            )}
            {metaField(t('bookDetail.field.isbn'), book.isbn13 && (
              <span className="font-mono">{book.isbn13}</span>
            ))}
            {metaField(t('bookDetail.field.publisher'), book.publisher)}
            {metaField(t('bookDetail.field.publishDate'), publishDate)}
            {metaField(t('bookDetail.field.pages'), book.pages != null && `${book.pages}`)}
            {metaField(
              t('bookDetail.field.price'),
              book.price && `${book.price.amount} ${book.price.currency}`,
            )}
            {book.parallelTitles.length > 0 &&
              metaField(t('bookDetail.field.parallelTitles'), book.parallelTitles.join(' / '))}
            {book.subjects.length > 0 &&
              metaField(t('bookDetail.field.subjects'), book.subjects.join(' / '))}
            {book.needsReview && (
              <Badge variant="destructive">{t('library.needsReview')}</Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('bookDetail.records.title')}</CardTitle>
            {catalogRecords.length === 0 && (
              <CardDescription>{t('bookDetail.records.empty')}</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {catalogRecords.length > 0 && (
              <ul className="space-y-3">
                {catalogRecords.map((cr) => (
                  <li key={cr.id}>
                    <CatalogRecordCard
                      record={cr}
                      source={sourceById.get(cr.sourceId)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>{t('bookDetail.cycles.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedCycles.length === 0 ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : (
            <ul className="divide-y">
              {sortedCycles.map((c: BorrowCycle) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className="tabular-nums">
                    {formatDateInTz(c.borrowedAt, displayTimezone)}
                  </span>
                  <span className="text-muted-foreground">→</span>
                  <span className="tabular-nums">
                    {c.returnedAt
                      ? formatDateInTz(c.returnedAt, displayTimezone)
                      : '—'}
                  </span>
                  {c.barcode && <span className="font-mono text-xs">{c.barcode}</span>}
                  {c.status === 'borrowed' && (
                    <Badge variant="secondary">{t('timeline.status.borrowed')}</Badge>
                  )}
                  {c.status === 'returned' && (
                    <Badge variant="outline" className="rounded-none">
                      {t('timeline.status.returned')}
                    </Badge>
                  )}
                  {c.status === 'unknown' && (
                    <Badge variant="outline" className="rounded-none">
                      {t('timeline.status.unknown')}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
