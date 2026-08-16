import { test, expect, type Page } from '@playwright/test'

import { buildDesensitizedFixture } from './fixtures'

/**
 * 阶段 2 A-2（WCAG 2.5.3 标签在名称中 / 3.3.2 标签或说明 / 4.1.2 名称角色值 /
 * 2.4.6 标题和标签 / 3.3.1 错误标识）E2E：
 * - profile 自定义日期范围：label 经 htmlFor 关联，点击 label 聚焦输入框；
 *   倒置输入（from > to）两输入 aria-invalid + role="alert" 可行动提示，修正即清除。
 * - library / timeline 筛选 Select：combobox 可访问名与旁边可见 span 一致，可按名定位。
 * 默认上下文 locale en-US（断言用英文文案），末例切简体中文核验 zh key 布线。
 * Radix SelectTrigger 的 role 为 combobox（与 profile.spec.ts 既有用法一致）。
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

/** 展开 profile 自定义日期范围（切换范围 Select 为 Custom/自定义）。 */
async function openCustomRange(page: Page): Promise<void> {
  await page.getByRole('combobox', { name: /Time range|时间范围/ }).click()
  await page.getByRole('option', { name: /Custom|自定义/ }).click()
}

test.describe('profile — custom date range inputs (A-2)', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('date inputs are locatable by label and clicking the label focuses the input', async ({
    page,
  }) => {
    await page.goto('/profile')
    await openCustomRange(page)

    // 可访问名与可见文本一致（3.3.2/2.4.6）：getByLabel 按 label 文本定位。
    const fromInput = page.getByLabel(/^(From|起)$/)
    const toInput = page.getByLabel(/^(To|止)$/)
    await expect(fromInput).toBeVisible()
    await expect(toInput).toBeVisible()

    // 点击「起」label → 焦点落到 from 输入（htmlFor 关联，2.4.6/3.3.2）。
    await page.getByText(/^(From|起)$/).click()
    await expect(fromInput).toBeFocused()
  })

  test('inverted range shows alert message + aria-invalid on both inputs and clears on fix', async ({
    page,
  }) => {
    await page.goto('/profile')
    await openCustomRange(page)

    const fromInput = page.getByLabel(/^(From|起)$/)
    const toInput = page.getByLabel(/^(To|止)$/)
    await expect(fromInput).toBeVisible()

    // 倒置：from > to → 可行动提示可见 + 两输入 aria-invalid（3.3.1）。
    await fromInput.fill('2025-06-01')
    await toInput.fill('2025-01-01')
    await expect(page.getByText(/earlier than start|早于开始/)).toBeVisible()
    await expect(fromInput).toHaveAttribute('aria-invalid', 'true')
    await expect(toInput).toHaveAttribute('aria-invalid', 'true')

    // 修正 to ≥ from → 提示消失、aria-invalid 移除（validate-on-change）。
    await toInput.fill('2025-12-31')
    await expect(page.getByText(/earlier than start|早于开始/)).toHaveCount(0)
    await expect(fromInput).not.toHaveAttribute('aria-invalid')
    await expect(toInput).not.toHaveAttribute('aria-invalid')
  })

  test('zh locale: labels, combobox names and the error message resolve in Chinese', async ({
    page,
  }) => {
    await page.goto('/settings')
    await page.getByRole('radio', { name: '简体中文' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')

    await page.goto('/profile')
    await openCustomRange(page)

    const fromInput = page.getByLabel(/^(起)$/)
    const toInput = page.getByLabel(/^(止)$/)
    await expect(fromInput).toBeVisible()
    await expect(toInput).toBeVisible()

    await fromInput.fill('2025-06-01')
    await toInput.fill('2025-01-01')
    await expect(page.getByText(/早于开始/)).toBeVisible()
    await expect(fromInput).toHaveAttribute('aria-invalid', 'true')
    await expect(toInput).toHaveAttribute('aria-invalid', 'true')
  })
})

test.describe('library — filter selects accessible names (A-2)', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('filter comboboxes are locatable by name matching the visible label', async ({
    page,
  }) => {
    await page.goto('/library')
    // 2.5.3：combobox 可访问名与旁边可见 span（library.filter.source / .status）一致。
    const source = page.getByRole('combobox', { name: /^Source$|^来源$/ })
    const status = page.getByRole('combobox', { name: /^Status$|^类型$/ })
    await expect(source).toBeVisible()
    await expect(status).toBeVisible()

    // 可操作：展开来源筛选并列出选项。
    await source.click()
    await expect(page.getByRole('option', { name: /All sources|全部来源/ })).toBeVisible()
  })
})

test.describe('timeline — filter selects accessible names (A-2)', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('filter comboboxes are locatable by name matching the visible label', async ({
    page,
  }) => {
    await page.goto('/timeline')
    const source = page.getByRole('combobox', { name: /^Source$|^来源$/ })
    const status = page.getByRole('combobox', { name: /^Status$|^状态$/ })
    await expect(source).toBeVisible()
    await expect(status).toBeVisible()

    // 可操作：展开状态筛选并列出选项。
    await status.click()
    await expect(page.getByRole('option', { name: /Borrowed|在借/ })).toBeVisible()
  })
})
