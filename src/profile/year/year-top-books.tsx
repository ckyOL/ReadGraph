// 最常借 Top N 区块（reading-profile §4 年度视图）：topBooks 降序行列表 = 序号 + 题名 + 次数
// （等宽 tabular-nums）。N 取 YEAR_TOP_BOOKS_N 常量（G-1 裁定 5）；空年 → Empty 变体。
import { useTranslation } from 'react-i18next'

import { YEAR_TOP_BOOKS_N } from '@/lib/profile-stats'
import type { YearSliceResult } from '@/lib/profile-stats'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'

import type { YearBookIndexEntry } from './year-book-index'

export function YearTopBooks({
  topBooks,
  bookIndex,
  emptyTitle,
  emptyDescription,
}: {
  topBooks: YearSliceResult['topBooks']
  bookIndex: Record<string, YearBookIndexEntry>
  emptyTitle: string
  emptyDescription: string
}) {
  const { t } = useTranslation('pages')
  return (
    <section data-slot="year-top-books" className="mt-4">
      <h2 className="text-base font-semibold">
        {t('profile.year.topBooks.title', { count: YEAR_TOP_BOOKS_N })}
      </h2>
      {topBooks.length === 0 ? (
        <Empty className="mt-2 min-h-[120px]">
          <EmptyHeader>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="mt-2 divide-y divide-border rounded-lg border border-border">
          {topBooks.map((row, i) => {
            const entry = bookIndex[row.bookId]
            return (
              <li key={row.bookId} className="flex items-center gap-3 px-3 py-2">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                  {i + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {entry?.title ?? row.bookId}
                </span>
                <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
                  {row.count}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}