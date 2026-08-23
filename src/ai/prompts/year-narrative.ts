/**
 * Phase 2 年度叙事（/profile/$year「年度叙事」）prompt 占位文件。
 * 规格：docs/specs/ai-features.md §9.1 —— 年度切片指标 + 切片内全量书目
 * （与画像场景同一白名单形态）→ 叙事段落；流式输出 + Abort；按 year/range/locale 缓存。
 *
 * Phase 2 落地时在本文件实现模板与 Zod schema；当前仅导出类型与占位标记，
 * 避免调用方误用未实现的模板。
 */

/** 年度叙事场景的数据切片（Phase 2 定稿具体字段）。 */
export type YearNarrativeScene = {
  year: number
  /** 该年度切片对应的统计摘要（Phase 2 定义）。 */
  summary: unknown
}

/** Phase 2 模板占位：空串标记「尚未实现」，调用方应显式判空降级。 */
export const YEAR_NARRATIVE_TEMPLATE_PHASE2 = '' as const
