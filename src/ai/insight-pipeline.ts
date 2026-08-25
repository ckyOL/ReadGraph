// AI 阅读画像编排核心（ai-features §3.1 ①–⑦ / §4.1 / §5.3 / §5.4）：use-ai.ts 的
// 生成/上送编排逻辑（缓存检查→装配→预览门→上送→错误分级）下沉为本纯函数模块，
// 实体/聚合/偏好/缓存/上送全部依赖注入；不读 Date.now()/IndexedDB/localStorage/DOM，
// 同入参 + 同 deps 产出确定阶段结果。React 状态管理（loading/busy/markdown/error/
// pendingPreview/streamingMarkdown）保留在 Hook（use-ai.ts），本模块不感知。
import { ZodError } from 'zod'

import { AiHttpError } from '@/ai/ai-client'
import { validateProfileInsightsMarkdown } from '@/ai/prompts/profile-insights'
import { serializePayload } from '@/ai/sanitize'
import type { ProfilePayload } from '@/ai/sanitize'
import type { AiCacheEntry } from '@/lib/ai-cache'
import type { Locale } from '@/lib/locale'
import type { ProfileStatsInput, ProfileStatsResult } from '@/lib/profile-stats'
import type { ClassificationSystem } from '@/types/entities'

/** 错误分级（§5.4）：F-2 toast 按 kind 取文案；失败不写库、不缓存。 */
export type AiInsightError =
  /** 网络失败/超时/HTTP 非 2xx（AbortError / AiHttpError / 其他网络异常） */
  | { kind: 'network'; message: string }
  /** 响应 Zod 校验失败（ZodError） */
  | { kind: 'validation'; message: string }
  /** 端点/模型未配置（§5.4 不支持空端点调用） */
  | { kind: 'unconfigured'; message: string }

/** 错误归一：AbortError/AiHttpError → network；ZodError → validation；其余按 network 兜底。 */
export function classifyError(e: unknown): AiInsightError {
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

/** 生成输入偏好（readPreferences().ai 的结构子集，调用方读入注入）。 */
export interface InsightPipelinePrefs {
  enabled: boolean
  baseUrl: string
  model: string
  sendPreview: boolean
}

/** 生成编排输入：偏好/实体/聚合/缓存键等全部由调用方传入（Hook 侧读数据源）。 */
export interface InsightPipelineInput {
  prefs: InsightPipelinePrefs
  /** prompt 与缓存键语言（§5.3 locale 隔离） */
  locale: Locale
  /** 本地实体（与 use-profile-stats 同源；输入独立性 §2.7） */
  entities: ProfileStatsInput
  /** 全量口径聚合结果；null = 未就绪（useLiveQuery 未加载） */
  stats: ProfileStatsResult | null
  classificationSystem: ClassificationSystem | null
  /** 重新生成（§4.1 整体可重新生成）：true 时绕过缓存直接装配+上送并覆盖缓存 */
  bypassCache: boolean
  /** 缓存 scene/key（§5.3）：调用方固定 'profile'/'all'，range 联动预留 */
  scene: string
  key: string
}

/** 编排依赖：缓存与上送注入点（Hook 绑定真实实现，测试可 mock）。 */
export interface InsightPipelineDeps {
  readCache(scene: string, locale: Locale, key: string): AiCacheEntry | null
  writeCache(scene: string, locale: Locale, key: string, result: unknown): void
  /** 上送：调用方绑定 provider 与 prompt 装配；弱校验失败抛 ZodError（此处分级）。
   *  onPartial 为流式增量回调（§4.1 逐字文本流）：累积 markdown 文本逐步送达；
   *  onReasoning 为 thinking 模型思考过程增量（仅展示，不参与定稿/缓存）。
   *  最终结果仍以返回值为准（校验/缓存语义不变）。 */
  submit(
    payload: ProfilePayload,
    locale: Locale,
    onPartial?: (partial: string) => void,
    onReasoning?: (text: string) => void,
  ): Promise<string>
}

/** 生成路径阶段结果。 */
export type InsightPipelineResult =
  /** 未启用/聚合未就绪：静默返回，不置 error */
  | { status: 'skipped' }
  /** 端点/模型未配置 */
  | { status: 'unconfigured'; error: AiInsightError }
  /** 缓存命中（过 弱校验）直出 */
  | { status: 'cache-hit'; markdown: string }
  /** 预览门（§3.1 ④）：payload 即 serializePayload 装配产物（§3.3 防漂移） */
  | { status: 'pending-preview'; payload: ProfilePayload }
  /** 上送成功（已写缓存） */
  | { status: 'success'; markdown: string }
  /** 上送失败（分级，未写缓存） */
  | { status: 'error'; error: AiInsightError }

/** 上送上下文：预览确认路径以同一 payload 引用走上送（§3.3）。 */
export interface InsightSubmitContext {
  locale: Locale
  scene: string
  key: string
}

/** 上送路径结果。 */
export type InsightSubmitResult =
  | { status: 'success'; markdown: string }
  | { status: 'error'; error: AiInsightError }

/**
 * 生成编排（§3.1 ①–⑦）：未启用或聚合未就绪 → skipped（静默）；未配置端点/模型 →
 * unconfigured；缓存命中（结果过 schema 校验，损坏视为未命中）→ cache-hit 直出；
 * 未命中 → serializePayload 装配 → sendPreview=true 停预览门（pending-preview，
 * 与上送同一装配产物引用），false 直接走上送（success/error，成功写缓存）。
 * 「重新生成」bypassCache=true 跳过缓存读取，重新请求并覆盖缓存（§4.1）。
 * onPartial 透传上送路径（流式增量渲染钩子，§4.1）。
 */
export async function runInsightPipeline(
  input: InsightPipelineInput,
  deps: InsightPipelineDeps,
  onPartial?: (partial: string) => void,
  onReasoning?: (text: string) => void,
): Promise<InsightPipelineResult> {
  const { prefs, locale, entities, stats, classificationSystem, bypassCache, scene, key } = input
  // 未启用（§2.1 默认关闭）或聚合无数据（useLiveQuery 未就绪）→ 静默返回，不置 error。
  if (!prefs.enabled || !stats) return { status: 'skipped' }
  // 未配置端点/模型（§5.4）：不支持空端点调用。
  if (prefs.baseUrl.trim() === '' || prefs.model.trim() === '') {
    return {
      status: 'unconfigured',
      error: {
        kind: 'unconfigured',
        message: '未配置 AI 端点：请在设置页填写端点 URL 与模型名',
      },
    }
  }
  // 缓存命中（§5.3）：结果过弱校验，缓存损坏视为未命中继续生成。
  // 「重新生成」绕过缓存（§4.1 整体可重新生成、§6 可重新生成覆盖）——重新请求并覆盖缓存。
  if (!bypassCache) {
    const cached = deps.readCache(scene, locale, key)
    if (cached) {
      try {
        // 弱校验：非字符串/空/超长均视为损坏（未命中继续生成）。
        return {
          status: 'cache-hit',
          markdown: validateProfileInsightsMarkdown(
            typeof cached.result === 'string' ? cached.result : '',
          ),
        }
      } catch {
        // 缓存损坏视为未命中
      }
    }
  }
  // 装配（§3.1 ②）：预览展示与上送共用同一 serializePayload 产物（§3.3 防漂移）。
  const payload = serializePayload(entities, stats, { classificationSystem })
  // 预览门（§3.1 ④）：sendPreview=true 停此处等确认；false 直接走同一上送路径。
  if (prefs.sendPreview) return { status: 'pending-preview', payload }
  return submitInsightPayload(payload, { locale, scene, key }, deps, onPartial, onReasoning)
}

/**
 * 上送路径（§3.1 ⑤⑥）：预览确认（confirmGenerate）与直接生成（sendPreview=false）
 * 共用；payload 即预览展示的同一对象引用（§3.3）。成功写缓存，失败分级——
 * 失败结果不写缓存（§5.4）。onPartial 透传流式增量回调（§4.1）。
 */
export async function submitInsightPayload(
  payload: ProfilePayload,
  ctx: InsightSubmitContext,
  deps: InsightPipelineDeps,
  onPartial?: (partial: string) => void,
  onReasoning?: (text: string) => void,
): Promise<InsightSubmitResult> {
  try {
    const result = await deps.submit(payload, ctx.locale, onPartial, onReasoning)
    deps.writeCache(ctx.scene, ctx.locale, ctx.key, result)
    return { status: 'success', markdown: result }
  } catch (e) {
    return { status: 'error', error: classifyError(e) }
  }
}
