// SC-5（annual-share-card-batch W3）：分享图 Dialog 预览组件测试。
// renderToStaticMarkup + mock（SSR 静态标记确定性断言，参照 profile.$year.test.tsx
// 模式）：Dialog 打开渲染 canvas 与 aria-label；i18n key 消费走 t() 取值路径断言
// （i18n-conventions §8，不断言字面量）；canShare false → 系统分享按钮不渲染。
// Radix Dialog 走 Portal，SSR 静态标记不产出内容：以直通 stub 替换（同文件
// router mock 先例）。canvas 绘制在 effect 内，静态标记不触发——canvas 元素
// 与 aria 属性按 JSX 渲染断言。
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n, { changeLanguage } from '@/i18n'

// Radix Dialog Portal 直通 stub（必须在 import share-dialog 之前 mock）。
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  DialogContent: ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) =>
    createElement('div', rest, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
  DialogDescription: ({ children }: { children?: ReactNode }) => createElement('div', null, children),
}))

import { ShareDialog } from './share-dialog'
import type { YearSliceResult } from '@/lib/profile-stats'
import type { YearBookIndexEntry } from '@/profile/year/year-book-index'

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init()
  await changeLanguage('zh-CN')
})

const slice: YearSliceResult = {
  bookIds: ['b1', 'b2', 'b3'],
  bookCount: 3,
  topBooks: [
    { bookId: 'b1', count: 2 },
    { bookId: 'b2', count: 1 },
  ],
  classification: [
    { name: '文学', code: 'I', category: null, value: 2 },
    { name: '历史', code: 'K', category: null, value: 1 },
  ],
}

const bookIndex: Record<string, YearBookIndexEntry> = {
  b1: { title: '小说A', authors: ['作者甲'], coverUrl: null },
  b2: { title: '哲学B', authors: ['作者乙'], coverUrl: 'https://cdn.example/b2.jpg' },
  b3: { title: '历史C', authors: ['作者丙'], coverUrl: null },
}

function renderDialog(over: Partial<Parameters<typeof ShareDialog>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(ShareDialog, {
      open: true,
      onOpenChange: () => undefined,
      year: 2025,
      slice,
      bookIndex,
      prevYear: { year: 2024, bookCount: 5 },
      ...over,
    }),
  )
}

describe('ShareDialog（SC-5 预览组件）', () => {
  it('打开渲染 canvas 预览：role=img + aria-label 走 t() 取值路径', () => {
    const html = renderDialog()
    expect(html).toContain('data-slot="share-preview-canvas"')
    expect(html).toContain('role="img"')
    expect(html).toContain(i18n.t('pages:profile.year.share.previewAria', { year: 2025 }) as string)
  })

  it('Dialog 标题/按钮走 t() 取值路径（不硬编码字面量）', () => {
    const html = renderDialog()
    expect(html).toContain(i18n.t('pages:profile.year.share.dialogTitle') as string)
    expect(html).toContain(i18n.t('pages:profile.year.share.download') as string)
    expect(html).toContain(i18n.t('pages:profile.year.share.privacyNote') as string)
  })

  it('canShare 不可用 → 系统分享按钮不渲染', () => {
    // node 环境 navigator 未定义 → 恒不可分享路径
    const html = renderDialog()
    expect(html).not.toContain(i18n.t('pages:profile.year.share.systemShare') as string)
  })

  it('canShare 可用 → 系统分享按钮渲染', () => {
    vi.stubGlobal('navigator', { canShare: () => true, share: vi.fn() })
    try {
      const html = renderDialog()
      expect(html).toContain(i18n.t('pages:profile.year.share.systemShare') as string)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('prevYear null → canvas 照常渲染（R4 无上年数据不崩）', () => {
    const html = renderDialog({ prevYear: null })
    expect(html).toContain('data-slot="share-preview-canvas"')
  })
})
