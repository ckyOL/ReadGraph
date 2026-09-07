import { test, expect, type Page } from '@playwright/test'

import { buildDesensitizedFixture } from './fixtures'

/**
 * WCAG 4.1.3（状态消息 AA）+ 2.5.8（目标尺寸 AA）E2E：
 * - 4.1.3：/profile 概览卡片（SummaryCards / MoneyCards）外层容器在重算期间
 *   aria-busy="true"，计算结束移除；结果区 aria-live="polite" 常驻（状态消息可播报）。
 * - 2.5.8：375px 移动视口下抽查代表性交互目标（卡片链接、图标按钮）boundingBox
 *   均 ≥ 24×24 CSS px。
 */

const SEED_KEY = 'readgraph:e2e-seed'

/** 大数据聚合的 Worker 阈值（src/profile/use-profile-stats.ts WORKER_THRESHOLD）：
 *  borrowCycles ≥ 5000 时聚合下放 Worker，computing 期间 aria-busy 有稳定可观测窗口。 */
const WORKER_THRESHOLD = 5000

async function seed(page: Page, payload?: unknown): Promise<void> {
  const json = JSON.stringify(payload ?? buildDesensitizedFixture())
  await page.addInitScript(([key, value]) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ignore
    }
  }, [SEED_KEY, json] as const)
}

/** 大数据夹具：基础夹具 + 8000 条借阅周期（远超 Worker 阈值），
 *  使 /profile 首载与 range 切换时的重算窗口足以被断言捕获。 */
function buildBusyFixture() {
  const base = buildDesensitizedFixture()
  const borrowCycles = [...base.borrowCycles]
  const DAY = 86_400_000
  for (let i = 0; i < WORKER_THRESHOLD + 3000; i++) {
    const bookId = `book-${(i % 3) + 1}`
    const ms = Date.UTC(2024, 0, 1) + (i % 730) * DAY
    borrowCycles.push({
      id: `busy-cycle-${i}`,
      bookId,
      catalogRecordId: `cat-${(i % 3) + 1}`,
      sourceId: base.sources[0].id,
      borrowedAt: new Date(ms).toISOString(),
      returnedAt: new Date(ms + 5 * DAY).toISOString(),
      status: 'returned',
      borrowLocation: '图书馆',
      returnLocation: null,
      rawRecordIds: [],
      barcode: `BX${i}`,
      createdAt: new Date(ms).toISOString(),
      updatedAt: new Date(ms + 5 * DAY).toISOString(),
    })
  }
  return { ...base, borrowCycles }
}

test.describe('profile status messages (WCAG 4.1.3)', () => {
  test('summary/money regions expose aria-busy during recompute and clear after', async ({ page }) => {
    await seed(page, buildBusyFixture())
    await page.goto('/profile')

    const summary = page.locator('[data-slot="profile-summary"]')
    const money = page.locator('[data-slot="profile-money"]')
    await expect(summary).toBeVisible({ timeout: 20000 })
    await expect(money).toBeVisible({ timeout: 20000 })

    // 4.1.3 契约：结果更新区 aria-live="polite"（读屏可播报状态变化）。
    await expect(summary).toHaveAttribute('aria-live', 'polite')
    await expect(money).toHaveAttribute('aria-live', 'polite')

    // 首载计算期间 summary/money 尚未挂载（页面显示 ProfileSkeleton），首载 busy 窗口
    // 不可观测；4.1.3 契约的「过渡与完成态」通过下方 range 切换重算窗口验证：
    // 切换时间范围触发重算 → 遮罩期 aria-busy 恢复 true，结束后归 false。
    await page.getByRole('combobox').first().click()
    await page.getByRole('option', { name: /Last 1 year|近 1 年/ }).click()
    await expect(summary).toHaveAttribute('aria-busy', 'true', { timeout: 15000 })
    await expect(money).toHaveAttribute('aria-busy', 'true', { timeout: 15000 })
    await expect.poll(
      async () => summary.getAttribute('aria-busy'),
      { timeout: 15000, message: 'summary aria-busy clears after range switch' },
    ).toBe('false')
    await expect.poll(
      async () => money.getAttribute('aria-busy'),
      { timeout: 15000, message: 'money aria-busy clears after range switch' },
    ).toBe('false')
  })
})

test.describe('target size minimum (WCAG 2.5.8) at 375px', () => {
  test('card links and icon buttons are ≥ 24×24 CSS px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await seed(page)
    await page.goto('/library')

    // 卡片网格（<1024px 可见）：卡片标题链接为代表性文本链接目标。
    const cards = page.locator('[data-slot="library-cards"]')
    await expect(cards.locator('a').first()).toBeVisible()
    const links = cards.locator('a')
    const linkCount = await links.count()
    expect(linkCount).toBeGreaterThan(0)
    for (let i = 0; i < linkCount; i++) {
      const box = await links.nth(i).boundingBox()
      expect(box, `card link #${i} should have a bounding box`).not.toBeNull()
      expect(box!.width, `card link #${i} width`).toBeGreaterThanOrEqual(24)
      expect(box!.height, `card link #${i} height`).toBeGreaterThanOrEqual(24)
    }

    // 图标按钮：移动工具栏排序方向按钮（Button size=icon → size-8）。
    const sortButton = page.getByRole('button', { name: /Ascending|升序/ })
    await expect(sortButton).toBeVisible()
    const sortBox = await sortButton.boundingBox()
    expect(sortBox).not.toBeNull()
    expect(sortBox!.width).toBeGreaterThanOrEqual(24)
    expect(sortBox!.height).toBeGreaterThanOrEqual(24)
  })
})
