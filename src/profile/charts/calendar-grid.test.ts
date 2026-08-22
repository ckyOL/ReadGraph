import { describe, it, expect } from 'vitest'

import {
  buildYearGrid,
  buildMonthGrid,
  calendarCellColor,
  buildCalendarTooltip,
} from '@/profile/charts/calendar-grid'
import type { CalendarCell } from '@/profile/charts/calendar-grid'
import type { CalendarDay } from '@/lib/profile-stats'

// ---- 固定数据 ----
const day = (date: string, count = 1, bookIds = ['b1']): CalendarCell => ({
  date,
  count,
  bookIds,
  x: 0,
  y: 0,
})
const NO_DAYS: CalendarDay[] = []

describe('calendar-grid - buildYearGrid（GitHub 贡献图式年视图）', () => {
  it('2024（闰年，1 月 1 日为周一）：周一先行的首格与周日换行正确', () => {
    const g = buildYearGrid(NO_DAYS, 2024, 1, 'zh-CN')
    expect(g.xCount).toBe(53)
    expect(g.yCount).toBe(7)
    // 2024-01-01 是周一 → weekStartsOn=1 下为 (0, 0)
    const byDate = new Map(g.cells.map((c) => [c.date, c]))
    expect(byDate.get('2024-01-01')).toMatchObject({ x: 0, y: 0 })
    // 2024-01-07 周日 → 同列第 7 行
    expect(byDate.get('2024-01-07')).toMatchObject({ x: 0, y: 6 })
    // 2024-01-08 次周一 → 第 2 列
    expect(byDate.get('2024-01-08')).toMatchObject({ x: 1, y: 0 })
    // 闰年 366 天全部产格
    expect(g.cells).toHaveLength(366)
  })

  it('周日先行：2024-01-01（周一）位于 (0, 1)，前导列由 2023-12-31 起始', () => {
    const g = buildYearGrid(NO_DAYS, 2024, 0, 'en')
    const byDate = new Map(g.cells.map((c) => [c.date, c]))
    expect(byDate.get('2024-01-01')).toMatchObject({ x: 0, y: 1 })
    expect(byDate.get('2024-01-07')).toMatchObject({ x: 1, y: 0 })
  })

  it('月初列标签：2 月标签落在第 5 列（2024-01-01 起 31 天），locale 正确', () => {
    const zh = buildYearGrid(NO_DAYS, 2024, 1, 'zh-CN')
    expect(zh.xLabels).toContainEqual({ index: 4, label: '2月' })
    const en = buildYearGrid(NO_DAYS, 2024, 1, 'en')
    expect(en.xLabels).toContainEqual({ index: 4, label: 'Feb' })
  })

  it('y 轴星期名随 locale 与周起始顺序', () => {
    const zh = buildYearGrid(NO_DAYS, 2024, 1, 'zh-CN')
    expect(zh.yLabels).toEqual(['周一', '周二', '周三', '周四', '周五', '周六', '周日'])
    const en = buildYearGrid(NO_DAYS, 2024, 0, 'en')
    expect(en.yLabels).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
  })

  it('有数据日携带 count/bookIds；无数据日 count=0', () => {
    const g = buildYearGrid(
      [day('2024-01-03', 2, ['b1', 'b2'])],
      2024,
      1,
      'zh-CN',
    )
    const byDate = new Map(g.cells.map((c) => [c.date, c]))
    expect(byDate.get('2024-01-03')).toMatchObject({ count: 2, bookIds: ['b1', 'b2'], x: 0, y: 2 })
    expect(byDate.get('2024-01-04')).toMatchObject({ count: 0, bookIds: [] })
  })

  it('非本年日被忽略', () => {
    const g = buildYearGrid(
      [day('2023-12-31'), day('2024-01-02'), day('2025-01-01')],
      2024,
      1,
      'zh-CN',
    )
    const dates = g.cells.map((c) => c.date)
    expect(dates).toContain('2024-01-02')
    expect(dates).not.toContain('2023-12-31')
    expect(dates).not.toContain('2025-01-01')
  })
})

describe('calendar-grid - buildMonthGrid（单月视图）', () => {
  it('2024-02（闰年，2 月 1 日为周四）：行列为 7×5，首日 (3, 0)，月末 (3, 4)', () => {
    const g = buildMonthGrid(NO_DAYS, 2024, 2, 1, 'zh-CN')
    expect(g.xCount).toBe(7)
    expect(g.yCount).toBe(5)
    const byDate = new Map(g.cells.map((c) => [c.date, c]))
    expect(byDate.get('2024-02-01')).toMatchObject({ x: 3, y: 0 })
    expect(byDate.get('2024-02-29')).toMatchObject({ x: 3, y: 4 })
    expect(g.cells).toHaveLength(29)
    // 仅本月日
    expect(g.cells.every((c) => c.date.startsWith('2024-02-'))).toBe(true)
  })

  it('2024-02 周日先行：2 月 1 日（周四）位于 (4, 0)', () => {
    const g = buildMonthGrid(NO_DAYS, 2024, 2, 0, 'en')
    const byDate = new Map(g.cells.map((c) => [c.date, c]))
    expect(byDate.get('2024-02-01')).toMatchObject({ x: 4, y: 0 })
  })

  it('x 轴星期名、y 轴为空占位', () => {
    const zh = buildMonthGrid(NO_DAYS, 2024, 2, 1, 'zh-CN')
    expect(zh.xLabels.map((l) => l.label)).toEqual([
      '周一', '周二', '周三', '周四', '周五', '周六', '周日',
    ])
    expect(zh.yLabels).toEqual(['', '', '', '', ''])
  })
})

describe('calendar-grid - calendarCellColor', () => {
  it('count 分阶 alpha：0→弱底格，1–4+ 步进', () => {
    expect(calendarCellColor(0, '#61764B', '#E8E4DC')).toBe('rgba(232,228,220,0.5)')
    expect(calendarCellColor(1, '#61764B', '#E8E4DC')).toBe('rgba(97,118,75,0.25)')
    expect(calendarCellColor(2, '#61764B', '#E8E4DC')).toBe('rgba(97,118,75,0.45)')
    expect(calendarCellColor(3, '#61764B', '#E8E4DC')).toBe('rgba(97,118,75,0.65)')
    expect(calendarCellColor(4, '#61764B', '#E8E4DC')).toBe('rgba(97,118,75,0.85)')
    expect(calendarCellColor(9, '#61764B', '#E8E4DC')).toBe('rgba(97,118,75,0.85)')
  })
})

describe('calendar-grid - buildCalendarTooltip', () => {
  const bookIndex = {
    b1: { title: '书一', coverUrl: null },
    b2: { title: 'a <b> & "q"', coverUrl: 'https://x.test/c.jpg?q=1&r=2' },
  }
  const opts = {
    dateText: '2024年2月1日',
    countText: '借阅 2 本',
    moreText: (n: number) => `另有 ${n} 本`,
  }
  const cell = day('2024-02-01', 2, ['b1', 'b2'])

  it('标题与计数、书名转义、封面缩略图、URL 转义', () => {
    const html = buildCalendarTooltip(cell, bookIndex, opts)
    expect(html).toContain('2024年2月1日')
    expect(html).toContain('借阅 2 本')
    expect(html).toContain('书一')
    // 书名与 URL 均被 HTML 转义
    expect(html).toContain('a &lt;b&gt; &amp; &quot;q&quot;')
    expect(html).toContain('https://x.test/c.jpg?q=1&amp;r=2')
    expect(html).toContain('<img')
  })

  it('超过 8 本折叠为「另有 N 本」', () => {
    const manyIds = Array.from({ length: 10 }, (_, i) => `b${i}`)
    const index: Record<string, { title: string; coverUrl: string | null }> = {}
    for (const id of manyIds) index[id] = { title: `t-${id}`, coverUrl: null }
    const html = buildCalendarTooltip(
      day('2024-02-01', 10, manyIds),
      index,
      opts,
    )
    expect(html).toContain('另有 2 本')
    expect(html).toContain('t-b7')
    expect(html).not.toContain('t-b8')
  })

  it('bookIndex 缺失该 bookId 时跳过不抛错；count=0 返回空串', () => {
    const missing = buildCalendarTooltip(
      day('2024-02-01', 1, ['b1', 'b-missing']),
      bookIndex,
      opts,
    )
    expect(missing).toContain('书一')
    expect(missing).not.toContain('b-missing')
    expect(buildCalendarTooltip(day('2024-02-01', 0), bookIndex, opts)).toBe('')
  })
})
