// 分类号芯片组件测试（classification-hierarchy 规格 §8 组件清单）。
// 视图中树/overlay 由调用方传入（ClassificationBadgeView 纯展示），
// 异步懒加载仅在 wrapper（ClassificationBadge）内发生，服务端渲染下 effect
// 不执行 → 初始回退一级类目可确定性断言。
import { describe, it, expect, beforeAll } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n from '@/i18n'
import { ClassificationBadge, ClassificationBadgeView } from './classification-badge'
import type { ClassificationPath } from '@/lib/classification-path'

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init()
})

const renderView = (props: {
  code: string
  category?: string
  path: ClassificationPath
}) => renderToStaticMarkup(createElement(ClassificationBadgeView, props))

describe('ClassificationBadgeView', () => {
  it('有路径: 主文本 = 最深段类名, tooltip 面包屑含全路径', () => {
    const html = renderView({
      code: 'J218.2',
      path: {
        path: [
          { code: 'J', name: '艺术' },
          { code: 'J2', name: '绘画' },
          { code: 'J21', name: '绘画技法' },
          { code: 'J218', name: '各种画技法：按用途分' },
          { code: 'J218.2', name: '漫画' },
        ],
        depth: 5,
        source: 'tree',
      },
    })
    expect(html).toContain('J218.2')
    expect(html).toContain('漫画')
    expect(html).toContain(
      'title="J 艺术 › J2 绘画 › J21 绘画技法 › J218 各种画技法：按用途分 › J218.2 漫画"',
    )
  })

  it('tree-partial: 主文本 = 已解析最深段, 不显示推测类名, tooltip 追加细分未收录提示', () => {
    const html = renderView({
      code: 'J238.2',
      path: {
        path: [
          { code: 'J', name: '艺术' },
          { code: 'J2', name: '绘画' },
          { code: 'J23', name: '各国绘画作品' },
          { code: 'J238', name: '各种画：按用途分' },
        ],
        depth: 4,
        source: 'tree-partial',
        unresolvedSuffix: '.2',
      },
    })
    expect(html).toContain('J238.2')
    expect(html).toContain('各种画：按用途分')
    expect(html).not.toContain('漫画')
    // tooltip 追加「细分未收录」提示（默认 locale 依 Node 环境而异，双语断言）。
    expect(html).toMatch(/J238\.2 (细分未收录|subdivision not covered)/)
  })

  it('first-level: 显示一级类名（现状回退）', () => {
    const html = renderView({
      code: 'TP312',
      path: { path: [{ code: 'T', name: '工业技术' }], depth: 1, source: 'first-level' },
    })
    expect(html).toContain('TP312')
    expect(html).toContain('工业技术')
  })

  it('auxiliary: 主文本不变，tooltip 面包屑追加复分段（§10.6）', () => {
    const html = renderView({
      code: 'K02-39',
      path: {
        path: [
          { code: 'K', name: '历史、地理' },
          { code: 'K0', name: '史学理论' },
          { code: 'K02', name: '社会发展理论' },
        ],
        depth: 3,
        source: 'tree',
        auxiliary: { code: '-39', name: '信息化建设、新技术的应用' },
      },
    })
    expect(html).toContain('K02-39')
    expect(html).toContain('社会发展理论')
    expect(html).toContain(
      'title="K 历史、地理 › K0 史学理论 › K02 社会发展理论 › -39 信息化建设、新技术的应用"',
    )
  })

  it('auxiliary + tree-partial: 复分段在前，细分未收录提示保留', () => {
    const html = renderView({
      code: 'G898.3-64',
      path: {
        path: [
          { code: 'G', name: '文化、科学、教育、体育' },
          { code: 'G89', name: '文体活动' },
          { code: 'G898', name: '游戏' },
        ],
        depth: 3,
        source: 'tree-partial',
        unresolvedSuffix: '.3',
        auxiliary: { code: '-64', name: '表解、图解、图册、谱录、数据、公式、地图' },
      },
    })
    expect(html).toContain('G898 游戏 › -64 表解、图解、图册、谱录、数据、公式、地图')
    expect(html).toMatch(/G898\.3-64 (细分未收录|subdivision not covered)/)
  })

  it('none: 仅 code；显式 category 仍显示', () => {
    const html = renderView({
      code: 'QA76',
      path: { path: [], depth: 0, source: 'none' },
    })
    expect(html).toContain('QA76')
    // 无次级文本（无 max-w-28 truncate 片段），tooltip 未分类占位。
    expect(html).not.toContain('max-w-28')
    expect(html).toMatch(/title="(未分类|Unclassified)"/)

    const withCategory = renderView({
      code: 'QA76',
      category: 'Mathematics',
      path: { path: [], depth: 0, source: 'none' },
    })
    expect(withCategory).toContain('Mathematics')
  })

  it('宽度截断仍生效（次级文本截断类）', () => {
    const html = renderView({
      code: 'J218.2',
      path: {
        path: [
          { code: 'J', name: '艺术' },
          { code: 'J218.2', name: '漫画' },
        ],
        depth: 2,
        source: 'tree',
      },
    })
    expect(html).toContain('max-w-28 truncate')
  })
})

describe('ClassificationBadge（wrapper）', () => {
  it('树懒加载前初始渲染回退一级类目（不阻塞首屏）', () => {
    const html = renderToStaticMarkup(
      createElement(ClassificationBadge, { system: 'clc', code: 'J218.2' }),
    )
    expect(html).toContain('J218.2')
    expect(html).toContain('艺术')
  })

  it('lcc 无内置表 → 初始仅 code', () => {
    const html = renderToStaticMarkup(
      createElement(ClassificationBadge, { system: 'lcc', code: 'QA76' }),
    )
    expect(html).toContain('QA76')
  })
})
