// ISBN 清洗、ISBN-10→13 转换、软校验（§10.1、book.md ISBN 处理规则）。
// 纯函数、无依赖。

/** 去除连字符与空格，统一为大写（ISBN-10 末位 X 保留）。 */
export function cleanIsbn(input: string | null | undefined): string | null {
  if (input == null) return null
  const cleaned = input.replace(/[-\s]/g, '').toUpperCase()
  return cleaned === '' ? null : cleaned
}

/** ISBN-10 校验位（模 11，权重 10..1）软校验。末位可为 X（=10）。 */
export function isValidIsbn10(isbn: string): boolean {
  if (!/^\d{9}[\dX]$/.test(isbn)) return false
  let sum = 0
  for (let i = 0; i < 10; i++) {
    const ch = isbn[i]!
    const digit = ch === 'X' ? 10 : Number(ch)
    sum += digit * (10 - i)
  }
  return sum % 11 === 0
}

/** ISBN-13 校验位（模 10，权重 1/3 交替）软校验。 */
export function isValidIsbn13(isbn: string): boolean {
  if (!/^\d{13}$/.test(isbn)) return false
  let sum = 0
  for (let i = 0; i < 13; i++) {
    const digit = Number(isbn[i])
    sum += digit * (i % 2 === 0 ? 1 : 3)
  }
  return sum % 10 === 0
}

/**
 * ISBN-10 → ISBN-13：去校验位、加 978 前缀、重算校验位。
 * 仅对合法 ISBN-10 转换；输入非合法 ISBN-10 返回 null。
 * 979 组从未发行 10 位 ISBN（L10 回归：979 开头 10 位串校验位可合法，
 * 旧版会加 978 前缀产出伪 978-13 书号）——非 978 前缀的 ISBN-10 不转换。
 */
export function isbn10To13(isbn10: string): string | null {
  if (!isValidIsbn10(isbn10)) return null
  // 979 组从未发行 10 位 ISBN：979 开头 10 位串（校验位可合法）加 978 前缀
  // 会产出伪 978-13 书号（L10 回归）。
  if (isbn10.startsWith('979')) return null
  const core = `978${isbn10.slice(0, 9)}`
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const digit = Number(core[i])
    sum += digit * (i % 2 === 0 ? 1 : 3)
  }
  const check = (10 - (sum % 10)) % 10
  return `${core}${check}`
}

/**
 * 把任一原始 ISBN 归一为 ISBN-13（纯数字）或 null。
 * 优先 ISBN-13 校验通过；否则尝试 ISBN-10→13；都不合法返回 null。
 * 同时返回清洗后的 ISBN-10（若有），供 Book.isbn10 保留。
 */
export function normalizeIsbn(
  input: string | null | undefined,
): { isbn13: string | null; isbn10: string | null } {
  const cleaned = cleanIsbn(input)
  if (cleaned == null) return { isbn13: null, isbn10: null }

  if (cleaned.length === 13 && isValidIsbn13(cleaned)) {
    // 末位 X 不可能是合法 ISBN-13，已由正则排除
    return { isbn13: cleaned, isbn10: null }
  }
  if (cleaned.length === 10) {
    if (isValidIsbn10(cleaned)) {
      const isbn13 = isbn10To13(cleaned)
      return { isbn13, isbn10: cleaned }
    }
  }
  return { isbn13: null, isbn10: null }
}
