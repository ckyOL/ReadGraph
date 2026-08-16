import { useEffect, useMemo, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { ArrowDownIcon, ArrowUpIcon, SearchIcon } from 'lucide-react'

import { db } from '@/db/db-instance'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { readPreferences } from '@/lib/preferences'
import { reviewBadgeOf, type ReviewTypeFilter } from '@/lib/book-status'
import {
  buildLibraryRows,
  filterAndSortRows,
  type SortDir,
  type SortKey,
} from '@/lib/library-view'
import { LibraryCardView, LibraryRowView } from './-list-items'

// 书库筛选/排序状态 URL 化（ui-navigation §3）：全 optional + Zod 校验，默认值不写 URL
// （干净的 /library）；变更经 navigate replace 回写，不产生历史条目，返回/刷新/直达均保留筛选。
// 视图参数同时供详情页（/library/$bookId）翻页延续——行链接携带，见 viewSearch()。
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

  // 行派生 + 过滤/排序：与详情页翻页共用 library-view 单一实现（opac-enrichment §10）。
  const rows = useMemo(
    () => buildLibraryRows(books, catalogRecords, borrowCycles, sources),
    [books, catalogRecords, borrowCycles, sources],
  )
  const filtered = useMemo(
    () =>
      filterAndSortRows(rows, {
        q: searchInput,
        source: sourceFilter,
        status: reviewFilter,
        sort: sortKey,
        dir: sortDir,
      }),
    [rows, searchInput, sourceFilter, reviewFilter, sortKey, sortDir],
  )

  /** 当前视图参数（非默认值才写 URL）——行链接携带，详情页翻页延续同一视图。
   *  q 取实时输入态：URL 态有 200ms 防抖，快速点行时 URL 尚未写入，
   *  带旧 q 会让详情页翻页基于旧过滤、返回列表丢输入（L1 回归）。 */
  const viewSearch = () => ({
    q: searchInput,
    source: sourceFilter !== 'all' ? sourceFilter : undefined,
    status: reviewFilter !== 'all' ? reviewFilter : undefined,
    sort: sortKey !== 'title' ? sortKey : undefined,
    dir: sortDir !== 'asc' ? sortDir : undefined,
  })

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
      className="-my-0.5 inline-flex items-center gap-1 py-0.5 hover:text-foreground"
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
                <SelectTrigger className="h-8 w-44 text-xs" aria-label={t('library.filter.source')}>
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
                <SelectTrigger className="h-8 w-36 text-xs" aria-label={t('library.filter.status')}>
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
            {/* 工具栏排序组件（平板/移动呈现的排序入口；桌面表格用表头排序，ui-navigation §3）。
                与表头共享同一 sort/dir URL 状态，选中即重排；方向按钮常显不位移（GitLab Sorting 模式）。 */}
            <div className="flex items-center gap-1.5 lg:hidden">
              <span className="text-xs text-muted-foreground">
                {t('library.sort.label')}
              </span>
              <Select
                value={sortKey}
                onValueChange={(v) => patchSearch({ sort: v as SortKey, dir: undefined })}
              >
                <SelectTrigger className="h-8 w-32 text-xs" aria-label={t('library.sort.label')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="title">{t('library.column.title')}</SelectItem>
                  <SelectItem value="author">{t('library.column.author')}</SelectItem>
                  <SelectItem value="isbn">{t('library.column.isbn')}</SelectItem>
                  <SelectItem value="borrowed">{t('library.column.borrowed')}</SelectItem>
                  <SelectItem value="borrows">{t('library.column.borrows')}</SelectItem>
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-8"
                onClick={() => toggleSort(sortKey)}
                aria-label={
                  sortDir === 'asc'
                    ? t('library.sort.ascending')
                    : t('library.sort.descending')
                }
                aria-pressed={sortDir === 'asc'}
              >
                {sortDir === 'asc' ? (
                  <ArrowUpIcon className="size-3.5" />
                ) : (
                  <ArrowDownIcon className="size-3.5" />
                )}
              </Button>
            </div>
          </div>

          {/* 桌面表格（≥1024px，ui-navigation §3）：table-fixed 显式列宽防长文本驱动漂移；
              书名列 sticky left 冻结（横向滚动锚点不丢，不透明背景防透字）。
              data-slot 供 E2E 按容器限定断言——卡片网格与表格同挂 DOM（CSS 断点切换）。 */}
          <div className="hidden lg:block" data-slot="library-table">
            <Table className="mt-4 table-fixed">
              <TableHeader>
                <TableRow>
                  {/* aria-sort：可排序列声明当前方向（L11 a11y）。 */}
                  <TableHead
                    className="sticky left-0 z-10 w-[28%] bg-background"
                    aria-sort={sortKey === 'title' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                  >
                    {sortButton('title', t('library.column.title'))}
                  </TableHead>
                  <TableHead className="w-[16%]" aria-sort={sortKey === 'author' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {sortButton('author', t('library.column.author'))}
                  </TableHead>
                  <TableHead className="w-[140px]" aria-sort={sortKey === 'isbn' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {sortButton('isbn', t('library.column.isbn'))}
                  </TableHead>
                  <TableHead className="w-[120px]">
                    {t('library.column.source')}
                  </TableHead>
                  <TableHead className="w-[120px]" aria-sort={sortKey === 'borrowed' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {sortButton('borrowed', t('library.column.borrowed'))}
                  </TableHead>
                  <TableHead className="w-[22%]">
                    {t('library.column.classification')}
                  </TableHead>
                  <TableHead className="w-[64px] text-right" aria-sort={sortKey === 'borrows' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
                    {sortButton('borrows', t('library.column.borrows'))}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <LibraryRowView
                    key={r.book.id}
                    row={r}
                    badge={reviewBadgeOf(r.book, r.book.id, catalogRecords)}
                    viewSearch={viewSearch()}
                    displayTimezone={displayTimezone}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          {/* 卡片网格（平板 2 列 / 移动 1 列，<1024px，ui-navigation §3）：信息完整、无隐藏列、
              无横向滚动；与表格共享同一 filtered/排序状态。
              data-slot 供 E2E 按容器限定断言（375px 移动端用例锁定本视图）。 */}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden" data-slot="library-cards">
            {filtered.map((r) => (
              <LibraryCardView
                key={r.book.id}
                row={r}
                badge={reviewBadgeOf(r.book, r.book.id, catalogRecords)}
                viewSearch={viewSearch()}
                displayTimezone={displayTimezone}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              {t('library.filter.noResults')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
