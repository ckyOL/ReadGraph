// 归一 publishDate 展示值（详情页与编辑框共用单一事实来源）：旧导出/夹具中 publishDate 可能被 JSON
// reviver 还原为 Date（e2e-seed DATE_KEYS）；统一转为 UTC 日期串 "YYYY-MM-DD"，
// 字符串与空值原样透传。详情页（$bookId.tsx）与编辑对话框（-edit-dialog.tsx）共用。
import { formatDateInTz } from '@/lib/display-time'

/**
 * publishDate → 展示值：Date 对象归一为 UTC 日期串；字符串 / null / undefined 透传。
 * 语义与旧防御一致（`!= null && typeof === 'object'`），零行为变化。
 */
export function normalizePublishDate(
  value: string | null | Date | undefined,
): string | null | undefined {
  if (value != null && typeof value === 'object') {
    return formatDateInTz(value as Date, 'UTC')
  }
  return value
}
