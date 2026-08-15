import { test, expect } from '@playwright/test'

import { buildClassificationFixture } from './fixtures'

/**
 * 分类法层级 E2E（classification-hierarchy §8）：
 * - 书库芯片：`J238.2` 显示完整 5 段路径（fixture 树已收录「漫画」，§11 修正 §2.4），tooltip 完整面包屑。
 * - treemap：点一级类目展开子类，面包屑回退一级。
 * 树/表经 route 拦截提供（D-4 决策：少量真实分类号 fixture，手写固定、无 src 溯源字段；
 * 数据契约见 docs/specs/classification-hierarchy.md §2）。
 */

const SEED_KEY = 'readgraph:e2e-seed'

// 少量真实分类号 fixture（≤10 条、不带 src；覆盖 e2e 断言所需 J 类路径）。
const clcTreeFixture = [
  {
    id: 'J',
    desc: '艺术',
    children: [
      {
        id: 'J2',
        desc: '绘画',
        children: [
          {
            id: 'J23',
            desc: '各国绘画作品',
            children: [{ id: 'J238', desc: '各种画：按用途分', children: [{ id: 'J238.2', desc: '漫画' }] }],
          },
        ],
      },
    ],
  },
]

async function seed(page: import('@playwright/test').Page): Promise<void> {
  const payload = JSON.stringify(buildClassificationFixture())
  await page.addInitScript(([key, value]) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ignore
    }
  }, [SEED_KEY, payload] as const)
}

/** 拦截分类数据请求（加载器 fetch `classification/*.json`，404 时降级一级表）。 */
async function interceptClassification(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/classification/clc-tree.json', (route) => route.fulfill({ json: clcTreeFixture }))
  await page.route('**/classification/clc-overlay.json', (route) => route.fulfill({ json: {} }))
  await page.route('**/classification/clc-auxiliary.json', (route) => route.fulfill({ json: {} }))
}

test.describe('classification hierarchy — library badge', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
    await interceptClassification(page)
  })

  test('J238.2 芯片: 完整 5 段面包屑（含漫画）+ 最深类名，无细分未收录提示', async ({ page }) => {
    await page.goto('/library')
    // 桌面视口（默认 1280px ≥ lg）断言限定表格容器：卡片网格（lg:hidden）与表格同挂 DOM
    // （CSS 断点切换），未限定的 [data-slot="badge"] 命中两份。
    const table = page.locator('[data-slot="library-table"]')
    // 等树懒加载完成：芯片从一级类目升级为深层路径（title 含面包屑分隔符）。
    const badge = table.locator('[data-slot="badge"]', { hasText: 'J238.2' })
    await expect(badge).toHaveCount(1, { timeout: 10000 })
    await expect(badge).toHaveAttribute(
      'title',
      /J 艺术 › J2 绘画 › J23 各国绘画作品 › J238 各种画：按用途分 › J238\.2 漫画/,
      { timeout: 20000 },
    )
    await expect(badge).not.toHaveAttribute('title', /细分未收录|subdivision not covered/)
    // 主文本 = 最深段类名「漫画」（fixture 已收录，§11 修正）。
    await expect(badge).toContainText('漫画')
  })
})

test.describe('classification hierarchy — treemap drill-down', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
    await interceptClassification(page)
  })

  test('点一级类目展开子类, 面包屑回退一级', async ({ page }) => {
    await page.goto('/profile')
    // 概览卡片出现（数据已灌入）。
    await expect(page.getByText(/Books|藏书数/).first()).toBeVisible({ timeout: 10000 })
    const treemap = page.locator('canvas').first()
    await expect(treemap).toBeVisible({ timeout: 10000 })

    const breadcrumb = page.getByRole('navigation', {
      name: /分类下钻|Classification drill-down/,
    })

    // 4 本书全部 J 类 → 一级仅一个 J 单元格占满画布；树懒加载完成前点击被忽略，
    // 用 toPass 轮询点击直至下钻生效。
    await expect(async () => {
      const box = await treemap.boundingBox()
      expect(box).not.toBeNull()
      await treemap.click({ position: { x: box!.width / 2, y: box!.height / 2 } })
      await expect(breadcrumb).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 30000 })

    // 面包屑含一级类目（子类已展开）。
    await expect(breadcrumb.getByRole('button', { name: '艺术' })).toBeVisible()

    // 面包屑回退一级：点根按钮 → 面包屑消失，回到一级分布。
    await breadcrumb.getByRole('button', { name: /全部分类|All classes/ }).click()
    await expect(breadcrumb).toBeHidden()
  })
})
