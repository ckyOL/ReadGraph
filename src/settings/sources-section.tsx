import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { PencilIcon, PlusIcon } from 'lucide-react'

import { db } from '@/db/db-instance'
import { createRepositories } from '@/db/repositories'
import { uuid } from '@/db/uuid'
import { SOURCE_TEMPLATES, sourceFromTemplate } from '@/lib/source-templates'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty'
import { TimezoneSelect } from './timezone-select'
import type { ClassificationSystem, Source } from '@/types/entities'

type DialogState = { mode: 'new' } | { mode: 'edit'; source: Source }

const NONE = 'none'

const CLASSIFICATION_OPTIONS: Array<{ value: ClassificationSystem | null; labelKey: string }> = [
  { value: null, labelKey: 'settings.sources.form.classification.none' },
  { value: 'clc', labelKey: 'profile.toolbar.classification.clc' },
  { value: 'ddc', labelKey: 'profile.toolbar.classification.ddc' },
  { value: 'lcc', labelKey: 'profile.toolbar.classification.lcc' },
  { value: 'udc', labelKey: 'profile.toolbar.classification.udc' },
  { value: 'other', labelKey: 'settings.sources.form.classification.other' },
]

function classificationLabelKey(system: ClassificationSystem | null | undefined): string {
  if (!system) return 'settings.sources.form.classification.none'
  if (system === 'other') return 'settings.sources.form.classification.other'
  return `profile.toolbar.classification.${system}`
}

function SourceDialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  const { t } = useTranslation('pages')
  const isEdit = state.mode === 'edit'
  const [name, setName] = useState(isEdit ? state.source.name : '')
  const [timezone, setTimezone] = useState(isEdit ? state.source.timezone : 'Asia/Shanghai')
  const [classification, setClassification] = useState(
    isEdit ? (state.source.library?.classificationSystem ?? NONE) : NONE,
  )
  const [notes, setNotes] = useState(isEdit ? (state.source.notes ?? '') : '')
  const [error, setError] = useState<string | null>(null)

  const buildSource = (): Source => {
    const sys = classification === NONE ? null : (classification as ClassificationSystem)
    const base = isEdit
      ? state.source
      : {
          id: uuid(),
          type: 'manual' as const,
          parserId: `manual-${uuid().slice(0, 8)}`,
          parserVersion: null,
          createdAt: new Date(),
          lastImportAt: null,
          totalImportedRecords: 0,
        }
    // 编辑保留既有 library 字段，仅覆盖分类体系；新建自定义来源无分类体系时 library=null。
    const library = sys
      ? {
          ...(isEdit && state.source.library
            ? state.source.library
            : {
                libraryType: 'public' as const,
                city: null,
                province: null,
                website: null,
                opacUrl: null,
              }),
          classificationSystem: sys,
        }
      : null
    return {
      ...base,
      name: name.trim(),
      timezone,
      library,
      notes: notes.trim() || null,
    }
  }

  const saveCustom = async () => {
    setError(null)
    try {
      // Repository.put 落库前跑 sourceSchema.safeParse（§6：put 前校验）。
      await createRepositories(db).sources.put(buildSource())
      onClose()
    } catch {
      setError(t('settings.sources.invalid'))
    }
  }

  const createFromTemplate = async (tplIndex: number) => {
    const tpl = SOURCE_TEMPLATES[tplIndex]
    if (!tpl) return
    setError(null)
    try {
      await createRepositories(db).sources.put(sourceFromTemplate(tpl, new Date()))
      onClose()
    } catch {
      setError(t('settings.sources.invalid'))
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t(isEdit ? 'settings.sources.edit.title' : 'settings.sources.new.title')}</DialogTitle>
          <DialogDescription>{t('settings.sources.subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!isEdit && (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('settings.sources.new.template')}</p>
              <ul className="space-y-2">
                {SOURCE_TEMPLATES.map((tpl, i) => (
                  <li
                    key={tpl.parserId}
                    className="flex items-center justify-between gap-3 border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{tpl.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {tpl.parserId} · {tpl.timezone}
                      </p>
                    </div>
                    <Button size="sm" onClick={() => void createFromTemplate(i)}>
                      {t('settings.sources.new.template')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-3">
            {!isEdit && (
              <p className="text-sm font-medium">{t('settings.sources.new.custom')}</p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm text-muted-foreground">{t('settings.sources.form.name')}</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('settings.sources.form.name')}
                className="w-64"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm text-muted-foreground">{t('settings.sources.form.timezone')}</span>
              <TimezoneSelect value={timezone} onValueChange={setTimezone} className="w-64" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm text-muted-foreground">
                {t('settings.sources.form.classification')}
              </span>
              <Select
                value={classification}
                onValueChange={setClassification}
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CLASSIFICATION_OPTIONS.map((o) => (
                    <SelectItem key={o.value ?? NONE} value={o.value ?? NONE}>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="w-24 text-sm text-muted-foreground">{t('settings.sources.form.notes')}</span>
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('settings.sources.form.notes')}
                className="w-64"
              />
            </div>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('settings.sources.form.cancel')}
          </Button>
          <Button onClick={() => void saveCustom()}>{t('settings.sources.form.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 来源管理区（settings 规格 §6）：列表 + 编辑/新建；删除不提供（由系统重置统一处理）。 */
export function SourcesSection() {
  const { t } = useTranslation('pages')
  const sources = useLiveQuery(() => db.sources.toArray(), [])
  const [dialog, setDialog] = useState<DialogState | null>(null)

  if (sources === undefined) return <div className="p-2" />

  return (
    <section className="space-y-4 border-t pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">{t('settings.sources.title')}</h2>
          <p className="text-xs text-muted-foreground">{t('settings.sources.subtitle')}</p>
        </div>
        <Button size="sm" onClick={() => setDialog({ mode: 'new' })}>
          <PlusIcon />
          {t('settings.sources.new')}
        </Button>
      </div>

      {sources.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>{t('settings.sources.empty.title')}</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <EmptyDescription>{t('settings.sources.empty.description')}</EmptyDescription>
          </EmptyContent>
        </Empty>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('settings.sources.column.name')}</TableHead>
              <TableHead className="hidden md:table-cell">{t('settings.sources.column.parser')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('settings.sources.column.type')}</TableHead>
              <TableHead className="hidden sm:table-cell">{t('settings.sources.column.timezone')}</TableHead>
              <TableHead className="hidden lg:table-cell">{t('settings.sources.column.classification')}</TableHead>
              <TableHead className="w-20" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.map((s) => (
              <TableRow key={s.id}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="hidden font-mono text-xs md:table-cell">{s.parserId}</TableCell>
                <TableCell className="hidden sm:table-cell">
                  <Badge variant="outline" className="rounded-none">
                    {t(`settings.sources.type.${s.type}`)}
                  </Badge>
                </TableCell>
                <TableCell className="hidden font-mono text-xs sm:table-cell">{s.timezone}</TableCell>
                <TableCell className="hidden lg:table-cell">
                  {t(classificationLabelKey(s.library?.classificationSystem))}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDialog({ mode: 'edit', source: s })}
                  >
                    <PencilIcon />
                    {t('settings.sources.edit')}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {dialog && <SourceDialog state={dialog} onClose={() => setDialog(null)} />}
    </section>
  )
}
