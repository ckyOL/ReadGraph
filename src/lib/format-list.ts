/**
 * 语言相关列表分隔符（阶段 2 本地化质量项 A-5）。
 *
 * 用 Intl.ListFormat（narrow conjunction）按当前语言连接列表项，仅用于
 * **只读展示**路径：
 * - en：`a, b, c`
 * - zh-CN：`a、b、c`
 *
 * 可编辑数据录入（splitPersons 等 round-trip 格式）**不走此函数**，保持规范
 * 分隔符 `'，'`，否则保存时拆分不回、数据损坏。
 */
export function formatList(language: string, items: string[]): string {
  return new Intl.ListFormat(language, { style: 'narrow', type: 'conjunction' }).format(items)
}
