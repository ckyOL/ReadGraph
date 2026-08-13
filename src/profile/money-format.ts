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
    f = new Intl.NumberFormat(locale, { style: 'currency', currency })
    formatterCache.set(key, f)
  }
  return f.format(amount)
}
