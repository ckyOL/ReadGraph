import { test, expect } from '@playwright/test'

import { buildDesensitizedFixture, buildClassificationFixture } from './fixtures'

/**
 * 图表无障碍 E2E（quality-hardening 阶段 2，A-1）：
 * - WCAG 1.1.1：5 个图表容器 role="img" + aria-label 非空。
 * - WCAG 2.1.1：分类 treemap 键盘等价路径——视图 Toggle（aria-pressed）、
 *   列表视图按钮 Tab 可聚焦、Enter 下钻、面包屑 root 回退，与 canvas 同一 state。
 * 默认 locale en-US（断言用英文文案，兼容中文）；seed 注入 `readgraph:e2e-seed`。
 * 列表视图下 canvas 隐藏但保持挂载（每 tab 恰 1 canvas 断言不受影响）。
 */

const SEED_KEY = 'readgraph:e2e-seed'

async function seed(
  page: import('@playwright/test').Page,
  fixture: ReturnType<typeof buildDesensitizedFixture>,
): Promise<void> {
  const payload = JSON.stringify(fixture)
  await page.addInitScript(([key, value]) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ignore
    }
  }, [SEED_KEY, payload] as const)
}

// 少量真实分类号 fixture（与 classification.spec.ts 同款，覆盖 J 类下钻路径）。
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

/** 拦截分类数据请求（与 classification.spec.ts 同款，保证树内容确定性）。 */
async function interceptClassification(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/classification/clc-tree.json', (route) => route.fulfill({ json: clcTreeFixture }))
  await page.route('**/classification/clc-overlay.json', (route) => route.fulfill({ json: {} }))
  await page.route('**/classification/clc-auxiliary.json', (route) => route.fulfill({ json: {} }))
}

test.describe('chart a11y — img roles & labels (WCAG 1.1.1)', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page, buildDesensitizedFixture())
  })

  test('each chart tab exposes one role=img container with non-empty aria-label', async ({ page }) => {
    await page.goto('/profile')
    // 概览卡片出现（标记数据已灌入）。
    await expect(page.getByText(/Books|藏书数/).first()).toBeVisible({ timeout: 10000 })
    const chartTabs = [
      {
        tab: /Classification distribution|分类法分布/,
        label: /Classification distribution chart|分类法分布图/,
      },
      {
        tab: /Borrow timeline|借阅甘特带/,
        label: /Borrow timeline chart|借阅甘特带图/,
      },
      {
        tab: /Borrow volume|借阅量/,
        label: /Borrow volume chart|借阅量柱状图/,
      },
      {
        tab: /Borrow duration distribution|借阅时长分布/,
        label: /Borrow duration distribution chart|借阅时长分布图/,
      },
      {
        tab: /Price distribution|价格分布/,
        label: /Price distribution chart|价格分布图/,
      },
    ]
    for (const { tab, label } of chartTabs) {
      await page.getByRole('tab', { name: tab }).click()
      // 当前激活 tab 恰好 1 个含 canvas 的 role=img 容器（radix 卸载非激活 tab）。
      const chart = page.locator('[role="img"]', { has: page.locator('canvas') })
      await expect(chart).toHaveCount(1, { timeout: 10000 })
      await expect(chart).toHaveAttribute('aria-label', label)
      const raw = await chart.getAttribute('aria-label')
      expect(raw).not.toBeNull()
      expect(raw!.trim().length).toBeGreaterThan(0)
    }
  })
})

test.describe('classification treemap — keyboard list view (WCAG 2.1.1)', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page, buildClassificationFixture())
    await interceptClassification(page)
  })

  test('toggle switches to list view; list buttons Tab-focusable and Enter-drill; breadcrumb backs out', async ({ page }) => {
    await page.goto('/profile')
    // 概览卡片出现（数据已灌入）；4 本书全部 J 类 → 根层仅一个节点「艺术」。
    await expect(page.getByText(/Books|藏书数/).first()).toBeVisible({ timeout: 10000 })

    const listToggle = page.getByRole('button', { name: /List view|列表视图/ })
    const chartToggle = page.getByRole('button', { name: /Chart view|图表视图/ })
    const breadcrumb = page.getByRole('navigation', {
      name: /Classification drill-down|分类下钻/,
    })

    // Toggle 初始：图表视图按下，列表视图未按下。
    await expect(chartToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(listToggle).toHaveAttribute('aria-pressed', 'false')

    // 切到列表视图：aria-pressed 翻转，根层节点渲染为按钮，canvas 隐藏但保持挂载。
    await listToggle.click()
    await expect(listToggle).toHaveAttribute('aria-pressed', 'true')
    await expect(chartToggle).toHaveAttribute('aria-pressed', 'false')
    const list = page.getByRole('list', {
      name: /Classification list at current level|当前层级分类列表/,
    })
    await expect(list).toBeVisible()
    await expect(list.getByRole('button')).toHaveCount(1)
    await expect(list.getByRole('button').first()).toContainText(/艺术/)
    await expect(page.locator('canvas')).toHaveCount(1)
    await expect(page.locator('canvas')).toBeHidden()

    // 键盘路径：列表按钮 Tab 可聚焦 → Enter 激活下钻（树懒加载完成前 Enter 被忽略，
    // toPass 轮询直至面包屑出现）。
    await expect(async () => {
      const first = list.getByRole('button').first()
      await first.focus()
      await expect(first).toBeFocused()
      await page.keyboard.press('Enter')
      await expect(breadcrumb).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 30000 })

    // 下钻后列表与 canvas 同步：显示 J 子级「绘画」，面包屑含「艺术」。
    await expect(list.getByRole('button')).toHaveCount(1)
    await expect(list.getByRole('button').first()).toContainText(/绘画/)
    await expect(breadcrumb.getByRole('button', { name: '艺术' })).toBeVisible()

    // 面包屑 root 回退 → 回到根层列表。
    await breadcrumb
      .getByRole('button', { name: /All classes|全部分类/ })
      .click()
    await expect(breadcrumb).toBeHidden()
    await expect(list.getByRole('button')).toHaveCount(1)
    await expect(list.getByRole('button').first()).toContainText(/艺术/)
  })
})
