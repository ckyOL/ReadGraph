import type { ParseWarning, ParseWarningType } from '@/types/entities'

/**
 * 按类型归组警告（导入报告侧栏展示用）。
 * 组间保持类型首见顺序、组内保持管线产出顺序；空输入返回空数组。
 */
export function groupWarnings(
  warnings: ParseWarning[],
): Array<[ParseWarningType, ParseWarning[]]> {
  const groups = new Map<ParseWarningType, ParseWarning[]>()
  for (const w of warnings) {
    const list = groups.get(w.type) ?? []
    list.push(w)
    groups.set(w.type, list)
  }
  return [...groups.entries()]
}
