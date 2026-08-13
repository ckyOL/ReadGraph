// 编目条码前缀归属馆解析（branch-library 规格 §2/§3）。
// 来源无关契约：各图书馆来源（parser）可注册自己的「条码前缀 → 归属馆」表，
// 查表按 parserId 路由；szlib 为参考实现（规则权威文档 szlib-parser §6）。
// 纯函数、无外部依赖：取条码前 6 位查表；未知来源/未命中 → null（不抛错）。
// 馆名为领域数据（分馆名），不做 i18n 翻译——同 classification.ts CLC/DDC 表约定。

/** 条码前缀 → 归属馆映射（馆名领域数据）。 */
export type BranchPrefixMap = Readonly<Record<string, string>>

/**
 * szlib 来源的归属馆规则（参考实现；权威文档 szlib-parser §6）。
 * 键长均为 6，无前缀包含歧义；`F44010` 为含字母前缀（大学城），查表前统一大写。
 */
export const SZ_BRANCH_PREFIXES: BranchPrefixMap = {
  '044005': '市馆',
  '044006': '南山区',
  '044007': '宝安区',
  '044008': '福田区',
  '044009': '盐田区',
  '044010': '罗湖区',
  '044120': '龙岗区',
  '044132': '光明区',
  '044136': '坪山区',
  '044137': '龙华区',
  'F44010': '大学城',
}

/**
 * 归属馆规则注册表：parserId → 前缀表。
 * 新增来源：在此登记其前缀表，并在对应 parser 文档定义规则（参考 szlib-parser §6）。
 */
export const BRANCH_PREFIX_TABLES: Readonly<Record<string, BranchPrefixMap>> = {
  szlib: SZ_BRANCH_PREFIXES,
}

/**
 * 按来源解析条码归属馆：取条码前 6 位查该来源注册的前缀表（字母前缀大小写归一）。
 * 空值/长度不足 6 位/未知前缀/未知来源（parserId 未注册）→ null，调用方按「无归属馆」处理。
 */
export function branchOfBarcode(
  barcode: string | null | undefined,
  parserId: string | null | undefined,
): string | null {
  if (!barcode || !parserId) return null
  const table = BRANCH_PREFIX_TABLES[parserId]
  if (!table) return null
  return table[barcode.slice(0, 6).toUpperCase()] ?? null
}
