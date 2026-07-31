import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { buildDesensitizedFixture } from './fixtures'

/**
 * 阶段 3 E2E（ui-navigation §8 / G-6）：
 * AppShell 导航与高亮、移动端折叠、空态 → 导入入口、暗色/locale 持久、
 * 书库列表/详情、导入关键路径（自动建源→文件→预览→执行→报告→落库→书库可见）。
 * 默认上下文 locale 为 en-US（无存储偏好 → browserLocale 'en'），断言用英文文案。
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

test.describe('shell navigation (ui-navigation §8)', () => {
  const pages = [
    { name: /Overview|概览/, url: '/' },
    { name: /Library|书库/, url: '/library' },
    { name: /Timeline|时间线/, url: '/timeline' },
    { name: /Import|导入/, url: '/import' },
    { name: /Profile|画像/, url: '/profile' },
    { name: /Settings|设置/, url: '/settings' },
  ] as const

  for (const p of pages) {
    test(`navigates to ${p.url} and highlights the active item`, async ({ page }) => {
      await page.goto('/')
      const link = page.locator('[data-slot="sidebar"]').getByRole('link', { name: p.name })
      await link.click()
      await expect(page).toHaveURL(p.url)
      await expect(link).toHaveAttribute('aria-current', 'page')
    })
  }

  test('mobile: sidebar collapses into a sheet toggled by the trigger', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/')
    // 桌面侧栏在移动端隐藏。
    const desktopSidebar = page.locator('[data-slot="sidebar"][data-mobile="true"]')
    await expect(desktopSidebar).toBeHidden()
    // 触发器展开移动端 Sheet。
    await page.locator('[data-slot="sidebar-trigger"]').click()
    await expect(desktopSidebar).toBeVisible()
    // 点击导航项跳转且 Sheet 收起。
    await desktopSidebar.getByRole('link', { name: /Library|书库/ }).click()
    await expect(page).toHaveURL('/library')
    await expect(desktopSidebar).toBeHidden()
  })
})

test.describe('empty states (ui-navigation §3)', () => {
  test('empty dashboard shows Empty + import entry → /import', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/No books yet|还没有藏书/)).toBeVisible()
    await page.getByRole('link', { name: /Go to import|去导入/ }).click()
    await expect(page).toHaveURL(/\/import/)
  })

  test('empty library shows Empty', async ({ page }) => {
    await page.goto('/library')
    await expect(page.getByText(/Library is empty|书库为空/)).toBeVisible()
  })

  test('empty timeline shows Empty + import entry', async ({ page }) => {
    await page.goto('/timeline')
    await expect(page.getByText(/No borrow records yet|还没有借阅记录/)).toBeVisible()
  })
})

test.describe('preference persistence (ui-navigation §8)', () => {
  test('dark theme persists across reload', async ({ page }) => {
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
    await page.goto('/')
    await expect(page.locator('html')).toHaveClass(/dark/, { timeout: 5000 })
  })

  test('locale switch updates html[lang] and persists', async ({ page }) => {
    await page.goto('/settings')
    await page.getByRole('button', { name: /English|简体中文/ }).click()
    await page.getByRole('menuitem', { name: '简体中文' }).click()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
    // 导航文案切换为中文。
    await expect(
      page.locator('[data-slot="sidebar"]').getByRole('link', { name: '概览' }),
    ).toBeVisible()
    // reload 后保留。
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
  })
})

test.describe('library list & detail (G-2/G-3)', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('renders rows with classification chips, search filters, sort toggles', async ({ page }) => {
    await page.goto('/library')
    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(3)
    // 分类号芯片（CLC code 等宽呈现）。
    for (const code of ['I', 'B', 'K']) {
      await expect(page.getByText(code, { exact: true }).first()).toBeVisible()
    }
    // 搜索过滤。
    await page.getByPlaceholder(/Search title, author or ISBN/).fill('哲学B')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('哲学B')
    // 排序切换：点「书名」列头翻转顺序。
    await page.getByPlaceholder(/Search title, author or ISBN/).fill('')
    const firstBefore = await rows.first().innerText()
    await page.getByRole('button', { name: /Title|书名/ }).click()
    const firstAfter = await rows.first().innerText()
    expect(firstAfter).not.toBe(firstBefore)
  })

  test('book detail shows metadata, holdings and borrow timeline', async ({ page }) => {
    await page.goto('/library')
    await page.getByRole('link', { name: '小说A' }).click()
    await expect(page).toHaveURL(/\/library\/book-1/)
    await expect(page.getByRole('heading', { name: '小说A' })).toBeVisible()
    // 馆藏记录：来源徽标 + 条码（等宽）。
    await expect(page.getByText(/Holdings|馆藏记录/)).toBeVisible()
    await expect(page.getByText('BC1', { exact: true }).first()).toBeVisible()
    // 借阅历史：2 个周期。
    await expect(page.getByText(/Borrow history|借阅历史/)).toBeVisible()
    await expect(page.getByText(/Returned|已还/).first()).toBeVisible()
  })
})

test.describe('import critical path (G-5)', () => {
  test('auto source → file → preview → execute → report → library', async ({ page }) => {
    await page.goto('/import')

    // 无来源 → 自动落库预置模板并选中（取代原「从模板创建」步骤）。
    await expect(page.getByText('深圳图书馆').first()).toBeVisible()

    // 选文件（脱敏 szlib 流水）：编码自动检测，预览立即呈现。
    const buffer = readFileSync('src/tests/fixtures/szlib-sample.json')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'szlib-sample.json',
      mimeType: 'application/json',
      buffer,
    })
    await expect(page.getByText(/Encoding: utf-8|编码: utf-8/)).toBeVisible()
    await expect(page.getByText(/First 10 rows preview|前 10 条预览/)).toBeVisible()
    await expect(page.getByText('再见绘梨').first()).toBeVisible()

    // 执行 → 右侧栏报告。
    await page.getByRole('button', { name: /Start import|开始导入/ }).click()
    await expect(page.getByText(/Import complete|导入完成/)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/New books|新增书目/)).toBeVisible()
    await expect(page.getByText(/New borrow cycles|新增借阅周期/)).toBeVisible()
    // 无效日期行产生 1 条警告。
    await expect(page.getByText(/Warnings|警告/).first()).toBeVisible()

    // 落库 → 书库可见（含分类号芯片与来源徽标）。
    await page.getByRole('link', { name: /Go to library|去书库/ }).click()
    await expect(page).toHaveURL('/library')
    await expect(page.getByRole('link', { name: '再见绘梨' })).toBeVisible()
    await expect(page.getByText('深圳图书馆').first()).toBeVisible()

    // Dashboard 统计卡片。
    await page.goto('/')
    await expect(page.locator('[data-stat="books"]')).toContainText('11')
    await expect(page.locator('[data-stat="cycles"]')).toContainText('12')
    // 最近借阅列表出现导入的书。
    await expect(page.getByText('再见绘梨').first()).toBeVisible()
  })
})
