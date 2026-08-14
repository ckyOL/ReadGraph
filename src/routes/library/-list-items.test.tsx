// 书库列表呈现组件测试（ui-navigation §3 三档响应式）。
// LibraryRowView（桌面表格行）/ LibraryCardView（平板/移动卡片）为纯展示组件，
// 用 SSR 静态标记确定性断言：书名列冻结类、分类芯片 code 完整（类名截断放宽）、
// 来源徽标、借阅时间 tabular-nums、卡片信息完整无隐藏列、徽标直达编辑链接。
// Link mock 为普通 a（@tanstack/react-router 的 Link 需要 Router 上下文，SSR 不建）。
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n, { changeLanguage } from '@/i18n'
import type { LibraryRow } from '@/lib/library-view'
import { LibraryRowView, LibraryCardView } from './-list-items'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    params,
    search,
    children,
    ...rest
  }: {
    to: string
    params?: { bookId: string }
    search?: Record<string, unknown>
    children?: ReactNode
  }) =>
    createElement(
      'a',
      {
        href: `#/${to.replace('$bookId', params?.bookId ?? '')}`,
        'data-search': search ? JSON.stringify(search) : undefined,
        ...rest,
      },
      children,
    ),
}))

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init()
  await changeLanguage('zh-CN')
})

const NOW = new Date('2026-06-01T00:00:00.000Z')

const row: LibraryRow = {
  book: {
    id: 'bk-1',
    isbn13: '9787111900009',
    isbn10: null,
    title: '再见绘梨',
    subtitle: null,
    authors: ['藤本树'],
    translators: [],
    publisher: null,
    publishDate: null,
    edition: null,
    pages: null,
    price: null,
    subjects: [],
    tags: [],
    coverUrl: null,
    description: null,
    createdAt: NOW,
    updatedAt: NOW,
    needsReview: false,
    materialType: 'book',
    sourceIds: ['src-sz'],
    parallelTitles: [],
  },
  authors: '藤本树',
  isbn13: '9787111900009',
  sourceName: '深圳图书馆',
  classification: { system: 'clc', code: 'J238.2' },
  borrowCount: 3,
  lastBorrowedAt: NOW,
  isSet: false,
}

const props = {
  row,
  badge: null as null | 'placeholder' | 'set',
  viewSearch: { q: undefined, source: 'src-sz', sort: 'borrows' },
  displayTimezone: 'Asia/Shanghai',
}

describe('LibraryRowView（桌面表格行）', () => {
  it('书名列 sticky 冻结 + 不透明背景（横向滚动锚点）', () => {
    const html = renderToStaticMarkup(createElement(LibraryRowView, props))
    expect(html).toContain('sticky left-0 z-10')
    expect(html).toContain('bg-background')
  })

  it('分类芯片 code 完整、类名截断放宽（max-w-40）', () => {
    const html = renderToStaticMarkup(createElement(LibraryRowView, props))
    expect(html).toContain('J238.2')
    expect(html).toContain('max-w-40')
  })

  it('来源徽标、借阅时间、ISBN 呈现', () => {
    const html = renderToStaticMarkup(createElement(LibraryRowView, props))
    expect(html).toContain('深圳图书馆')
    expect(html).toContain('2026-06-01')
    expect(html).toContain('9787111900009')
    expect(html).toContain('tabular-nums')
  })

  it('占位徽标渲染 destructive Badge 且链接带 edit=true', () => {
    const html = renderToStaticMarkup(
      createElement(LibraryRowView, { ...props, badge: 'placeholder' }),
    )
    expect(html).toContain('占位')
    expect(html).toContain('&quot;edit&quot;:true')
    expect(html).toContain('data-variant="destructive"')
  })
})

describe('LibraryCardView（平板/移动卡片）', () => {
  it('信息完整：书名、作者、分类、ISBN、借阅时间、来源、借阅数（无隐藏列）', () => {
    const html = renderToStaticMarkup(createElement(LibraryCardView, props))
    expect(html).toContain('再见绘梨')
    expect(html).toContain('藤本树')
    expect(html).toContain('J238.2')
    expect(html).toContain('9787111900009')
    expect(html).toContain('2026-06-01')
    expect(html).toContain('深圳图书馆')
    expect(html).toContain('>3<')
  })

  it('书名用 font-display 明朝（书卷气，DESIGN.md §3）', () => {
    const html = renderToStaticMarkup(createElement(LibraryCardView, props))
    expect(html).toContain('font-display')
  })

  it('无借阅时间/ISBN 时该行省略（不占位）', () => {
    const html = renderToStaticMarkup(
      createElement(LibraryCardView, {
        ...props,
        row: { ...row, isbn13: null, lastBorrowedAt: null, classification: null, sourceName: null },
      }),
    )
    expect(html).not.toContain('9787111900009')
    expect(html).not.toContain('2026-06-01')
    // 无来源 → 空 span 占位保持底部行对齐
    expect(html).toContain('<span></span>')
  })

  it('套装徽标渲染 outline Badge', () => {
    const html = renderToStaticMarkup(
      createElement(LibraryCardView, { ...props, badge: 'set' }),
    )
    expect(html).toContain('套装')
    expect(html).toContain('data-variant="outline"')
  })
})
