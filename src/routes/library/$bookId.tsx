import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react'
import { z } from 'zod'

import { db } from '@/db/db-instance'
import { bookSchema, catalogRecordSchema } from '@/db/schemas'
import { readPreferences } from '@/lib/preferences'
import { formatDateInTz } from '@/lib/display-time'
import { reviewKindOf } from '@/lib/book-status'
import { parseTitle } from '@/lib/title'
import { buildLibraryRows, filterAndSortRows, adjacentBookIds } from '@/lib/library-view'
import { parseOrDefault } from '@/lib/parse-or-default'
import { withClassCodesAll } from '@/lib/with-class-codes'
import { getProvider } from '@/enrich/opac-provider'
import { enrichOneRecord, hasLookupKey, type EnrichmentContext } from '@/enrich/enrich-service'
import type { CatalogRecord } from '@/types/entities'
import { CatalogRecordCard } from '@/components/catalog-record'
import { BorrowCyclesList } from '@/components/borrow-cycles-list'
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { markReviewed, splitSetBook } from './-edit-actions'
import { EditDialog } from './-edit-dialog'
import { MergeDialog } from './-merge-dialog'

const bookIdSchema = z.string().min(1)

// 编辑对话框由 search `edit=true` 驱动（book-editing 规格 §4.1），URL 状态可刷新/回退。
// 视图参数（q/source/status/sort/dir）与书库列表同构：列表行链接携带，详情页翻页
// 沿同一过滤/排序视图找相邻书（opac-enrichment §10）。不用 default(false)：
// 默认值会使 search 对象与空 URL 不一致，触发 router 自动回写。
const detailSearchSchema = z.object({
  edit: z.boolean().optional(),
  q: z.string().optional(),
  source: z.string().optional(),
  status: z.enum(['needsReview', 'placeholder', 'set']).optional(),
  sort: z.enum(['title', 'author', 'isbn', 'borrowed', 'borrows']).optional(),
  dir: z.enum(['asc', 'desc']).optional(),
})

export const Route = createFileRoute('/library/$bookId')({
  // $bookId 走 z.string() 校验 loader 入参（ui-navigation §2）；非法 id 路由不匹配。
  parseParams: (raw) => {
    const parsed = bookIdSchema.safeParse(raw.bookId)
    return parsed.success ? { bookId: parsed.data } : false
  },
  validateSearch: detailSearchSchema,
  component: BookDetailPage,
})

function BookDetailPage() {
  const { t } = useTranslation('pages')
  const { bookId } = Route.useParams()
  const searchParams = Route.useSearch()
  const edit = searchParams.edit ?? false
  const navigate = Route.useNavigate()
  const displayTimezone = useMemo(() => readPreferences().displayTimezone, [])

  const [mergeOpen, setMergeOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitting, setSplitting] = useState(false)

  // —— OPAC 补全单条入口（opac-enrichment §7.2/§10；上下文为详情页组件态，§7.3） ——
  const { t: te } = useTranslation('enrich')
  const [enrichingId, setEnrichingId] = useState<string | null>(null)
  const [enrichMsg, setEnrichMsg] = useState<{ recordId: string; text: string } | null>(null)
  const [enrichment, setEnrichment] = useState<EnrichmentContext | null>(null)

  // 翻页/直达其它书 → 组件复用时清掉上一本的补全上下文（§7.3：离开即弃）。
  useEffect(() => {
    setEnrichment(null)
  }, [bookId])

  const data = useLiveQuery(
    () =>
      Promise.all([
        // 翻页需全量书库视图派生（library-view 内存管线，与列表页同查询面，§13）。
        db.books.toArray(),
        // H-5 读路径自愈：回填失败时存量记录缺 classCodes 索引字段，内存物化后
        // 一次派生补回（缺字段才补、全有零分配），分类芯片等读取不丢分类。
        db.catalogRecords.toArray().then(withClassCodesAll),
        db.borrowCycles.toArray(),
        db.sources.toArray(),
        // rawRecords 无 bookId 索引（data-layer §3），单书溯源用 filter。
        db.rawRecords.filter((r) => r.bookId === bookId).toArray(),
      ]),
    [bookId],
  )

  const loading = data === undefined
  const [rawBooks, rawCatalogRecords, allBorrowCycles, sources, rawRecords] = data ?? [
    [],
    [],
    [],
    [],
    [],
  ]
  // 读路径归一（Q-6）：旧导出记录缺 schema 默认字段（parallelTitles/materialType/volume 等），
  // 直读渲染前按 schema 默认值补齐，防 undefined 字段渲染崩溃（M1 classCodes 同类）。
  const books = rawBooks.map((b) => parseOrDefault(bookSchema, b))
  const allCatalogRecords = rawCatalogRecords.map((cr) => parseOrDefault(catalogRecordSchema, cr))
  const book = books.find((b) => b.id === bookId)

  // 全量集合仅供翻页派生；页面本体只消费当前书的数据（过滤派生，防串书）。
  const catalogRecords = useMemo(
    () => allCatalogRecords.filter((cr) => cr.bookId === bookId),
    [allCatalogRecords, bookId],
  )
  const borrowCycles = useMemo(
    () => allBorrowCycles.filter((c) => c.bookId === bookId),
    [allBorrowCycles, bookId],
  )

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

  // —— 翻页：沿书库列表当前视图（筛选/排序）顺序找相邻书（opac-enrichment §10） ——
  const viewRows = useMemo(
    () =>
      filterAndSortRows(
        buildLibraryRows(books, allCatalogRecords, allBorrowCycles, sources),
        {
          q: searchParams.q,
          source: searchParams.source,
          status: searchParams.status,
          sort: searchParams.sort,
          dir: searchParams.dir,
        },
      ),
    [books, allCatalogRecords, allBorrowCycles, sources, searchParams],
  )
  const { prevId, nextId } = useMemo(
    () => adjacentBookIds(viewRows, bookId),
    [viewRows, bookId],
  )
  const goToBook = (targetId: string) =>
    void navigate({
      to: '/library/$bookId',
      params: { bookId: targetId },
      // 保留视图参数、清 edit（翻页即放弃当前书未保存的 Dialog 编辑，§10）。
      search: (prev) => ({ ...prev, edit: undefined }),
    })

  // 关闭走 replace：以干净详情 URL 替换 ?edit=true 条目（book-editing §4.1），
  // 之后浏览器返回直接回上一页，不重新弹出 dialog。
  const closeEdit = () =>
    void navigate({ search: (prev) => ({ ...prev, edit: undefined }), replace: true })

  const handleMarkReviewed = async () => {
    if (!book) return
    await markReviewed(db, book.id)
  }

  const handleSplit = async () => {
    if (!book) return
    setSplitting(true)
    try {
      await splitSetBook(db, book.id)
      // 拆书后原 bookId 不复存在，回书库列表。
      void navigate({ to: '/library' })
    } finally {
      setSplitting(false)
    }
  }

  /** 单条抓取：成功 → 上下文入组件态并打开编辑 Dialog；not_found/failed → 内联提示（状态已回写）。
   *  取消后上下文保留（重开编辑仍带建议）；「重新抓取」覆盖（§7.3）。 */
  const handleEnrich = async (cr: CatalogRecord) => {
    if (!book) return
    const src = sourceById.get(cr.sourceId)
    const provider = src ? getProvider(src.parserId) : null
    if (!provider || !src) return
    setEnrichingId(cr.id)
    setEnrichMsg(null)
    try {
      const outcome = await enrichOneRecord(db, cr, book, src)
      if (outcome.kind === 'success') {
        setEnrichment(outcome.context)
        if (!edit) {
          void navigate({ search: (prev) => ({ ...prev, edit: true }) })
        }
      } else {
        setEnrichMsg({
          recordId: cr.id,
          text: outcome.kind === 'not_found' ? te('notFound') : te('failed'),
        })
      }
    } catch {
      // 双保险：enrichOneRecord 意外抛错 → 失败提示（契约上不抛错，见 enrich-service；
      // 此处仅设提示，不重复 setEnrichingId——finally 统一复位）。
      setEnrichMsg({ recordId: cr.id, text: te('failed') })
    } finally {
      setEnrichingId(null)
    }
  }

  /** 保存成功：清补全上下文（已应用即确认，重开编辑不再带陈旧建议，§7.3）。 */
  const handleEnrichmentSaved = () => setEnrichment(null)

  /** 占位 Book：补全入口置灰 + 提示（§7.1），外链同样不提供。 */
  const isPlaceholderBook =
    book != null && book.needsReview && parseTitle(book.title).isPlaceholder

  /** 单条补全按钮可见性：provider 命中 + lookupKey 有效；已 fetched 显示「重新抓取」（§6，可重复抓取）。 */
  const enrichActionsOf = (cr: CatalogRecord): ReactNode => {
    const src = sourceById.get(cr.sourceId)
    const provider = src ? getProvider(src.parserId) : null
    if (!provider || !src || !hasLookupKey(cr, currentBook, provider)) return null
    if (isPlaceholderBook) {
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" disabled>
            {te('fetch', { provider: provider.displayName })}
          </Button>
          <span className="text-xs text-muted-foreground">{te('placeholderHint')}</span>
        </div>
      )
    }
    const isFetched = cr.opacEnrichment?.status === 'fetched'
    const detailUrl = provider.detailUrl(cr, currentBook)
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={enrichingId === cr.id}
          onClick={() => void handleEnrich(cr)}
        >
          {enrichingId === cr.id
            ? te('running')
            : isFetched
              ? te('refetch')
              : te('fetch', { provider: provider.displayName })}
        </Button>
        {detailUrl && (
          <a
            href={detailUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            {te('viewInOpac', { provider: provider.displayName })}
          </a>
        )}
        {enrichMsg?.recordId === cr.id && (
          <span className="text-xs text-destructive">{enrichMsg.text}</span>
        )}
      </div>
    )
  }

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

  // 守卫后 book 收窄为非空；提前定义的闭包（enrichActionsOf）需显式绑定。
  const currentBook = book

  const kind = reviewKindOf(book)
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">{book.title}</h1>
          {book.authors.length > 0 && (
            <p className="text-muted-foreground">{book.authors.join(' / ')}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {/* 翻页（opac-enrichment §10：沿列表视图顺序；边界禁用；导航清 edit） */}
          <Button
            variant="outline"
            size="sm"
            aria-label={t('bookDetail.pager.prev')}
            disabled={prevId == null}
            onClick={() => prevId != null && goToBook(prevId)}
          >
            <ChevronLeftIcon className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={t('bookDetail.pager.next')}
            disabled={nextId == null}
            onClick={() => nextId != null && goToBook(nextId)}
          >
            <ChevronRightIcon className="size-4" />
          </Button>
          <Button
            onClick={() =>
              void navigate({ search: (prev) => ({ ...prev, edit: true }) })
            }
          >
            {t('bookDetail.edit')}
          </Button>
          {(book.needsReview || kind !== null || catalogRecords.length >= 2) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label={t('bookDetail.more')}>
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {book.needsReview && (
                  <DropdownMenuItem onClick={() => void handleMarkReviewed()}>
                    {t('bookDetail.more.markReviewed')}
                  </DropdownMenuItem>
                )}
                {kind === 'placeholder' && (
                  <DropdownMenuItem onClick={() => setMergeOpen(true)}>
                    {t('bookDetail.more.merge')}
                  </DropdownMenuItem>
                )}
                {kind === 'set' && catalogRecords.length >= 2 && (
                  <DropdownMenuItem
                    onClick={() => setSplitOpen(true)}
                    className="text-destructive focus:text-destructive"
                  >
                    {t('bookDetail.more.split')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('bookDetail.metadata.title')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {/* 封面（opac-enrichment §3.5：外部图床不受 CORS 限制，可直接 <img> 展示） */}
            {book.coverUrl && (
              <img
                src={book.coverUrl}
                alt={book.title}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="max-h-56 w-auto border object-contain"
              />
            )}
            {book.subtitle && (
              <p className="text-sm text-muted-foreground">{book.subtitle}</p>
            )}
            {book.translators.length > 0 &&
              metaField(t('bookDetail.field.translators'), book.translators.join(' / '))}
            {metaField(t('bookDetail.field.isbn'), book.isbn13 && (
              <span className="font-mono">{book.isbn13}</span>
            ))}
            {metaField(t('bookDetail.field.isbn10'), book.isbn10 && (
              <span className="font-mono">{book.isbn10}</span>
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
            {book.description && (
              <div className="flex gap-2 text-sm">
                <span className="w-20 shrink-0 text-muted-foreground">
                  {t('bookDetail.field.description')}
                </span>
                <p className="min-w-0 whitespace-pre-wrap">{book.description}</p>
              </div>
            )}
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
                      actions={enrichActionsOf(cr)}
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
            <p className="text-sm text-muted-foreground">
              {t('bookDetail.cycles.empty')}
            </p>
          ) : (
            <BorrowCyclesList
              cycles={sortedCycles}
              displayTimezone={displayTimezone}
              sources={sources}
            />
          )}
        </CardContent>
      </Card>

      {/* 编辑对话框：URL search.edit 驱动；enrichment 为补全建议改动上下文（详情页组件态，§7.3） */}
      {edit && (
        <EditDialog
          book={book}
          catalogRecords={catalogRecords}
          rawRecords={rawRecords}
          sources={sources}
          open={edit}
          onOpenChange={(open) => !open && closeEdit()}
          onSaved={handleEnrichmentSaved}
          enrichment={enrichment ?? undefined}
        />
      )}

      {/* 占位书：合并到已有书目 */}
      {kind === 'placeholder' && (
        <MergeDialog
          book={book}
          borrowCycles={borrowCycles}
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          onMerged={(targetId) =>
            void navigate({ to: '/library/$bookId', params: { bookId: targetId } })
          }
        />
      )}

      {/* 套装候选：拆为独立 Book（二次确认） */}
      <AlertDialog open={splitOpen} onOpenChange={setSplitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('bookDetail.more.split.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('bookDetail.more.split.confirmDesc', { count: catalogRecords.length })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel', { ns: 'edit' })}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={splitting}
              onClick={() => void handleSplit()}
            >
              {t('bookDetail.more.split.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
