// 分享图内容收敛纯函数测试（annual-share-card-batch SC-1；reading-profile §4.1）。
// 白名单双层断言（C2 隐私护栏，W1 门禁）：输入类型层面编译期排除 + 输出序列化
// 文本黑名单逐值穷举（同 ai-features §3.3 形态）；Top 3 截取/占比归一/delta 降级/
// 空数据降级/纯函数性。纯函数：无 DOM/时钟/存储，同输入两次调用深等价。
import { describe, expect, it } from 'vitest'

import { buildShareContent } from './share-content'
import type { ShareContentInput } from './share-content'

/** 黑名单穷举夹具值（C2）：annualGoals/price/barcode/isbn13/馆名 各一个唯一秘密串。 */
const BLACKLIST_VALUES = [
  'TARGET-52', // annualGoals 目标值
  '12.99', // price 金额
  'BC-9876', // barcode
  '978-7-5001-2345-6', // isbn13
  '南山区图书馆', // 馆名
]

/**
 * 顶层超属性编译期排除断言（C2）：ShareContentInput 不含 annualGoals。
 * tsgo 7.0.2 对含嵌套脏值字面量只报内层超属性（外层被遮蔽）→ 顶层断言须用
 * covers 干净的独立字面量；嵌套条目超属性断言见 blacklistedInput()。
 */
void buildShareContent({
  year: 2025,
  bookCount: 3,
  topBooks: [],
  classification: [],
  covers: {},
  prevYear: null,
  // @ts-expect-error C2 白名单：annualGoals 不在 ShareContentInput（TS2353 超属性）
  annualGoals: { 2025: 'TARGET-52' },
})

/** 常规白名单夹具：3 本 Top 书 + 2 分类 + 上年对照。 */
function cleanInput(): ShareContentInput {
  return {
    year: 2025,
    bookCount: 3,
    topBooks: [
      { bookId: 'b1', count: 5 },
      { bookId: 'b2', count: 3 },
      { bookId: 'b3', count: 2 },
    ],
    classification: [
      { name: '文学', value: 2 },
      { name: '历史', value: 1 },
    ],
    covers: {
      b1: { title: '三体', authors: ['刘慈欣'], coverUrl: null },
      b2: { title: '活着', authors: ['余华'], coverUrl: null },
      b3: { title: '围城', authors: ['钱锺书'], coverUrl: null },
    },
    prevYear: { year: 2024, bookCount: 2 },
  }
}

/**
 * 黑名单穷举夹具：covers 每个条目挂一个脏值（类型层面 @ts-expect-error 断言编译期
 * 排除 = W1 门禁；运行时再由序列化断言兜底）。covers 值目标类型为
 * YearBookIndexEntry——超属性（libraryName/barcode/price/isbn13）必报 TS2353。
 */
function blacklistedInput(): ShareContentInput {
  const input: ShareContentInput = {
    year: 2025,
    bookCount: 3,
    topBooks: [
      { bookId: 'b1', count: 5 },
      { bookId: 'b2', count: 3 },
      { bookId: 'b3', count: 2 },
      { bookId: 'b4', count: 1 }, // 第 4 条：Top 3 截取应截掉（含 isbn13 脏值）
    ],
    classification: [
      { name: '文学', value: 2 },
      { name: '历史', value: 1 },
    ],
    covers: {
      b1: {
        title: '三体',
        authors: ['刘慈欣'],
        coverUrl: null,
        // @ts-expect-error C2 白名单：馆名不在 YearBookIndexEntry（TS2353 超属性）
        libraryName: '南山区图书馆',
      },
      b2: {
        title: '活着',
        authors: ['余华'],
        coverUrl: null,
        // @ts-expect-error C2 白名单：barcode 不在 YearBookIndexEntry（TS2353 超属性）
        barcode: 'BC-9876',
      },
      b3: {
        title: '围城',
        authors: ['钱锺书'],
        coverUrl: null,
        // @ts-expect-error C2 白名单：price 不在 YearBookIndexEntry（TS2353 超属性）
        price: { amount: 12.99, currency: 'CNY' },
      },
      b4: {
        title: '百年孤独',
        authors: ['加西亚·马尔克斯'],
        coverUrl: null,
        // @ts-expect-error C2 白名单：isbn13 不在 YearBookIndexEntry（TS2353 超属性）
        isbn13: '978-7-5001-2345-6',
      },
    },
    prevYear: null,
  }
  // annualGoals 脏值运行时挂载（编译期排除已由上方独立字面量断言覆盖）
  ;(input as ShareContentInput & { annualGoals: Record<number, string> }).annualGoals = {
    2025: 'TARGET-52',
  }
  return input
}

describe('buildShareContent', () => {
  it('红黑榜：黑名单值不出现于序列化产物，白名单字段俱全（C2 穷举断言，W1 门禁）', () => {
    const content = buildShareContent(blacklistedInput())
    const serialized = JSON.stringify(content)
    for (const value of BLACKLIST_VALUES) {
      expect(serialized).not.toContain(value)
    }
    expect(content.year).toBe(2025)
    expect(content.bookCount).toBe(3)
  })

  it('Top 3 截取：4 条输入 → 3 条输出，按输入顺序保留', () => {
    const content = buildShareContent(cleanInput())
    expect(content.topItems).toEqual([
      { title: '三体', authors: ['刘慈欣'], coverUrl: null, count: 5 },
      { title: '活着', authors: ['余华'], coverUrl: null, count: 3 },
      { title: '围城', authors: ['钱锺书'], coverUrl: null, count: 2 },
    ])
    expect(content.topItems).toHaveLength(3)
  })

  it('Top 3 截取：covers 无对应书 → 跳过该条（不占位、不补位）', () => {
    const input = cleanInput()
    input.topBooks = [
      { bookId: 'b1', count: 5 },
      { bookId: 'missing', count: 3 },
      { bookId: 'b2', count: 2 },
      { bookId: 'b3', count: 1 },
    ]
    const content = buildShareContent(input)
    // missing 无 covers 条目被跳过；b2/b3 顺序保留
    expect(content.topItems).toEqual([
      { title: '三体', authors: ['刘慈欣'], coverUrl: null, count: 5 },
      { title: '活着', authors: ['余华'], coverUrl: null, count: 2 },
      { title: '围城', authors: ['钱锺书'], coverUrl: null, count: 1 },
    ])
  })

  it('Top 分类截取：value 降序（slice.classification 为插入序，不排序会截错桶）→ 占比 = value/bookCount，和 ≤ 1', () => {
    const input = cleanInput()
    input.classification = [
      { name: '哲学', value: 1 },
      { name: '文学', value: 4 },
      { name: '艺术', value: 1 },
      { name: '历史', value: 2 },
    ]
    input.bookCount = 8
    const content = buildShareContent(input)
    expect(content.topCategories).toEqual([
      { name: '文学', ratio: 0.5 },
      { name: '历史', ratio: 0.25 },
      { name: '哲学', ratio: 0.125 },
    ])
    const sum = content.topCategories.reduce((acc, c) => acc + c.ratio, 0)
    expect(sum).toBeLessThanOrEqual(1)
  })

  it('__unclassified__ 桶与零值桶不进 topCategories/不占 topCategory 位', () => {
    const input = cleanInput()
    input.classification = [
      { name: '__unclassified__', value: 2 },
      { name: '文学', value: 1 },
    ]
    const content = buildShareContent(input)
    expect(content.topCategories).toEqual([{ name: '文学', ratio: 1 / 3 }])
  })

  it('summary：bookCount>0 有分类 → 主键 + count/categories（真实类目数，非 Top 3 截取数）/topCategory（降序后首桶）', () => {
    const content = buildShareContent(cleanInput())
    expect(content.summary).toEqual({
      key: 'profile.year.share.summary',
      params: { count: 3, categories: 2, topCategory: '文学' },
    })
  })

  it('summary：categories 计全部正值类目（>3 类时不再伪装「3 类」）', () => {
    const input = cleanInput()
    input.classification = [
      { name: '文学', value: 4 },
      { name: '历史', value: 2 },
      { name: '哲学', value: 1 },
      { name: '艺术', value: 1 },
    ]
    input.bookCount = 8
    const content = buildShareContent(input)
    expect(content.summary.params).toEqual({ count: 8, categories: 4, topCategory: '文学' })
  })

  it('summary：无分类 → summaryNoTop 键（params 含 count/categories，无 topCategory）', () => {
    const input = cleanInput()
    input.classification = []
    const content = buildShareContent(input)
    expect(content.summary).toEqual({
      key: 'profile.year.share.summaryNoTop',
      params: { count: 3, categories: 0 },
    })
    expect(content.summary.params).not.toHaveProperty('topCategory')
  })

  it('delta：prevYear=null（无上年数据）→ null', () => {
    const input = cleanInput()
    input.prevYear = null
    const content = buildShareContent(input)
    expect(content.delta).toBeNull()
  })

  it('delta：prevYear.bookCount=0（上年零读数）→ null', () => {
    const input = cleanInput()
    input.prevYear = { year: 2024, bookCount: 0 }
    const content = buildShareContent(input)
    expect(content.delta).toBeNull()
  })

  it('delta：有上年数据 → { prevBookCount }', () => {
    const content = buildShareContent(cleanInput())
    expect(content.delta).toEqual({ prevBookCount: 2 })
  })

  it('bookCount=0：topCategories 空数组且不除零抛错；summary 降级不抛错', () => {
    const input: ShareContentInput = {
      year: 2025,
      bookCount: 0,
      topBooks: [],
      classification: [
        { name: '文学', value: 0 },
        { name: '历史', value: 0 },
      ],
      covers: {},
      prevYear: null,
    }
    expect(() => buildShareContent(input)).not.toThrow()
    const content = buildShareContent(input)
    expect(content.topCategories).toEqual([])
    expect(content.topItems).toEqual([])
  })

  it('空输入：无 Top3/无分类/无上年 → 结构与 summaryNoTop 降级不抛错', () => {
    const input: ShareContentInput = {
      year: 2024,
      bookCount: 0,
      topBooks: [],
      classification: [],
      covers: {},
      prevYear: null,
    }
    const content = buildShareContent(input)
    expect(content.topItems).toEqual([])
    expect(content.topCategories).toEqual([])
    expect(content.summary).toEqual({
      key: 'profile.year.share.summaryNoTop',
      params: { count: 0, categories: 0 },
    })
    expect(content.delta).toBeNull()
  })

  it('纯函数性：同输入两次调用深等价', () => {
    const input = blacklistedInput()
    expect(buildShareContent(input)).toEqual(buildShareContent(input))
  })
})
