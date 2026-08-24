// AI 阅读画像编排核心（src/ai/insight-pipeline.ts）单测（ai-features §7 / §3.3 / §4.1 / §5.3 / §5.4）。
// 纯函数模块：实体/聚合/偏好/缓存/上送全部依赖注入（mock），不依赖网络/时钟/IndexedDB/DOM。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

import { AiHttpError } from '@/ai/ai-client'
import { runInsightPipeline, submitInsightPayload } from '@/ai/insight-pipeline'
import type {
  InsightPipelineDeps,
  InsightPipelineInput,
} from '@/ai/insight-pipeline'
import { profileInsightsSchema } from '@/ai/prompts/profile-insights'
import type { AIInsight, ProfileInsights } from '@/ai/prompts/profile-insights'
import { serializePayload } from '@/ai/sanitize'
import { readAiCache, writeAiCache } from '@/lib/ai-cache'
import { makeBook, makeCatalog, makeCycle, makeSource } from '@/db/test-helpers'
import { computeProfileStats } from '@/lib/profile-stats'
import type { ProfileStatsInput, ProfileStatsOptions } from '@/lib/profile-stats'

const U = (isoUtc: string) => new Date(isoUtc)

const SCENE = 'profile'
const KEY = 'all'

const BASE_PREFS = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:9000',
  model: 'test-model',
  sendPreview: false,
}

const INSIGHTS: AIInsight[] = [
  { kind: 'fact', title: '偏爱文学类', body: '藏书中文学类占比最高，共 2 本。', dimension: 'classification' },
  { kind: 'fact', body: '最近 30 天内借阅了 2 本。', dimension: 'volume' },
  { kind: 'taste', body: '整体书单以虚构类为主，风格偏向细腻叙事。' },
]

const RESULT: ProfileInsights = { insights: INSIGHTS }

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

function baseInput(overrides: Partial<InsightPipelineInput> = {}): InsightPipelineInput {
  return {
    prefs: BASE_PREFS,
    locale: 'zh-CN',
    entities,
    stats,
    classificationSystem: 'clc',
    bypassCache: false,
    scene: SCENE,
    key: KEY,
    ...overrides,
  }
}

function baseDeps(overrides: Partial<InsightPipelineDeps> = {}): InsightPipelineDeps {
  return {
    readCache: vi.fn(() => null),
    writeCache: vi.fn(),
    submit: vi.fn(async () => RESULT),
    ...overrides,
  }
}

/** 构造真实 ZodError：对非法响应 safeParse 取 error（与 provider 抛错同型）。 */
function zodError(): ZodError {
  const parsed = profileInsightsSchema.safeParse({ insights: [] })
  if (parsed.success) throw new Error('unreachable')
  return parsed.error
}

describe('runInsightPipeline — 缓存（§5.3）', () => {
  it('缓存命中直出：返回缓存结果，不调用上送、不写缓存', async () => {
    const deps = baseDeps({ readCache: vi.fn(() => ({ result: RESULT, generatedAt: 123 })) })
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'cache-hit', insights: INSIGHTS })
    expect(deps.submit).not.toHaveBeenCalled()
    expect(deps.writeCache).not.toHaveBeenCalled()
  })

  it('缓存结果不满足 schema（条数不足）→ 视为未命中继续生成', async () => {
    const deps = baseDeps({
      readCache: vi.fn(() => ({
        result: { insights: [{ kind: 'fact', body: '只有一条' }] },
        generatedAt: 1,
      })),
    })
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'success', insights: INSIGHTS })
    expect(vi.mocked(deps.submit)).toHaveBeenCalledOnce()
  })

  it('缓存结果非对象（损坏 JSON）→ 视为未命中继续生成', async () => {
    const deps = baseDeps({ readCache: vi.fn(() => ({ result: 'garbage', generatedAt: 1 })) })
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'success', insights: INSIGHTS })
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
    expect(confirmed).toEqual({ status: 'success', insights: INSIGHTS })
    expect(vi.mocked(deps.submit).mock.calls[0][0]).toBe(result.payload)
  })

  it('sendPreview=false → 直接走上送（不经预览门），成功写缓存（writeAiCache 收到 result）', async () => {
    const deps = baseDeps()
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'success', insights: INSIGHTS })
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
      readCache: vi.fn(() => ({
        result: {
          insights: [
            { kind: 'fact', body: '旧缓存一' },
            { kind: 'fact', body: '旧缓存二' },
          ],
        },
        generatedAt: 1,
      })),
    })
    const result = await runInsightPipeline(baseInput({ bypassCache: true }), deps)
    expect(result).toEqual({ status: 'success', insights: INSIGHTS })
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

  it('聚合未就绪（stats=null）→ 静默 skipped', async () => {
    const deps = baseDeps()
    const result = await runInsightPipeline(baseInput({ stats: null }), deps)
    expect(result).toEqual({ status: 'skipped' })
    expect(deps.readCache).not.toHaveBeenCalled()
    expect(deps.submit).not.toHaveBeenCalled()
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
    expect(zhFirst).toEqual({ status: 'success', insights: INSIGHTS })
    const zhKey = `ai:${SCENE}:zh-CN:${KEY}`
    const enKey = `ai:${SCENE}:en:${KEY}`
    const zhRaw = store.get(zhKey)
    expect(zhRaw).toBeDefined()
    // en 生成 → 独立 en 键落盘（ai:profile:en:all），且不覆盖 zh 条目（locale 隔离）。
    const enFirst = await runInsightPipeline(baseInput({ locale: 'en' }), deps)
    expect(enFirst).toEqual({ status: 'success', insights: INSIGHTS })
    expect(store.get(enKey)).toBeDefined()
    expect(store.get(zhKey)).toBe(zhRaw)
    // zh 再次生成 → 命中 zh 缓存直出（不再上送）；en 缓存不受影响。
    const zhAgain = await runInsightPipeline(baseInput(), deps)
    expect(zhAgain).toEqual({ status: 'cache-hit', insights: INSIGHTS })
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
