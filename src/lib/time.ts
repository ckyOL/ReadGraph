// 时区转换纯函数（§10.5）。
// 无 Date.now()、不在模块顶层读时区，依赖 date-fns-tz 的 fromZonedTime。
import { fromZonedTime } from 'date-fns-tz'

/**
 * 把「无时区标记的本地时间字符串」按 IANA 时区解释为 UTC `Date`。
 *
 * 输入形如 szlib 的 `"YYYY-MM-DDTHH:MM:SS"`（由 date+time 组合），
 * 即 date-fns-tz 的 fromZonedTime 所消费的「墙上时间」字符串。
 * 非法日期/时区时抛 Error，由管线转 invalid_date 警告（不在此处理）。
 */
export function localToUtc(localText: string, timezone: string): Date {
  const result = fromZonedTime(localText, timezone)
  if (Number.isNaN(result.getTime())) {
    throw new Error(`invalid date/time: "${localText}" in timezone "${timezone}"`)
  }
  return result
}
