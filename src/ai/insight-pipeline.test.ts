// AI 场景编排核心（src/ai/insight-pipeline.ts）单测（ai-features §7 / §3.3 / §4.1 / §5.3 / §5.4）。
// 纯函数模块：装配/偏好/缓存/校验/上送全部依赖注入（mock），不依赖网络/时钟/IndexedDB/DOM。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

import { AiHttpError } from '@/ai/ai-client'
import { runInsightPipeline, submitInsightPayload } from '@/ai/insight-pipeline'
import type {
  InsightPipelineDeps,
  InsightPipelineInput,
} from '@/ai/insight-pipeline'
import { validateProfileInsightsMarkdown } from '@/ai/prompts/profile-insights'
import { serializePayload } from '@/ai/sanitize'
import { readAiCache, writeAiCache } from '@/lib/ai-cache'
import { makeBook, makeCatalog, makeCycle, makeSource } from '@/db/test-helpers'
import { computeProfileStats } from '@/lib/profile-stats'
import type { ProfileStatsInput, ProfileStatsOptions } from '@/lib/profile-stats'
import type { ProfilePayload } from '@/ai/sanitize'

const U = (isoUtc: string) => new Date(isoUtc)

const SCENE = 'profile'
const KEY = 'all'

const BASE_PREFS = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:9000',
  model: 'test-model',
  sendPreview: false,
}

/** 合法 markdown 生成结果（弱校验：非空 + 长度上限）。 */
const MARKDOWN =
  '## 分类偏好\n\n藏书中文学类占比最高，共 2 本。\n\n## 借阅节奏\n\n最近 30 天内借阅了 2 本。\n\n## 一句话总结\n\n整体书单以虚构类为主，风格偏向细腻叙事。'

const RESULT = MARKDOWN

/** 迷你实体集：2 本书 × 各 1 编目 + 1 返回周期（跨 CLC 一级类目）。 */
function buildEntities(): ProfileStatsInput {
  const src = makeSource('src-ai-test')
  return {
    books: [
      makeBook('b1', '9787000000001', '测试之书一'),
      makeBook('b2', '9787000000002', '测试之书二'),
    ],
    catalogRecords: [
      makeCatalog('c1', 'b1', src.id, 'BC1', null, [{ system: 'clc', code: 'I247.5' }]),
      makeCatalog('c2', 'b2', src.id, 'BC2', null, [{ system: 'clc', code: 'I247.5' }]),
    ],
    borrowCycles: [
      makeCycle('y1', 'b1', src.id, U('2025-01-05T08:00:00.000Z'), 'returned', 'BC1'),
      makeCycle('y2', 'b2', src.id, U('2025-02-10T08:00:00.000Z'), 'returned', 'BC2'),
    ],
    sources: [src],
  }
}

const STATS_OPTS: ProfileStatsOptions = {
  classificationSystem: 'clc',
  range: null,
  displayTimezone: 'UTC',
  calendarAnchor: null,
}

const entities = buildEntities()
const stats = computeProfileStats(entities, STATS_OPTS)

function baseInput(overrides: Partial<InsightPipelineInput<ProfilePayload>> = {}): InsightPipelineInput<ProfilePayload> {
  return {
    prefs: BASE_PREFS,
    locale: 'zh-CN',
    // 数据就绪门：画像场景 = 聚合结果非 null（Hook 侧保证）。
    ready: true,
    // 装配闭包（§3.3）：与 Hook 同一 serializePayload 产物（防漂移断言用直接调用深等价）。
    assemble: () => serializePayload(entities, stats, { classificationSystem: 'clc' }),
    bypassCache: false,
    scene: SCENE,
    key: KEY,
    ...overrides,
  }
}

function baseDeps(overrides: Partial<InsightPipelineDeps<ProfilePayload>> = {}): InsightPipelineDeps<ProfilePayload> {
  return {
    readCache: vi.fn(() => null),
    writeCache: vi.fn(),
    // 弱校验（场景注入）：画像场景 = validateProfileInsightsMarkdown。
    validate: validateProfileInsightsMarkdown,
    submit: vi.fn(async () => RESULT),
    ...overrides,
  }
}


/** 构造真实 ZodError：对非法文本调用弱校验取 error（与 Hook 上送抛错同型）。 */
function zodError(): ZodError {
  try {
    validateProfileInsightsMarkdown('')
    throw new Error('unreachable')
  } catch (e) {
    return e as ZodError
  }
}

describe('runInsightPipeline — 缓存（§5.3）', () => {
  it('缓存命中直出：返回缓存结果，不调用上送、不写缓存', async () => {
    const deps = baseDeps({ readCache: vi.fn(() => ({ result: RESULT, generatedAt: 123 })) })
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'cache-hit', markdown: MARKDOWN })
    expect(deps.submit).not.toHaveBeenCalled()
    expect(deps.writeCache).not.toHaveBeenCalled()
  })

  it('缓存结果不满足弱校验（纯空白）→ 视为未命中继续生成', async () => {
    const deps = baseDeps({
      readCache: vi.fn(() => ({ result: '   \n ', generatedAt: 1 })),
    })
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'success', markdown: MARKDOWN })
    expect(vi.mocked(deps.submit)).toHaveBeenCalledOnce()
  })

  it('缓存结果非字符串（损坏 JSON）→ 视为未命中继续生成', async () => {
    const deps = baseDeps({ readCache: vi.fn(() => ({ result: 42, generatedAt: 1 })) })
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'success', markdown: MARKDOWN })
    expect(vi.mocked(deps.submit)).toHaveBeenCalledOnce()
  })
})

describe('runInsightPipeline — 预览门（§3.1 ④ / §3.3）', () => {
  it('sendPreview=true → pending-preview；确认上送与预览同一 payload 对象引用', async () => {
    const deps = baseDeps()
    const result = await runInsightPipeline(
      baseInput({ prefs: { ...BASE_PREFS, sendPreview: true } }),
      deps,
    )
    if (result.status !== 'pending-preview') {
      throw new Error(`期望 pending-preview，实际 ${result.status}`)
    }
    // 预览产物即 serializePayload 直接调用产物：同一装配函数、同入参 → 深等价（§3.3 防漂移）。
    const direct = serializePayload(entities, stats, { classificationSystem: 'clc' })
    expect(result.payload).toEqual(direct)
    // 预览门：确认前不走上送、不写缓存。
    expect(deps.submit).not.toHaveBeenCalled()
    expect(deps.writeCache).not.toHaveBeenCalled()
    // 确认上送：deps.submit 收到与预览展示完全同一的对象引用（防「预览一套、上送一套」漂移）。
    const confirmed = await submitInsightPayload(
      result.payload,
      { locale: 'zh-CN', scene: SCENE, key: KEY },
      deps,
    )
    expect(confirmed).toEqual({ status: 'success', markdown: MARKDOWN })
    expect(vi.mocked(deps.submit).mock.calls[0][0]).toBe(result.payload)
  })

  it('sendPreview=false → 直接走上送（不经预览门），成功写缓存（writeAiCache 收到 result）', async () => {
    const deps = baseDeps()
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'success', markdown: MARKDOWN })
    expect(vi.mocked(deps.submit)).toHaveBeenCalledOnce()
    // 上送产物与 serializePayload 直接调用产物深等价（同一装配函数）。
    const submitted = vi.mocked(deps.submit).mock.calls[0][0]
    expect(submitted).toEqual(serializePayload(entities, stats, { classificationSystem: 'clc' }))
    // 成功即写缓存：写入的正是上送返回的 result（同一对象引用）。
    expect(vi.mocked(deps.writeCache)).toHaveBeenCalledOnce()
    expect(vi.mocked(deps.writeCache).mock.calls[0][0]).toBe(SCENE)
    expect(vi.mocked(deps.writeCache).mock.calls[0][1]).toBe('zh-CN')
    expect(vi.mocked(deps.writeCache).mock.calls[0][2]).toBe(KEY)
    expect(vi.mocked(deps.writeCache).mock.calls[0][3]).toBe(RESULT)
  })
})

describe('runInsightPipeline — 上送失败分级（§5.4）', () => {
  const abortError = new Error('aborted')
  abortError.name = 'AbortError'

  it.each([
    ['AbortError', abortError],
    ['AiHttpError', new AiHttpError(500, 'server error')],
    ['ZodError', zodError()],
  ] as const)('上送抛 %s → 分级 error 且不写缓存', async (_label, err) => {
    const deps = baseDeps({
      submit: vi.fn(async () => {
        throw err
      }),
    })
    const result = await runInsightPipeline(baseInput(), deps)
    if (result.status !== 'error') {
      throw new Error(`期望 error，实际 ${result.status}`)
    }
    // AbortError/AiHttpError → network；ZodError → validation。
    const expectedKind: 'network' | 'validation' = err instanceof ZodError ? 'validation' : 'network'
    expect(result.error.kind).toBe(expectedKind)
    expect(result.error.message.length).toBeGreaterThan(0)
    expect(deps.writeCache).not.toHaveBeenCalled()
  })
})

describe('runInsightPipeline — 重新生成（§4.1）', () => {
  it('bypassCache=true → 跳过缓存读取，直接装配+上送并覆盖缓存', async () => {
    const deps = baseDeps({
      // 存在合法缓存（正常路径会命中），bypass 后必须忽略。
      readCache: vi.fn(() => ({ result: '## 分类偏好\n\n旧缓存', generatedAt: 1 })),
    })
    const result = await runInsightPipeline(baseInput({ bypassCache: true }), deps)
    expect(result).toEqual({ status: 'success', markdown: MARKDOWN })
    // 绕过缓存：完全不读缓存（与「命中则直出」路径互斥）。
    expect(deps.readCache).not.toHaveBeenCalled()
    expect(vi.mocked(deps.submit)).toHaveBeenCalledOnce()
    // 新结果覆盖缓存（写缓存收到本次上送结果）。
    expect(vi.mocked(deps.writeCache).mock.calls[0][3]).toBe(RESULT)
  })
})

describe('runInsightPipeline — 前置门（§2.1 / §5.4）', () => {
  it('未启用（enabled=false）→ 静默 skipped，不读缓存不上送', async () => {
    const deps = baseDeps()
    const result = await runInsightPipeline(
      baseInput({ prefs: { ...BASE_PREFS, enabled: false } }),
      deps,
    )
    expect(result).toEqual({ status: 'skipped' })
    expect(deps.readCache).not.toHaveBeenCalled()
    expect(deps.submit).not.toHaveBeenCalled()
    expect(deps.writeCache).not.toHaveBeenCalled()
  })

  it('数据未就绪（ready=false）→ 静默 skipped，不读缓存不上送', async () => {
    const deps = baseDeps()
    const result = await runInsightPipeline(baseInput({ ready: false }), deps)
    expect(result).toEqual({ status: 'skipped' })
    expect(deps.readCache).not.toHaveBeenCalled()
    expect(deps.submit).not.toHaveBeenCalled()
  })

  it('弱校验注入生效：缓存命中走 deps.validate，抛错视为未命中继续生成', async () => {
    // 注入恒抛错校验：任何缓存都视为损坏 → 未命中走上送。
    const deps = baseDeps({
      readCache: vi.fn(() => ({ result: MARKDOWN, generatedAt: 1 })),
      validate: vi.fn(() => {
        throw zodError()
      }),
    })
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'success', markdown: MARKDOWN })
    expect(vi.mocked(deps.submit)).toHaveBeenCalledOnce()
    // 注入的校验确实被调用（缓存命中路径先过校验）。
    expect(vi.mocked(deps.validate)).toHaveBeenCalledWith(MARKDOWN)
  })

  it.each([
    ['baseUrl 为空串', { baseUrl: '' }],
    ['baseUrl 纯空白', { baseUrl: '   ' }],
    ['model 为空串', { model: '' }],
  ] as const)('未配置端点/模型（%s）→ unconfigured，不读缓存不上送', async (_label, patch) => {
    const deps = baseDeps()
    const result = await runInsightPipeline(
      baseInput({ prefs: { ...BASE_PREFS, ...patch } }),
      deps,
    )
    if (result.status !== 'unconfigured') {
      throw new Error(`期望 unconfigured，实际 ${result.status}`)
    }
    expect(result.error.kind).toBe('unconfigured')
    expect(deps.readCache).not.toHaveBeenCalled()
    expect(deps.submit).not.toHaveBeenCalled()
  })
})

describe('缓存键 locale 隔离（§5.3）', () => {
  let store: Map<string, string>

  /** 简易 localStorage mock（Map 存储，与真实实现同契约的读接口）。 */
  function stubLocalStorage(): void {
    store = new Map()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v)
      },
      removeItem: (k: string) => {
        store.delete(k)
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      clear: () => {
        store.clear()
      },
    })
  }

  beforeEach(() => {
    stubLocalStorage()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('同 key 不同 locale 互不命中：键形态 ai:profile:zh-CN:all / ai:profile:en:all 独立', async () => {
    // 注入真实缓存实现：断言真实键形态与跨 locale 隔离。
    const deps = baseDeps({ readCache: readAiCache, writeCache: writeAiCache })
    // zh-CN 首次生成 → 写 zh 缓存（键形态 ai:profile:zh-CN:all）。
    const zhFirst = await runInsightPipeline(baseInput(), deps)
    expect(zhFirst).toEqual({ status: 'success', markdown: MARKDOWN })
    const zhKey = `ai:${SCENE}:zh-CN:${KEY}`
    const enKey = `ai:${SCENE}:en:${KEY}`
    const zhRaw = store.get(zhKey)
    expect(zhRaw).toBeDefined()
    // en 生成 → 独立 en 键落盘（ai:profile:en:all），且不覆盖 zh 条目（locale 隔离）。
    const enFirst = await runInsightPipeline(baseInput({ locale: 'en' }), deps)
    expect(enFirst).toEqual({ status: 'success', markdown: MARKDOWN })
    expect(store.get(enKey)).toBeDefined()
    expect(store.get(zhKey)).toBe(zhRaw)
    // zh 再次生成 → 命中 zh 缓存直出（不再上送）；en 缓存不受影响。
    const zhAgain = await runInsightPipeline(baseInput(), deps)
    expect(zhAgain).toEqual({ status: 'cache-hit', markdown: MARKDOWN })
    expect(vi.mocked(deps.submit)).toHaveBeenCalledTimes(2)
    // 缓存条目 = 生成结果 + 时间戳（原文存储）。
    const zhEntry = JSON.parse(store.get(zhKey) ?? 'null') as {
      result: unknown
      generatedAt: number
    }
    expect(zhEntry.result).toEqual(RESULT)
    expect(typeof zhEntry.generatedAt).toBe('number')
  })
})
describe('流式 onPartial 透传（ai-features §4.1 逐字文本流）', () => {
  it('submitInsightPayload 把 onPartial 透传给 deps.submit（逐步回调累积 markdown 文本）', async () => {
    const submit = vi.fn(async (_payload: unknown, _locale: string, onPartial?: (p: string) => void) => {
      onPartial?.('## 分类偏好')
      onPartial?.('## 分类偏好\n\n藏书中文学类占比最高，共 2 本。')
      return RESULT
    })
    const deps = baseDeps({ submit })
    const seen: string[] = []

    const result = await submitInsightPayload(
      serializePayload(entities, stats, { classificationSystem: 'clc' }),
      { locale: 'zh-CN', scene: SCENE, key: KEY },
      deps,
      (partial) => seen.push(partial),
    )

    expect(result).toEqual({ status: 'success', markdown: MARKDOWN })
    expect(seen).toEqual(['## 分类偏好', '## 分类偏好\n\n藏书中文学类占比最高，共 2 本。'])
    // 成功路径：onPartial 只是增量渲染钩子，不改变写缓存/成功语义。
    expect(vi.mocked(deps.writeCache)).toHaveBeenCalledOnce()
  })

  it('runInsightPipeline 直发路径（sendPreview=false）同样透传 onPartial', async () => {
    const submit = vi.fn(async (_payload: unknown, _locale: string, onPartial?: (p: string) => void) => {
      onPartial?.('## 分类偏好')
      return RESULT
    })
    const deps = baseDeps({ submit })
    const seen: string[] = []

    const result = await runInsightPipeline(baseInput(), deps, (partial) => seen.push(partial))

    expect(result).toEqual({ status: 'success', markdown: MARKDOWN })
    expect(seen).toEqual(['## 分类偏好'])
  })

  it('不传 onPartial（非流式兼容）→ submit 收到 undefined，行为不变', async () => {
    const deps = baseDeps()
    const result = await submitInsightPayload(
      serializePayload(entities, stats, { classificationSystem: 'clc' }),
      { locale: 'zh-CN', scene: SCENE, key: KEY },
      deps,
    )
    expect(result).toEqual({ status: 'success', markdown: MARKDOWN })
    expect(vi.mocked(deps.submit).mock.calls[0][2]).toBeUndefined()
  })

  it('上送失败 → onPartial 已产生的增量不回滚给调用方（错误路径语义不变）', async () => {
    const submit = vi.fn(async (_payload: unknown, _locale: string, onPartial?: (p: string) => void) => {
      onPartial?.('## 分类偏好')
      throw new AiHttpError(500, 'server error')
    })
    const deps = baseDeps({ submit })
    const seen: string[] = []

    const result = await submitInsightPayload(
      serializePayload(entities, stats, { classificationSystem: 'clc' }),
      { locale: 'zh-CN', scene: SCENE, key: KEY },
      deps,
      (partial) => seen.push(partial),
    )

    expect(result.status).toBe('error')
    // 透传语义保持：onPartial 回调仍然被调用（Hook 侧负责失败时清空增量）。
    expect(seen).toEqual(['## 分类偏好'])
    expect(deps.writeCache).not.toHaveBeenCalled()
  })

  it('submitInsightPayload 把 onReasoning 透传给 deps.submit（thinking 思考增量回调）', async () => {
    const submit = vi.fn(
      async (
        _payload: unknown,
        _locale: string,
        onPartial?: (p: string) => void,
        onReasoning?: (t: string) => void,
      ) => {
        onReasoning?.('思考中')
        onPartial?.('正文')
        return RESULT
      },
    )
    const deps = baseDeps({ submit })
    const seenReasoning: string[] = []
    const seenPartial: string[] = []

    const result = await submitInsightPayload(
      serializePayload(entities, stats, { classificationSystem: 'clc' }),
      { locale: 'zh-CN', scene: SCENE, key: KEY },
      deps,
      (p) => seenPartial.push(p),
      (t) => seenReasoning.push(t),
    )

    expect(result).toEqual({ status: 'success', markdown: MARKDOWN })
    expect(seenReasoning).toEqual(['思考中'])
    expect(seenPartial).toEqual(['正文'])
    // 思考增量仅展示，不参与缓存写入（写缓存仍是完整 markdown 结果）。
    expect(vi.mocked(deps.writeCache).mock.calls[0][3]).toBe(RESULT)
  })
})
