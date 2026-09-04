// AI 场景共享编排引擎 Hook（ai-features §3.1 ①–⑦ / §4.1 / §5.3 / §5.4）。
// 从 use-ai.ts（画像场景）原样抽取的引擎层：状态管理（markdown/loading/error/
// pendingPreview/streamingMarkdown/streamingReasoning）、并发闸、主动停止、流式增量
// 落位与缓存/上送接线；场景差异（scene/key/装配/prompt/温度/弱校验）全部由 opts 注入。
// 编排核心为 insight-pipeline.ts 纯函数（依赖注入），本 Hook 只注入数据源与状态落位。
// 输入独立性（§2.7）：生成输入只消费本地实体/聚合/payload，markdown 状态绝不参与
// 生成输入——防幻觉传播。
import { useCallback, useMemo, useRef, useState } from 'react'

import { createAiProvider } from '@/ai/ai-provider'
import { runInsightPipeline, submitInsightPayload } from '@/ai/insight-pipeline'
import type { AiInsightError, InsightPipelineDeps } from '@/ai/insight-pipeline'
import { readAiApiKey } from '@/lib/ai-api-key'
import { readAiCache, writeAiCache } from '@/lib/ai-cache'
import type { Locale } from '@/lib/locale'
import { readPreferences } from '@/lib/preferences'
import type { PromptMessage } from '@/ai/prompts/profile-insights'

/** AI 场景共享引擎输入（P = 场景 payload 类型）：场景差异全部显式注入。 */
export interface UseAiEngineOptions<P> {
  /** 缓存 scene（§5.3 键形 ai:{scene}:{locale}:{key}）：画像 'profile'、年度 'year-narrative'。 */
  scene: string
  /** 缓存 key：画像 'all-v2'（全量口径）、年度 String(year)。 */
  key: string
  /** prompt 与缓存键语言（§5.3 locale 隔离；Hook 侧由 i18n.language 归一）。 */
  locale: Locale
  /** 生成温度（场景常量：画像 PROFILE_TEMPERATURE、年度 YEAR_NARRATIVE_TEMPERATURE）。 */
  temperature: number
  /** 数据就绪门：false（偏好未就绪/聚合未就绪/空年）→ generate() 静默 skipped。 */
  ready: boolean
  /** 装配闭包（§3.1 ②③）：预览与上送共用同一产物引用（§3.3 防漂移）。 */
  assemble: () => P
  /** prompt 装配（§3.1 ⑤）：由场景将 payload 白名单子集转译为 messages。 */
  buildPrompt: (payload: P, locale: Locale) => PromptMessage[]
  /** 弱校验（场景注入）：流结束后完整文本校验（空/超长抛 ZodError → validation 分级）。 */
  validate: (text: string) => string
}

/** AI 场景共享引擎状态（画像/年度场景同构对外形态）。 */
export interface UseAiEngineState<P> {
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
  pendingPreview: P | null
  /** 触发生成：未启用/无数据静默返回；缓存命中直出；error 状态下再次调用即重试。
   *  bypassCache=true（重新生成，§4.1 整体可重新生成）绕过缓存重新请求并覆盖。 */
  generate: (bypassCache?: boolean) => Promise<void>
  /** 预览确认：用 pendingPreview（同一引用）走上送路径。 */
  confirmGenerate: () => Promise<void>
  /** 预览取消：仅关闭预览门，不置 error。 */
  cancelGenerate: () => void
  /** 停止生成（§4.1）：中止上送请求；已生成部分保留为结果展示，静默不报错。 */
  stop: () => void
}

/**
 * AI 场景共享编排引擎 Hook（画像 useAiInsights / 年度 useYearNarrative 的引擎层）。
 * 场景数据（实体/聚合/偏好读入）由调用方负责；本 Hook 只管理状态落位与上送链路：
 * submit 闭包绑定 provider（readPreferences + readAiApiKey + opts.temperature）与
 * opts.buildPrompt，chatStream 逐增量累积（content/reasoning 分通道），流末过
 * opts.validate 弱校验（失败抛 ZodError，管线按 validation 分级）。
 */
export function useAiEngine<P>(opts: UseAiEngineOptions<P>): UseAiEngineState<P> {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<AiInsightError | null>(null)
  const [pendingPreview, setPendingPreview] = useState<P | null>(null)
  // 流式增量预览（§4.1 逐字文本流）：上送在途时逐步落位累积文本。
  const [streamingMarkdown, setStreamingMarkdown] = useState<string | null>(null)
  // thinking 模型思考过程（§4.1）：reasoning_content 增量，仅展示不参与定稿。
  const [streamingReasoning, setStreamingReasoning] = useState<string | null>(null)
  // 并发防护：上送在途时忽略重复的 generate/confirm 触发。
  const busyRef = useRef(false)
  // 主动停止（§4.1）：abort 上送中的请求；stopped 标记区分「用户取消」与真实错误。
  const abortRef = useRef<AbortController | null>(null)
  const stoppedRef = useRef(false)
  // 最近一次流式文本：主动停止时提升为部分结果展示。
  const streamingRef = useRef<string | null>(null)

  /**
   * 上送（§3.1 ⑤⑥）：绑定 provider 的 chat 门面，由管线 submitInsightPayload 调用；
   * payload 即预览展示的同一对象引用（§3.3）。prompt 由场景注入的 opts.buildPrompt
   * 从 payload 白名单子集装配。流式路径（§4.1）：chatStream 逐增量累积文本，
   * 每次增量经 onPartial 落位（逐字渐进渲染），thinking 思考过程经 onReasoning
   * 落位（仅展示）；流结束后完整文本过 opts.validate 弱校验（失败抛 ZodError，
   * 管线按 validation 分级）。成功/失败与缓存写入由管线处理，此处只管理并发闸、
   * loading 态与增量状态。
   */
  const { temperature, buildPrompt, validate } = opts
  const submit = useCallback<InsightPipelineDeps<P>['submit']>(
    async (payload, locale, onPartial, onReasoning) => {
      busyRef.current = true
      setLoading(true)
      setError(null)
      setPendingPreview(null)
      setStreamingMarkdown(null)
      setStreamingReasoning(null)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const prefs = readPreferences()
        const provider = createAiProvider({
          baseUrl: prefs.ai.baseUrl,
          apiKey: readAiApiKey(),
          model: prefs.ai.model,
          temperature,
        })
        const messages = buildPrompt(payload, locale)
        // （失败抛 ZodError，管线按 validation 分级）。
        let text = ''
        let reasoning = ''
        for await (const chunk of provider.chatStream(messages, { signal: controller.signal })) {
          if (chunk.kind === 'reasoning') {
            reasoning += chunk.text
            if (onReasoning) onReasoning(reasoning)
          } else {
            text += chunk.text
            streamingRef.current = text
            if (onPartial) onPartial(text)
          }
        }
        return validate(text)
      } finally {
        abortRef.current = null
        busyRef.current = false
        setLoading(false)
      }
    },
    // 场景注入项解构引用（调用方稳定；纯函数语义不变）。
    [temperature, buildPrompt, validate],
  )

  const pipelineDeps = useMemo<InsightPipelineDeps<P>>(
    () => ({
      readCache: readAiCache,
      writeCache: writeAiCache,
      validate,
      submit,
    }),
    [validate, submit],
  )


  const generate = useCallback(
    async (bypassCache = false) => {
      if (busyRef.current || pendingPreview) return
      stoppedRef.current = false
      const prefs = readPreferences()
      // 编排核心（缓存检查→装配→预览门→上送→错误分级）在 insight-pipeline.ts：
      // 未启用/数据未就绪 → skipped（静默，不清 error）；未配置端点/模型 → unconfigured；
      // 缓存命中（损坏视为未命中）→ cache-hit 直出；未命中 → 装配 → 预览门或直接上送。
      // 「重新生成」bypassCache=true 绕过缓存重新请求并覆盖缓存（§4.1）。
      // 流式增量（§4.1）：上送在途时 onPartial 落位 streamingMarkdown，定稿/失败清空。
      const result = await runInsightPipeline<P>(
        {
          prefs: prefs.ai,
          locale: opts.locale,
          ready: opts.ready,
          assemble: opts.assemble,
          bypassCache,
          scene: opts.scene,
          key: opts.key,
        },
        pipelineDeps,
        (partial) => {
          streamingRef.current = partial
          setStreamingMarkdown(partial)
        },
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
          setStreamingReasoning(null)
          if (stoppedRef.current) {
            // 主动停止（§4.1）：保留已生成的部分内容，静默不置 error、不写缓存。
            setStreamingMarkdown(null)
            setMarkdown(streamingRef.current)
            return
          }
          setStreamingMarkdown(null)
          setError(result.error)
          return
      }
    },
    [opts, pendingPreview, pipelineDeps],
  )

  const confirmGenerate = useCallback(async () => {
    if (busyRef.current || !pendingPreview) return
    stoppedRef.current = false
    // 上送对象与预览展示对象同一引用（§3.3）。
    const result = await submitInsightPayload<P>(
      pendingPreview,
      { locale: opts.locale, scene: opts.scene, key: opts.key },
      pipelineDeps,
      (partial) => {
        streamingRef.current = partial
        setStreamingMarkdown(partial)
      },
      (partial) => setStreamingReasoning(partial),
    )
    if (result.status === 'success') {
      setStreamingMarkdown(null)
      setStreamingReasoning(null)
      setMarkdown(result.markdown)
    } else if (stoppedRef.current) {
      // 主动停止（§4.1）：保留部分内容，静默。
      setStreamingMarkdown(null)
      setStreamingReasoning(null)
      setMarkdown(streamingRef.current)
    } else {
      setStreamingMarkdown(null)
      setStreamingReasoning(null)
      setError(result.error)
    }
  }, [opts, pendingPreview, pipelineDeps])

  const cancelGenerate = useCallback(() => {
    setPendingPreview(null)
  }, [])

  /** 停止生成（§4.1）：中止上送请求；已生成部分保留为结果展示。 */
  const stop = useCallback(() => {
    if (abortRef.current) {
      stoppedRef.current = true
      abortRef.current.abort()
    }
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
    stop,
  }
}
