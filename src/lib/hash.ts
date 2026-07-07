// FNV-1a 32bit 确定性哈希（纯函数、无依赖）。
// 用于 §10.4 派生实体 ID：相同输入恒等输出，保证重建等价。
// 输出固定长度 8 位十六进制串。

/**
 * 计算 FNV-1a 32bit 哈希，返回固定 8 位十六进制字符串。
 *
 * FNV-1a 算法：offset basis 0x811c9dc5，prime 0x01000193，
 * 逐字节 mix。UTF-8 编码输入以支持任意字符串。
 */
export function stableHash(input: string): string {
  const PRIME = 0x01000193
  // FNV-1a offset basis（无符号 32 位）
  let hash = 0x811c9dc5 >>> 0

  // UTF-8 编码，保证非 ASCII 字符在 node/浏览器一致
  const bytes = new TextEncoder().encode(input)
  for (const byte of bytes) {
    hash ^= byte
    // 用 Math.imul 做带符号 32 位乘法，再 >>>0 归一无符号
    hash = Math.imul(hash, PRIME) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}
