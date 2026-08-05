// 批量补全面板（opac-enrichment 规格 §7/§10）：按 provider 分组的触发按钮（各自计数）→
// 抓取进度（受控整数 N/M）→ 结果面板「成功 M / 未找到 K / 失败 F」→ 成功项逐条
// 「查看改动并应用」；面板关闭后未应用项不保留（会话内存，重新触发将重新抓取）。
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { db } from '@/db/db-instance'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  enrichCatalogRecords,
  groupCandidatesByProvider,
  type EnrichCandidate,
  type EnrichSummary,
  type EnrichSuccess,
} from '@/enrich/enrich-service'

export interface EnrichBatchPanelProps {
  candidates: EnrichCandidate[]
  /** 占位 Book 记录数（§7.1：置灰并单独说明，不计入候选）。 */
  placeholderExcluded?: number
  /** 应用成功项：写入会话上下文并导航到该书编辑 Dialog（调用方负责）。 */
  onApply: (success: EnrichSuccess) => void
}

export function EnrichBatchPanel({
  candidates,
  placeholderExcluded = 0,
  onApply,
}: EnrichBatchPanelProps) {
  const { t } = useTranslation('enrich')
  const groups = groupCandidatesByProvider(candidates)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [summary, setSummary] = useState<EnrichSummary | null>(null)

  if (groups.length === 0) return null

  const run = async (groupCandidates: EnrichCandidate[]) => {
    setRunning(true)
    setSummary(null)
    setProgress({ done: 0, total: groupCandidates.length })
    try {
      // 抓取阶段：成功项零实体写入，仅回写 not_found/failed 状态（§7）。
      const result = await enrichCatalogRecords(db, groupCandidates, {
        concurrency: 4,
        timeoutMs: 10_000,
        onProgress: (done, total) => setProgress({ done, total }),
      })
      setSummary(result)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {groups.map((g) => (
          <Button
            key={g.provider.id}
            size="sm"
            variant="outline"
            disabled={running}
            onClick={() => void run(g.candidates)}
          >
            {t('fetch', { provider: g.provider.displayName })} ({g.candidates.length})
          </Button>
        ))}
        {placeholderExcluded > 0 && (
          <span className="text-xs text-muted-foreground">
            {t('batch.placeholderNote', { count: placeholderExcluded })}
          </span>
        )}
      </div>
      {running && progress && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Progress value={(progress.done / progress.total) * 100} className="w-48" />
          <span className="tabular-nums">
            {t('batch.running', { done: progress.done, total: progress.total })}
          </span>
        </div>
      )}
      {summary && (
        <div className="space-y-2 border p-3">
          <p className="text-xs text-muted-foreground">
            {t('batch.result', {
              ok: summary.successes.length,
              notFound: summary.notFound.length,
              failed: summary.failed.length,
            })}
          </p>
          {summary.successes.length > 0 && (
            <ul className="space-y-1">
              {summary.successes.map((s) => (
                <li
                  key={s.record.id}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="min-w-0 truncate">{s.book.title}</span>
                  <Button size="sm" variant="outline" onClick={() => onApply(s)}>
                    {t('batch.apply')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
