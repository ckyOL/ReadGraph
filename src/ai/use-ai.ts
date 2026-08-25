// AI 阅读画像编排 Hook（ai-features §3.1 管道流程 ①–⑦ / §4.1 / §5.3 / §5.4）。
// 职责边界：响应式聚合（与 use-profile-stats 同源实体，range 固定 null = 全量口径）、
// 状态管理（markdown/loading/error/pendingPreview/streamingMarkdown/并发闸）与预览门接线；
// 编排核心（缓存检查→装配→预览门→上送→错误分级）为纯函数，落在
// insight-pipeline.ts（依赖注入可单测），本 Hook 只做数据源接入与状态落位。
// 输入独立性（§2.7）：生成输入只消费本地实体+聚合+payload，markdown 状态绝不参与
// 生成输入——防幻觉传播。
import { useCallback, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'

import { createAiProvider } from '@/ai/ai-provider'
import { runInsightPipeline, submitInsightPayload } from '@/ai/insight-pipeline'
import type { AiInsightError, InsightPipelineDeps } from '@/ai/insight-pipeline'
import {
  PROFILE_TEMPERATURE,
  buildProfileInsightsPrompt,
  validateProfileInsightsMarkdown,
} from '@/ai/prompts/profile-insights'
import type { ProfilePayload } from '@/ai/sanitize'
import { db } from '@/db/db-instance'
import { readAiApiKey } from '@/lib/ai-api-key'
import { readAiCache, writeAiCache } from '@/lib/ai-cache'
import type { Locale } from '@/lib/locale'
import { readPreferences } from '@/lib/preferences'
import { computeProfileStats } from '@/lib/profile-stats'
import type { ProfileStatsInput, ProfileStatsResult } from '@/lib/profile-stats'
import type { ClassificationSystem } from '@/types/entities'

/** 画像场景缓存键（§5.3）：scene/key 形态固定；Phase 1 全量口径固定 'all-v2'，
 *  range 预留。'all-v2'：2026-08-25 markdown 切换 bump——旧 JSON 条目缓存失效。 */
const CACHE_SCENE = 'profile'
const CACHE_KEY = 'all-v2'

export interface UseAiInsightsOptions {
  classificationSystem: ClassificationSystem | null
  displayTimezone: string
  /** 借阅日历「今天」锚（透传 computeProfileStats，调用方传入，不读 Date.now()） */
  calendarAnchor: Date | null
}

// 错误分级类型归属编排核心模块（insight-pipeline.ts）；对外签名不变（再导出）。
export type { AiInsightError } from '@/ai/insight-pipeline'

export interface UseAiInsightsState {
  /** 生成结果（markdown 文本）；未生成/无数据时为 null */
  markdown: string | null
  /** 流式增量预览（§4.1 逐字文本流）：上送在途时累积 markdown 文本逐步落位；
   *  最终定稿（成功写缓存）或失败后清空。null = 无增量。 */
  streamingMarkdown: string | null
  /** thinking 模型思考过程增量（§4.1）：仅流式中展示（灰色思考块），定稿/失败清空。 */
  streamingReasoning: string | null
  /** 覆盖生成与重新生成（§8 rerender-transitions：Skeleton 占位 + 按钮禁用） */
  loading: boolean
  error: AiInsightError | null
  /** 预览门（§3.1 ④）：sendPreview=true 时 generate() 停在此处；
   *  F-2 据此挂 AiSendPreviewDialog，payload 与上送为同一对象引用（§3.3 防漂移）。 */
  pendingPreview: ProfilePayload | null
  /** 触发生成：未启用/聚合无数据静默返回；缓存命中直出；error 状态下再次调用即重试。
   *  bypassCache=true（重新生成，§4.1 整体可重新生成）绕过缓存重新请求并覆盖。 */
  generate: (bypassCache?: boolean) => Promise<void>
  /** 预览确认：用 pendingPreview（同一引用）走上送路径。 */
  confirmGenerate: () => Promise<void>
  /** 预览取消：仅关闭预览门，不置 error。 */
  cancelGenerate: () => void
}

type EntityTuple = [
  ProfileStatsInput['books'],
  ProfileStatsInput['catalogRecords'],
  ProfileStatsInput['borrowCycles'],
  ProfileStatsInput['sources'],
]

const EMPTY_TUPLE: EntityTuple = [[], [], [], []]

/**
 * AI 阅读画像编排 Hook。
 *
 * 数据：useLiveQuery 直连四类实体（与 use-profile-stats 同源；未就绪时 empty 兜底、
 * 结构完整），useMemo 跑 computeProfileStats——range 固定 null = 全量口径，
 * 不与 range 联动（§4.1），classificationSystem/displayTimezone/calendarAnchor 透传。
 *
 * 上述编排核心为 insight-pipeline.ts 纯函数（依赖注入：实体/聚合/偏好/缓存/上送），
 * 本 Hook 只注入数据源（db/偏好/apiKey）与状态落位；loading 覆盖生成与重新生成，
 * error 状态下再次 generate() 即重试。
 */
export function useAiInsights(opts: UseAiInsightsOptions): UseAiInsightsState {
  const { i18n } = useTranslation('pages')
  // 缓存键与 prompt 语言一致（§5.3）；仅 'zh-CN'/'en' 两个已配置 locale，其余回退默认。
  const locale: Locale = i18n.language === 'en' ? 'en' : 'zh-CN'

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
  const [books, catalogRecords, borrowCycles, sources] = data ?? EMPTY_TUPLE

  // 全量口径聚合：range 固定 null（§4.1 不与 range 联动）；opts 其余透传。
  const stats = useMemo<ProfileStatsResult | null>(() => {
    if (!data) return null
    return computeProfileStats(
      { books, catalogRecords, borrowCycles, sources },
      {
        classificationSystem: opts.classificationSystem,
        range: null,
        displayTimezone: opts.displayTimezone,
        calendarAnchor: opts.calendarAnchor,
      },
    )
  }, [
    data,
    books,
    catalogRecords,
    borrowCycles,
    sources,
    opts.classificationSystem,
    opts.displayTimezone,
    opts.calendarAnchor,
  ])

  const [markdown, setMarkdown] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AiInsightError | null>(null)
  const [pendingPreview, setPendingPreview] = useState<ProfilePayload | null>(null)
  // 流式增量预览（§4.1 逐字文本流）：上送在途时逐步落位累积文本。
  const [streamingMarkdown, setStreamingMarkdown] = useState<string | null>(null)
  // thinking 模型思考过程（§4.1）：reasoning_content 增量，仅展示不参与定稿。
  const [streamingReasoning, setStreamingReasoning] = useState<string | null>(null)
  // 并发防护：上送在途时忽略重复的 generate/confirm 触发。
  const busyRef = useRef(false)

  /**
   * 上送（§3.1 ⑤⑥）：绑定 provider 的 chat 门面，由管线 submitInsightPayload 调用；
   * payload 即预览展示的同一对象引用（§3.3）。prompt 数据区只取 payload 白名单子集
   * （summary + books，prompts 契约）。流式路径（§4.1）：chatStream 逐增量累积文本，
   * 每次增量经 onPartial 落位（逐字渐进渲染），thinking 思考过程经 onReasoning
   * 落位（仅展示）；流结束后完整文本过 validateProfileInsightsMarkdown 弱校验
   * （失败抛 ZodError，管线按 validation 分级）。
   * 成功/失败与缓存写入由管线处理，此处只管理并发闸、loading 态与增量状态。
   */
  const submit = useCallback<InsightPipelineDeps['submit']>(
    async (payload, locale, onPartial, onReasoning) => {
      busyRef.current = true
      setLoading(true)
      setError(null)
      setPendingPreview(null)
      setStreamingMarkdown(null)
      setStreamingReasoning(null)
      try {
        const prefs = readPreferences()
        const provider = createAiProvider({
          baseUrl: prefs.ai.baseUrl,
          apiKey: readAiApiKey(),
          model: prefs.ai.model,
          temperature: PROFILE_TEMPERATURE,
        })
        const messages = buildProfileInsightsPrompt({
          summary: payload.summary,
          books: payload.books,
          locale,
        })
        // 流式路径（§4.1）：增量累积文本 → 每次增量 onPartial/onReasoning 落位
        // （逐字渐进渲染；thinking 思考过程分通道）→ 流结束后完整文本过弱校验
        // （失败抛 ZodError，管线按 validation 分级）。
        let text = ''
        let reasoning = ''
        for await (const chunk of provider.chatStream(messages)) {
          if (chunk.kind === 'reasoning') {
            reasoning += chunk.text
            if (onReasoning) onReasoning(reasoning)
          } else {
            text += chunk.text
            if (onPartial) onPartial(text)
          }
        }
        return validateProfileInsightsMarkdown(text)
      } finally {
        busyRef.current = false
        setLoading(false)
      }
    },
    [],
  )

  const pipelineDeps = useMemo<InsightPipelineDeps>(
    () => ({
      readCache: readAiCache,
      writeCache: writeAiCache,
      submit,
    }),
    [submit],
  )

  const generate = useCallback(
    async (bypassCache = false) => {
      if (busyRef.current || pendingPreview) return
      const prefs = readPreferences()
      // 编排核心（缓存检查→装配→预览门→上送→错误分级）在 insight-pipeline.ts：
      // 未启用/聚合无数据 → skipped（静默，不清 error）；未配置端点/模型 → unconfigured；
      // 缓存命中（损坏视为未命中）→ cache-hit 直出；未命中 → 装配 → 预览门或直接上送。
      // 「重新生成」bypassCache=true 绕过缓存重新请求并覆盖缓存（§4.1）。
      // 流式增量（§4.1）：上送在途时 onPartial 落位 streamingMarkdown，定稿/失败清空。
      const result = await runInsightPipeline(
        {
          prefs: prefs.ai,
          locale,
          entities: { books, catalogRecords, borrowCycles, sources },
          stats,
          classificationSystem: opts.classificationSystem,
          bypassCache,
          scene: CACHE_SCENE,
          key: CACHE_KEY,
        },
        pipelineDeps,
        (partial) => setStreamingMarkdown(partial),
        (partial) => setStreamingReasoning(partial),
      )
      switch (result.status) {
        case 'skipped':
          // 静默返回，不置 error。
          return
        case 'unconfigured':
          setError(result.error)
          return
        case 'cache-hit':
          setError(null)
          setMarkdown(result.markdown)
          return
        case 'pending-preview':
          setError(null)
          setPendingPreview(result.payload)
          return
        case 'success':
          setError(null)
          setStreamingMarkdown(null)
          setStreamingReasoning(null)
          setMarkdown(result.markdown)
          return
        case 'error':
          setStreamingMarkdown(null)
          setStreamingReasoning(null)
          setError(result.error)
          return
      }
    },
    [
      stats,
      books,
      catalogRecords,
      borrowCycles,
      sources,
      locale,
      opts.classificationSystem,
      pendingPreview,
      pipelineDeps,
    ],
  )

  const confirmGenerate = useCallback(async () => {
    if (busyRef.current || !pendingPreview) return
    // 上送对象与预览展示对象同一引用（§3.3）。
    const result = await submitInsightPayload(
      pendingPreview,
      { locale, scene: CACHE_SCENE, key: CACHE_KEY },
      pipelineDeps,
      (partial) => setStreamingMarkdown(partial),
      (partial) => setStreamingReasoning(partial),
    )
    if (result.status === 'success') {
      setStreamingMarkdown(null)
      setStreamingReasoning(null)
      setMarkdown(result.markdown)
    } else {
      setStreamingMarkdown(null)
      setStreamingReasoning(null)
      setError(result.error)
    }
  }, [pendingPreview, locale, pipelineDeps])

  const cancelGenerate = useCallback(() => {
    setPendingPreview(null)
  }, [])

  return {
    markdown,
    streamingMarkdown,
    streamingReasoning,
    loading,
    error,
    pendingPreview,
    generate,
    confirmGenerate,
    cancelGenerate,
  }
}
