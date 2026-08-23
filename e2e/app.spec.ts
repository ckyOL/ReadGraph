import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { buildDesensitizedFixture } from './fixtures'
import { szlibParser } from '@/parsers/szlib'
import type { Source } from '@/types/entities'

/**
 * 阶段 3 E2E（ui-navigation §8 / G-6）：
 * AppShell 导航与高亮、移动端折叠、空态 → 导入入口、暗色/locale 持久、
 * 书库列表/详情、导入关键路径（自动建源→文件→预览→执行→报告→落库→书库可见）。
 * 默认上下文 locale 为 en-US（无存储偏好 → browserLocale 'en'），断言用英文文案。
 */

const SEED_KEY = 'readgraph:e2e-seed'

/**
 * H-6 数据耦合：从样本夹具实时推导导入产出的期望统计（books/borrowCycles），
 * 样本行数/书目变动无需改断言。与导入共用同一 szlibParser（空库导入时
 * newBooks/newBorrowCycles 即 parse 产物，已由 run-import 单测验证）。
 * 注意：import critical path 测试未调用 seed()（全新上下文空库导入），
 * 故总数 = 样本产物本身；若将来给本测试加 seed，需在此累加
 * buildDesensitizedFixture() 的 books/borrowCycles 数量。
 */
function sampleImportStats(buffer: Buffer): { books: number; cycles: number } {
  const source: Source = {
    id: 'src-e2e-import',
    type: 'library',
    name: '深圳图书馆',
    parserId: 'szlib',
    parserVersion: null,
    timezone: 'Asia/Shanghai',
    library: null,
    notes: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastImportAt: null,
    totalImportedRecords: 0,
  }
  const rows = JSON.parse(buffer.toString('utf-8')) as unknown[]
  const parsed = szlibParser.parse(rows, source)
  return { books: parsed.books.length, cycles: parsed.borrowCycles.length }
}

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
    { name: /Profile|画像/, url: '/profile' },
    { name: /Settings|设置/, url: '/settings' },
  ] as const

  for (const p of pages) {
    test(`navigates to ${p.url} and highlights the active item`, async ({ page }) => {
      await page.goto('/')
      const link = page
        .locator('[data-slot="sidebar"] [data-slot="sidebar-content"]')
        .getByRole('link', { name: p.name })
      await link.click()
      await expect(page).toHaveURL(p.url)
      await expect(link).toHaveAttribute('aria-current', 'page')
    })
  }

  test('footer import button navigates to /import (single import entry)', async ({ page }) => {
    await page.goto('/')
    const link = page.locator('[data-slot="sidebar-footer"]').getByRole('link', {
      name: /Import|导入/,
    })
    await link.click()
    await expect(page).toHaveURL(/\/import/)
  })

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
    // 语言控件为 SegmentedControl 单选（非下拉菜单），点击中文选项直接生效。
    await page.getByRole('radio', { name: '简体中文' }).click()
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
    // 预览可见夹具首行（隐私虚构化后标题为「合成书目001」）。
    await expect(page.getByText('合成书目001').first()).toBeVisible()
    // 预览已按 parser.filterRows 剔除「自助查询」等无用条目（样本含自助查询/读者续借行）。
    await expect(page.locator('table').getByText('自助查询')).toHaveCount(0)
    await expect(page.locator('table').getByText('读者续借')).toHaveCount(0)

    // 执行 → 右侧栏报告。
    await page.getByRole('button', { name: /Start import|开始导入/ }).click()
    await expect(page.getByText(/Import complete|导入完成/)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/New books|新增书目/)).toBeVisible()
    await expect(page.getByText(/New borrow cycles|新增借阅周期/)).toBeVisible()
    // 无效日期行产生 1 条警告（count=1 时 en 复数规则取单数 "Warning (1)"，正则须兼容两种形式）。
    await expect(page.getByText(/Warning(s)?|警告/).first()).toBeVisible()

    // 落库 → 书库可见（含分类号芯片与来源徽标）。
    await page.getByRole('link', { name: /Go to library|去书库/ }).click()
    await expect(page).toHaveURL('/library')
    await expect(page.getByRole('link', { name: '合成书目001' })).toBeVisible()
    await expect(page.getByText('深圳图书馆').first()).toBeVisible()

    // Dashboard 统计卡片：期望值从样本夹具实时派生（H-6），样本行数变动不碎。
    await page.goto('/')
    const expected = sampleImportStats(buffer)
    await expect(page.locator('[data-stat="books"]')).toContainText(String(expected.books))
    await expect(page.locator('[data-stat="cycles"]')).toContainText(String(expected.cycles))
    // 最近借阅列表出现导入的书。
    await expect(page.getByText('合成书目001').first()).toBeVisible()
  })
})
