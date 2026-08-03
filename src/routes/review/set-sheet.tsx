// 套装审核表单（review 规格 §6）。Sheet 宽 640px（移动端 Drawer）。
// 三区：书目（可改题名）→ 编目卷号（每行 volume 可改可清空）→ 操作
// （保存为套装 / 不是套装 / 拆为独立 Book 二次确认）。
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { db } from '@/db/db-instance'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { catalogTitleByRecord } from '@/lib/review'
import { parseVolumeFromTitle, stripVolumeSuffix } from '@/lib/volume'
import type { Book, BorrowCycle, CatalogRecord, RawRecord, Source } from '@/types/entities'
import { markNotSet, saveSetBook, splitSetBook } from './review-actions'

export interface SetSheetProps {
  book: Book
  catalogRecords: CatalogRecord[]
  rawRecords: RawRecord[]
  borrowCycles: BorrowCycle[]
  sources: Source[]
  /** 保存/不是套装/拆书成功后关闭并刷新。 */
  onDone: () => void
}

/** 公共前缀建议：取首个编目题名、去掉卷号段（review 规格 §6.1）。 */
export function suggestSetTitle(
  book: Book,
  catalogRecords: CatalogRecord[],
  rawRecords: RawRecord[],
): string {
  const titles = catalogTitleByRecord(book.id, catalogRecords, rawRecords)
  const first = catalogRecords[0]
  if (first) {
    const raw = titles.get(first.id)
    if (raw) return stripVolumeSuffix(raw)
  }
  return stripVolumeSuffix(book.title)
}

export function SetSheet(props: SetSheetProps) {
  const { t } = useTranslation('review')
  return (
    <Sheet open onOpenChange={(open) => !open && props.onDone()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-[640px]">
        <SheetHeader>
          <SheetTitle>{t('set.title')}</SheetTitle>
          <SheetDescription>{props.book.title}</SheetDescription>
        </SheetHeader>
        <SetForm {...props} />
      </SheetContent>
    </Sheet>
  )
}

/** 表单体（独立导出供 SSR 渲染测试；事件处理器引用 db 单例，渲染不触发）。 */
export function SetForm({
  book,
  catalogRecords,
  rawRecords,
  borrowCycles,
  sources,
  onDone,
}: SetSheetProps) {
  const { t } = useTranslation('review')
  const titles = catalogTitleByRecord(book.id, catalogRecords, rawRecords)
  const sourceById = new Map(sources.map((s) => [s.id, s]))

  const [title, setTitle] = useState(() => suggestSetTitle(book, catalogRecords, rawRecords))
  // crId → 卷号输入值（'' 表示清空）。
  const [volumes, setVolumes] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    for (const cr of catalogRecords) {
      const t = titles.get(cr.id) ?? ''
      init[cr.id] =
        cr.volume != null && cr.volume !== '' ? cr.volume : (parseVolumeFromTitle(t) ?? '')
    }
    return init
  })
  const [saving, setSaving] = useState(false)
  const [splitOpen, setSplitOpen] = useState(false)
  const [splitting, setSplitting] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      const map = new Map<string, string | null>()
      for (const cr of catalogRecords) {
        const v = volumes[cr.id]
        map.set(cr.id, v === undefined || v.trim() === '' ? null : v.trim())
      }
      await saveSetBook(db, book.id, title.trim() === '' ? book.title : title.trim(), map)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const handleNotSet = async () => {
    setSaving(true)
    try {
      await markNotSet(db, book.id)
      onDone()
    } finally {
      setSaving(false)
    }
  }

  const handleSplit = async () => {
    setSplitting(true)
    try {
      await splitSetBook(db, book.id)
      onDone()
    } finally {
      setSplitting(false)
    }
  }

  return (
    <>
      {/* 1. 书目 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('set.book')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">
                {t('set.book.title')}
              </label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="flex items-baseline gap-3">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {t('set.book.isbn')}
              </span>
              <span className="font-mono">{book.isbn13 ?? '—'}</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">
                {t('placeholder.known.borrows')}
              </span>
              <span className="tabular-nums">{borrowCycles.length}</span>
            </div>
            {book.sourceIds.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {book.sourceIds.map((sid) => {
                  const s = sourceById.get(sid)
                  return s ? (
                    <Badge key={sid} variant="outline" className="rounded-none">
                      {s.name}
                    </Badge>
                  ) : null
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 2. 编目卷号 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('set.catalogs')}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('set.catalog.title')}</TableHead>
                  <TableHead className="hidden md:table-cell">
                    {t('set.catalog.metaId')}
                  </TableHead>
                  <TableHead className="hidden lg:table-cell">
                    {t('set.catalog.barcode')}
                  </TableHead>
                  <TableHead>{t('set.catalog.volume')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {catalogRecords.map((cr) => (
                  <TableRow key={cr.id}>
                    <TableCell>
                      <p className="max-w-52 truncate">{titles.get(cr.id) ?? book.title}</p>
                      {sourceById.get(cr.sourceId) && (
                        <Badge variant="outline" className="mt-1 rounded-none">
                          {sourceById.get(cr.sourceId)!.name}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs md:table-cell">
                      {cr.metaId != null ? String(cr.metaId) : '—'}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs lg:table-cell">
                      {cr.barcodes[0] ?? '—'}
                    </TableCell>
                    <TableCell>
                      <Input
                        value={volumes[cr.id] ?? ''}
                        onChange={(e) =>
                          setVolumes((prev) => ({ ...prev, [cr.id]: e.target.value }))
                        }
                        placeholder={parseVolumeFromTitle(titles.get(cr.id) ?? '') ?? ''}
                        aria-label={`${t('set.catalog.volume')} ${titles.get(cr.id) ?? cr.id}`}
                        className="h-8 w-20 font-mono"
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* 3. 操作 */}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {t('set.save')}
          </Button>
          <Button variant="outline" onClick={() => void handleNotSet()} disabled={saving}>
            {t('set.notSet')}
          </Button>
          {catalogRecords.length >= 2 && (
            <Button
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setSplitOpen(true)}
              disabled={saving}
            >
              {t('set.split')}
            </Button>
          )}
        </div>

        <AlertDialog open={splitOpen} onOpenChange={setSplitOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('set.split.confirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('set.split.confirmDesc', { count: catalogRecords.length })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={splitting}
                onClick={() => void handleSplit()}
              >
                {t('set.split.confirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
    </>
  )
}
