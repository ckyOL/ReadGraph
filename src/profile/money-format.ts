// 价值统计展示格式化（reading-profile 规格 §2.5 / §8）。
// 聚合层只产数值（元），格式化仅在渲染层；Intl.NumberFormat 按
// `locale + currency` 模块级缓存复用，避免每次渲染重建（构建成本高）。
const formatterCache = new Map<string, Intl.NumberFormat>()

/** 金额 → locale 货币串（如 zh-CN "¥35.00" / en "CN¥35.00"）。 */
export function formatCurrency(
  amount: number,
  currency: string,
  locale: string,
): string {
  const key = `${locale}:${currency}`
  let f = formatterCache.get(key)
  if (!f) {
    // M7 回归：非法币种码（parsePrice 正则可产出、编辑表单自由文本可输入，
    // 如 "US"）会令 Intl.NumberFormat 抛 RangeError——MoneyCards 无
    // ErrorBoundary 时 profile 整页崩溃。降级为纯数字格式（不带货币符号），
    // 不抛错；合法币种缓存路径不受影响。
    try {
      f = new Intl.NumberFormat(locale, { style: 'currency', currency })
    } catch {
      f = new Intl.NumberFormat(locale, { style: 'decimal', maximumFractionDigits: 2 })
    }
    formatterCache.set(key, f)
  }
  return f.format(amount)
}
