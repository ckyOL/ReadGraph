// 合并到已有书目（book-editing 规格 §4.3；原 review 规格 §5 合并流程迁移）。
// 搜索目标书（searchMergeTargets）→ 选中 → AlertDialog 确认 → mergePlaceholderInto
//（占位书编目/借阅/原始行重挂目标书，占位 Book 删除）。
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SearchIcon } from 'lucide-react'

import { db } from '@/db/db-instance'
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
import type { Book, BorrowCycle } from '@/types/entities'
import { mergePlaceholderInto, searchMergeTargets } from './-edit-actions'

export interface MergeDialogProps {
  /** 占位书。 */
  book: Book
  borrowCycles: BorrowCycle[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 合并成功后回调（目标书 id）；占位书已删除，调用方应导航离开当前详情页。 */
  onMerged: (targetBookId: string) => void
}

export function MergeDialog(props: MergeDialogProps) {
  const { t } = useTranslation('edit')
  const { book, borrowCycles, open, onOpenChange, onMerged } = props

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Book[] | null>(null)
  const [target, setTarget] = useState<Book | null>(null)
  const [merging, setMerging] = useState(false)

  const runSearch = async () => {
    const hits = await searchMergeTargets(db, query, book.id)
    setResults(hits)
  }

  const handleMerge = async () => {
    if (!target) return
    setMerging(true)
    try {
      await mergePlaceholderInto(db, book.id, target.id)
      const targetId = target.id
      setTarget(null)
      setResults(null)
      setQuery('')
      onOpenChange(false)
      onMerged(targetId)
    } finally {
      setMerging(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t('merge.title')}</DialogTitle>
            <DialogDescription>{book.title}</DialogDescription>
          </DialogHeader>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">{t('merge.title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="relative">
                <SearchIcon className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
                  placeholder={t('merge.search')}
                  aria-label={t('merge.search')}
                  className="pl-8"
                />
              </div>
              <Button variant="outline" onClick={() => void runSearch()}>
                {t('merge.searchAction')}
              </Button>
              {results !== null && results.length === 0 && (
                <p className="text-xs text-muted-foreground">{t('merge.noMatch')}</p>
              )}
              {results !== null && results.length > 0 && (
                <ul className="divide-y">
                  {results.map((b) => (
                    <li key={b.id} className="flex items-center gap-2 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{b.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {b.authors.join(' / ')}
                          {b.isbn13 ? ` · ${b.isbn13}` : ''}
                        </p>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => setTarget(b)}>
                        {t('merge.select')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </DialogContent>
      </Dialog>

      <AlertDialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('merge.confirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('merge.confirmDesc', {
                count: borrowCycles.length,
                title: target?.title ?? '',
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
              {t('merge.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
