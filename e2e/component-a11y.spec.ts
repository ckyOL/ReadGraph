import { test, expect, type Page } from '@playwright/test'

import { buildDesensitizedFixture } from './fixtures'

/**
 * 阶段 2 WCAG 3.1.2（局部语言 AA）E2E：
 * vendored 组件（Dialog/Sheet/Sidebar）无障碍名本地化——关闭按钮与侧边栏触发按钮的
 * aria-label / 可访问名称在 en-US ⇄ zh-CN 切换时同步变化，读屏在 zh-CN 下不再读英文控件名。
 * 默认上下文 locale 为 en-US（无存储偏好 → browserLocale 'en'），断言用英文文案；
 * 切中文：/settings 页 SegmentedControl 单选（app.spec.ts 同款模式）。
 */

const SEED_KEY = 'readgraph:e2e-seed'

async function seed(page: Page): Promise<void> {
  const payload = JSON.stringify(buildDesensitizedFixture())
  await page.addInitScript(([key, value]) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ignore
    }
  }, [SEED_KEY, payload] as const)
}

test.describe('component accessible names localize (WCAG 3.1.2)', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('dialog close button accessible name follows locale', async ({ page }) => {
    await page.goto('/library/book-1')
    // 详情页头部「Edit」→ search.edit=true 打开编辑 Dialog（editing.spec 同款入口）。
    await page.getByRole('button', { name: 'Edit' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    // en：可访问名称来自 sr-only 文本与 Button aria-label（同键 dialog.close）。
    const close = dialog.getByRole('button', { name: 'Close' })
    await expect(close).toHaveAttribute('aria-label', 'Close')
    await close.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)

    // 切中文后重开对话框：关闭按钮可访问名变为「关闭」。
    await page.goto('/settings')
    await page.getByRole('radio', { name: '简体中文' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await page.goto('/library/book-1')
    await page.getByRole('button', { name: '编辑' }).click()
    const zhDialog = page.getByRole('dialog')
    await expect(zhDialog).toBeVisible()
    const zhClose = zhDialog.getByRole('button', { name: '关闭' })
    await expect(zhClose).toHaveAttribute('aria-label', '关闭')
    await zhClose.click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('sidebar trigger aria-label follows locale', async ({ page }) => {
    await page.goto('/')
    const trigger = page.locator('[data-slot="sidebar-trigger"]')
    await expect(trigger).toHaveAttribute('aria-label', 'Toggle Sidebar')
    // 可访问名称与 aria-label 一致（getByRole 按计算名匹配）。
    await expect(page.getByRole('button', { name: 'Toggle Sidebar' })).toBeVisible()

    await page.goto('/settings')
    await page.getByRole('radio', { name: '简体中文' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await page.goto('/')
    await expect(trigger).toHaveAttribute('aria-label', '切换侧边栏')
    await expect(page.getByRole('button', { name: '切换侧边栏' })).toBeVisible()
  })

  test('mobile sidebar sheet accessible name follows locale', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    // 触发器展开移动端 Sheet（app.spec 同款交互）；可访问名来自 sr-only SheetTitle。
    await page.locator('[data-slot="sidebar-trigger"]').click()
    await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible()

    // 收起后切中文重开：Sheet 可访问名变为「侧边栏」。
    // 注：面板打开时其遮罩覆盖触发器（pointer-events 拦截），用 Escape 关闭（Radix 默认行为）。
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goto('/settings')
    await page.getByRole('radio', { name: '简体中文' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    await page.goto('/')
    await page.locator('[data-slot="sidebar-trigger"]').click()
    await expect(page.getByRole('dialog', { name: '侧边栏' })).toBeVisible()
  })
})
