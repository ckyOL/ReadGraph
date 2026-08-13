// 归属馆小框组件测试（branch-library 规格 §4）。
// 按来源（parserId）查注册表：命中 → outline 直角小框内为馆名；
// 未命中（非该来源条码/空值）/未知来源 → 渲染 null 不占位。
import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { BranchBadge } from './branch-badge'

const render = (barcode: string | null | undefined, parserId?: string | null) =>
  renderToStaticMarkup(createElement(BranchBadge, { barcode, parserId }))

describe('BranchBadge', () => {
  it('szlib 前缀命中 → outline 直角小框，内容为归属馆名', () => {
    const html = render('04400514707325', 'szlib')
    expect(html).toContain('市馆')
    expect(html).toContain('rounded-none')
    expect(html).toContain('border-border')
    expect(html).toContain('data-variant="outline"')
  })

  it('字母前缀（F44010）→ 大学城', () => {
    expect(render('F440101234567', 'szlib')).toContain('大学城')
  })

  it('未命中（非该来源条码/空值）→ 渲染空（不占位）', () => {
    expect(render('BC001', 'szlib')).toBe('')
    expect(render('9787111000000', 'szlib')).toBe('')
    expect(render('', 'szlib')).toBe('')
    expect(render(null, 'szlib')).toBe('')
    expect(render(undefined, 'szlib')).toBe('')
  })

  it('未知来源（parserId 未注册/缺失）→ 渲染空（不占位）', () => {
    expect(render('04400514707325', 'no-such-parser')).toBe('')
    expect(render('04400514707325', null)).toBe('')
    expect(render('04400514707325')).toBe('')
  })
})
