import { useEffect, useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { useLiveQuery } from 'dexie-react-hooks'
import { FileUpIcon } from 'lucide-react'

import { db } from '@/db/db-instance'
import { detectAndDecode, IMPORT_MAX_FILE_SIZE } from '@/lib/encoding'
import { SOURCE_TEMPLATES, ensureSourceFromTemplate } from '@/lib/source-templates'
import { getParser } from '@/parsers/registry'
import { executeImport } from '@/import/run-import'
import type { PipelineResult } from '@/parsers/pipeline'
import type { Source } from '@/types/entities'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const Route = createFileRoute('/import')({
  component: ImportPage,
})

const PREVIEW_LIMIT = 10

interface FileInfo {
  name: string
  size: number
  encoding: string
  text: string
}

/**
 * 单页导入：顶部来源选择，主体区文件选择（选后即预览），右侧栏常驻导入报告。
 * 无来源时自动落库预置模板（取代原「从模板创建」步骤），ensureSourceFromTemplate
 * 幂等（parserId 唯一），重复挂载/并发安全。
 */
function ImportPage() {
  const { t } = useTranslation('pages')
  const sources = useLiveQuery(() => db.sources.toArray(), [])
  const loadingSources = sources === undefined

  // selectedSource 存对象而非仅 id：自动建源后立即可用，避免 useLiveQuery
  // 尚未回查导致 handleFile 拿不到刚落库的 Source。
  const [selectedSource, setSelectedSource] = useState<Source | null>(null)
  const [fileInfo, setFileInfo] = useState<FileInfo | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [result, setResult] = useState<PipelineResult | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!sources) return
    if (sources.length === 0) {
      // 首次使用：自动落库预置模板并选中（取代原「从模板创建」）
      void ensureSourceFromTemplate(db, SOURCE_TEMPLATES[0]!, new Date()).then(setSelectedSource)
    } else if (sources.length === 1 && !selectedSource) {
      // 仅一个来源时直接选中，减少重复导入的点击
      setSelectedSource(sources[0]!)
    }
  }, [sources, selectedSource])

  const clearFile = () => {
    setFileInfo(null)
    setFileError(null)
    setRows(null)
  }

  const pickSource = (id: string) => {
    setSelectedSource(sources?.find((s) => s.id === id) ?? null)
    // 换来源后旧文件/旧报告均属上一来源的解析结果，一并清空
    clearFile()
    setRunError(null)
    setResult(null)
  }

  const handleFile = async (file: File | undefined) => {
    setFileError(null)
    setFileInfo(null)
    if (!file) return
    if (file.size > IMPORT_MAX_FILE_SIZE) {
      setFileError(t('import.file.tooLarge'))
      return
    }
    if (!selectedSource) return
    const { text, detectedEncoding } = detectAndDecode(await file.arrayBuffer())
    const parser = getParser(selectedSource.parserId)
    if (!parser.validate(text)) {
      setFileError(t('import.file.invalid'))
      return
    }
    setFileInfo({ name: file.name, size: file.size, encoding: detectedEncoding, text })
    setRows(JSON.parse(text) as Record<string, unknown>[])
  }

  const startImport = async () => {
    if (!fileInfo || !selectedSource) return
    setRunning(true)
    setRunError(null)
    setResult(null)
    try {
      const res = await executeImport(db, {
        fileName: fileInfo.name,
        fileSize: fileInfo.size,
        detectedEncoding: fileInfo.encoding,
        text: fileInfo.text,
        sourceId: selectedSource.id,
      })
      setResult(res)
    } catch (e) {
      setRunError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  const resetImport = () => {
    clearFile()
    setRunning(false)
    setRunError(null)
    setResult(null)
  }

  const previewRows = (rows ?? []).slice(0, PREVIEW_LIMIT)
  const previewTitle = (r: Record<string, unknown>) =>
    typeof r.title === 'string' ? r.title : ''

  if (loadingSources) return <div className="p-6" />

  return (
    <div className="flex flex-col p-6">
      <h1 className="text-2xl font-bold">{t('import.title')}</h1>
      <p className="text-muted-foreground">{t('import.subtitle')}</p>

      {/* 来源选择 */}
      <div className="mt-6 flex items-center gap-2">
        <span className="text-sm text-muted-foreground">{t('import.source.existing')}</span>
        <Select value={selectedSource?.id ?? ''} onValueChange={pickSource}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder={t('import.source.existing')} />
          </SelectTrigger>
          <SelectContent>
            {(sources ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* 主体：文件选择/预览；右侧栏：导入报告 */}
      <div className="mt-6 grid flex-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-4">
          {fileInfo ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{fileInfo.name}</span>
                <Badge variant="outline" className="rounded-none">
                  {t('import.file.encoding')}: {fileInfo.encoding}
                </Badge>
                {selectedSource && (
                  <Badge variant="outline" className="rounded-none">
                    {t('import.file.parser')}: {selectedSource.name}
                  </Badge>
                )}
              </div>
              <h2 className="text-sm font-medium">{t('import.preview.title')}</h2>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('import.preview.column.date')}</TableHead>
                    <TableHead>{t('import.preview.column.optype')}</TableHead>
                    <TableHead>{t('import.preview.column.title')}</TableHead>
                    <TableHead className="hidden md:table-cell">
                      {t('import.preview.column.barcode')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {previewRows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="tabular-nums">
                        {String(r.date ?? '')}
                      </TableCell>
                      <TableCell>{String(r.optype ?? '')}</TableCell>
                      <TableCell className="max-w-64 truncate">
                        {previewTitle(r) || '—'}
                      </TableCell>
                      <TableCell className="hidden font-mono text-xs md:table-cell">
                        {String(r.barcode ?? '')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="text-xs text-muted-foreground">{t('import.preview.note')}</p>
              <div className="flex gap-2">
                <Button disabled={running} onClick={() => void startImport()}>
                  {t('import.execute.action')}
                </Button>
                <Button
                  variant="outline"
                  disabled={running}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {t('import.file.rechoose')}
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-none border border-dashed border-border p-10">
              <div className="flex flex-col items-center gap-3">
                <FileUpIcon className="size-8 text-muted-foreground" />
                <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                  {t('import.file.label')}
                </Button>
                <p className="text-center text-xs text-muted-foreground">
                  {t('import.file.hint')}
                </p>
              </div>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            aria-label={t('import.file.label')}
            onClick={(e) => {
              e.currentTarget.value = ''
            }}
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
          {fileError && (
            <p role="alert" className="text-sm text-destructive">
              {fileError}
            </p>
          )}
        </main>

        {/* 右侧报告栏 */}
        <aside className="space-y-4">
          <h2 className="text-sm font-medium">{t('import.report.heading')}</h2>
          {running ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t('import.execute.running')}</p>
              <p className="text-xs text-muted-foreground">
                {t('import.execute.progress')}
              </p>
              <Progress value={undefined} />
            </div>
          ) : runError ? (
            <div role="alert" className="space-y-1">
              <p className="text-sm font-medium text-destructive">
                {t('import.execute.failed')}
              </p>
              <p className="text-sm text-destructive/80">{runError}</p>
              <p className="text-xs text-muted-foreground">
                {t('import.execute.failedDesc')}
              </p>
            </div>
          ) : result ? (
            <>
              <h3 className="text-lg font-semibold">{t('import.report.title')}</h3>
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-none border border-border p-3">
                  <p className="text-2xl font-bold tabular-nums">
                    {result.importLog.stats.newBooks}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('import.report.newBooks')}
                  </p>
                </div>
                <div className="rounded-none border border-border p-3">
                  <p className="text-2xl font-bold tabular-nums">
                    {result.importLog.stats.newBorrowCycles}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('import.report.newCycles')}
                  </p>
                </div>
                <div className="rounded-none border border-border p-3">
                  <p className="text-2xl font-bold tabular-nums">
                    {result.importLog.stats.skippedRecords}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('import.report.skipped')}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium">{t('import.report.warnings')}</p>
                {result.warnings.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('import.report.warnings.none')}
                  </p>
                ) : (
                  <ul className="mt-2 max-h-56 space-y-1.5 overflow-y-auto">
                    {result.warnings.map((w, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 rounded-none border border-border p-2 text-sm"
                      >
                        <Badge variant="outline" className="shrink-0 rounded-none">
                          {t(`import.warning.${w.type}`)}
                        </Badge>
                        <span className="min-w-0 flex-1">{w.message}</span>
                        {w.recordRef && (
                          <span className="shrink-0 font-mono text-xs text-muted-foreground">
                            {w.recordRef}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2">
                <Button asChild>
                  <Link to="/library">{t('import.report.toLibrary')}</Link>
                </Button>
                <Button variant="outline" onClick={resetImport}>
                  {t('import.report.importAgain')}
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{t('import.report.empty')}</p>
          )}
        </aside>
      </div>
    </div>
  )
}
