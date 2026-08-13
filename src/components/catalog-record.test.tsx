// 编目卡条码行归属馆框测试（branch-library 规格 §4 落点 1）。
// CatalogRecordCard 为纯展示组件，用 SSR 静态标记确定性断言：
// 条码行内等宽条码后渲染归属馆框（前 6 位命中）；未知前缀不渲染。
import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n, { changeLanguage } from '@/i18n'
import { CatalogRecordCard } from './catalog-record'
import { makeCatalog } from '@/db/test-helpers'
import type { CatalogRecord } from '@/types/entities'

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init()
  await changeLanguage('zh-CN')
})

const renderCard = (record: CatalogRecord) =>
  renderToStaticMarkup(createElement(CatalogRecordCard, { record }))

describe('CatalogRecordCard', () => {
  it('条码行内：等宽条码后渲染归属馆框（前 6 位命中）', () => {
    const html = renderCard(makeCatalog('cr-1', 'bk-1', 'src-sz', '04400514707325', null))
    expect(html).toContain('04400514707325')
    expect(html).toContain('市馆')
    expect(html).toContain('font-mono')
  })

  it('字母前缀（F44010）→ 大学城框', () => {
    const html = renderCard(makeCatalog('cr-2', 'bk-1', 'src-sz', 'F440101234567', null))
    expect(html).toContain('大学城')
  })

  it('未知前缀条码 → 无归属馆框', () => {
    const html = renderCard(makeCatalog('cr-3', 'bk-1', 'src-other', 'BC001', null))
    expect(html).toContain('BC001')
    expect(html).not.toContain('市馆')
    expect(html).not.toContain('南山区')
  })
})
