// 深图编目条码归属馆解析（branch-library 规格 §2/§3）。
// 纯函数、无外部依赖：取条码前 6 位查归属馆表；未命中 → null（不抛错）。
// 馆名为领域数据（分馆名），不做 i18n 翻译——同 classification.ts CLC/DDC 表约定。
// 键长均为 6，无前缀包含歧义；`F44010` 为含字母前缀（大学城），查表前统一大写。

/** 深图编目条码前 6 位 → 归属馆对照表（唯一来源）。 */
export const SZ_BRANCH_PREFIXES: Readonly<Record<string, string>> = {
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
 * 条码 → 归属馆名。取前 6 位查表（字母前缀大小写归一）；
 * 空值/长度不足 6 位/未知前缀（非深图条码）→ null，调用方按「无归属馆」处理。
 */
export function branchOfBarcode(barcode: string | null | undefined): string | null {
  if (!barcode) return null
  return SZ_BRANCH_PREFIXES[barcode.slice(0, 6).toUpperCase()] ?? null
}
