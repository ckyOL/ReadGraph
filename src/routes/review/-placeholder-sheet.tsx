// 选书帮补全表单（review 规格 §5）。Sheet 宽 640px（移动端 Drawer）。
// 三区：已知信息（只读）→ 补全字段（Form）→ 合并到已有书目（独立于保存）。
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchIcon } from 'lucide-react'

import { db } from '@/db/db-instance'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { ClassificationBadge } from '@/components/classification-badge'
import { normalizeIsbn } from '@/lib/isbn'
import { splitPersons } from '@/lib/title'
import { formatDateInTz } from '@/lib/display-time'
import type { Book, BorrowCycle, CatalogRecord, Source } from '@/types/entities'
import { completePlaceholder, mergePlaceholderInto, searchMergeTargets } from './-review-actions'

export interface PlaceholderSheetProps {
  book: Book
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  sources: Source[]
  displayTimezone: string
  /** 保存/合并成功后关闭并刷新。 */
  onDone: () => void
}

export function PlaceholderSheet(props: PlaceholderSheetProps) {
  const { t } = useTranslation('review')
  return (
    <Dialog open onOpenChange={(open) => !open && props.onDone()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t('placeholder.title')}</DialogTitle>
          <DialogDescription>{props.book.title}</DialogDescription>
        </DialogHeader>
        <PlaceholderForm {...props} />
      </DialogContent>
    </Dialog>
  )
}

/** 表单体（独立导出供 SSR 渲染测试；事件处理器引用 db 单例，渲染不触发）。 */
export function PlaceholderForm({
  book,
  catalogRecords,
  borrowCycles,
  sources,
  displayTimezone,
  onDone,
}: PlaceholderSheetProps) {
  const { t } = useTranslation('review')
  const firstCr = catalogRecords[0]
  const source = firstCr ? sources.find((s) => s.id === firstCr.sourceId) : undefined
  const lastBorrowedAt = borrowCycles.reduce<Date | null>(
    (acc, c) => (acc === null || c.borrowedAt > acc ? c.borrowedAt : acc),
    null,
  )

  const [title, setTitle] = useState(book.title)
  const [authors, setAuthors] = useState(book.authors.join('，'))
  const [isbn, setIsbn] = useState(book.isbn13 ?? '')
  const [titleError, setTitleError] = useState<string | null>(null)
  const [isbnError, setIsbnError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [mergeQuery, setMergeQuery] = useState('')
  const [mergeResults, setMergeResults] = useState<Book[] | null>(null)
  const [mergeTarget, setMergeTarget] = useState<Book | null>(null)
  const [merging, setMerging] = useState(false)

  // ISBN 合法化（非法 → 内联错误 + 禁用保存）。
  const { isbn13, isbn10 } = normalizeIsbn(isbn)

  const runMergeSearch = async () => {
    const hits = await searchMergeTargets(db, mergeQuery, book.id)
    setMergeResults(hits)
  }

  const canSave =
    !saving &&
    title.trim() !== '' &&
    titleError === null &&
    isbnError === null &&
    (isbn.trim() === '' || isbn13 !== null)

  const handleSave = async () => {
    if (title.trim() === '') {
      setTitleError(t('placeholder.field.titleRequired'))
      return
    }
    if (isbn.trim() !== '' && isbn13 === null) {
      setIsbnError(t('placeholder.field.isbnInvalid'))
      return
    }
    setSaving(true)
    try {
      await completePlaceholder(db, book.id, {
        title: title.trim(),
        authors: splitPersons(authors),
        isbn13,
        isbn10,
      })
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const handleMerge = async () => {
    if (!mergeTarget) return
    setMerging(true)
    try {
      await mergePlaceholderInto(db, book.id, mergeTarget.id)
      onDone()
    } finally {
      setMerging(false)
    }
  }

  return (
    <>
      {/* 1. 已知信息（只读） */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('placeholder.known')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex items-baseline gap-3">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {t('placeholder.known.barcode')}
              </span>
              <span className="font-mono">{firstCr?.barcodes[0] ?? '—'}</span>
            </div>
            {firstCr && firstCr.classifications.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {firstCr.classifications.map((c) => (
                  <ClassificationBadge
                    key={`${c.system}:${c.code}`}
                    system={c.system}
                    code={c.code}
                    category={c.category}
                  />
                ))}
              </div>
            )}
            <div className="flex items-baseline gap-3">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {t('placeholder.known.borrows')}
              </span>
              <span className="tabular-nums">{borrowCycles.length}</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {t('placeholder.known.lastBorrowed')}
              </span>
              <span className="tabular-nums">
                {lastBorrowedAt ? formatDateInTz(lastBorrowedAt, displayTimezone) : t('placeholder.known.none')}
              </span>
            </div>
            {source && (
              <div>
                <Badge variant="outline" className="rounded-none">
                  {source.name}
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. 补全字段 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('placeholder.form')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t('placeholder.field.title')} *
              </label>
              <Input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value)
                  setTitleError(null)
                }}
                aria-invalid={titleError !== null}
              />
              {titleError && <p className="text-xs text-destructive">{titleError}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t('placeholder.field.authors')}
              </label>
              <Input value={authors} onChange={(e) => setAuthors(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t('placeholder.field.isbn')}
              </label>
              <Input
                value={isbn}
                onChange={(e) => {
                  setIsbn(e.target.value)
                  setIsbnError(null)
                }}
                className="font-mono"
                aria-invalid={isbnError !== null}
              />
              {isbnError && <p className="text-xs text-destructive">{isbnError}</p>}
            </div>
            <Button onClick={handleSave} disabled={!canSave}>
              {t('placeholder.save')}
            </Button>
          </CardContent>
        </Card>

        {/* 3. 合并到已有书目（与保存互斥，独立触发） */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('placeholder.merge')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="relative">
              <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={mergeQuery}
                onChange={(e) => setMergeQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void runMergeSearch()}
                placeholder={t('placeholder.merge.search')}
                className="pl-8"
              />
            </div>
            <Button variant="outline" onClick={() => void runMergeSearch()}>
              {t('placeholder.merge.searchAction')}
            </Button>
            {mergeResults !== null && mergeResults.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t('placeholder.merge.noMatch')}
              </p>
            )}
            {mergeResults !== null && mergeResults.length > 0 && (
              <ul className="divide-y">
                {mergeResults.map((b) => (
                  <li key={b.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{b.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {b.authors.join(' / ')}
                        {b.isbn13 ? ` · ${b.isbn13}` : ''}
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setMergeTarget(b)}
                    >
                      {t('placeholder.merge.select')}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <AlertDialog
          open={mergeTarget !== null}
          onOpenChange={(open) => !open && setMergeTarget(null)}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('placeholder.merge.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('placeholder.merge.confirmDesc', {
                  count: borrowCycles.length,
                  title: mergeTarget?.title ?? '',
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={merging}
                onClick={() => void handleMerge()}
              >
                {t('placeholder.merge.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </>
  )
}
