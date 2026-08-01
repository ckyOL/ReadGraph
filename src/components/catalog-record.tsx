// 单条馆藏记录（编目卡）：来源徽标 + 馆藏号在上，条码与分类号在下。
// 每条记录带边框独立成块，归属图书馆一眼可辨（ui-navigation §2 书目详情）。
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { ClassificationBadge } from '@/components/classification-badge'
import type { CatalogRecord, Source } from '@/types/entities'

interface CatalogRecordCardProps {
  record: CatalogRecord
  /** 馆藏所属来源（图书馆）；缺失时省略徽标。 */
  source?: Source
}

export function CatalogRecordCard({ record, source }: CatalogRecordCardProps) {
  const { t } = useTranslation('pages')
  return (
    <div className="space-y-2 border p-3">
      <div className="flex flex-wrap items-center gap-2">
        {source && (
          <Badge variant="outline" className="rounded-none">
            {source.name}
          </Badge>
        )}
        {record.metaId != null && (
          <span className="font-mono text-xs text-muted-foreground">
            {t('bookDetail.field.metaId')}: {String(record.metaId)}
          </span>
        )}
      </div>
      {(record.barcodes.length > 0 || record.classifications.length > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          {record.barcodes.map((b) => (
            <span key={b} className="font-mono text-xs">
              {t('bookDetail.field.barcode')}: {b}
            </span>
          ))}
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
  )
}
