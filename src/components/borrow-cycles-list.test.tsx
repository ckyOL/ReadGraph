// 借阅历史列表测试：列表只负责遍历渲染 BorrowCycleRow 块（块级行为见 borrow-cycle-row.test.tsx）。
import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n, { changeLanguage } from '@/i18n'
import { BorrowCyclesList } from './borrow-cycles-list'
import type { BorrowCycle } from '@/types/entities'

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init()
  await changeLanguage('zh-CN')
})

const BORROWED = new Date('2026-06-28T06:30:00.000Z')

function makeCycle(id: string, over: Partial<BorrowCycle> = {}): BorrowCycle {
  return {
    id,
    bookId: 'bk-1',
    catalogRecordId: 'cr-1',
    sourceId: 'src-szlib',
    borrowedAt: BORROWED,
    returnedAt: null,
    status: 'borrowed',
    borrowLocation: null,
    returnLocation: null,
    rawRecordIds: [`r-${id}`],
    barcode: null,
    createdAt: BORROWED,
    updatedAt: BORROWED,
    ...over,
  }
}

const renderList = (cycles: BorrowCycle[]) =>
  renderToStaticMarkup(
    createElement(BorrowCyclesList, { cycles, displayTimezone: 'UTC' }),
  )

describe('BorrowCyclesList', () => {
  it('空数组不渲染（空态由页面处理）', () => {
    expect(renderList([])).toBe('')
  })

  it('每个借阅周期渲染一个块（BorrowCycleRow 输出在列表内）', () => {
    const html = renderList([
      makeCycle('cy-1', { borrowLocation: '合成馆1自助借还机' }),
      makeCycle('cy-2', { barcode: '04400515000000' }),
    ])
    // 两条记录 → 两个 <li> 块；块内容来自行组件（地点/条码各自命中）。
    expect(html.match(/<li/g)).toHaveLength(2)
    expect(html).toContain('合成馆1自助借还机')
    expect(html).toContain('04400515000000')
  })
})
