// 年度叙事编排测试（ai-features §9.1 / §5.3 / §3.3，Phase 2 U-2）。
// 三层覆盖：
// 1) 管线编排（insight-pipeline 泛化 + 年度场景注入）：真实 serializeYearPayload /
//    validateYearNarrative 注入——预览 payload 过 yearPayloadSchema、上送产物与直接装配
//    深等价（§3.3 防漂移）、缓存键 ai:year-narrative:{locale}:{year} 按 year+locale 隔离、
//    失败不写缓存、bypass 覆盖、空年 skipped。
// 2) 组件渲染（renderToStaticMarkup，SSR 静态标记）：AI 未启用 → null 无痕迹；
//    启用 + 有结果 → t('profile.year.ai.*') 取值路径渲染（i18n-conventions §8）。
// 3) 源码审计：year-narrative.tsx 不引用年度目标字段（§9.1 白名单边界）——
//    以 sanitize.test.ts 同款 `?raw` 导入（sanitizeSource 先例），无 node types 依赖。
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n from '@/i18n'
import { runInsightPipeline, submitInsightPayload } from '@/ai/insight-pipeline'
import type { InsightPipelineDeps, InsightPipelineInput } from '@/ai/insight-pipeline'
import { YEAR_NARRATIVE_TEMPERATURE } from '@/ai/prompts/year-narrative'
import { serializeYearPayload, yearPayloadSchema } from '@/ai/sanitize'
import type { YearPayload } from '@/ai/sanitize'
import { computeYearSlice } from '@/lib/profile-stats'
import type { ProfileStatsInput, YearSliceResult } from '@/lib/profile-stats'
import { makeBook, makeCatalog, makeCycle, makeSource } from '@/db/test-helpers'
import narrativeSource from './year-narrative.tsx?raw'
import { YearNarrativeSection } from './year-narrative'

const U = (isoUtc: string) => new Date(isoUtc)
const YEAR = 2026
const SCENE = 'year-narrative'
const NARRATIVE = '今年借阅 **3** 本，最爱文学类，复借最多的是《测试之书一》。'

// ---- 年度夹具：b1 年内 2 次（复借最多）、b2/b3 各 1 次；b1 带 CLC 分类 ----
function buildEntities(): ProfileStatsInput {
  const src = makeSource('src-year-test')
  return {
    books: [
      makeBook('b1', '9787000000001', '测试之书一'),
      makeBook('b2', '9787000000002', '测试之书二'),
      makeBook('b3', '9787000000003', '测试之书三'),
    ],
    catalogRecords: [
      makeCatalog('c1', 'b1', src.id, 'BC1', null, [{ system: 'clc', code: 'I247.5' }]),
      makeCatalog('c2', 'b2', src.id, 'BC2', null, [{ system: 'clc', code: 'I247.5' }]),
    ],
    borrowCycles: [
      makeCycle('y1', 'b1', src.id, U('2026-01-10T08:00:00.000Z'), 'returned', 'BC1'),
      makeCycle('y2', 'b1', src.id, U('2026-03-10T08:00:00.000Z'), 'returned', 'BC1'),
      makeCycle('y3', 'b2', src.id, U('2026-02-10T08:00:00.000Z'), 'returned', 'BC2'),
      makeCycle('y4', 'b3', src.id, U('2026-04-10T08:00:00.000Z'), 'borrowed', 'BC3'),
    ],
    sources: [src],
  }
}

const entities = buildEntities()
const slice: YearSliceResult = computeYearSlice(entities.books, entities, YEAR, {
  classificationSystem: null,
})

const BASE_PREFS = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:9000',
  model: 'test-model',
  sendPreview: false,
}

function baseInput(
  overrides: Partial<InsightPipelineInput<YearPayload>> = {},
): InsightPipelineInput<YearPayload> {
  return {
    prefs: BASE_PREFS,
    locale: 'zh-CN',
    ready: true,
    assemble: () => serializeYearPayload(entities, slice, YEAR, { classificationSystem: null }),
    bypassCache: false,
    scene: SCENE,
    key: String(YEAR),
    ...overrides,
  }
}

function baseDeps(
  overrides: Partial<InsightPipelineDeps<YearPayload>> = {},
): InsightPipelineDeps<YearPayload> {
  return {
    readCache: vi.fn(() => null),
    writeCache: vi.fn(),
    validate: (text) => {
      expect(text).toBe(NARRATIVE)
      return text
    },
    submit: vi.fn(async () => NARRATIVE),
    ...overrides,
  }
}

// ---- 1) 管线编排（年度场景注入） ----
describe('年度场景管线编排（ai-features §9.1 / §3.3）', () => {
  it('sendPreview=true → pending-preview；payload 过 yearPayloadSchema 且与直接装配深等价', async () => {
    const deps = baseDeps()
    const result = await runInsightPipeline(
      baseInput({ prefs: { ...BASE_PREFS, sendPreview: true } }),
      deps,
    )
    if (result.status !== 'pending-preview') {
      throw new Error(`期望 pending-preview，实际 ${result.status}`)
    }
    expect(yearPayloadSchema.safeParse(result.payload).success).toBe(true)
    // 同一装配函数、同入参 → 深等价（§3.3 防漂移）。
    expect(result.payload).toEqual(
      serializeYearPayload(entities, slice, YEAR, { classificationSystem: null }),
    )
    expect(deps.submit).not.toHaveBeenCalled()
    expect(deps.writeCache).not.toHaveBeenCalled()
  })

  it('确认上送与预览同一 payload 对象引用（§3.3）；成功写缓存', async () => {
    const deps = baseDeps()
    const result = await runInsightPipeline(
      baseInput({ prefs: { ...BASE_PREFS, sendPreview: true } }),
      deps,
    )
    if (result.status !== 'pending-preview') throw new Error('期望 pending-preview')
    const confirmed = await submitInsightPayload(
      result.payload,
      { locale: 'zh-CN', scene: SCENE, key: String(YEAR) },
      deps,
    )
    expect(confirmed).toEqual({ status: 'success', markdown: NARRATIVE })
    expect(vi.mocked(deps.submit).mock.calls[0][0]).toBe(result.payload)
    expect(vi.mocked(deps.writeCache)).toHaveBeenCalledOnce()
  })

  it('sendPreview=false → 直接上送；成功写缓存（scene/locale/key 正确）', async () => {
    const deps = baseDeps()
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'success', markdown: NARRATIVE })
    expect(vi.mocked(deps.writeCache)).toHaveBeenCalledOnce()
    expect(vi.mocked(deps.writeCache).mock.calls[0][0]).toBe(SCENE)
    expect(vi.mocked(deps.writeCache).mock.calls[0][1]).toBe('zh-CN')
    expect(vi.mocked(deps.writeCache).mock.calls[0][2]).toBe(String(YEAR))
  })

  it('空年（bookCount=0 → 页面 ready=false）→ 静默 skipped，不上送不写缓存', async () => {
    const deps = baseDeps()
    const emptySlice = computeYearSlice(entities.books, entities, 1999, {
      classificationSystem: null,
    })
    const result = await runInsightPipeline(
      baseInput({
        ready: false,
        assemble: () =>
          serializeYearPayload(entities, emptySlice, 1999, { classificationSystem: null }),
        key: '1999',
      }),
      deps,
    )
    expect(result).toEqual({ status: 'skipped' })
    expect(deps.submit).not.toHaveBeenCalled()
    expect(deps.writeCache).not.toHaveBeenCalled()
  })

  it('失败（网络错误）不写缓存（§5.4）', async () => {
    const deps = baseDeps()
    deps.submit = vi.fn(async () => {
      throw new Error('network down')
    })
    const result = await runInsightPipeline(baseInput(), deps)
    if (result.status !== 'error') throw new Error('期望 error')
    expect(result.error.kind).toBe('network')
    expect(deps.writeCache).not.toHaveBeenCalled()
  })

  it('bypassCache=true → 跳过缓存读取并覆盖缓存（§4.1）', async () => {
    const deps = baseDeps({
      readCache: vi.fn(() => ({ result: '旧缓存', generatedAt: 1 })),
    })
    const result = await runInsightPipeline(baseInput({ bypassCache: true }), deps)
    expect(result).toEqual({ status: 'success', markdown: NARRATIVE })
    expect(deps.readCache).not.toHaveBeenCalled()
    expect(vi.mocked(deps.writeCache)).toHaveBeenCalledOnce()
  })
})

describe('缓存按 year + locale 隔离（§5.3，真实 ai-cache 键形）', () => {
  let store: Map<string, string>

  beforeEach(() => {
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
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('同年不同 locale / 不同年互不命中；键形 ai:year-narrative:{locale}:{year}', async () => {
    // 真实 ai-cache 读写直连 stub localStorage（键形由 ai-cache 拼接逻辑决定）。
    const { readAiCache, writeAiCache } = await import('@/lib/ai-cache')
    const deps = baseDeps()
    deps.readCache = readAiCache
    deps.writeCache = writeAiCache
    // zh-CN 2026 首次生成 → 写 ai:year-narrative:zh-CN:2026。
    const zh = await runInsightPipeline(baseInput(), deps)
    expect(zh).toEqual({ status: 'success', markdown: NARRATIVE })
    expect(store.has(`ai:${SCENE}:zh-CN:${YEAR}`)).toBe(true)
    // 同年 en 生成 → 独立键，不覆盖 zh。
    await runInsightPipeline(baseInput({ locale: 'en' }), deps)
    expect(store.has(`ai:${SCENE}:en:${YEAR}`)).toBe(true)
    // 2025（不同年）生成 → 独立键。
    await runInsightPipeline(baseInput({ key: '2025' }), deps)
    expect(store.has(`ai:${SCENE}:zh-CN:2025`)).toBe(true)
    // zh-CN 2026 再次生成 → 命中缓存直出，不上送。
    const zhAgain = await runInsightPipeline(baseInput(), deps)
    expect(zhAgain).toEqual({ status: 'cache-hit', markdown: NARRATIVE })
    expect(vi.mocked(deps.submit)).toHaveBeenCalledTimes(3)
  })

  it('缓存损坏（纯空白）→ 视为未命中继续生成', async () => {
    const deps = baseDeps({
      readCache: vi.fn(() => ({ result: '  ', generatedAt: 1 })),
    })
    const result = await runInsightPipeline(baseInput(), deps)
    expect(result).toEqual({ status: 'success', markdown: NARRATIVE })
    expect(vi.mocked(deps.submit)).toHaveBeenCalledOnce()
  })
})

// ---- 2) 组件渲染（SSR 静态标记；vi.mock 提升到模块顶层） ----

// 引擎 mock 状态：可变对象承载（vi.mock 工厂提升后仍可引用）。
const engineState = {
  markdown: null as string | null,
  streamingMarkdown: null as string | null,
  streamingReasoning: null as string | null,
  loading: false,
  error: null,
  pendingPreview: null,
  generate: vi.fn(async () => undefined),
  confirmGenerate: vi.fn(async () => undefined),
  cancelGenerate: vi.fn(),
  stop: vi.fn(),
}

let aiEnabled = false

vi.mock('@/ai/use-year-narrative', () => ({
  useYearNarrative: () => engineState,
}))

vi.mock('@/lib/preferences', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/preferences')>()
  return {
    ...mod,
    readPreferences: () => ({
      ...mod.readPreferences(),
      ai: { ...mod.readPreferences().ai, enabled: aiEnabled },
    }),
  }
})

function renderSection(): string {
  return renderToStaticMarkup(
    createElement(YearNarrativeSection, { year: YEAR, slice, entities }),
  )
}

describe('YearNarrativeSection 渲染（reading-profile §4 / ai-features §9.1）', () => {
  beforeAll(async () => {
    await i18n
  })

  it('AI 未启用 → null（无任何叙事痕迹）', () => {
    aiEnabled = false
    expect(renderSection()).toBe('')
  })

  it('启用 + 无结果 → 标题与生成按钮渲染（t() 取值路径）', () => {
    aiEnabled = true
    const html = renderSection()
    expect(html).toContain(i18n.t('pages:profile.year.ai.title'))
    expect(html).toContain(i18n.t('pages:profile.year.ai.generate'))
    expect(html).not.toContain(i18n.t('pages:profile.year.ai.regenerate'))
  })

  it('启用 + 已生成 → markdown + AI 生成标注 + 重新生成/复制按钮', () => {
    aiEnabled = true
    engineState.markdown = NARRATIVE
    const html = renderSection()
    expect(html).toContain(i18n.t('pages:profile.year.ai.title'))
    expect(html).toContain(i18n.t('pages:profile.year.ai.generated'))
    expect(html).toContain(i18n.t('pages:profile.year.ai.regenerate'))
    expect(html).toContain(i18n.t('pages:profile.year.ai.copy'))
    engineState.markdown = null
  })

  it('启用 + loading 流式 → 流式 markdown 与打字光标渲染', () => {
    aiEnabled = true
    engineState.loading = true
    engineState.streamingMarkdown = NARRATIVE
    const html = renderSection()
    expect(html).toContain(i18n.t('pages:profile.year.ai.generating'))
    expect(html).toContain(i18n.t('pages:profile.year.ai.stop'))
    expect(html).toContain('ai-markdown-caret')
    engineState.loading = false
    engineState.streamingMarkdown = null
  })
})

// ---- 3) 源码审计（§9.1 白名单边界） ----
describe('年度叙事区源码审计（ai-features §9.1）', () => {
  it('组件不引用年度目标字段（annualGoals 不进组件输入面）', () => {
    // ?raw 源码审计（sanitize.test.ts 先例）：年度目标值绝不进叙事装配/渲染面。
    expect(narrativeSource).not.toMatch(/annualGoals/)
  })

  it('温度为年度场景常量（低值抑制发散）', () => {
    expect(YEAR_NARRATIVE_TEMPERATURE).toBe(0.2)
  })
})
