// AI 阅读画像编排 Hook（ai-features §3.1 管道流程 ①–⑦ / §4.1 / §5.3 / §5.4）。
// 职责边界：响应式聚合（与 use-profile-stats 同源实体，range 固定 null = 全量口径）、
// 脱敏装配（serializePayload）、结果缓存、发送预览门、上送编排与错误分级。
// 输入独立性（§2.7）：生成输入只消费本地实体+聚合+payload，insights 状态绝不参与
// 生成输入——防幻觉传播。
import { useCallback, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'
import { ZodError } from 'zod'

import { AiHttpError } from '@/ai/ai-client'
import { createAiProvider } from '@/ai/ai-provider'
import {
  PROFILE_TEMPERATURE,
  buildProfileInsightsPrompt,
  profileInsightsSchema,
} from '@/ai/prompts/profile-insights'
import type { AIInsight, ProfileInsights } from '@/ai/prompts/profile-insights'
import { serializePayload } from '@/ai/sanitize'
import type { ProfilePayload } from '@/ai/sanitize'
import { db } from '@/db/db-instance'
import { readAiApiKey } from '@/lib/ai-api-key'
import { readAiCache, writeAiCache } from '@/lib/ai-cache'
import type { Locale } from '@/lib/locale'
import { readPreferences } from '@/lib/preferences'
import { computeProfileStats } from '@/lib/profile-stats'
import type { ProfileStatsInput, ProfileStatsResult } from '@/lib/profile-stats'
import type { ClassificationSystem } from '@/types/entities'

/** 画像场景缓存键（§5.3）：scene/key 形态固定；Phase 1 全量口径固定 'all'，range 预留。 */
const CACHE_SCENE = 'profile'
const CACHE_KEY = 'all'

export interface UseAiInsightsOptions {
  classificationSystem: ClassificationSystem | null
  displayTimezone: string
  /** 借阅日历「今天」锚（透传 computeProfileStats，调用方传入，不读 Date.now()） */
  calendarAnchor: Date | null
}

/** 错误分级（§5.4）：F-2 toast 按 kind 取文案；失败不写库、不缓存。 */
export type AiInsightError =
  /** 网络失败/超时/HTTP 非 2xx（AbortError / AiHttpError / 其他网络异常） */
  | { kind: 'network'; message: string }
  /** 响应 Zod 校验失败（ZodError） */
  | { kind: 'validation'; message: string }
  /** 端点/模型未配置（§5.4 不支持空端点调用） */
  | { kind: 'unconfigured'; message: string }

export interface UseAiInsightsState {
  /** 生成结果；未生成/无数据时为 null */
  insights: AIInsight[] | null
  /** 覆盖生成与重新生成（§8 rerender-transitions：Skeleton 占位 + 按钮禁用） */
  loading: boolean
  error: AiInsightError | null
  /** 预览门（§3.1 ④）：sendPreview=true 时 generate() 停在此处；
   *  F-2 据此挂 AiSendPreviewDialog，payload 与上送为同一对象引用（§3.3 防漂移）。 */
  pendingPreview: ProfilePayload | null
  /** 触发生成：未启用/聚合无数据静默返回；缓存命中直出；error 状态下再次调用即重试。 */
  generate: () => Promise<void>
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

/** 错误归一：AbortError/AiHttpError → network；ZodError → validation；其余按 network 兜底。 */
function classifyError(e: unknown): AiInsightError {
  if (e instanceof AiHttpError || (e instanceof Error && e.name === 'AbortError')) {
    return { kind: 'network', message: e.message }
  }
  if (e instanceof ZodError) {
    return { kind: 'validation', message: 'AI 响应校验失败：响应不符合预期格式，请重试' }
  }
  if (e instanceof Error) {
    return { kind: 'network', message: e.message }
  }
  return { kind: 'network', message: String(e) }
}

/**
 * AI 阅读画像编排 Hook。
 *
 * 数据：useLiveQuery 直连四类实体（与 use-profile-stats 同源；未就绪时 empty 兜底、
 * 结构完整），useMemo 跑 computeProfileStats——range 固定 null = 全量口径，
 * 不与 range 联动（§4.1），classificationSystem/displayTimezone/calendarAnchor 透传。
 *
 * 编排（§3.1）：未启用或聚合无数据 → 静默返回；缓存命中（过 profileInsightsSchema
 * 校验，损坏视为未命中）→ insights 直出；未命中 → serializePayload 装配 →
 * sendPreview=true 停预览门（等 F-2 确认），false 直接走同一上送路径。
 * 上送（⑤⑥）：createAiProvider.chat + buildProfileInsightsPrompt，成功
 * writeAiCache + setInsights，失败分级 setError；loading 覆盖生成与重新生成，
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

  const [insights, setInsights] = useState<AIInsight[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AiInsightError | null>(null)
  const [pendingPreview, setPendingPreview] = useState<ProfilePayload | null>(null)
  // 并发防护：上送在途时忽略重复的 generate/confirm 触发。
  const busyRef = useRef(false)

  /**
   * 上送路径（§3.1 ⑤⑥）：预览确认（confirmGenerate）与直接生成（sendPreview=false）
   * 共用；payload 即预览展示的同一对象引用（§3.3）。成功写缓存 + 落 insights，
   * 失败分级 setError——均不写库、不缓存失败结果。
   */
  const submitPayload = useCallback(
    async (payload: ProfilePayload) => {
      busyRef.current = true
      setLoading(true)
      setError(null)
      setPendingPreview(null)
      try {
        const prefs = readPreferences()
        const provider = createAiProvider({
          baseUrl: prefs.ai.baseUrl,
          apiKey: readAiApiKey(),
          model: prefs.ai.model,
          temperature: PROFILE_TEMPERATURE,
        })
        // prompt 数据区只取 payload 白名单子集（summary + books，prompts 契约）；
        // schema 校验失败 provider 抛 ZodError，此处按 validation 分级。
        const result = (await provider.chat(
          buildProfileInsightsPrompt({
            summary: payload.summary,
            books: payload.books,
            locale,
          }),
          { schema: profileInsightsSchema },
        )) as ProfileInsights
        writeAiCache(CACHE_SCENE, locale, CACHE_KEY, result)
        setInsights(result.insights)
      } catch (e) {
        setError(classifyError(e))
      } finally {
        busyRef.current = false
        setLoading(false)
      }
    },
    [locale],
  )

  const generate = useCallback(async () => {
    if (busyRef.current || pendingPreview) return
    const prefs = readPreferences()
    // 未启用（§2.1 默认关闭）或聚合无数据（useLiveQuery 未就绪）→ 静默返回，不置 error。
    if (!prefs.ai.enabled || !stats) return
    // 未配置端点/模型（§5.4）：不支持空端点调用。
    if (prefs.ai.baseUrl.trim() === '' || prefs.ai.model.trim() === '') {
      setError({
        kind: 'unconfigured',
        message: '未配置 AI 端点：请在设置页填写端点 URL 与模型名',
      })
      return
    }
    setError(null)
    // 缓存命中（§5.3）：结果过 schema 校验，缓存损坏视为未命中继续生成。
    const cached = readAiCache(CACHE_SCENE, locale, CACHE_KEY)
    if (cached) {
      const parsed = profileInsightsSchema.safeParse(cached.result)
      if (parsed.success) {
        setInsights(parsed.data.insights)
        return
      }
    }
    setLoading(true)
    try {
      // 装配（§3.1 ②）：预览展示与上送共用同一 serializePayload 产物（§3.3 防漂移）。
      const payload = serializePayload(
        { books, catalogRecords, borrowCycles, sources },
        stats,
        { classificationSystem: opts.classificationSystem },
      )
      // 预览门（§3.1 ④）：sendPreview=true 停此处等 F-2 确认；false 直接走同一上送路径。
      if (prefs.ai.sendPreview) {
        setPendingPreview(payload)
        return
      }
      await submitPayload(payload)
    } finally {
      setLoading(false)
    }
  }, [
    stats,
    books,
    catalogRecords,
    borrowCycles,
    sources,
    locale,
    opts.classificationSystem,
    pendingPreview,
    submitPayload,
  ])

  const confirmGenerate = useCallback(async () => {
    if (busyRef.current || !pendingPreview) return
    // 上送对象与预览展示对象同一引用（§3.3）。
    await submitPayload(pendingPreview)
  }, [pendingPreview, submitPayload])

  const cancelGenerate = useCallback(() => {
    setPendingPreview(null)
  }, [])

  return {
    insights,
    loading,
    error,
    pendingPreview,
    generate,
    confirmGenerate,
    cancelGenerate,
  }
}
