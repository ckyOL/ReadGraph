// 标题/作者归一化键（§10.6、internal-schema normalize 函数）。
// 目的：去重匹配键，使全角/半角、标点、大小写差异归一。
// 纯函数、无外部依赖；繁简转换不在本里程碑（留扩展）。

/** 全角字符（FF01–FF5E）转半角；全角空格 U+3000 也转普通空格。 */
function fullWidthToHalf(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (code === 0x3000) {
      out += ' '
    } else if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0)
    } else {
      out += ch
    }
  }
  return out
}

/**
 * 归一化匹配键：去空白与标点、全角→半角、转小写。
 * 繁→简不在本里程碑（留扩展，见 §10.6）。
 */
export function normalize(input: string): string {
  if (input == null) return ''
  const half = fullWidthToHalf(input)
  // 去空白与标点：保留字母数字与 CJK 等普通字符，
  // 去掉 Unicode 标点类（P）与空白类（Z）。
  const stripped = half
    .split('')
    .filter((ch) => {
      if (/\s/.test(ch)) return false
      const cat = ch
      if (/\p{P}/u.test(cat)) return false
      return true
    })
    .join('')
  return stripped.toLowerCase()
}
