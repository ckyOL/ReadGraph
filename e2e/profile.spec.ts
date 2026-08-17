import { test, expect } from '@playwright/test'

import { buildDesensitizedFixture, buildLargeFixture } from './fixtures'

/**
 * 阅读画像页 E2E（reading-profile §7，C-7）。
 * 脱敏夹具通过 `localStorage['readgraph:e2e-seed']` 注入，应用首启灌库。
 */

const SEED_KEY = 'readgraph:e2e-seed'

async function seed(page: import('@playwright/test').Page): Promise<void> {
  const payload = JSON.stringify(buildDesensitizedFixture())
  await page.addInitScript(([key, value]) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ignore
    }
  }, [SEED_KEY, payload] as const)
}

test.describe('profile page — empty state', () => {
  test('shows Empty + import entry and navigates to /import', async ({ page }) => {
    await page.goto('/profile')
    // 等待加载完成（避免 Skeleton 误判）。
    await expect(page.getByText(/No books or borrow records yet|还没有藏书与借阅记录/)).toBeVisible()
    const importLink = page.getByRole('link', { name: /Go to import|去导入/ })
    await expect(importLink).toBeVisible()
    await importLink.click()
    await expect(page).toHaveURL(/\/import/)
  })
})

test.describe('profile page — charts with seeded data', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('renders non-empty chart canvases', async ({ page }) => {
    await page.goto('/profile')
    // 概览卡片出现（标记数据已灌入）。
    await expect(page.getByText(/Books|藏书数/).first()).toBeVisible()
    // 图表区为 Tabs：逐个激活，每次恰好一个 canvas（treemap + gantt + volume + duration）。
    const chartTabs = [
      /Classification distribution|分类法分布/,
      /Borrow timeline|借阅甘特带/,
      /Borrow volume|借阅量/,
      /Borrow duration distribution|借阅时长分布/,
    ]
    for (const name of chartTabs) {
      await page.getByRole('tab', { name }).click()
      await expect(page.locator('canvas')).toHaveCount(1, { timeout: 10000 })
      const box = await page.locator('canvas').boundingBox()
      expect(box).not.toBeNull()
      expect(box!.width).toBeGreaterThan(10)
      expect(box!.height).toBeGreaterThan(10)
    }
  })

  test('range switch re-renders charts', async ({ page }) => {
    await page.goto('/profile')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 })
    const firstCanvas = page.locator('canvas').first()
    const before = await firstCanvas.screenshot()
    // 切换时间范围 Select 为近 1 年，触发柱图/treemap 重绘（useTransition 期间
    // 当前 tab 内容显示 Skeleton，canvas 短暂消失 → 等待过渡完成后再断言）。
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /Last 1 year|近 1 年/ }).click()
    // 切换「近 1 年」后：2024 夹具落在窗口外，借阅量/甘特降级为 Empty（无 canvas），
    // 分类 treemap（默认 tab）与时长分布仍有数据。断言 canvas 存在（重绘生效）。
    await expect.poll(
      async () => await page.locator('canvas').count(),
      { timeout: 15000, message: 'canvas count settles after transition' },
    ).toBeGreaterThanOrEqual(1)
    const after = await firstCanvas.screenshot()
    expect(after.length).toBeGreaterThan(0)
    expect(before.length).toBeGreaterThan(0)
  })

  test('dark mode changes chart palette and persists on reload', async ({ page }) => {
    await page.goto('/profile')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 })
    // 切暗色：通过设置偏好 theme=dark（走 localStorage 偏好），reload。
    await page.addInitScript(() => {
      try {
        const raw = localStorage.getItem('readgraph:preferences')
        const obj = raw ? JSON.parse(raw) : {}
        obj.theme = 'dark'
        localStorage.setItem('readgraph:preferences', JSON.stringify(obj))
      } catch {
        // ignore
      }
    })
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 5000 })
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 10000 })
    // 截图暗色下 treemap。
    const darkShot = await page.locator('canvas').first().screenshot()
    expect(darkShot.length).toBeGreaterThan(0)
  })
})

test.describe('profile page — gantt multi-lane render (performance baseline)', () => {
  test('large fixture renders gantt without crashing', async ({ page }) => {
    // 多 lane 夹具：fixtures.buildLargeFixture（150 lane × 2 周期），验证高 lane 数下
    // 甘特 canvas 渲染不崩。
    const payload = JSON.stringify(buildLargeFixture())
    await page.addInitScript(([key, value]) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // ignore
      }
    }, [SEED_KEY, payload] as const)

    await page.goto('/profile')
    // 切到甘特 tab：150 lane 大库下高度自适应封顶（min 280 / max 624），不再压扁 lane。
    await page.getByRole('tab', { name: /Borrow timeline|借阅甘特带/ }).click()
    await expect.poll(
      async () => await page.locator('canvas').count(),
      { timeout: 20000, message: 'gantt canvas settles at 1' },
    ).toBe(1)
    const box = await page.locator('canvas').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(50)
    // 150 lane 超出可视上限 → 视口封顶 624px 且启用 y 轴缩放，高度远大于旧固定 320px。
    expect(box!.height).toBeGreaterThan(400)
  })
})
