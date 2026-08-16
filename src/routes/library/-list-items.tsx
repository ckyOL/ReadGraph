// 书库列表呈现组件（ui-navigation §3 三档响应式）：桌面表格行 + 平板/移动卡片。
// 纯展示：数据（LibraryRow）与徽标判定由列表页传入，链接参数（viewSearch）原样携带；
// 与列表页共用同一 filtered/排序状态，无内部数据逻辑，可 SSR 静态标记确定性断言。
// 纸墨语言（DESIGN.md §4.3）：直角、无阴影、1px 罫线；卡片与编目卡同构（border p-3）。
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'

import { ClassificationBadge } from '@/components/classification-badge'
import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { formatDateInTz } from '@/lib/display-time'
import type { LibraryRow } from '@/lib/library-view'
import type { ReviewKind } from '@/lib/book-status'

export interface LibraryItemProps {
  row: LibraryRow
  /** 状态徽标（占位/套装/null），由列表页派生传入。 */
  badge: ReviewKind | null
  /** 行链接携带的视图参数（q/source/status/sort/dir），详情页翻页延续。 */
  viewSearch: Record<string, string | undefined>
  displayTimezone: string
}

/** 桌面表格行（≥1024px）：table-fixed 列宽，书名列 sticky left 冻结（横向滚动锚点）。 */
export function LibraryRowView({ row, badge, viewSearch, displayTimezone }: LibraryItemProps) {
  const { t } = useTranslation('pages')
  return (
    <TableRow className="group/row">
      <TableCell className="sticky left-0 z-10 whitespace-normal bg-background group-hover/row:bg-muted/50">
        <div className="flex items-center gap-2">
          <Link
            to="/library/$bookId"
            params={{ bookId: row.book.id }}
            search={viewSearch}
            className="-my-0.5 line-clamp-2 min-w-0 py-0.5 hover:underline"
          >
            {row.book.title}
          </Link>
          {badge && (
            <Link
              to="/library/$bookId"
              params={{ bookId: row.book.id }}
              search={{ ...viewSearch, edit: true }}
              aria-label={`${badge === 'placeholder' ? t('library.badge.placeholder') : t('library.set')} ${row.book.title}`}
              className="-m-0.5 p-0.5"
            >
              <Badge variant={badge === 'placeholder' ? 'destructive' : 'outline'}>
                {badge === 'placeholder' ? t('library.badge.placeholder') : t('library.set')}
              </Badge>
            </Link>
          )}
        </div>
      </TableCell>
      <TableCell>
        <span className="block truncate text-muted-foreground" title={row.authors}>
          {row.authors}
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs">{row.isbn13 ?? '—'}</TableCell>
      <TableCell>
        {row.sourceName ? (
          <Badge variant="outline" className="rounded-none">
            {row.sourceName}
          </Badge>
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell>
        <span className="tabular-nums text-muted-foreground">
          {row.lastBorrowedAt ? formatDateInTz(row.lastBorrowedAt, displayTimezone) : '—'}
        </span>
      </TableCell>
      <TableCell>
        {row.classification ? (
          <ClassificationBadge
            system={row.classification.system}
            code={row.classification.code}
            categoryClassName="max-w-40"
          />
        ) : (
          '—'
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums">{row.borrowCount}</TableCell>
    </TableRow>
  )
}

/** 平板/移动卡片（<1024px）：书名明朝 2 行、作者弱化 1 行、分类/ISBN/借阅时间行、底部来源+借阅数。
 *  信息完整、无隐藏列、无横向滚动；排序键值固定位置可扫读（UX 卡片排序模式）。 */
export function LibraryCardView({ row, badge, viewSearch, displayTimezone }: LibraryItemProps) {
  const { t } = useTranslation('pages')
  return (
    <div className="border p-3">
      <div className="flex items-start gap-2">
        <Link
          to="/library/$bookId"
          params={{ bookId: row.book.id }}
          search={viewSearch}
          className="-my-0.5 font-display line-clamp-2 min-w-0 py-0.5 text-base leading-snug font-semibold hover:underline"
        >
          {row.book.title}
        </Link>
        {badge && (
          <Link
            to="/library/$bookId"
            params={{ bookId: row.book.id }}
            search={{ ...viewSearch, edit: true }}
            aria-label={`${badge === 'placeholder' ? t('library.badge.placeholder') : t('library.set')} ${row.book.title}`}
            className="-m-0.5 shrink-0 p-0.5"
          >
            <Badge variant={badge === 'placeholder' ? 'destructive' : 'outline'}>
              {badge === 'placeholder' ? t('library.badge.placeholder') : t('library.set')}
            </Badge>
          </Link>
        )}
      </div>
      <p className="mt-1 truncate text-sm text-muted-foreground" title={row.authors}>
        {row.authors}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {row.classification ? (
          <ClassificationBadge
            system={row.classification.system}
            code={row.classification.code}
            categoryClassName="max-w-40"
          />
        ) : null}
        {row.isbn13 ? (
          <span className="font-mono text-xs text-muted-foreground">{row.isbn13}</span>
        ) : null}
        {row.lastBorrowedAt ? (
          <span className="tabular-nums text-xs text-muted-foreground">
            {formatDateInTz(row.lastBorrowedAt, displayTimezone)}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        {row.sourceName ? (
          <Badge variant="outline" className="rounded-none">
            {row.sourceName}
          </Badge>
        ) : (
          <span />
        )}
        <span className="text-sm tabular-nums">{row.borrowCount}</span>
      </div>
    </div>
  )
}
