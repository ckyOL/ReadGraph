import { useMemo, useState, type ReactNode } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { MoreHorizontalIcon } from 'lucide-react'
import { z } from 'zod'

import { db } from '@/db/db-instance'
import { readPreferences } from '@/lib/preferences'
import { formatDateInTz } from '@/lib/display-time'
import { reviewKindOf } from '@/lib/book-status'
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

export const Route = createFileRoute('/library/$bookId')({
  // $bookId 走 z.string() 校验 loader 入参（ui-navigation §2）；非法 id 路由不匹配。
  parseParams: (raw) => {
    const parsed = bookIdSchema.safeParse(raw.bookId)
    return parsed.success ? { bookId: parsed.data } : false
  },
  // 编辑对话框由 search `edit=true` 驱动（book-editing 规格 §4.1），URL 状态可刷新/回退。
  // 不用 default(false)：默认值会使 search 对象与空 URL 不一致，触发 router 自动回写 `?edit=false`。
  validateSearch: z.object({
    edit: z.boolean().optional(),
  }),
  component: BookDetailPage,
})

function BookDetailPage() {
  const { t } = useTranslation('pages')
  const { bookId } = Route.useParams()
  const { edit } = Route.useSearch()
  const navigate = Route.useNavigate()
  const displayTimezone = useMemo(() => readPreferences().displayTimezone, [])

  const [mergeOpen, setMergeOpen] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitting, setSplitting] = useState(false)

  const data = useLiveQuery(
    () =>
      Promise.all([
        db.books.get(bookId),
        db.catalogRecords.where('bookId').equals(bookId).toArray(),
        db.borrowCycles.where('bookId').equals(bookId).toArray(),
        // rawRecords 无 bookId 索引（data-layer §3），单书溯源用 filter。
        db.rawRecords.filter((r) => r.bookId === bookId).toArray(),
        db.sources.toArray(),
      ]),
    [bookId],
  )

  const loading = data === undefined
  const [book, catalogRecords, borrowCycles, rawRecords, sources] = data ?? [
    undefined,
    [],
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
            <p className="text-sm text-muted-foreground">
              {t('bookDetail.cycles.empty')}
            </p>
          ) : (
            <BorrowCyclesList
              cycles={sortedCycles}
              displayTimezone={displayTimezone}
            />
          )}
        </CardContent>
      </Card>

      {/* 编辑对话框：URL search.edit 驱动 */}
      {edit && (
        <EditDialog
          book={book}
          catalogRecords={catalogRecords}
          rawRecords={rawRecords}
          sources={sources}
          open={edit}
          onOpenChange={(open) => !open && closeEdit()}
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
