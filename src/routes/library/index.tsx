import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from 'lucide-react'

import { db } from '@/db/db-instance'
import { ClassificationBadge } from '@/components/classification-badge'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import type { Book } from '@/types/entities'
import { readPreferences } from '@/lib/preferences'
import { formatDateInTz } from '@/lib/display-time'
import {
  filterBookByReviewType,
  reviewBadgeOf,
  type ReviewTypeFilter,
} from '@/lib/book-status'
import {
  collectCandidates,
  countPlaceholderExcluded,
  type EnrichSuccess,
} from '@/enrich/enrich-service'
import { setPendingEnrichment } from '@/enrich/enrich-session'
import { EnrichBatchPanel } from '@/components/enrich-batch'

// 书库筛选/排序状态 URL 化（ui-navigation §3）：全 optional + Zod 校验，默认值不写 URL
// （干净的 /library）；变更经 navigate replace 回写，不产生历史条目，返回/刷新/直达均保留筛选。
const librarySearchSchema = z.object({
  q: z.string().optional(),
  source: z.string().optional(),
  status: z.enum(['needsReview', 'placeholder', 'set']).optional(),
  sort: z.enum(['title', 'author', 'isbn', 'borrowed', 'borrows']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
})

export const Route = createFileRoute('/library/')({
  validateSearch: librarySearchSchema,
  component: LibraryPage,
})

type SortKey = 'title' | 'author' | 'isbn' | 'borrowed' | 'borrows'
type SortDir = 'asc' | 'desc'

interface LibraryRow {
  book: Book
  authors: string
  isbn13: string | null
  sourceName: string | null
  classification: { system: 'clc' | 'ddc' | 'lcc' | 'udc' | 'other'; code: string } | null
  borrowCount: number
  lastBorrowedAt: Date | null
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(id)
  }, [value, delayMs])
  return debounced
}

function LibraryPage() {
  const { t } = useTranslation('pages')
  const data = useLiveQuery(
    () =>
      Promise.all([
        db.books.toArray(),
        db.catalogRecords.toArray(),
        db.borrowCycles.toArray(),
        db.sources.toArray(),
      ]),
    [],
  )

  // 筛选/排序状态由 URL search 驱动（useState 组件卸载即丢；URL 化后返回详情页时筛选原样恢复）。
  const searchParams = Route.useSearch()
  const navigate = Route.useNavigate()

  const sourceFilter = searchParams.source ?? 'all'
  const reviewFilter: ReviewTypeFilter = searchParams.status ?? 'all'
  const sortKey: SortKey = searchParams.sort ?? 'title'
  const sortDir: SortDir = searchParams.dir ?? 'asc'

  // 搜索框本地输入态：过滤即时生效（乐观更新），防抖（200ms）写 URL；
  // 外部导航（返回/前进/直达）同步回输入框。
  const [searchInput, setSearchInput] = useState(searchParams.q ?? '')
  const debouncedQ = useDebouncedValue(searchInput, 200)

  useEffect(() => {
    const next = debouncedQ || undefined
    if (next !== searchParams.q) {
      void navigate({ search: (prev) => ({ ...prev, q: next }), replace: true })
    }
  }, [debouncedQ, searchParams.q, navigate])

  useEffect(() => {
    setSearchInput(searchParams.q ?? '')
  }, [searchParams.q])

  // 筛选/排序变更统一 replace 回写（不产生历史条目；值为 undefined 的键从 URL 删除）。
  const patchSearch = (updates: {
    source?: string
    status?: Exclude<ReviewTypeFilter, 'all'>
    sort?: SortKey
    dir?: SortDir
  }) => void navigate({ search: (prev) => ({ ...prev, ...updates }), replace: true })

  const loading = data === undefined
  const [books, catalogRecords, borrowCycles, sources] = data ?? [[], [], [], []]
  const displayTimezone = useMemo(() => readPreferences().displayTimezone, [])

  // —— OPAC 补全批量入口（opac-enrichment §7/§10） ——
  const enrichCandidates = useMemo(
    () => collectCandidates(books, catalogRecords, sources),
    [books, catalogRecords, sources],
  )
  const placeholderExcluded = useMemo(
    () => countPlaceholderExcluded(books, catalogRecords, sources),
    [books, catalogRecords, sources],
  )
  // 应用成功项：建议改动上下文写入会话内存 → 该书编辑 Dialog（详情页消费，不落 URL）。
  const applyEnrichment = (success: EnrichSuccess) => {
    setPendingEnrichment(success.context)
    void navigate({
      to: '/library/$bookId',
      params: { bookId: success.book.id },
      search: { edit: true },
    })
  }

  const rows = useMemo<LibraryRow[]>(() => {
    const sourceById = new Map(sources.map((s) => [s.id, s]))
    const cycleCountByBook = new Map<string, number>()
    const lastBorrowedByBook = new Map<string, Date>()
    for (const c of borrowCycles) {
      cycleCountByBook.set(c.bookId, (cycleCountByBook.get(c.bookId) ?? 0) + 1)
      const prev = lastBorrowedByBook.get(c.bookId)
      if (!prev || c.borrowedAt > prev) lastBorrowedByBook.set(c.bookId, c.borrowedAt)
    }
    return books.map((book) => {
      const cr = catalogRecords.find((c) => c.bookId === book.id)
      const source = cr ? sourceById.get(cr.sourceId) : sourceById.get(book.sourceIds[0] ?? '')
      const entry = cr?.classifications[0] ?? null
      return {
        book,
        authors: book.authors.join(' / '),
        isbn13: book.isbn13,
        sourceName: source?.name ?? null,
        classification: entry ? { system: entry.system, code: entry.code } : null,
        borrowCount: cycleCountByBook.get(book.id) ?? 0,
        lastBorrowedAt: lastBorrowedByBook.get(book.id) ?? null,
      }
    })
  }, [books, catalogRecords, borrowCycles, sources])

  const filtered = useMemo(() => {
    const needle = searchInput.trim().toLowerCase()
    let out = rows
    if (needle) {
      out = out.filter(
        (r) =>
          r.book.title.toLowerCase().includes(needle) ||
          r.authors.toLowerCase().includes(needle) ||
          (r.isbn13 ?? '').toLowerCase().includes(needle),
      )
    }
    if (sourceFilter !== 'all') {
      out = out.filter((r) => r.book.sourceIds.includes(sourceFilter))
    }
    if (reviewFilter !== 'all') {
      out = out.filter((r) => filterBookByReviewType(r.book, reviewFilter))
    }
    const dir = sortDir === 'asc' ? 1 : -1
    return [...out].sort((a, b) => {
      switch (sortKey) {
        case 'author':
          return collator.compare(a.authors, b.authors) * dir
        case 'isbn':
          return (a.isbn13 ?? '').localeCompare(b.isbn13 ?? '') * dir
        case 'borrowed': {
          // 无借阅记录恒排末尾，不随排序方向翻转
          if (!a.lastBorrowedAt && !b.lastBorrowedAt) return 0
          if (!a.lastBorrowedAt) return 1
          if (!b.lastBorrowedAt) return -1
          return (a.lastBorrowedAt.getTime() - b.lastBorrowedAt.getTime()) * dir
        }
        case 'borrows':
          return (a.borrowCount - b.borrowCount) * dir
        default:
          return collator.compare(a.book.title, b.book.title) * dir
      }
    })
  }, [rows, searchInput, sourceFilter, reviewFilter, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      patchSearch({ dir: sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      patchSearch({ sort: key, dir: undefined })
    }
  }

  const sortButton = (key: SortKey, label: string) => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className="inline-flex items-center gap-1 hover:text-foreground"
      aria-label={label}
    >
      {label}
      {sortKey === key &&
        (sortDir === 'asc' ? (
          <ArrowUpIcon className="size-3" />
        ) : (
          <ArrowDownIcon className="size-3" />
        ))}
    </button>
  )

  if (loading) return <div className="p-6" />

  return (
    <div className="flex flex-col p-6">
      <h1 className="text-2xl font-bold">{t('library.title')}</h1>
      <p className="text-muted-foreground">{t('library.subtitle')}</p>

      {rows.length === 0 ? (
        <Empty className="mt-8 min-h-[360px]">
          <EmptyHeader>
            <EmptyTitle>{t('library.empty.title')}</EmptyTitle>
            <EmptyDescription>{t('library.empty.description')}</EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button asChild>
              <Link to="/import">{t('library.empty.action')}</Link>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="relative w-64">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder={t('library.search.placeholder')}
                className="pl-8"
                aria-label={t('library.search.placeholder')}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">
                {t('library.filter.source')}
              </span>
              <Select
                value={sourceFilter}
                onValueChange={(v) => patchSearch({ source: v === 'all' ? undefined : v })}
              >
                <SelectTrigger className="h-8 w-44 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('library.filter.allSources')}</SelectItem>
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
                {t('library.filter.status')}
              </span>
              <Select
                value={reviewFilter}
                onValueChange={(v) =>
                  patchSearch({
                    status: v === 'all' ? undefined : (v as Exclude<ReviewTypeFilter, 'all'>),
                  })
                }
              >
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('library.filter.allStatus')}</SelectItem>
                  <SelectItem value="needsReview">
                    {t('library.filter.needsReview')}
                  </SelectItem>
                  <SelectItem value="placeholder">
                    {t('library.filter.placeholder')}
                  </SelectItem>
                  <SelectItem value="set">{t('library.filter.set')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {enrichCandidates.length > 0 && (
            <div className="mt-4">
              <EnrichBatchPanel
                candidates={enrichCandidates}
                placeholderExcluded={placeholderExcluded}
                onApply={applyEnrichment}
              />
            </div>
          )}

          <Table className="mt-4">
            <TableHeader>
              <TableRow>
                <TableHead>{sortButton('title', t('library.column.title'))}</TableHead>
                <TableHead className="hidden md:table-cell">
                  {sortButton('author', t('library.column.author'))}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {sortButton('isbn', t('library.column.isbn'))}
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  {t('library.column.source')}
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  {sortButton('borrowed', t('library.column.borrowed'))}
                </TableHead>
                <TableHead className="hidden sm:table-cell">
                  {t('library.column.classification')}
                </TableHead>
                <TableHead className="text-right">
                  {sortButton('borrows', t('library.column.borrows'))}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const badge = reviewBadgeOf(r.book, r.book.id, catalogRecords)
                return (
                  <TableRow key={r.book.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Link
                          to="/library/$bookId"
                          params={{ bookId: r.book.id }}
                          className="min-w-0 truncate hover:underline"
                        >
                          {r.book.title}
                        </Link>
                        {badge && (
                          <Link
                            to="/library/$bookId"
                            params={{ bookId: r.book.id }}
                            search={{ edit: true }}
                            aria-label={`${badge === 'placeholder' ? t('library.badge.placeholder') : t('library.set')} ${r.book.title}`}
                          >
                            <Badge
                              variant={badge === 'placeholder' ? 'destructive' : 'outline'}
                            >
                              {badge === 'placeholder'
                                ? t('library.badge.placeholder')
                                : t('library.set')}
                            </Badge>
                          </Link>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="text-muted-foreground">{r.authors}</span>
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">
                      {r.isbn13 ?? '—'}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {r.sourceName ? (
                        <Badge variant="outline" className="rounded-none">
                          {r.sourceName}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="tabular-nums text-muted-foreground">
                        {r.lastBorrowedAt
                          ? formatDateInTz(r.lastBorrowedAt, displayTimezone)
                          : '—'}
                      </span>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {r.classification ? (
                        <ClassificationBadge
                          system={r.classification.system}
                          code={r.classification.code}
                        />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.borrowCount}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {filtered.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">—</p>
          )}
        </>
      )}
    </div>
  )
}
