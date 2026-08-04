// 统一编辑表单（book-editing 规格 §3）。宽屏 Dialog（max-w-5xl，移动端 Drawer）。
// 书目全字段 + 每 CatalogRecord 的 volume/barcodes/classifications；保存走
// updateBookWithRecords 单事务（ISBN 冲突 IsbnConflictError 内联展示）。
// 普通书目、选书帮占位、套装候选共用；待审类型差异仅体现在徽标与卷号解析辅助。
import { useState } from 'react'
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
import { formatDateInTz } from '@/lib/display-time'
import { catalogTitleByRecord, reviewBadgeOf } from '@/lib/book-status'
import { parseVolumeFromTitle } from '@/lib/volume'
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
  updateBookWithRecords,
  type BookDraft,
  type CatalogRecordDraft,
} from './-edit-actions'

export interface EditDialogProps {
  book: Book
  catalogRecords: CatalogRecord[]
  rawRecords: RawRecord[]
  sources: Source[]
  open: boolean
  onOpenChange: (open: boolean) => void
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

/** 编目行本地编辑态。 */
interface RecordDraft {
  metaId: string
  volume: string
  /** 条码多行文本（每行一条）。 */
  barcodes: string
  classifications: ClassificationEntry[]
}

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
}: EditDialogProps) {
  const { t } = useTranslation('edit')
  const titles = catalogTitleByRecord(book.id, catalogRecords, rawRecords)
  const sourceById = new Map(sources.map((s) => [s.id, s]))
  const badge = reviewBadgeOf(book, book.id, catalogRecords)

  // —— 书目字段 ——
  const [title, setTitle] = useState(book.title)
  const [subtitle, setSubtitle] = useState(book.subtitle ?? '')
  const [parallelTitles, setParallelTitles] = useState(book.parallelTitles.join('，'))
  const [authors, setAuthors] = useState(book.authors.join('，'))
  const [translators, setTranslators] = useState(book.translators.join('，'))
  const [publisher, setPublisher] = useState(book.publisher ?? '')
  // 旧导出/夹具中 publishDate 可能被 revive 为 Date（e2e-seed DATE_KEYS）；归一为字符串（与详情页同款逻辑）。
  const publishDateRaw = book.publishDate
  const publishDateInit =
    publishDateRaw != null && typeof publishDateRaw === 'object'
      ? formatDateInTz(publishDateRaw as Date, 'UTC')
      : publishDateRaw
  const [publishDate, setPublishDate] = useState(publishDateInit ?? '')
  const [edition, setEdition] = useState(book.edition ?? '')
  const [pages, setPages] = useState(book.pages != null ? String(book.pages) : '')
  const [priceAmount, setPriceAmount] = useState(book.price != null ? String(book.price.amount) : '')
  const [priceCurrency, setPriceCurrency] = useState(book.price?.currency ?? '')
  const [isbn13, setIsbn13] = useState(book.isbn13 ?? '')
  const [isbn10, setIsbn10] = useState(book.isbn10 ?? '')
  const [subjects, setSubjects] = useState(book.subjects.join('，'))
  const [tags, setTags] = useState(book.tags.join('，'))
  const [description, setDescription] = useState(book.description ?? '')
  const [coverUrl, setCoverUrl] = useState(book.coverUrl ?? '')

  // —— 编目字段 ——
  const [records, setRecords] = useState<Record<string, RecordDraft>>(() => {
    const init: Record<string, RecordDraft> = {}
    for (const cr of catalogRecords) {
      const parsed = parseVolumeFromTitle(titles.get(cr.id) ?? book.title)
      init[cr.id] = {
        metaId: cr.metaId != null ? String(cr.metaId) : '',
        volume:
          cr.volume != null && cr.volume !== '' ? cr.volume : (parsed ?? ''),
        barcodes: cr.barcodes.join('\n'),
        classifications: [...cr.classifications],
      }
    }
    return init
  })

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
      await updateBookWithRecords(db, book.id, bookDraft, recordDrafts)
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

  const textField = (
    key: string,
    label: string,
    value: string,
    onChange: (v: string) => void,
    extra?: { mono?: boolean; hint?: string },
  ) => {
    const err = errors[key as keyof FieldErrors]
    return (
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{label}</label>
        <Input
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            if (key in errors) setErrors((prev) => ({ ...prev, [key]: undefined }))
          }}
          className={extra?.mono ? 'font-mono' : undefined}
          aria-invalid={err !== undefined}
        />
        {err && <p className="text-xs text-destructive">{err}</p>}
        {extra?.hint && !err && (
          <p className="text-xs text-muted-foreground">{extra.hint}</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
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
          <div className="md:col-span-2">{textField('title', `${t('field.title')} *`, title, setTitle)}</div>
          {textField('subtitle', t('field.subtitle'), subtitle, setSubtitle)}
          {textField('parallelTitles', t('field.parallelTitles'), parallelTitles, setParallelTitles)}
          {textField('authors', t('field.authors'), authors, setAuthors)}
          {textField('translators', t('field.translators'), translators, setTranslators)}
          {textField('publisher', t('field.publisher'), publisher, setPublisher)}
          {textField('publishDate', t('field.publishDate'), publishDate, setPublishDate)}
          {textField('edition', t('field.edition'), edition, setEdition)}
          {textField('pages', t('field.pages'), pages, setPages)}
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{t('field.priceAmount')}</label>
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
            </div>
            {errors.price && <p className="text-xs text-destructive">{errors.price}</p>}
          </div>
          {textField('isbn13', `${t('field.isbn13')} *`, isbn13, setIsbn13, { mono: true })}
          {textField('isbn10', t('field.isbn10'), isbn10, setIsbn10, { mono: true })}
          {textField('subjects', t('field.subjects'), subjects, setSubjects, {
            hint: t('field.subjectsHint'),
          })}
          {textField('tags', t('field.tags'), tags, setTags)}
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs text-muted-foreground">{t('field.description')}</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
          {textField('coverUrl', t('field.coverUrl'), coverUrl, setCoverUrl, { mono: true })}
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
              return (
                <div key={cr.id} className="space-y-3 rounded-none border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {source && (
                      <Badge variant="outline" className="rounded-none">
                        {source.name}
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
                    <label className="text-xs text-muted-foreground">
                      {t('catalog.classifications')}
                    </label>
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
                            aria-label={t('cancel')}
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
