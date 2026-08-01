import { test, expect } from '@playwright/test'

import { buildClassificationFixture } from './fixtures'

/**
 * 分类法层级 E2E（classification-hierarchy §8）：
 * - 书库芯片：`J238.2` 显示已解析最深类名（不推测「漫画」），tooltip 完整面包屑
 *   + 「细分未收录」提示（tree-partial）。
 * - treemap：点一级类目展开子类，面包屑回退一级。
 */

const SEED_KEY = 'readgraph:e2e-seed'

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

test.describe('classification hierarchy — library badge', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('J238.2 芯片: 最深类名 + 面包屑 tooltip + tree-partial 提示，不显示推测类名', async ({
    page,
  }) => {
    await page.goto('/library')
    // 等树懒加载完成：芯片从一级类目升级为深层路径（title 含面包屑分隔符）。
    const badge = page.locator('[data-slot="badge"]', { hasText: 'J238.2' })
    await expect(badge).toHaveCount(1, { timeout: 10000 })
    await expect(badge).toHaveAttribute(
      'title',
      /J 艺术 › J2 绘画 › J23 各国绘画作品 › J238 各种画：按用途分/,
      { timeout: 20000 },
    )
    await expect(badge).toHaveAttribute(
      'title',
      /J238\.2 (细分未收录|subdivision not covered)/,
    )
    // 主文本 = 已解析最深段类名；不显示推测类名「漫画」。
    await expect(badge).toContainText('各种画：按用途分')
    await expect(badge).not.toContainText('漫画')
  })
})

test.describe('classification hierarchy — treemap drill-down', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
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
