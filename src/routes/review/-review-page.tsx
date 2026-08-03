// 待审书目页组件（review 规格 §3/§4）。聚合选书帮占位与套装候选两类人工审核：
// 列表（Tabs 分流 + 搜索 + 类型徽标）→ 行「审核」打开对应 Sheet。
// 独立于路由文件（src/routes/review.tsx 只导出 Route，组件走 autoCodeSplitting
// 懒加载 chunk；本文件不导出 Route，不会被 tanstack router 当作路由）。
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { SearchIcon } from 'lucide-react'

import { db } from '@/db/db-instance'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { buildReviewRows, filterReviewRows, type ReviewRow } from '@/lib/review'
import { readPreferences } from '@/lib/preferences'
import { formatDateInTz } from '@/lib/display-time'
import { PlaceholderSheet } from './-placeholder-sheet'
import { SetSheet } from './-set-sheet'

type ReviewTab = 'all' | 'placeholder' | 'set'

export function ReviewPage() {
  const { t } = useTranslation('review')
  const data = useLiveQuery(
    () =>
      Promise.all([
        db.books.toArray(),
        db.catalogRecords.toArray(),
        db.borrowCycles.toArray(),
        db.rawRecords.toArray(),
        db.sources.toArray(),
      ]),
    [],
  )

  const [tab, setTab] = useState<ReviewTab>('all')
  const [search, setSearch] = useState('')
  const [reviewing, setReviewing] = useState<ReviewRow | null>(null)

  const loading = data === undefined
  const [books, catalogRecords, borrowCycles, rawRecords, sources] =
    data ?? [[], [], [], [], []]
  const displayTimezone = useMemo(() => readPreferences().displayTimezone, [])

  const rows = useMemo(
    () => buildReviewRows(books, catalogRecords, borrowCycles),
    [books, catalogRecords, borrowCycles],
  )

  const crsByBook = useMemo(() => {
    const m = new Map<string, typeof catalogRecords>()
    for (const cr of catalogRecords) {
      const arr = m.get(cr.bookId) ?? []
      arr.push(cr)
      m.set(cr.bookId, arr)
    }
    return m
  }, [catalogRecords])
  const cyclesByBook = useMemo(() => {
    const m = new Map<string, typeof borrowCycles>()
    for (const c of borrowCycles) {
      const arr = m.get(c.bookId) ?? []
      arr.push(c)
      m.set(c.bookId, arr)
    }
    return m
  }, [borrowCycles])

  const filtered = useMemo(
    () => filterReviewRows(rows, tab, search),
    [rows, tab, search],
  )

  if (loading) return <div className="p-6" />

  return (
    <div className="flex flex-col p-6">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('subtitle')}</p>

      {rows.length === 0 ? (
        <Empty className="mt-8 min-h-[360px]">
          <EmptyHeader>
            <EmptyTitle>{t('empty.title')}</EmptyTitle>
            <EmptyDescription>{t('empty.description')}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Tabs value={tab} onValueChange={(v) => setTab(v as ReviewTab)}>
              <TabsList variant="line">
                <TabsTrigger value="all">{t('tabs.all')}</TabsTrigger>
                <TabsTrigger value="placeholder">{t('tabs.placeholder')}</TabsTrigger>
                <TabsTrigger value="set">{t('tabs.set')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="relative w-64">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('search.placeholder')}
                className="pl-8"
                aria-label={t('search.placeholder')}
              />
            </div>
          </div>

          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>{t('column.title')}</TableHead>
                <TableHead>{t('column.kind')}</TableHead>
                <TableHead className="hidden lg:table-cell">
                  {t('column.isbn')}
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  {t('column.catalogs')}
                </TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t('column.borrows')}
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  {t('column.borrowed')}
                </TableHead>
                <TableHead className="text-right">{t('column.action')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => (
                <TableRow key={r.book.id}>
                  <TableCell>
                    <span className="block max-w-64 truncate">{r.book.title}</span>
                  </TableCell>
                  <TableCell>
                    {r.kind === 'placeholder' ? (
                      <Badge variant="destructive">{t('kind.placeholder')}</Badge>
                    ) : (
                      <Badge variant="outline">{t('kind.set')}</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs lg:table-cell">
                    {r.book.isbn13 ?? '—'}
                  </TableCell>
                  <TableCell className="hidden tabular-nums md:table-cell">
                    {r.catalogCount}
                  </TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">
                    {r.borrowCount}
                  </TableCell>
                  <TableCell className="hidden tabular-nums text-muted-foreground md:table-cell">
                    {r.lastBorrowedAt
                      ? formatDateInTz(r.lastBorrowedAt, displayTimezone)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => setReviewing(r)}>
                      {t('action.review')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filtered.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              {t('empty.title')}
            </p>
          )}
        </>
      )}

      {reviewing?.kind === 'placeholder' && (
        <PlaceholderSheet
          book={reviewing.book}
          catalogRecords={crsByBook.get(reviewing.book.id) ?? []}
          borrowCycles={cyclesByBook.get(reviewing.book.id) ?? []}
          sources={sources}
          displayTimezone={displayTimezone}
          onDone={() => setReviewing(null)}
        />
      )}
      {reviewing?.kind === 'set' && (
        <SetSheet
          book={reviewing.book}
          catalogRecords={crsByBook.get(reviewing.book.id) ?? []}
          rawRecords={rawRecords}
          borrowCycles={cyclesByBook.get(reviewing.book.id) ?? []}
          sources={sources}
          onDone={() => setReviewing(null)}
        />
      )}
    </div>
  )
}
