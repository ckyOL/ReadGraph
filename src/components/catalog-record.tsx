// 单条馆藏记录（编目卡，ui-navigation §2 书目详情 / DESIGN.md §3 编目卡标签条）。
// 主次层级：上排「来源徽标（左锚）+ 分类号芯片（右锚）」为双主元素；
// 中排条码为副本主标识（等宽、前景色）；末排馆藏号为次级元数据（弱化）。
// 区块间 1px 细罫线分隔（Casa BRUTUS 纸墨语言）；完全直角、无阴影。
import { useTranslation } from 'react-i18next'
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { ClassificationBadge } from '@/components/classification-badge'
import { BranchBadge } from '@/components/branch-badge'
import type { CatalogRecord, Source } from '@/types/entities'

interface CatalogRecordCardProps {
  record: CatalogRecord
  /** 馆藏所属来源（图书馆）；缺失时省略徽标。 */
  source?: Source
  /** 卡片底部动作区（OPAC 补全按钮/外链等，opac-enrichment §10）。 */
  actions?: ReactNode
}

export function CatalogRecordCard({ record, source, actions }: CatalogRecordCardProps) {
  const { t } = useTranslation('pages')
  const hasHeader = Boolean(source) || record.classifications.length > 0
  const hasItems = record.barcodes.length > 0 || record.metaId != null
  if (!hasHeader && !hasItems) return null

  return (
    <div className="border p-3">
      {hasHeader && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {source && (
              <Badge variant="outline" className="rounded-none">
                {source.name}
              </Badge>
            )}
          </div>
          {record.classifications.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              {record.classifications.map((c) => (
                <ClassificationBadge
                  key={`${c.system}:${c.code}`}
                  system={c.system}
                  code={c.code}
                  category={c.category}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {hasHeader && hasItems && <div className="my-2.5 border-t" />}
      {hasItems && (
        <dl className="space-y-1">
          {(record.volume ?? null) !== null && record.volume !== '' && (
            <div className="flex items-baseline gap-3 text-sm">
              <dt className="w-14 shrink-0 text-xs text-muted-foreground">
                {t('bookDetail.field.volume')}
              </dt>
              <dd>
                <Badge variant="outline" className="rounded-none">
                  {record.volume}
                </Badge>
              </dd>
            </div>
          )}
          {record.barcodes.map((b) => (
            <div key={b} className="flex items-baseline gap-3 text-sm">
              <dt className="w-14 shrink-0 text-xs text-muted-foreground">
                {t('bookDetail.field.barcode')}
              </dt>
              <dd className="flex items-center gap-2">
                <span className="font-mono">{b}</span>
                <BranchBadge barcode={b} />
              </dd>
            </div>
          ))}
          {record.metaId != null && (
            <div className="flex items-baseline gap-3 text-sm">
              <dt className="w-14 shrink-0 text-xs text-muted-foreground">
                {t('bookDetail.field.metaId')}
              </dt>
              <dd className="font-mono text-muted-foreground">{String(record.metaId)}</dd>
            </div>
          )}
        </dl>
      )}
      {actions && <div className="mt-2.5 border-t pt-2.5">{actions}</div>}
    </div>
  )
}
