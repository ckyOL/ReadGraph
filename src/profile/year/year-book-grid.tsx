// 年度书单全幅封面网格（reading-profile §4 年度视图）：bookIds 升序，画报语义。
// 每格 = 封面缩略图（aspect 3/4；无封面 → 占位块显题名首字符）+ 题名（1–2 行 clamp）
// + 作者（1 行弱化）；网格列数响应式；全量呈现不折叠；数据经 bookIndex 式索引。
// 空年 → Empty 变体。
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'

import type { YearBookIndexEntry } from './year-book-index'
/**
 * 年度书单网格（bookIds 升序全量）。headerAction：标题行右侧动作插槽
 * （分享图入口注入；布局保持 h2 独占左侧，不破坏标题行结构断言）。
 */
export function YearBookGrid({
  bookIds,
  bookIndex,
  emptyTitle,
  emptyDescription,
  headerAction = null,
}: {
  bookIds: string[]
  bookIndex: Record<string, YearBookIndexEntry>
  emptyTitle: string
  emptyDescription: string
  headerAction?: ReactNode
}) {
  const { t } = useTranslation('pages')
  return (
    <section data-slot="year-book-grid" className="mt-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t('profile.year.books.title')}</h2>
        {headerAction}
      </div>
      {bookIds.length === 0 ? (
        <Empty className="mt-2 min-h-[120px]">
          <EmptyHeader>
            <EmptyTitle>{emptyTitle}</EmptyTitle>
            <EmptyDescription>{emptyDescription}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {bookIds.map((id) => {
            const entry = bookIndex[id]
            if (!entry) return null
            const initial = entry.title.trim().charAt(0) || '·'
            return (
              <figure key={id} className="flex min-w-0 flex-col gap-1.5">
                <div className="aspect-[3/4] overflow-hidden rounded-md border border-border bg-muted">
                  {entry.coverUrl ? (
                    <img
                      src={entry.coverUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div
                      data-slot="year-book-cover-placeholder"
                      aria-hidden="true"
                      className="flex h-full items-center justify-center font-heading text-2xl text-muted-foreground"
                    >
                      {initial}
                    </div>
                  )}
                </div>
                <figcaption className="min-w-0">
                  <div className="line-clamp-2 text-xs leading-relaxed">{entry.title}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {entry.authors.join(' / ')}
                  </div>
                </figcaption>
              </figure>
            )
          })}
        </div>
      )}
    </section>
  )
}