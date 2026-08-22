// 阅读画像数据响应式 Hook（reading-profile §1/§5，依赖 D-1 dexie-react-hooks）。
//
// `useLiveQuery` 直连 Dexie 取 books/catalogRecords/borrowCycles/sources → 派生
// `ProfileStatsResult`。小数据同步 `useMemo` 跑 `computeProfileStats`；大数据
// （borrowCycles ≥ WORKER_THRESHOLD）下放 `stats-worker.ts`（Comlink）重算，
// 期间回退最近同步结果，避免阻塞主线程。分类体系/时间范围变化用
// `useDeferredValue` 延迟重算，保输入与导航响应（rerender-use-deferred-value）。
//
// 纯函数契约不变：聚合不带时钟/不读写存储；本 Hook 仅做响应式编排。
import { useEffect, useMemo, useState, useDeferredValue } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { wrap } from 'comlink'

import { db } from '@/db/db-instance'
import { computeProfileStats } from '@/lib/profile-stats'
import type {
  ProfileStatsInput,
  ProfileStatsOptions,
  ProfileStatsResult,
} from '@/lib/profile-stats'
import type { ClassificationSystem } from '@/types/entities'

import type { StatsWorkerApi } from './stats-worker'

/** 大数据聚合下放 Worker 的启用阈值（reading-profile §5 候选 5000 区间）。 */
export const WORKER_THRESHOLD = 5000

export interface UseProfileStatsOptions {
  classificationSystem: ClassificationSystem | null
  range: { from: Date | null; to: Date | null } | null
  displayTimezone: string
  /** 借阅日历「今天」锚（调用方传入，不读 Date.now()） */
  calendarAnchor: Date | null
}

export interface ProfileStatsState {
  /** useLiveQuery 未就绪（首次加载）时为 true，UI 渲染 Skeleton。 */
  loading: boolean
  /** 大数据 Worker 重算中（结果尚未回填）时为 true，UI 渲染 Progress。 */
  computing: boolean
  /** 聚合结果；loading 中或异常降级时可为 null。 */
  result: ProfileStatsResult | null
}

type EntityTuple = [
  ProfileStatsInput['books'],
  ProfileStatsInput['catalogRecords'],
  ProfileStatsInput['borrowCycles'],
  ProfileStatsInput['sources'],
]

const EMPTY_TUPLE: EntityTuple = [[], [], [], []]

/**
 * 阅读画像响应式聚合。
 *
 * 输入与聚合都随 IndexedDB 实时更新（`useLiveQuery`）；opts 变化经
 * `useDeferredValue` 延迟重算。大数据（borrowCycles ≥ WORKER_THRESHOLD）
 * 走 Worker；小数据同步 `useMemo`。
 */
export function useProfileStats(opts: UseProfileStatsOptions): ProfileStatsState {
  const data = useLiveQuery<EntityTuple>(
    () =>
      Promise.all([
        db.books.toArray(),
        db.catalogRecords.toArray(),
        db.borrowCycles.toArray(),
        db.sources.toArray(),
      ]),
    [],
  )

  const loading = data === undefined
  const [books, catalogRecords, borrowCycles, sources] = data ?? EMPTY_TUPLE

  // 分类体系/时间范围变化延迟重算，保输入响应（rerender-use-deferred-value）。
  const deferredOpts = useDeferredValue<ProfileStatsOptions>(opts)

  // 小数据同步派生；亦作为大数据 Worker 回填前的回退。
  const syncResult = useMemo<ProfileStatsResult | null>(() => {
    if (!data) return null
    return computeProfileStats(
      { books, catalogRecords, borrowCycles, sources },
      deferredOpts,
    )
  }, [data, books, catalogRecords, borrowCycles, sources, deferredOpts])

  const useWorker = !!data && borrowCycles.length >= WORKER_THRESHOLD

  const [workerResult, setWorkerResult] = useState<ProfileStatsResult | null>(null)
  // M7 回归：Worker 失败标记——旧版失败后 workerResult 恒 null 且无失败态，
  // computing 永久 true（遮罩常驻）；失败降级同步结果并解除遮罩。
  const [workerFailed, setWorkerFailed] = useState(false)

  // 大数据 Worker 重算：opts 或实体变化时重启；卸载时 terminate 防泄漏。
  // 重启先清旧结果与失败态：实体变化后旧 workerResult 是过期聚合，不得展示
  // （回退应取当前实体的 syncResult）；失败后解除 computing 遮罩。
  useEffect(() => {
    if (!useWorker) return
    let cancelled = false
    setWorkerResult(null)
    setWorkerFailed(false)
    const worker = new Worker(new URL('./stats-worker.ts', import.meta.url), {
      type: 'module',
    })
    const api = wrap<StatsWorkerApi>(worker)
    api
      .compute({ books, catalogRecords, borrowCycles, sources }, deferredOpts)
      .then((r: ProfileStatsResult) => {
        if (!cancelled) setWorkerResult(r)
      })
      .catch(() => {
        // Worker 失败降级到同步结果，不崩整页（reading-profile §5）。
        if (!cancelled) setWorkerFailed(true)
      })
    return () => {
      cancelled = true
      worker.terminate()
    }
  }, [useWorker, books, catalogRecords, borrowCycles, sources, deferredOpts])

  const result = useWorker ? (workerResult ?? syncResult) : syncResult
  const computing = useWorker && workerResult === null && !workerFailed

  return { loading, computing, result }
}
