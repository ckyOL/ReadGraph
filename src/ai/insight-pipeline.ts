// AI 场景编排核心（ai-features §3.1 ①–⑦ / §4.1 / §5.3 / §5.4）：Hook（use-ai.ts /
// use-year-narrative.ts）的生成/上送编排逻辑（缓存检查→装配→预览门→上送→错误分级）
// 下沉为本纯函数模块，场景无关——装配（assemble）与缓存弱校验（deps.validate）由
// 调用方按场景注入（画像 serializePayload / 年度 serializeYearPayload），payload 泛型化；
// 偏好/缓存/上送全部依赖注入；不读 Date.now()/IndexedDB/localStorage/DOM，
// 同入参 + 同 deps 产出确定阶段结果。React 状态管理（loading/busy/markdown/error/
// pendingPreview/streamingMarkdown）保留在 Hook，本模块不感知。
import { ZodError } from 'zod'

import { AiHttpError } from '@/ai/ai-client'
import type { AiCacheEntry } from '@/lib/ai-cache'
import type { Locale } from '@/lib/locale'

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

/** 生成编排输入（场景无关，P = 场景 payload 类型）：偏好/缓存键/装配闭包等全部由
 *  调用方传入（Hook 侧读数据源）。 */
export interface InsightPipelineInput<P> {
  prefs: InsightPipelinePrefs
  /** prompt 与缓存键语言（§5.3 locale 隔离） */
  locale: Locale
  /** 数据就绪门：false（未启用数据/聚合未就绪/空年）→ 静默 skipped */
  ready: boolean
  /** 装配闭包（§3.1 ②③）：预览与上送共用同一产物引用（§3.3 防漂移）。 */
  assemble: () => P
  /** 重新生成（§4.1 整体可重新生成）：true 时绕过缓存直接装配+上送并覆盖缓存 */
  bypassCache: boolean
  /** 缓存 scene/key（§5.3）：画像 'profile'/'all-v2'，年度 'year-narrative'/{year} */
  scene: string
  key: string
}

/** 编排依赖（场景无关）：缓存、弱校验与上送注入点（Hook 绑定真实实现，测试可 mock）。 */
export interface InsightPipelineDeps<P> {
  readCache(scene: string, locale: Locale, key: string): AiCacheEntry | null
  writeCache(scene: string, locale: Locale, key: string, result: unknown): void
  /** 缓存命中弱校验（场景注入：validateProfileInsightsMarkdown / validateYearNarrative）；
   *  抛错（空/超长/非字符串场景语义）视为缓存损坏——未命中继续生成。 */
  validate(text: string): string
  /** 上送：调用方绑定 provider 与 prompt 装配；弱校验失败抛 ZodError（此处分级）。
   *  onPartial 为流式增量回调（§4.1 逐字文本流）：累积 markdown 文本逐步送达；
   *  onReasoning 为 thinking 模型思考过程增量（仅展示，不参与定稿/缓存）。
   *  最终结果仍以返回值为准（校验/缓存语义不变）。 */
  submit(
    payload: P,
    locale: Locale,
    onPartial?: (partial: string) => void,
    onReasoning?: (text: string) => void,
  ): Promise<string>
}

/** 生成路径阶段结果（场景无关，P = 场景 payload 类型）。 */
export type InsightPipelineResult<P> =
  /** 未启用/数据未就绪：静默返回，不置 error */
  | { status: 'skipped' }
  /** 端点/模型未配置 */
  | { status: 'unconfigured'; error: AiInsightError }
  /** 缓存命中（过 弱校验）直出 */
  | { status: 'cache-hit'; markdown: string }
  /** 预览门（§3.1 ④）：payload 即 assemble() 装配产物（§3.3 防漂移） */
  | { status: 'pending-preview'; payload: P }
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
 * 生成编排（§3.1 ①–⑦，场景无关）：未启用或数据未就绪（ready=false）→ skipped（静默）；
 * 未配置端点/模型 → unconfigured；缓存命中（过 deps.validate 弱校验，损坏视为未命中）
 * → cache-hit 直出；未命中 → assemble() 装配 → sendPreview=true 停预览门（pending-preview，
 * 与上送同一装配产物引用），false 直接走上送（success/error，成功写缓存）。
 * 「重新生成」bypassCache=true 跳过缓存读取，重新请求并覆盖缓存（§4.1）。
 * onPartial 透传上送路径（流式增量渲染钩子，§4.1）。
 */
export async function runInsightPipeline<P>(
  input: InsightPipelineInput<P>,
  deps: InsightPipelineDeps<P>,
  onPartial?: (partial: string) => void,
  onReasoning?: (text: string) => void,
): Promise<InsightPipelineResult<P>> {
  const { prefs, locale, ready, assemble, bypassCache, scene, key } = input
  // 未启用（§2.1 默认关闭）或数据未就绪 → 静默返回，不置 error。
  if (!prefs.enabled || !ready) return { status: 'skipped' }
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
        // 弱校验（场景注入）：非字符串/空/超长均视为损坏（未命中继续生成）。
        return {
          status: 'cache-hit',
          markdown: deps.validate(typeof cached.result === 'string' ? cached.result : ''),
        }
      } catch {
        // 缓存损坏视为未命中
      }
    }
  }
  // 装配（§3.1 ②③）：预览展示与上送共用同一 assemble() 产物（§3.3 防漂移）。
  const payload = assemble()
  // 预览门（§3.1 ④）：sendPreview=true 停此处等确认；false 直接走同一上送路径。
  if (prefs.sendPreview) return { status: 'pending-preview', payload }
  return submitInsightPayload(payload, { locale, scene, key }, deps, onPartial, onReasoning)
}

/**
 * 上送路径（§3.1 ⑤⑥）：预览确认（confirmGenerate）与直接生成（sendPreview=false）
 * 共用；payload 即预览展示的同一对象引用（§3.3）。成功写缓存，失败分级——
 * 失败结果不写缓存（§5.4）。onPartial 透传流式增量回调（§4.1）。
 */
export async function submitInsightPayload<P>(
  payload: P,
  ctx: InsightSubmitContext,
  deps: InsightPipelineDeps<P>,
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
