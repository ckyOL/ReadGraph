/**
 * 日期范围倒置判定（WCAG 3.3.1 错误标识 / 3.3.3 错误建议）。
 * 输入为 `<input type="date">` 的 YYYY-MM-DD 字符串：两端均填且 from > to 即倒置。
 * YYYY-MM-DD 定长字典序等价于时间序，直接字符串比较即可，无需解析为 Date。
 */
export function isDateRangeInverted(from: string, to: string): boolean {
  return from !== '' && to !== '' && from > to
}
