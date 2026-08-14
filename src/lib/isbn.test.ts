import { describe, it, expect } from 'vitest'

import { normalizeIsbn, isbn10To13, isValidIsbn10, isValidIsbn13, cleanIsbn } from '@/lib/isbn'

describe('cleanIsbn', () => {
  it('去除连字符与空格、空串归 null', () => {
    expect(cleanIsbn('978-7-5217-4823-9')).toBe('9787521748239')
    expect(cleanIsbn(' 978 7 111 60000 0 ')).toBe('97871116000000'.slice(0, 13))
    expect(cleanIsbn('')).toBeNull()
    expect(cleanIsbn(null)).toBeNull()
    expect(cleanIsbn(undefined)).toBeNull()
  })

  it('ISBN-10 末位 X 保留大写', () => {
    expect(cleanIsbn('0-306-40615-x')).toBe('030640615X')
  })
})

describe('isValidIsbn10', () => {
  it('对合法 ISBN-10 返回 true', () => {
    expect(isValidIsbn10('0306406152')).toBe(true)
    // 末位为 X 的合法 ISBN-10（校验位 = 10）
    expect(isValidIsbn10('080442957X')).toBe(true)
  })

  it('对非法 ISBN-10 返回 false', () => {
    expect(isValidIsbn10('0306406153')).toBe(false)
    expect(isValidIsbn10('752174000X')).toBe(false) // 脱敏样本（校验位失效）
  })
})

describe('isValidIsbn13', () => {
  it('对合法 ISBN-13 返回 true', () => {
    expect(isValidIsbn13('9787521748239')).toBe(true)
    expect(isValidIsbn13('9780306406157')).toBe(true)
  })

  it('13 位非数字/校验失败被拒', () => {
    expect(isValidIsbn13('9787521748230')).toBe(false)
    expect(isValidIsbn13('978752174X239')).toBe(false)
  })
})

describe('isbn10To13', () => {
  it('已知 ISBN-10 0306406152 → ISBN-13 9780306406157', () => {
    expect(isbn10To13('0306406152')).toBe('9780306406157')
  })

  it('非法 ISBN-10 返回 null', () => {
    expect(isbn10To13('0306406153')).toBeNull()
  })

  it('979 开头 10 位串（校验位可合法）不转换，避免伪 978-13（L10）', () => {
    // 979 组从未发行 10 位 ISBN；979 前缀 10 位串加 978 前缀会产出伪书号。
    // 9790000006 为校验位合法的 10 位串（Σ 权重和 231 ≡ 0 mod 11）。
    expect(isbn10To13('9790000006')).toBeNull()
    expect(normalizeIsbn('9790000006')).toEqual({ isbn13: null, isbn10: '9790000006' })
  })
})

describe('normalizeIsbn', () => {
  it('原始 ISBN-13 通过校验返回 isbn13', () => {
    expect(normalizeIsbn('978-7-5217-4823-9')).toEqual({ isbn13: '9787521748239', isbn10: null })
  })

  it('有效 ISBN-10 转换为 ISBN-13 并保留 isbn10', () => {
    expect(normalizeIsbn('0-306-40615-2')).toEqual({ isbn13: '9780306406157', isbn10: '0306406152' })
  })

  it('有效 ISBN-10^尾位 X 同样可转换', () => {
    // 080442957X → 9780804429573（我实现按 978+前9位 + ISBN-13 校验位）
    expect(normalizeIsbn('080442957X')).toEqual({ isbn13: '9780804429573', isbn10: '080442957X' })
  })

  it('脱敏/非法 ISBN-10 归 null（夹具 7-5217-4000-X）', () => {
    expect(normalizeIsbn('7-5217-4000-X')).toEqual({ isbn13: null, isbn10: null })
  })

  it('空/空串归 null', () => {
    expect(normalizeIsbn('')).toEqual({ isbn13: null, isbn10: null })
    expect(normalizeIsbn(null)).toEqual({ isbn13: null, isbn10: null })
  })
})
