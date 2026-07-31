import { test, expect, type Page } from '@playwright/test'
import { mkdirSync } from 'node:fs'

import { buildDesensitizedFixture } from './fixtures'

/**
 * 阶段 4 E2E（settings 规格 §10 / S-3）：
 * 偏好持久（暗色/时区）、导出备份下载、系统重置 AlertDialog 二次确认 + 勾选门槛、
 * 导出后清空系统（各页 Empty）、导入备份恢复书库、来源管理（列表/编辑/新建）。
 * 默认上下文 locale 为 en-US（无存储偏好 → browserLocale 'en'），断言用英文文案。
 */

const SEED_KEY = 'readgraph:e2e-seed'
const BACKUP_PATH = 'test-results/settings-backup.json'

mkdirSync('test-results', { recursive: true })

async function seed(page: Page): Promise<void> {
  const payload = JSON.stringify(buildDesensitizedFixture())
  // sessionStorage 守卫：init script 每次导航都重跑，仅首次注入 seed key
  // （应用灌库后清除 key；避免重置后 goto 又被重新灌库）。
  await page.addInitScript(([key, value]) => {
    try {
      if (sessionStorage.getItem('readgraph:e2e-seeded')) return
      localStorage.setItem(key, value)
      sessionStorage.setItem('readgraph:e2e-seeded', '1')
    } catch {
      // ignore
    }
  }, [SEED_KEY, payload] as const)
}

test.describe('preference persistence (S-3, settings 规格 §9-1/§9-2)', () => {
  test('dark theme + timezone switch persist across reload', async ({ page }) => {
    await page.goto('/settings')

    // 暗色：SegmentedControl 单选 → <html class="dark">。
    await page.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    // 时区：搜索过滤后选择 Asia/Tokyo（先输查询再开 Select，过滤实时生效）。
    const tzSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Preferences' }),
    })
    await page.getByPlaceholder('Search timezones…').fill('Tokyo')
    await tzSection.getByRole('combobox').click()
    await page.getByRole('option', { name: 'Asia/Tokyo' }).click()
    await expect(tzSection.getByRole('combobox')).toContainText('Asia/Tokyo')

    // reload 后保留。
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(tzSection.getByRole('combobox')).toContainText('Asia/Tokyo')
  })
})

test.describe('export + system reset (S-3, settings 规格 §9-3/§9-6)', () => {
  test('exports backup, gates reset behind checkbox, then all pages are empty', async ({ page }) => {
    await seed(page)
    await page.goto('/settings')

    // 导出备份 → 下载 readgraph-backup-YYYYMMDD-HHmmss.json。
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export backup', exact: true }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toMatch(/^readgraph-backup-\d{8}-\d{6}\.json$/)
    await download.saveAs(BACKUP_PATH)

    // 系统重置：AlertDialog 二次确认，未勾选门槛时确认禁用。
    await page.getByRole('button', { name: 'System reset', exact: true }).click()
    await expect(page.getByText('Confirm system reset?')).toBeVisible()
    const confirmBtn = page.getByRole('button', { name: 'Reset everything', exact: true })
    await expect(confirmBtn).toBeDisabled()
    await page.getByLabel('I have exported a backup').click()
    await expect(confirmBtn).toBeEnabled()
    await confirmBtn.click()

    // 对话框关闭 + 成功提示；各页回到 Empty 空态。
    await expect(page.getByText('Confirm system reset?')).toBeHidden()
    await expect(page.getByText(/Reset complete/)).toBeVisible()
    await page.goto('/')
    await expect(page.getByText(/No books yet|还没有藏书/)).toBeVisible()
    await page.goto('/library')
    await expect(page.getByText(/Library is empty|书库为空/)).toBeVisible()
  })
})

test.describe('import backup restores library (S-3, settings 规格 §9-4)', () => {
  test('snapshot restore brings books back after reset', async ({ page }) => {
    await seed(page)
    await page.goto('/settings')

    // 先导出备份。
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export backup', exact: true }).click()
    const download = await downloadPromise
    await download.saveAs(BACKUP_PATH)

    // 重置（勾选门槛后确认；等事务完成信号再导航，避免中途离开销毁 JS 上下文）。
    await page.getByRole('button', { name: 'System reset', exact: true }).click()
    await page.getByLabel('I have exported a backup').click()
    await page.getByRole('button', { name: 'Reset everything', exact: true }).click()
    await expect(page.getByText(/Reset complete/)).toBeVisible()
    await page.goto('/library')
    await expect(page.getByText(/Library is empty|书库为空/)).toBeVisible()

    // 导入备份（snapshot 模式默认）→ 书库恢复可见。
    await page.goto('/settings')
    await page.locator('input[type="file"]').setInputFiles(BACKUP_PATH)
    await page.getByRole('button', { name: 'Restore', exact: true }).click()
    await expect(page.getByText('Restore complete.')).toBeVisible({ timeout: 15000 })
    await page.goto('/library')
    await expect(page.getByRole('link', { name: '小说A' })).toBeVisible()
    await expect(page.getByRole('link', { name: '哲学B' })).toBeVisible()
    // 时间线同样恢复。
    await page.goto('/timeline')
    await expect(page.getByText(/No borrow records yet|还没有借阅记录/)).toBeHidden()
  })
})

test.describe('source management (settings 规格 §6/§9)', () => {
  test('lists sources, edits name, creates a custom source', async ({ page }) => {
    await seed(page)
    await page.goto('/settings')

    // 列表：fixture 来源 + parserId + 分类体系。
    const row = page.locator('tbody tr').filter({ hasText: '测试图书馆' })
    await expect(row).toHaveCount(1)
    await expect(row).toContainText('szlib')
    await expect(row).toContainText('CLC')

    // 编辑名称 → 列表更新。
    await row.getByRole('button', { name: 'Edit' }).click()
    const nameInput = page.getByPlaceholder('Name')
    await nameInput.fill('测试图书馆改名')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await expect(page.locator('tbody tr').filter({ hasText: '测试图书馆改名' })).toHaveCount(1)

    // 新建自定义来源（manual）→ 列表出现。
    await page.getByRole('button', { name: 'New source', exact: true }).click()
    await page.getByPlaceholder('Name').fill('我的手动来源')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    const customRow = page.locator('tbody tr').filter({ hasText: '我的手动来源' })
    await expect(customRow).toHaveCount(1)
    await expect(customRow).toContainText('Manual')
    await expect(customRow).toContainText('Asia/Shanghai')
  })
})
