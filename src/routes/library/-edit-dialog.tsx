// 统一编辑表单（book-editing 规格 §3）。宽屏 Dialog（max-w-5xl，移动端 Drawer）。
// 书目全字段 + 每 CatalogRecord 的 volume/barcodes/classifications；保存走
// updateBookWithRecords 单事务（ISBN 冲突 IsbnConflictError 内联展示）。
// 普通书目、选书帮占位、套装候选共用；待审类型差异仅体现在徽标与卷号解析辅助。
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Wand2Icon, XIcon } from 'lucide-react'

import { db } from '@/db/db-instance'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cleanIsbn, normalizeIsbn } from '@/lib/isbn'
import { splitPersons } from '@/lib/title'
import { formatList } from '@/lib/format-list'
import { normalizePublishDate } from '@/lib/publish-date'
import { catalogTitleByRecord, reviewBadgeOf } from '@/lib/book-status'
import { parseVolumeFromTitle } from '@/lib/volume'
import { cn } from '@/lib/utils'
import { prefillFromChanges, type EnrichmentChange } from '@/lib/opac-mapping'
import { getProvider } from '@/enrich/opac-provider'
import type { EnrichmentContext } from '@/enrich/enrich-service'
import type {
  Book,
  CatalogRecord,
  ClassificationEntry,
  ClassificationSystem,
  RawRecord,
  Source,
} from '@/types/entities'
import {
  IsbnConflictError,
  applyRecordPrefill,
  updateBookWithRecords,
  type BookDraft,
  type CatalogRecordDraft,
  type RecordDraft,
} from './-edit-actions'

export interface EditDialogProps {
  book: Book
  catalogRecords: CatalogRecord[]
  rawRecords: RawRecord[]
  sources: Source[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 保存成功回调（opac-enrichment §7.2/§7.3：详情页清组件态补全上下文用）。 */
  onSaved?: () => void
  /** OPAC 补全建议改动上下文（opac-enrichment §5.3/§10）：表单预填 + 现有值对照 + 恢复。 */
  enrichment?: EnrichmentContext
}

export function EditDialog(props: EditDialogProps) {
  const { t } = useTranslation('edit')
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{props.book.title}</DialogDescription>
        </DialogHeader>
        <EditForm {...props} />
      </DialogContent>
    </Dialog>
  )
}

const CLASSIFICATION_SYSTEMS: ClassificationSystem[] = ['clc', 'ddc', 'lcc', 'udc', 'other']

const PUBLISH_DATE_RE = /^\d{4}(-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?)?$/

/** 编目行本地编辑态（-edit-actions 定义，供草稿装配）。 */
export type { RecordDraft } from './-edit-actions'

interface FieldErrors {
  title?: string
  isbn13?: string
  publishDate?: string
  pages?: string
  price?: string
  coverUrl?: string
}

/** 前端校验（book-editing 规格 §3.4.1）：返回字段错误映射；全过 → {}。 */
export function validateBookFields(
  input: {
    title: string
    isbn13: string
    publishDate: string
    pages: string
    priceAmount: string
    priceCurrency: string
    coverUrl: string
  },
  t: (key: string) => string,
): FieldErrors {
  const e: FieldErrors = {}
  if (input.title.trim() === '') e.title = t('field.titleRequired')
  // ISBN 硬校验与 bookSchema 一致（13 位纯数字，校验位为软校验不阻断，见 data-layer §2）；
  // 预填的旧数据/夹具可能校验位不合法，编辑保存不应因此被卡死。
  const cleanedIsbn = cleanIsbn(input.isbn13)
  if (input.isbn13.trim() !== '' && cleanedIsbn !== null && !/^\d{13}$/.test(cleanedIsbn)) {
    e.isbn13 = t('field.isbn13Invalid')
  }
  if (input.publishDate.trim() !== '' && !PUBLISH_DATE_RE.test(input.publishDate.trim())) {
    e.publishDate = t('field.publishDateInvalid')
  }
  if (input.pages.trim() !== '' && !/^\d+$/.test(input.pages.trim())) {
    e.pages = t('field.pagesInvalid')
  }
  const amountEmpty = input.priceAmount.trim() === ''
  const currencyEmpty = input.priceCurrency.trim() === ''
  if (amountEmpty !== currencyEmpty) {
    e.price = t('field.priceInvalid')
  } else if (!amountEmpty && Number.isNaN(Number(input.priceAmount))) {
    e.price = t('field.priceInvalid')
  }
  if (input.coverUrl.trim() !== '') {
    try {
      void new URL(input.coverUrl.trim())
    } catch {
      e.coverUrl = t('field.coverUrlInvalid')
    }
  }
  return e
}

/** 表单体（独立导出供 SSR 渲染测试；事件处理器引用 db 单例，渲染不触发）。 */
export function EditForm({
  book,
  catalogRecords,
  rawRecords,
  sources,
  onOpenChange,
  onSaved,
  enrichment,
}: EditDialogProps) {
  const { t, i18n } = useTranslation('edit')
  const titles = catalogTitleByRecord(book.id, catalogRecords, rawRecords)
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const badge = reviewBadgeOf(book, book.id, catalogRecords)

  // —— OPAC 补全上下文（opac-enrichment §5.3/§10） ——
  // 建议值入框（fill 与 conflict 一视同仁）：表单初始 state = 现有值 ∪ bookPrefill；
  // conflict 的现有值对照/恢复由 changes 驱动（kind 由 changes 保留，供 UI 展示）。
  const enrichedRecord = enrichment
    ? catalogRecords.find((cr) => cr.id === enrichment.recordId)
    : undefined
  /** 补全来源 provider（徽标/摘要条溯源；unregistered → undefined 防御）。 */
  const enrichmentProvider = enrichment ? getProvider(enrichment.providerId) : undefined
  const providerShort = enrichmentProvider?.shortName ?? enrichmentProvider?.displayName
  const prefill = useMemo(
    () =>
      enrichment && enrichedRecord
        ? prefillFromChanges(book, enrichedRecord, enrichment.changes)
        : null,
    [enrichment, enrichedRecord, book],
  )
  /** conflict 字段现有值（表单同构形态），供「现有：…」对照与恢复。
   *  上下文指向的编目不存在时整体退化为普通编辑（防御，不渲染补全 UI）。 */
  const conflictCurrentByField = useMemo(() => {
    const map = new Map<EnrichmentChange['field'], unknown>()
    if (!enrichment || !enrichedRecord) return map
    for (const c of enrichment.changes) {
      if (c.kind === 'conflict') map.set(c.field, c.current)
    }
    return map
  }, [enrichment, enrichedRecord])
  /** 建议字段 → 徽标类型（fill 常规 / conflict 警示，§10）。 */
  const kindByField = useMemo(() => {
    const map = new Map<EnrichmentChange['field'], EnrichmentChange['kind']>()
    if (!enrichment || !enrichedRecord) return map
    for (const c of enrichment.changes) {
      if (!map.has(c.field)) map.set(c.field, c.kind)
    }
    return map
  }, [enrichment, enrichedRecord])
  const conflictCount = enrichment?.changes.filter((c) => c.kind === 'conflict').length ?? 0

  // —— 书目字段（补全建议值直接入框） ——
  const [title, setTitle] = useState(prefill?.bookPrefill.title ?? book.title)
  const [subtitle, setSubtitle] = useState(prefill?.bookPrefill.subtitle ?? book.subtitle ?? '')
  const [parallelTitles, setParallelTitles] = useState(
    prefill?.bookPrefill.parallelTitles?.join('，') ?? book.parallelTitles.join('，'),
  )
  const [authors, setAuthors] = useState(
    prefill?.bookPrefill.authors?.join('，') ?? book.authors.join('，'),
  )
  const [translators, setTranslators] = useState(
    prefill?.bookPrefill.translators?.join('，') ?? book.translators.join('，'),
  )
  const [publisher, setPublisher] = useState(prefill?.bookPrefill.publisher ?? book.publisher ?? '')
  // 旧导出/夹具中 publishDate 可能被 revive 为 Date（e2e-seed DATE_KEYS）；归一为字符串（详情页共用实现）。
  const publishDateInit = normalizePublishDate(book.publishDate)
  const [publishDate, setPublishDate] = useState(
    prefill?.bookPrefill.publishDate ?? publishDateInit ?? '',
  )
  const [edition, setEdition] = useState(book.edition ?? '')
  const [pages, setPages] = useState(
    prefill?.bookPrefill.pages != null
      ? String(prefill.bookPrefill.pages)
      : book.pages != null
        ? String(book.pages)
        : '',
  )
  const [priceAmount, setPriceAmount] = useState(
    prefill?.bookPrefill.price != null
      ? String(prefill.bookPrefill.price.amount)
      : book.price != null
        ? String(book.price.amount)
        : '',
  )
  const [priceCurrency, setPriceCurrency] = useState(
    prefill?.bookPrefill.price?.currency ?? book.price?.currency ?? '',
  )
  const [isbn13, setIsbn13] = useState(prefill?.bookPrefill.isbn13 ?? book.isbn13 ?? '')
  const [isbn10, setIsbn10] = useState(prefill?.bookPrefill.isbn10 ?? book.isbn10 ?? '')
  const [subjects, setSubjects] = useState(
    prefill?.bookPrefill.subjects?.join('，') ?? book.subjects.join('，'),
  )
  const [tags, setTags] = useState(book.tags.join('，'))
  const [description, setDescription] = useState(
    prefill?.bookPrefill.description ?? book.description ?? '',
  )
  const [coverUrl, setCoverUrl] = useState(prefill?.bookPrefill.coverUrl ?? book.coverUrl ?? '')

  // —— 编目字段（补全的 recordPrefill.classifications = 现有 ∪ 建议去重） ——
  const [records, setRecords] = useState<Record<string, RecordDraft>>(() => {
    const init: Record<string, RecordDraft> = {}
    for (const cr of catalogRecords) {
      const parsed = parseVolumeFromTitle(titles.get(cr.id) ?? book.title)
      init[cr.id] = {
        metaId: cr.metaId != null ? String(cr.metaId) : '',
        volume:
          cr.volume != null && cr.volume !== '' ? cr.volume : (parsed ?? ''),
        barcodes: cr.barcodes.join('\n'),
        classifications:
          enrichment?.recordId === cr.id && prefill?.recordPrefill
            ? prefill.recordPrefill.classifications
            : [...cr.classifications],
      }
    }
    return init
  })

  // M5 回归：打开期间「重新抓取」→ 上下文替换 → 把新建议分类同步进被补全编目
  // 的草稿（首挂载时与 initializer 幂等；仅改 classifications，不动用户其它编辑）。
  useEffect(() => {
    if (!enrichment || !prefill?.recordPrefill) return
    setRecords((prev) => {
      const next = applyRecordPrefill(
        prev,
        enrichment.recordId,
        prefill.recordPrefill!.classifications,
      )
      return next ?? prev
    })
  }, [enrichment, prefill])

  const [errors, setErrors] = useState<FieldErrors>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const { isbn13: normalizedIsbn13, isbn10: normalizedIsbn10 } = normalizeIsbn(isbn13)

  const validate = () =>
    validateBookFields(
      { title, isbn13, publishDate, pages, priceAmount, priceCurrency, coverUrl },
      t,
    )

  const canSave = !saving && Object.keys(errors).length === 0

  const handleSave = async () => {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length > 0) return
    setSaving(true)
    setSaveError(null)
    try {
      const bookDraft: BookDraft = {
        title: title.trim(),
        subtitle: subtitle.trim() === '' ? null : subtitle.trim(),
        parallelTitles: splitPersons(parallelTitles),
        authors: splitPersons(authors),
        translators: splitPersons(translators),
        publisher: publisher.trim() === '' ? null : publisher.trim(),
        publishDate: publishDate.trim() === '' ? null : publishDate.trim(),
        edition: edition.trim() === '' ? null : edition.trim(),
        pages: pages.trim() === '' ? null : Number(pages),
        price:
          priceAmount.trim() === '' || priceCurrency.trim() === ''
            ? null
            : { amount: Number(priceAmount), currency: priceCurrency.trim() },
        isbn13:
          normalizedIsbn13 ??
          (isbn13.trim() !== '' && /^\d{13}$/.test(cleanIsbn(isbn13) ?? '')
            ? cleanIsbn(isbn13)
            : null),
        isbn10: isbn10.trim() === '' ? null : (normalizedIsbn10 ?? isbn10.trim()),
        subjects: splitPersons(subjects),
        tags: splitPersons(tags),
        description: description.trim() === '' ? null : description.trim(),
        coverUrl: coverUrl.trim() === '' ? null : coverUrl.trim(),
      }
      const recordDrafts: CatalogRecordDraft[] = catalogRecords.map((cr) => {
        const d = records[cr.id]
        return {
          id: cr.id,
          metaId: d.metaId.trim() === '' ? null : d.metaId.trim(),
          volume: d.volume.trim() === '' ? null : d.volume.trim(),
          barcodes: d.barcodes
            .split('\n')
            .map((b) => b.trim())
            .filter((b) => b !== ''),
          classifications: d.classifications,
        }
      })
      // 补全保存：同一事务写目标编目 opacEnrichment（§7.2；Zod 失败整体回滚时状态一并回滚）。
      await updateBookWithRecords(
        db,
        book.id,
        bookDraft,
        recordDrafts,
        enrichment
          ? {
              recordId: enrichment.recordId,
              providerId: enrichment.providerId,
              status: 'fetched',
              fetchedAt: new Date(),
              sourceUrl: enrichment.sourceUrl,
            }
          : undefined,
      )
      onSaved?.()
      onOpenChange(false)
    } catch (err) {
      if (err instanceof IsbnConflictError) {
        setSaveError(t('errors.isbnConflict', { title: err.otherTitle }))
      } else {
        setSaveError(t('errors.saveFailed'))
      }
    } finally {
      setSaving(false)
    }
  }

  const setRecord = (crId: string, patch: Partial<RecordDraft>) =>
    setRecords((prev) => ({ ...prev, [crId]: { ...prev[crId]!, ...patch } }))

  const fillVolumeFromTitle = (cr: CatalogRecord) => {
    const parsed = parseVolumeFromTitle(titles.get(cr.id) ?? book.title)
    if (parsed != null) setRecord(cr.id, { volume: parsed })
  }

  // —— OPAC 补全对照/恢复（§5.4：保存=采纳、恢复=拒绝） ——

  /** 表单同构值 → 只读展示文本（数组按当前语言分隔符、价格 amount+currency）。
   *  仅用于展示（对照/恢复文本）；可编辑输入内容另走 restoreField 的 '，' 数据格式。 */
  const displayValue = (value: unknown): string => {
    if (value == null) return ''
    if (Array.isArray(value)) return formatList(i18n.language, value)
    if (typeof value === 'object' && 'amount' in value && 'currency' in value) {
      const p = value as { amount: number; currency: string }
      return `${p.amount} ${p.currency}`
    }
    return String(value)
  }

  /** 恢复某字段为现有值（conflict 字段；classifications 由编目行内处理）。
   *  数组字段写回可编辑输入：保持规范分隔符 '，'（splitPersons round-trip），
   *  展示文本（displayValue）才用 formatList 本地化分隔。 */
  const restoreField = (field: EnrichmentChange['field'], current: unknown): void => {
    const text = Array.isArray(current) ? current.join('，') : displayValue(current)
    switch (field) {
      case 'title': setTitle(text); break
      case 'subtitle': setSubtitle(text); break
      case 'parallelTitles': setParallelTitles(text); break
      case 'authors': setAuthors(text); break
      case 'translators': setTranslators(text); break
      case 'publisher': setPublisher(text); break
      case 'publishDate': setPublishDate(text); break
      case 'pages': setPages(text); break
      case 'price': {
        const p = current as { amount: number; currency: string } | null
        setPriceAmount(p ? String(p.amount) : '')
        setPriceCurrency(p?.currency ?? '')
        break
      }
      case 'subjects': setSubjects(text); break
      case 'description': setDescription(text); break
      case 'coverUrl': setCoverUrl(text); break
      case 'isbn13': setIsbn13(text); break
      case 'isbn10': setIsbn10(text); break
      default: break
    }
  }

  interface FieldDecor {
    badge?: EnrichmentChange['kind']
    /** 只读展示文本（数组按当前语言分隔符）。 */
    currentText?: string | null
    /** 数据格式文本（数组 '，'），供恢复按钮可见性对照（输入框内容为数据格式）。 */
    currentDataText?: string | null
    onRestore?: () => void
  }

  /** 字段装饰：徽标（建议字段）+ 现有值对照 + 恢复（conflict 字段）。 */
  const decorOf = (field: EnrichmentChange['field']): FieldDecor => {
    const current = conflictCurrentByField.get(field)
    return {
      badge: kindByField.get(field),
      currentText: current === undefined ? undefined : displayValue(current),
      currentDataText:
        current === undefined
          ? undefined
          : Array.isArray(current)
            ? current.join('，')
            : displayValue(current),
      onRestore:
        current === undefined ? undefined : () => restoreField(field, current),
    }
  }

  const textField = (
    key: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    extra?: { mono?: boolean; hint?: string },
    decor?: FieldDecor,
  ) => {
    const err = errors[key as keyof FieldErrors]
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <label htmlFor={key} className="text-xs text-muted-foreground">
            {label}
          </label>
          {decor?.badge && (
            <Badge
              variant={decor.badge === 'conflict' ? 'destructive' : 'outline'}
              className="rounded-none px-1.5 text-[10px] leading-4"
            >
              {t('badge', { ns: 'enrich', provider: providerShort })}
            </Badge>
          )}
        </div>
        {decor?.currentText != null && (
          <p
            className="line-clamp-1 text-[11px] text-muted-foreground/70 line-through decoration-muted-foreground/50"
            title={decor.currentText}
          >
            {t('current', { ns: 'enrich', value: decor.currentText })}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Input
            id={key}
            value={value}
            onChange={(e) => {
              onChange(e.target.value)
              if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }))
            }}
            className={cn(extra?.mono && 'font-mono', decor?.onRestore && 'min-w-0 flex-1')}
            aria-invalid={err !== undefined}
          />
          {decor?.onRestore && value !== decor.currentDataText && (
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={decor.onRestore}
              className="shrink-0"
            >
              {t('restore', { ns: 'enrich' })}
            </Button>
          )}
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        {extra?.hint && !err && (
          <p className="text-xs text-muted-foreground">{extra.hint}</p>
        )}
      </div>
    )
  }

  const priceDecor = decorOf('price')
  const priceCurrent = conflictCurrentByField.get('price') as
    | { amount: number; currency: string }
    | null
    | undefined
  const priceRestoreVisible =
    priceDecor.onRestore != null &&
    (priceAmount !== (priceCurrent ? String(priceCurrent.amount) : '') ||
      priceCurrency !== (priceCurrent?.currency ?? ''))
  const descDecor = decorOf('description')

  return (
    <div className="space-y-4">
      {/* OPAC 补全摘要条（§10：全局兜底审视，逐条细节内联在字段） */}
      {enrichment && enrichedRecord && (
        <p className="text-xs text-muted-foreground">
          {providerShort != null && (
            <span className="font-medium text-foreground">{providerShort} · </span>
          )}
          {t('summary', {
            ns: 'enrich',
            filled: prefill?.applied.length ?? 0,
            conflicts: conflictCount,
          })}
          {enrichment.warnings.length > 0 &&
            ` · ${t('warnings', { ns: 'enrich', count: enrichment.warnings.length })}`}
          {catalogRecords.length > 1 &&
            ` · ${t(badge === 'set' ? 'setMarkAll' : 'targetRecordOnly', { ns: 'enrich' })}`}
        </p>
      )}

      {/* 待审类型徽标 */}
      {badge && (
        <div className="flex gap-2">
          <Badge variant={badge === 'placeholder' ? 'destructive' : 'outline'}>
            {badge === 'placeholder'
              ? t('library.badge.placeholder', { ns: 'pages' })
              : t('library.set', { ns: 'pages' })}
          </Badge>
        </div>
      )}

      {/* 1. 书目 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">{t('section.book')}</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="md:col-span-2">
            {textField('title', `${t('field.title')} *`, title, setTitle, undefined, decorOf('title'))}
          </div>
          {textField('subtitle', t('field.subtitle'), subtitle, setSubtitle, undefined, decorOf('subtitle'))}
          {textField('parallelTitles', t('field.parallelTitles'), parallelTitles, setParallelTitles, undefined, decorOf('parallelTitles'))}
          {textField('authors', t('field.authors'), authors, setAuthors, undefined, decorOf('authors'))}
          {textField('translators', t('field.translators'), translators, setTranslators, undefined, decorOf('translators'))}
          {textField('publisher', t('field.publisher'), publisher, setPublisher, undefined, decorOf('publisher'))}
          {textField('publishDate', t('field.publishDate'), publishDate, setPublishDate, undefined, decorOf('publishDate'))}
          {textField('edition', t('field.edition'), edition, setEdition)}
          {textField('pages', t('field.pages'), pages, setPages, undefined, decorOf('pages'))}
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">{t('field.priceAmount')}</label>
              {priceDecor.badge && (
                <Badge
                  variant={priceDecor.badge === 'conflict' ? 'destructive' : 'outline'}
                  className="rounded-none px-1.5 text-[10px] leading-4"
                >
                  {t('badge', { ns: 'enrich', provider: providerShort })}
                </Badge>
              )}
            </div>
            {priceDecor.currentText != null && (
              <p
                className="line-clamp-1 text-[11px] text-muted-foreground/70 line-through decoration-muted-foreground/50"
                title={priceDecor.currentText}
              >
                {t('current', { ns: 'enrich', value: priceDecor.currentText })}
              </p>
            )}
            <div className="flex gap-2">
              <Input
                value={priceAmount}
                onChange={(e) => {
                  setPriceAmount(e.target.value)
                  setErrors((prev) => ({ ...prev, price: undefined }))
                }}
                inputMode="decimal"
                className="w-28"
                aria-label={t('field.priceAmount')}
                aria-invalid={errors.price !== undefined}
              />
              <Input
                value={priceCurrency}
                onChange={(e) => {
                  setPriceCurrency(e.target.value)
                  setErrors((prev) => ({ ...prev, price: undefined }))
                }}
                placeholder={t('field.priceCurrency')}
                className="w-24"
                aria-label={t('field.priceCurrency')}
              />
              {priceRestoreVisible && (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={priceDecor.onRestore}
                  className="shrink-0"
                >
                  {t('restore', { ns: 'enrich' })}
                </Button>
              )}
            </div>
            {errors.price && <p className="text-xs text-destructive">{errors.price}</p>}
          </div>
          {textField('isbn13', `${t('field.isbn13')} *`, isbn13, setIsbn13, { mono: true }, decorOf('isbn13'))}
          {textField('isbn10', t('field.isbn10'), isbn10, setIsbn10, { mono: true }, decorOf('isbn10'))}
          {textField('subjects', t('field.subjects'), subjects, setSubjects, {
            hint: t('field.subjectsHint'),
          }, decorOf('subjects'))}
          {textField('tags', t('field.tags'), tags, setTags)}
          <div className="md:col-span-2 space-y-1">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">{t('field.description')}</label>
              {descDecor.badge && (
                <Badge
                  variant={descDecor.badge === 'conflict' ? 'destructive' : 'outline'}
                  className="rounded-none px-1.5 text-[10px] leading-4"
                >
                  {t('badge', { ns: 'enrich', provider: providerShort })}
                </Badge>
              )}
            </div>
            {descDecor.currentText != null && (
              <p
                className="line-clamp-1 text-[11px] text-muted-foreground/70 line-through decoration-muted-foreground/50"
                title={descDecor.currentText}
              >
                {t('current', { ns: 'enrich', value: descDecor.currentText })}
              </p>
            )}
            <div className="flex items-start gap-2">
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className={cn(descDecor.onRestore && 'min-w-0 flex-1')}
              />
              {descDecor.onRestore && description !== descDecor.currentDataText && (
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  onClick={descDecor.onRestore}
                  className="shrink-0"
                >
                  {t('restore', { ns: 'enrich' })}
                </Button>
              )}
            </div>
          </div>
          {textField('coverUrl', t('field.coverUrl'), coverUrl, setCoverUrl, { mono: true }, decorOf('coverUrl'))}
        </CardContent>
      </Card>

      {/* 2. 编目 */}
      {catalogRecords.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">{t('section.catalog')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {catalogRecords.map((cr) => {
              const d = records[cr.id]
              const source = sourceById.get(cr.sourceId)
              // OPAC 补全：编目侧分类（追加语义，§5.2）——现有值对照 + 恢复
              const isEnriched = enrichment?.recordId === cr.id
              const classChange = isEnriched
                ? enrichment?.changes.find((c) => c.field === 'classifications')
                : undefined
              const classCurrent = classChange?.current as ClassificationEntry[] | undefined
              const classCurrentText = classCurrent
                ? formatList(i18n.language, classCurrent.map((e) => e.code))
                : ''
              // 恢复仅在有现有值可回退时出现（纯 fill 无对照无恢复）
              const classDirty = Boolean(
                classCurrent &&
                  classCurrent.length > 0 &&
                  (d.classifications.length !== classCurrent.length ||
                    d.classifications.some(
                      (c) =>
                        !classCurrent.some((e) => e.system === c.system && e.code === c.code),
                    )),
              )
              return (
                <div
                  key={cr.id}
                  className={cn(
                    'space-y-3 rounded-none border p-3',
                    isEnriched && 'border-primary ring-1 ring-primary',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {source && (
                      <Badge variant="outline" className="rounded-none">
                        {source.name}
                      </Badge>
                    )}
                    {isEnriched && providerShort != null && (
                      <Badge variant="outline" className="rounded-none border-primary text-primary">
                        {t('targetBadge', { ns: 'enrich', provider: providerShort })}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {titles.get(cr.id) ?? book.title}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        {t('catalog.metaId')}
                      </label>
                      <Input
                        value={d.metaId}
                        onChange={(e) => setRecord(cr.id, { metaId: e.target.value })}
                        className="h-8 w-28 font-mono"
                        aria-label={`${t('catalog.metaId')} ${titles.get(cr.id) ?? cr.id}`}
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        {t('catalog.volume')}
                      </label>
                      <div className="flex gap-2">
                        <Input
                          value={d.volume}
                          onChange={(e) => setRecord(cr.id, { volume: e.target.value })}
                          placeholder={parseVolumeFromTitle(titles.get(cr.id) ?? '') ?? ''}
                          className="h-8 w-24 font-mono"
                          aria-label={`${t('catalog.volume')} ${titles.get(cr.id) ?? cr.id}`}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          type="button"
                          onClick={() => fillVolumeFromTitle(cr)}
                        >
                          <Wand2Icon className="size-3.5" />
                          {t('catalog.volumeParse')}
                        </Button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">
                        {t('catalog.barcodes')}
                      </label>
                      <Textarea
                        value={d.barcodes}
                        onChange={(e) => setRecord(cr.id, { barcodes: e.target.value })}
                        rows={2}
                        className="font-mono text-xs"
                        aria-label={`${t('catalog.barcodes')} ${titles.get(cr.id) ?? cr.id}`}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t('catalog.barcodesHint')}
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="text-xs text-muted-foreground">
                        {t('catalog.classifications')}
                      </label>
                      {classChange && (
                        <>
                          <Badge
                            variant="outline"
                            className="rounded-none px-1.5 text-[10px] leading-4"
                          >
                            {t('badge', { ns: 'enrich', provider: providerShort })}
                          </Badge>
                          {classCurrentText !== '' && (
                            <span
                              className="line-clamp-1 text-[11px] text-muted-foreground/70 line-through decoration-muted-foreground/50"
                              title={classCurrentText}
                            >
                              {t('current', { ns: 'enrich', value: classCurrentText })}
                            </span>
                          )}
                          {classDirty && (
                            <Button
                              variant="outline"
                              size="sm"
                              type="button"
                              className="h-6 shrink-0 px-2 text-[11px]"
                              onClick={() =>
                                setRecord(cr.id, {
                                  classifications: classCurrent?.map((e) => ({ ...e })) ?? [],
                                })
                              }
                            >
                              {t('restore', { ns: 'enrich' })}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                    <div className="space-y-2">
                      {d.classifications.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          <Select
                            value={c.system}
                            onValueChange={(v) => {
                              const next = [...d.classifications]
                              next[i] = { ...c, system: v as ClassificationSystem }
                              setRecord(cr.id, { classifications: next })
                            }}
                          >
                            <SelectTrigger className="h-8 w-28 text-xs" aria-label={t('catalog.classification.system')}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CLASSIFICATION_SYSTEMS.map((s) => (
                                <SelectItem key={s} value={s}>
                                  {s.toUpperCase()}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Input
                            value={c.code}
                            onChange={(e) => {
                              const next = [...d.classifications]
                              next[i] = { ...c, code: e.target.value }
                              setRecord(cr.id, { classifications: next })
                            }}
                            className="h-8 flex-1 font-mono text-xs"
                            aria-label={t('catalog.classification.code')}
                          />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-8"
                            type="button"
                            onClick={() =>
                              setRecord(cr.id, {
                                classifications: d.classifications.filter((_, j) => j !== i),
                              })
                            }
                            aria-label={t('catalog.classification.remove')}
                          >
                            <XIcon className="size-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      type="button"
                      onClick={() =>
                        setRecord(cr.id, {
                          classifications: [
                            ...d.classifications,
                            { system: 'clc' as const, code: '' },
                          ],
                        })
                      }
                    >
                      {t('catalog.addClassification')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      {/* 3. 操作 */}
      <div className="flex items-center gap-2">
        <Button type="button" onClick={() => void handleSave()} disabled={!canSave}>
          {t('save')}
        </Button>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
          {t('cancel')}
        </Button>
        {saveError && <p className="text-sm text-destructive">{saveError}</p>}
      </div>
    </div>
  )
}
