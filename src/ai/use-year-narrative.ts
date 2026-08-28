// 年度叙事编排 Hook（ai-features §9.1 / §5.3，Phase 2 U-2）：/profile/$year「年度叙事」
// AI 区的数据接入层。复用共享引擎 use-ai-engine（与画像 use-ai.ts 同构）：年度场景注入
// scene 'year-narrative' / key String(year) / serializeYearPayload 装配 /
// buildYearNarrativePrompt / validateYearNarrative。
// 数字同源（§2.7）：assemble 消费与页面静态骨架同一 computeYearSlice 产物 +
// 同源实体——叙事数字与目标卡/Top 5/书单完全一致，LLM 只转译不生成。
// 年度目标值（UserPreferences.annualGoals）不进 payload（§9.1 白名单边界）：装配器
// serializeYearPayload 不消费偏好，引擎不读年度目标字段。
import { useTranslation } from 'react-i18next'

import { useAiEngine } from '@/ai/use-ai-engine'
import type { UseAiEngineState } from '@/ai/use-ai-engine'
import {
  YEAR_NARRATIVE_TEMPERATURE,
  buildYearNarrativePrompt,
  validateYearNarrative,
} from '@/ai/prompts/year-narrative'
import { serializeYearPayload } from '@/ai/sanitize'
import type { YearPayload } from '@/ai/sanitize'
import type { Locale } from '@/lib/locale'
import type { ProfileStatsInput, YearSliceResult } from '@/lib/profile-stats'

/** 年度场景缓存键（§5.3）：ai:year-narrative:{locale}:{year}——键形不变，scene=year-narrative、
 *  key=year；按年 + locale 隔离；清除仍仅 `ai:` 前缀（clearAiCache 不感知 scene）。 */
const CACHE_SCENE = 'year-narrative'

export interface UseYearNarrativeOptions {
  /** 年份（缓存 key 与 payload.year）。 */
  year: number
  /** 年切片（computeYearSlice 产物）；null = 未就绪（useLiveQuery 未加载）。 */
  slice: YearSliceResult | null
  /** 本地实体（与页面静态骨架同源；输入独立性 §2.7）；null = 未就绪。 */
  entities: ProfileStatsInput | null
}

export type UseYearNarrativeState = UseAiEngineState<YearPayload>

/**
 * 年度叙事编排 Hook：引擎注入年度场景。
 * ready 门：slice/entities 就绪且 bookCount > 0——空年静默（页面侧本就不渲染叙事区，
 * 双保险防误触发）；serializeYearPayload 借阅次数取年内口径（与 computeYearSlice 同源）。
 */
export function useYearNarrative(opts: UseYearNarrativeOptions): UseYearNarrativeState {
  const { i18n } = useTranslation('pages')
  // 缓存键与 prompt 语言一致（§5.3）；仅 'zh-CN'/'en' 两个已配置 locale，其余回退默认。
  const locale: Locale = i18n.language === 'en' ? 'en' : 'zh-CN'

  const { year, slice, entities } = opts
  // assemble 闭包：ready 门保证 slice/entities 非空后调用（闭包内非空断言）。
  return useAiEngine<YearPayload>({
    scene: CACHE_SCENE,
    key: String(year),
    locale,
    temperature: YEAR_NARRATIVE_TEMPERATURE,
    ready: slice !== null && entities !== null && slice.bookCount > 0,
    assemble: () =>
      serializeYearPayload(
        entities as ProfileStatsInput,
        slice as YearSliceResult,
        year,
        { classificationSystem: null },
      ),
    buildPrompt: (payload, promptLocale) =>
      buildYearNarrativePrompt({
        year: payload.year,
        slice: payload.slice,
        books: payload.books,
        locale: promptLocale,
      }),
    validate: validateYearNarrative,
  })
}
