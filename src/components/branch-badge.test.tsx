// 归属馆小框组件测试（branch-library 规格 §4）。
// 命中 → outline 直角小框内为馆名；未命中（非深图条码/空值）→ 渲染 null 不占位。
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BranchBadge } from './branch-badge'

const render = (barcode: string | null | undefined) =>
  renderToStaticMarkup(createElement(BranchBadge, { barcode }))

describe('BranchBadge', () => {
  it('szlib 前缀命中 → outline 直角小框，内容为归属馆名', () => {
    const html = render('04400514707325')
    expect(html).toContain('市馆')
    expect(html).toContain('rounded-none')
    expect(html).toContain('border-border')
    expect(html).toContain('data-variant="outline"')
  })

  it('字母前缀（F44010）→ 大学城', () => {
    expect(render('F440101234567')).toContain('大学城')
  })

  it('未命中（非 szlib 条码/空值）→ 渲染空（不占位）', () => {
    expect(render('BC001')).toBe('')
    expect(render('9787111000000')).toBe('')
    expect(render('')).toBe('')
    expect(render(null)).toBe('')
    expect(render(undefined)).toBe('')
  })
})
