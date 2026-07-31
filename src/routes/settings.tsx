import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { DownloadIcon, FileUpIcon, TrashIcon } from 'lucide-react'

import { db } from '@/db/db-instance'
import { useLocale } from '@/hooks/use-locale'
import { useTheme } from '@/hooks/use-theme'
import { readPreferences, writePreferences, type Theme } from '@/lib/preferences'
import { importDatabase, type ImportMode } from '@/db/export-import'
import { resetDatabase } from '@/db/reset'
import { parseExportText } from '@/db/backup'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { SegmentedControl } from '@/components/ui/segmented-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { TimezoneSelect } from '@/settings/timezone-select'
import { exportBackupAndDownload } from '@/settings/backup-actions'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

const THEME_OPTIONS: Array<{ value: Theme; labelKey: string }> = [
  { value: 'light', labelKey: 'settings.preferences.themeLight' },
  { value: 'dark', labelKey: 'settings.preferences.themeDark' },
  { value: 'auto', labelKey: 'settings.preferences.themeAuto' },
]

/** 偏好区：语言（useLocale）/ 主题（useTheme）/ displayTimezone（readPreferences + writePreferences）。 */
function SettingsPage() {
  const { t } = useTranslation('pages')
  const { theme, setTheme } = useTheme()
  const { locale, setLocale, locales } = useLocale()
  const [timezone, setTimezoneState] = useState(() => readPreferences().displayTimezone)

  const setTimezone = (next: string) => {
    setTimezoneState(next)
    writePreferences({ displayTimezone: next })
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
      <p className="text-muted-foreground">{t('settings.subtitle')}</p>

      {/* 偏好区 */}
      <section className="space-y-4 border-t pt-4">
        <h2 className="text-sm font-semibold">{t('settings.preferences.title')}</h2>

        <div className="flex flex-wrap items-center gap-3">
          <span className="w-32 shrink-0 text-sm text-muted-foreground">
            {t('settings.language.label')}
          </span>
          <SegmentedControl
            value={locale}
            onValueChange={(lng) => void setLocale(lng)}
            options={locales.map((lng) => ({
              value: lng,
              label: t(`settings.language.${lng.replace('-', '')}`),
            }))}
            aria-label={t('settings.language.label')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="w-32 shrink-0 text-sm text-muted-foreground">
            {t('settings.preferences.theme')}
          </span>
          <SegmentedControl
            value={theme}
            onValueChange={setTheme}
            options={THEME_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
            aria-label={t('settings.preferences.theme')}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <span className="w-32 shrink-0 text-sm text-muted-foreground">
            {t('settings.preferences.timezone')}
          </span>
          <TimezoneSelect value={timezone} onValueChange={setTimezone} className="w-72" />
        </div>
      </section>

      <DataSection />
    </div>
  )
}

type ImportState = 'idle' | 'running' | 'done' | 'error'

interface ImportFile {
  name: string
  text: string
}

/** 数据区：导出备份 / 导入备份（snapshot + replay 模式）/ 系统重置（AlertDialog 二次确认 + 勾选门槛）。 */
function DataSection() {
  const { t } = useTranslation('pages')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importFile, setImportFile] = useState<ImportFile | null>(null)
  const [importMode, setImportMode] = useState<ImportMode>('snapshot')
  const [importState, setImportState] = useState<ImportState>('idle')
  const [importError, setImportError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportBackupAndDownload(db)
    } finally {
      setExporting(false)
    }
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    setImportState('idle')
    setImportError(null)
    setImportFile({ name: file.name, text: await file.text() })
  }

  const runImport = async () => {
    if (!importFile) return
    setImportState('running')
    setImportError(null)
    try {
      // 文件入口先经 parseExportText（version/rawRecords/字段非法抛 ZodError，不写库），
      // 再走 importDatabase（snapshot 直接恢复 / replay 重放重建）。
      const data = parseExportText(importFile.text)
      await importDatabase(db, data, { mode: importMode })
      setImportState('done')
    } catch (e) {
      setImportError((e as Error).message)
      setImportState('error')
    }
  }

  return (
    <section className="space-y-4 border-t pt-4">
      <h2 className="text-sm font-semibold">{t('settings.data.title')}</h2>

      {/* 导出备份 */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-32 shrink-0 text-sm text-muted-foreground">
          {t('settings.data.export')}
        </span>
        <Button variant="outline" onClick={() => void handleExport()} disabled={exporting}>
          <DownloadIcon />
          {t('settings.data.export')}
        </Button>
        <p className="text-xs text-muted-foreground">{t('settings.data.export.desc')}</p>
      </div>

      {/* 导入备份：标签 + 统一控件列（各行列同左边界，导入按钮右对齐形成统一右边界） */}
      <div className="flex flex-wrap gap-3">
        <span className="w-32 shrink-0 text-sm text-muted-foreground">
          {t('settings.data.import')}
        </span>
        <div className="min-w-0 max-w-md flex-1 space-y-3">
          {/* 文件选择行（文件名超宽时单行截断，不换行破坏列宽） */}
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <FileUpIcon />
              {t('settings.data.import.choose')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label={t('settings.data.import.choose')}
              onClick={(e) => {
                e.currentTarget.value = ''
              }}
              onChange={(e) => void handleFile(e.target.files?.[0])}
            />
            {importFile && (
              <span
                className="min-w-0 flex-1 truncate text-sm font-medium"
                title={importFile.name}
              >
                {importFile.name}
              </span>
            )}
          </div>

          {/* 恢复模式 + 导入操作行 */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-muted-foreground">{t('settings.data.import.mode')}</span>
            <Select value={importMode} onValueChange={(v) => setImportMode(v as ImportMode)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="snapshot">{t('settings.data.import.mode.snapshot')}</SelectItem>
                <SelectItem value="replay">{t('settings.data.import.mode.replay')}</SelectItem>
              </SelectContent>
            </Select>
            <Button
              className="ml-auto"
              disabled={!importFile || importState === 'running'}
              onClick={() => void runImport()}
            >
              {t('settings.data.import.action')}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {t(
              importMode === 'snapshot'
                ? 'settings.data.import.mode.snapshotDesc'
                : 'settings.data.import.mode.replayDesc',
            )}
          </p>

          {importState === 'running' && (
            <div className="space-y-1">
              <p className="text-sm">{t('settings.data.import.running')}</p>
              <Progress value={undefined} />
            </div>
          )}
          {importState === 'done' && (
            <p className="text-sm text-primary">{t('settings.data.import.done')}</p>
          )}
          {importState === 'error' && (
            <div role="alert" className="space-y-1">
              <p className="text-sm font-medium text-destructive">
                {t('settings.data.import.invalid')}
              </p>
              {importError && <p className="text-xs text-destructive/80">{importError}</p>}
            </div>
          )}
        </div>
      </div>

      <ResetSection />
    </section>
  )
}

/** 系统重置：AlertDialog 二次确认 + 「已导出备份」Checkbox 门槛 + 可选清偏好。 */
function ResetSection() {
  const { t } = useTranslation('pages')
  const [open, setOpen] = useState(false)
  const [backedUp, setBackedUp] = useState(false)
  const [clearPrefs, setClearPrefs] = useState(false)
  const [running, setRunning] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const handleExport = async () => {
    setExporting(true)
    try {
      await exportBackupAndDownload(db)
    } finally {
      setExporting(false)
    }
  }

  const confirmReset = async () => {
    if (!backedUp || running) return
    setRunning(true)
    setError(null)
    try {
      // 默认保留偏好（clearPreferences: false）；用户另选清偏好时一并清除。
      await resetDatabase(db, { clearPreferences: clearPrefs })
      setDone(true)
      setOpen(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="w-32 shrink-0 text-sm text-muted-foreground">
        {t('settings.data.reset')}
      </span>
      <AlertDialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o)
          if (!o) {
            setBackedUp(false)
            setClearPrefs(false)
            setError(null)
          }
        }}
      >
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            onClick={() => {
              setError(null)
              setDone(false)
            }}
          >
            <TrashIcon />
            {t('settings.data.reset')}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('settings.reset.confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.reset.confirm.desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-3">
            <Button variant="outline" onClick={() => void handleExport()} disabled={exporting}>
              <DownloadIcon />
              {t('settings.reset.confirm.export')}
            </Button>
            <label htmlFor="reset-backup-gate" className="flex items-center gap-2 text-sm">
              <Checkbox
                id="reset-backup-gate"
                checked={backedUp}
                onCheckedChange={(v) => setBackedUp(v === true)}
              />
              {t('settings.reset.confirm.backupCheckbox')}
            </label>
            <label htmlFor="reset-clear-prefs" className="flex items-center gap-2 text-sm">
              <Checkbox
                id="reset-clear-prefs"
                checked={clearPrefs}
                onCheckedChange={(v) => setClearPrefs(v === true)}
              />
              {t('settings.reset.confirm.clearPrefs')}
            </label>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {t('settings.reset.failed')}
              </p>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>{t('settings.reset.cancel')}</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={!backedUp || running}
              onClick={() => void confirmReset()}
            >
              {running ? t('settings.reset.running') : t('settings.reset.confirm.confirm')}
            </Button>
          </AlertDialogFooter>
          {running && <Progress value={undefined} />}
        </AlertDialogContent>
      </AlertDialog>
      <p className="text-xs text-muted-foreground">{t('settings.data.reset.desc')}</p>
      {done && <p className="text-sm text-primary">{t('settings.reset.done')}</p>}
    </div>
  )
}
