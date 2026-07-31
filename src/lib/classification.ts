// 分类法一级类目对照表与归并纯函数（ui-navigation §3「分类法芯片」）。
// 从 profile-stats.ts 抽离的共享表：阅读画像聚合与书库/详情分类号芯片共用，
// 保证 code ↔ category 映射唯一来源。
// 纯函数、无依赖。CLC/DDC 表为领域数据（中图法/杜威主类名），不做 i18n 翻译。
import type { ClassificationSystem } from '@/types/entities'

/** CLC 一级类目对照表（取分类号首字母 A–Z）。 */
export const CLC_FIRST_LEVEL: Record<string, string> = {
  A: '马克思主义、列宁主义、毛泽东思想、邓小平理论',
  B: '哲学、宗教',
  C: '社会科学总论',
  D: '政治、法律',
  E: '军事',
  F: '经济',
  G: '文化、科学、教育、体育',
  H: '语言、文字',
  I: '文学',
  J: '艺术',
  K: '历史、地理',
  N: '自然科学总论',
  O: '数理科学和化学',
  P: '天文学、地球科学',
  Q: '生物科学',
  R: '医药、卫生',
  S: '农业科学',
  T: '工业技术',
  U: '交通运输',
  V: '航空、航天',
  X: '环境科学、安全科学',
  Z: '综合性图书',
}

/** DDC 一级类目对照表（取分类号首位 0–9）。 */
export const DDC_FIRST_LEVEL: Record<string, string> = {
  '0': 'Computer science, information & general works',
  '1': 'Philosophy & psychology',
  '2': 'Religion',
  '3': 'Social sciences',
  '4': 'Language',
  '5': 'Science',
  '6': 'Technology',
  '7': 'Arts & recreation',
  '8': 'Literature',
  '9': 'History & geography',
}

/** 分类体系展示顺序（toolbar/筛选用）。 */
export const CLASSIFICATION_SYSTEMS: ClassificationSystem[] = [
  'clc',
  'ddc',
  'lcc',
  'udc',
]

/**
 * 分类号 → 一级类目名（芯片主文本）。
 * CLC 取首字母、DDC 取首位；lcc/udc/other 无内置表 → null。
 * 未知 code 返回 null（不抛错），调用方按未分类处理。
 */
export function classificationCategory(
  system: ClassificationSystem,
  code: string,
): string | null {
  if (!code) return null
  if (system === 'clc') {
    return CLC_FIRST_LEVEL[code.charAt(0).toUpperCase()] ?? null
  }
  if (system === 'ddc') {
    return DDC_FIRST_LEVEL[code.charAt(0)] ?? null
  }
  return null
}

/**
 * 体系条目 → 一级归并（CLC 首字母 / DDC 首位 / 其余沿用原 code）。
 * 返回 { code, category, name }；条目不可用返回 null。
 */
export function classificationFirstLevel(
  system: ClassificationSystem,
  entry: { system: ClassificationSystem; code: string; category?: string },
): { code: string; category: string | null; name: string } | null {
  if (system === 'clc' || system === 'ddc') {
    const category = classificationCategory(system, entry.code)
    if (category == null) return null
    const code = system === 'clc' ? entry.code.charAt(0).toUpperCase() : entry.code.charAt(0)
    return { code, category, name: category }
  }
  // lcc/udc/other：不做表归并，沿用条目原 code/category。
  const category = entry.category ?? null
  return { code: entry.code, category, name: category ?? entry.code }
}
