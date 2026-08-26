// 年度视图路由与静态骨架测试（reading-profile §4/§7 测试清单，U-1）。
// $year loader 参数校验（4 位数字年；非法 → 路由不匹配 404 路径）与骨架渲染
// （年份导航/目标卡/Top 5/书单网格按 computeYearSlice 产物渲染、空年 Empty 变体、
// 全库空整页 Empty、加载态 Skeleton）。渲染断言走 t() 取值路径（i18n-conventions §8：
// 断言 t(key) 结果，不硬编码中英文字面量）。
// Route 依赖（router/useLiveQuery/db/preferences）全部 mock：SSR 静态标记确定性断言。
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n, { changeLanguage } from '@/i18n'
import { useLiveQuery } from 'dexie-react-hooks'
import { makeBook, makeCatalog, makeCycle, makeSource } from '@/db/test-helpers'
import type { Book, BorrowCycle, CatalogRecord, Source } from '@/types/entities'

import { ProfileYearPage, parseYearParams } from './profile.$year'
import { YearGoalSummaryCard } from '@/profile/year/year-goal-summary-card'

vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('@/db/db-instance', () => ({ db: {} }))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children?: ReactNode
  }) =>
    createElement(
      'a',
      {
        href: `#${to.replace('$year', params?.year ?? '')}`,
        ...rest,
      },
      children,
    ),
}))
// 偏好：2026 目标 12；AI 默认关闭（年度视图无叙事痕迹——本波无叙事区，U-2 起断言）。
vi.mock('@/lib/preferences', () => ({
  readPreferences: () => ({
    locale: 'zh-CN',
    theme: 'auto',
    displayTimezone: 'Asia/Shanghai',
    ai: { enabled: false, baseUrl: '', model: '', sendPreview: true },
    annualGoals: { 2025: 12, 2026: 12 },
  }),
}))

const useLiveQueryMock = vi.mocked(useLiveQuery)

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init()
  await changeLanguage('zh-CN')
})

beforeEach(() => {
  useLiveQueryMock.mockReset()
})

const DAY = 86_400_000
const T0 = new Date('2026-03-10T00:00:00.000Z')

/** 2026 年度夹具：b1 年内 2 次（returned）、b2 年内 1 次（borrowed 在借，不依赖 returned）、
 *  b3 年内 1 次；b1 带封面与 clc 分类。bookCount=3、topBooks=[b1:2, b2:1, b3:1]。 */
function fixtures(): {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  sources: Source[]
} {
  const books: Book[] = [
    {
      ...makeBook('b1', '9780000000001', '三体'),
      authors: ['刘慈欣'],
      coverUrl: 'https://cdn.example.test/cover-san-ti.jpg',
    },
    { ...makeBook('b2', '9780000000002', '历史二'), authors: ['作者乙'] },
    { ...makeBook('b3', null, '在借三'), authors: ['作者丙'] },
  ]
  const catalogRecords: CatalogRecord[] = [
    makeCatalog('c1', 'b1', 'src-sz', 'BC1', 'm1', [{ system: 'clc', code: 'I247.5' }]),
    makeCatalog('c2', 'b2', 'src-sz', 'BC2', 'm2', [{ system: 'clc', code: 'K252.1' }]),
  ]
  const borrowCycles: BorrowCycle[] = [
    makeCycle('cy1', 'b1', 'src-sz', T0, 'returned', 'BC1'),
    makeCycle('cy2', 'b1', 'src-sz', new Date(T0.getTime() + DAY), 'returned', 'BC1'),
    makeCycle('cy3', 'b2', 'src-sz', new Date(T0.getTime() + DAY * 2), 'borrowed', 'BC2'),
    makeCycle('cy4', 'b3', 'src-sz', new Date(T0.getTime() + DAY * 3), 'borrowed', 'BC3'),
  ]
  return { books, catalogRecords, borrowCycles, sources: [makeSource('src-sz')] }
}

function entitiesOf(f: {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  sources: Source[]
}): {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  sources: Source[]
} {
  return f
}

function renderYearPage(year: number): string {
  return renderToStaticMarkup(
    createElement(ProfileYearPage, { year, navigateYear: () => undefined }),
  )
}

describe('YearGoalSummaryCard（/profile 概览行第 6 卡入口，reading-profile §4 入口导航）', () => {
  it('有目标 → 当年 N/M 同源数字 + 链接 /profile/$year', () => {
    const html = renderToStaticMarkup(
      createElement(YearGoalSummaryCard, { bookCount: 3, goal: 12, year: 2026 }),
    )
    expect(html).toContain(i18n.t('pages:profile.summary.goal'))
    expect(html).toContain('3/12')
    expect(html).toContain('#/profile/2026')
  })

  it('未设置目标 → 未设置文案，仍可跳转', () => {
    const html = renderToStaticMarkup(
      createElement(YearGoalSummaryCard, { bookCount: 3, goal: null, year: 2026 }),
    )
    expect(html).toContain(i18n.t('pages:profile.summary.goal.unset'))
    expect(html).toContain('#/profile/2026')
  })

  it('未就绪（yearSlice 未算出）→ — 不报错', () => {
    const html = renderToStaticMarkup(
      createElement(YearGoalSummaryCard, { bookCount: null, goal: null, year: 2026 }),
    )
    expect(html).toContain('—')
  })
})

describe('parseYearParams（$year loader 参数校验）', () => {
  it('4 位数字年通过', () => {
    expect(parseYearParams({ year: '2026' })).toEqual({ year: '2026' })
  })

  it('非 4 位数字/非数字/空 → false（notFound 路径）', () => {
    expect(parseYearParams({ year: 'abc' })).toBe(false)
    expect(parseYearParams({ year: '26' })).toBe(false)
    expect(parseYearParams({ year: '20261' })).toBe(false)
    expect(parseYearParams({ year: 'abcd' })).toBe(false)
    expect(parseYearParams({ year: '' })).toBe(false)
  })
})

describe('ProfileYearPage — 数据年骨架渲染', () => {
  it('年份导航 + 标题渲染（t() 取值路径）', () => {
    const f = fixtures()
    useLiveQueryMock.mockReturnValue(entitiesOf(f))
    const html = renderYearPage(2026)

    const yearLabel = new Intl.NumberFormat('zh-CN').format(2026)
    expect(html).toContain(i18n.t('pages:profile.year.title', { year: yearLabel }))
    expect(html).toContain(i18n.t('pages:profile.year.nav.prev'))
    expect(html).toContain(i18n.t('pages:profile.year.nav.next'))
  })

  it('目标卡进度 = computeYearSlice.bookCount 同源（3 / 12 + 差量 9）', () => {
    const f = fixtures()
    useLiveQueryMock.mockReturnValue(entitiesOf(f))
    const html = renderYearPage(2026)

    expect(html).toContain(i18n.t('pages:profile.year.goal.title'))
    expect(html).toContain(i18n.t('pages:profile.year.goal.progress', { current: 3, goal: 12 }))
    expect(html).toContain(i18n.t('pages:profile.year.goal.remaining', { count: 9 }))
  })

  it('目标未设置年（无 annualGoals 条目）→ 未设置文案 + 设置链接', () => {
    const f = fixtures()
    useLiveQueryMock.mockReturnValue(entitiesOf(f))
    const html = renderYearPage(2027)

    expect(html).toContain(i18n.t('pages:profile.year.goal.unset'))
    expect(html).toContain(i18n.t('pages:profile.year.goal.set'))
    expect(html).toContain('#/settings')
  })

  it('Top 5 区块标题与行数据（topBooks 降序渲染）', () => {
    const f = fixtures()
    useLiveQueryMock.mockReturnValue(entitiesOf(f))
    const html = renderYearPage(2026)

    expect(html).toContain(i18n.t('pages:profile.year.topBooks.title', { count: 5 }))
    // 复借最多的三体必在 Top 行；两次本地聚合产物深等价由 profile-stats 测试覆盖，
    // 这里断言渲染值来自 computeYearSlice（同源数字）：
    expect(html).toContain('三体')
    expect(html).toContain('历史二')
    expect(html).toContain('在借三')
  })

  it('年度书单网格：题名/作者/封面（有封面 img，无封面首字符占位）', () => {
    const f = fixtures()
    useLiveQueryMock.mockReturnValue(entitiesOf(f))
    const html = renderYearPage(2026)

    expect(html).toContain(i18n.t('pages:profile.year.books.title'))
    expect(html).toContain('三体')
    expect(html).toContain('刘慈欣')
    expect(html).toContain('历史二')
    expect(html).toContain('cover-san-ti.jpg')
    expect(html).toContain(i18n.t('pages:profile.year.books.title'))
  })

  it('本年借阅卡：bookCount 本（同源数字）', () => {
    const f = fixtures()
    useLiveQueryMock.mockReturnValue(entitiesOf(f))
    const html = renderYearPage(2026)

    expect(html).toContain(i18n.t('pages:profile.year.summary.title'))
    expect(html).toContain(i18n.t('pages:profile.year.summary.books', { count: 3 }))
  })
})

describe('ProfileYearPage — 空年/全库空/加载态', () => {
  it('空年（无周期落入）→ 书单与 Top 5 Empty 变体、目标卡 0 / 12、不崩', () => {
    const f = fixtures()
    useLiveQueryMock.mockReturnValue(entitiesOf(f))
    const html = renderYearPage(2025)

    expect(html).toContain(i18n.t('pages:profile.year.empty.title'))
    // 空年 Empty 变体 ≥2（书单/Top 5）+ 区块标题仍在
    expect(html.match(/data-slot="empty"/g)?.length).toBeGreaterThanOrEqual(2)
    expect(html).toContain(i18n.t('pages:profile.year.goal.progress', { current: 0, goal: 12 }))
    expect(html).toContain(i18n.t('pages:profile.year.goal.remaining', { count: 12 }))
  })

  it('全库空 → 整页 Empty + 导入入口（跳 /import），不崩', () => {
    useLiveQueryMock.mockReturnValue(entitiesOf({ books: [], catalogRecords: [], borrowCycles: [], sources: [] }))
    const html = renderYearPage(2026)

    expect(html).toContain(i18n.t('pages:profile.empty.title'))
    expect(html).toContain(i18n.t('pages:profile.empty.action'))
    expect(html).toContain('#/import')
  })

  it('useLiveQuery 未就绪 → Skeleton 加载态', () => {
    useLiveQueryMock.mockReturnValue(undefined)
    const html = renderYearPage(2026)

    expect(html).toContain('data-slot="skeleton"')
  })
})