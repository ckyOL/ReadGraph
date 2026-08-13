// 单条借阅周期「块」组件测试（borrow-cycle 规格「地点与附加元数据」/ DESIGN.md §2.4、§4.4）。
// BorrowCycleRow 为纯展示组件（同 CatalogRecordCard），用 SSR 静态标记确定性断言。
// 块布局：借出块（细罫线方框：时间在上、地点在下）→ 归还块（同构），两块之间只有一个流向箭头。
// 状态徽章为 DESIGN.md 语义高对比色（借阅中=松叶 success、已归还=蓝鼠 info、unknown 弱化 outline）。
import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n, { changeLanguage } from '@/i18n'
import { BorrowCycleRow } from './borrow-cycle-row'
import type { BorrowCycle } from '@/types/entities'

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init()
  // 测试环境 navigator.language=en-US 会选中 en；固定 zh-CN 使徽标文案断言确定。
  await changeLanguage('zh-CN')
})

const BORROWED = new Date('2026-06-28T06:30:00.000Z')
const RETURNED = new Date('2026-07-05T02:00:00.000Z')

// 细罫线方框（借出块/归还块）class；断言其出现 2 次证明两块结构稳定。
const BLOCK_CLASS = 'border border-border px-2.5 py-1.5'

function makeCycle(over: Partial<BorrowCycle> = {}): BorrowCycle {
  return {
    id: 'cy-1',
    bookId: 'bk-1',
    catalogRecordId: 'cr-1',
    sourceId: 'src-szlib',
    borrowedAt: BORROWED,
    returnedAt: RETURNED,
    status: 'returned',
    borrowLocation: null,
    returnLocation: null,
    rawRecordIds: ['r1'],
    barcode: '04400611745052',
    createdAt: BORROWED,
    updatedAt: RETURNED,
    ...over,
  }
}

const renderRow = (cycle: BorrowCycle) =>
  renderToStaticMarkup(
    createElement(BorrowCycleRow, { cycle, displayTimezone: 'UTC', parserId: 'szlib' }),
  )

const countArrows = (html: string) => html.match(/→/g)?.length ?? 0
const countBlocks = (html: string) => html.split(BLOCK_CLASS).length - 1

describe('BorrowCycleRow', () => {
  it('借出块（时间上地点下）→ 归还块（时间上地点下），仅一个箭头', () => {
    const html = renderRow(
      makeCycle({ borrowLocation: '南山馆自助借还机', returnLocation: '深图三楼自助借还机' }),
    )
    // 块内顺序：借出日期 → 借出地点 → 箭头 → 归还日期 → 归还地点。
    expect(html.indexOf('2026-06-28')).toBeLessThan(html.indexOf('南山馆自助借还机'))
    expect(html.indexOf('南山馆自助借还机')).toBeLessThan(html.indexOf('→'))
    expect(html.indexOf('→')).toBeLessThan(html.indexOf('2026-07-05'))
    expect(html.indexOf('2026-07-05')).toBeLessThan(html.indexOf('深图三楼自助借还机'))
    // 整个周期块只有一个流向箭头（时间/地点不再各自带箭头）。
    expect(countArrows(html)).toBe(1)
  })

  it('借出/归还块为细罫线方框，两块结构稳定（地点缺失时方框仍在）', () => {
    const html = renderRow(
      makeCycle({ borrowLocation: '南山馆自助借还机', returnLocation: '深图三楼自助借还机' }),
    )
    expect(countBlocks(html)).toBe(2)
    // 地点为 null 时方框仍成对存在——只退化掉块内地点行。
    const bare = renderRow(makeCycle())
    expect(countBlocks(bare)).toBe(2)
    expect(bare).not.toContain('· ')
  })

  it('已归还徽章 = 蓝鼠 info 高对比；地点为 null 时其余渲染不变', () => {
    const html = renderRow(makeCycle())
    expect(countArrows(html)).toBe(1)
    expect(html).toContain('2026-06-28')
    expect(html).toContain('2026-07-05')
    expect(html).toContain('04400611745052')
    expect(html).toContain('已还')
    expect(html).toContain('bg-info')
    expect(html).toContain('text-info-foreground')
  })

  it('借阅中徽章 = 松叶 success 高对比；归还块时间侧 — 弱化为 muted', () => {
    const html = renderRow(
      makeCycle({
        returnedAt: null,
        status: 'borrowed',
        borrowLocation: '深图北馆一楼自助机',
      }),
    )
    expect(html).toContain('深图北馆一楼自助机')
    expect(html).toContain('在借')
    expect(html).toContain('bg-success')
    expect(html).toContain('text-success-foreground')
    expect(html).toContain('text-muted-foreground">—<')
    expect(countArrows(html)).toBe(1)
  })

  it('unknown 徽章保持弱化 outline（无语义高对比色）', () => {
    const html = renderRow(
      makeCycle({ returnLocation: '宝安中心馆', status: 'unknown' }),
    )
    expect(html).toContain('宝安中心馆')
    expect(html).toContain('未知')
    expect(html).not.toContain('bg-success')
    expect(html).not.toContain('bg-info')
    expect(countArrows(html)).toBe(1)
  })

  it('szlib 条码后渲染归属馆框（前 6 位命中）；未知条码无框', () => {
    const html = renderRow(makeCycle({ barcode: '04400515000000' }))
    expect(html).toContain('04400515000000')
    expect(html).toContain('市馆')
    // 未命中前缀（非 szlib 条码）→ 条码后无归属馆框。
    const unknown = renderRow(makeCycle({ barcode: 'BC-UNKNOWN' }))
    expect(unknown).toContain('BC-UNKNOWN')
    expect(unknown).not.toContain('市馆')
    expect(unknown).not.toContain('南山区')
  })

  it('来源未知（parserId 缺失，如来源被删）→ 不渲染归属馆框', () => {
    const html = renderToStaticMarkup(
      createElement(BorrowCycleRow, { cycle: makeCycle(), displayTimezone: 'UTC' }),
    )
    expect(html).toContain('04400611745052')
    expect(html).not.toContain('南山区')
  })
})
