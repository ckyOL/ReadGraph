// AI 阅读画像编排 Hook（ai-features §3.1 管道流程 ①–⑦ / §4.1 / §5.3 / §5.4）。
// 职责边界（Phase 2 U-2 抽取后）：响应式聚合（与 use-profile-stats 同源实体，
// range 固定 null = 全量口径）+ 画像场景注入（scene/key/装配/prompt/温度/弱校验）；
// 状态管理与上送编排在共享引擎 use-ai-engine.ts（年度叙事 use-year-narrative.ts
// 同构复用），编排核心纯函数在 insight-pipeline.ts。
// 输入独立性（§2.7）：生成输入只消费本地实体+聚合+payload，markdown 状态绝不参与
// 生成输入——防幻觉传播。
import { useCallback, useMemo } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useTranslation } from 'react-i18next'

import { useAiEngine } from '@/ai/use-ai-engine'
import type { UseAiEngineState } from '@/ai/use-ai-engine'
import {
  PROFILE_TEMPERATURE,
  buildProfileInsightsPrompt,
  validateProfileInsightsMarkdown,
} from '@/ai/prompts/profile-insights'
import { serializePayload } from '@/ai/sanitize'
import type { ProfilePayload } from '@/ai/sanitize'
import { db } from '@/db/db-instance'
import type { Locale } from '@/lib/locale'
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

export type UseAiInsightsState = UseAiEngineState<ProfilePayload>

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
 * 结构完整），useMemo 跑 computeProfileStats——range 固定 null（§4.1 不与 range 联动），
 * classificationSystem/displayTimezone/calendarAnchor 透传。
 *
 * 编排委托共享引擎 useAiEngine：画像场景注入（scene 'profile' / key 'all-v2' /
 * serializePayload 装配 / buildProfileInsightsPrompt / validateProfileInsightsMarkdown）；
 * loading 覆盖生成与重新生成，error 状态下再次 generate() 即重试。
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

  // 装配闭包：ready 门保证 stats 非空后调用（闭包内非空断言）；§3.3 预览与上送同产物。
  const assemble = useCallback(
    () =>
      serializePayload(
        { books, catalogRecords, borrowCycles, sources },
        stats as ProfileStatsResult,
        { classificationSystem: opts.classificationSystem },
      ),
    [books, catalogRecords, borrowCycles, sources, stats, opts.classificationSystem],
  )
  return useAiEngine<ProfilePayload>({
    scene: CACHE_SCENE,
    key: CACHE_KEY,
    locale,
    temperature: PROFILE_TEMPERATURE,
    ready: stats !== null,
    assemble,
    buildPrompt: (payload, promptLocale) =>
      buildProfileInsightsPrompt({
        summary: payload.summary,
        books: payload.books,
        locale: promptLocale,
      }),
    validate: validateProfileInsightsMarkdown,
  })
}
