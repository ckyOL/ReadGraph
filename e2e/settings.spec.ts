import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

import { buildDesensitizedFixture } from './fixtures'

/**
 * 阶段 4 E2E（settings 规格 §10 / S-3）：
 * 偏好持久（暗色/时区）、导出备份下载、系统重置 AlertDialog 二次确认 + 勾选门槛、
 * 导出后清空系统（各页 Empty）、导入备份恢复书库。
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

/** 导出备份下载并保存到本地文件（供后续重置/恢复用）。 */
async function exportBackup(page: Page, path: string): Promise<void> {
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export backup', exact: true }).click()
  const download = await downloadPromise
  await download.saveAs(path)
}

/** 系统重置（二次确认 + 勾选门槛后清库）。 */
async function resetLibrary(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'System reset', exact: true }).click()
  await page.getByLabel('I have exported a backup').click()
  await page.getByRole('button', { name: 'Reset everything', exact: true }).click()
  await expect(page.getByText(/Reset complete/)).toBeVisible()
}

/** 选文件 + 恢复模式 + 导入，等待事务完成信号（Restore complete.）。 */
async function restoreBackup(
  page: Page,
  path: string,
  mode: 'snapshot' | 'replay',
): Promise<void> {
  if (mode === 'replay') {
    await page.getByRole('combobox').filter({ hasText: 'Snapshot' }).click()
    await page.getByRole('option', { name: 'Replay' }).click()
  }
  await page.locator('input[type="file"]').setInputFiles(path)
  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  await expect(page.getByText('Restore complete.')).toBeVisible({ timeout: 15000 })
}

/**
 * 构造「可重放」备份文本（settings 规格 §4 重建模式对照）：快照实体复用脱敏
 * 夹具（3 书 3 编目 6 周期），另附与夹具同构的 szlib rawRecords + importLog ——
 * snapshot 模式直接落实体；replay 模式按 rawRecords 重放重建出同一批书目
 * （重建等价），故两次恢复同一文件断言数据集一致。
 */
function buildReplayBackupText(): string {
  const fx = buildDesensitizedFixture()
  const rows = [
    { date: '20240110', time: '10:00:00', optype: '读者借出', metaid: 1001, title: '小说A/ 作者1', ISBN: '9780000000001', barcode: 'BC1' },
    { date: '20240115', time: '10:00:00', optype: '读者还回文献', metaid: 1001, title: '小说A/ 作者1', ISBN: '9780000000001', barcode: 'BC1' },
    { date: '20240120', time: '10:00:00', optype: '读者借出', metaid: 1002, title: '哲学B/ 作者2', ISBN: '9780000000002', barcode: 'BC2' },
    { date: '20240125', time: '10:00:00', optype: '读者还回文献', metaid: 1002, title: '哲学B/ 作者2', ISBN: '9780000000002', barcode: 'BC2' },
    { date: '20240201', time: '10:00:00', optype: '读者借出', metaid: 1003, title: '历史C/ 作者3', ISBN: '9780000000003', barcode: 'BC3' },
    { date: '20240206', time: '10:00:00', optype: '读者还回文献', metaid: 1003, title: '历史C/ 作者3', ISBN: '9780000000003', barcode: 'BC3' },
  ]
  const rawRecords = rows.map((d, i) => ({
    id: `rr-replay-${i + 1}`,
    importLogId: 'imp-replay-1',
    sourceId: 'src-e2e',
    data: d,
    rowIndex: i + 1,
    borrowCycleId: null,
    bookId: null,
    parseStatus: 'success',
    parseNote: null,
  }))
  return JSON.stringify(
    {
      version: '1',
      exportedAt: '2024-06-01T00:00:00.000Z',
      sources: fx.sources,
      rawRecords,
      books: fx.books,
      catalogRecords: fx.catalogRecords,
      borrowCycles: fx.borrowCycles,
      importLogs: [
        {
          id: 'imp-replay-1',
          sourceId: 'src-e2e',
          importedAt: '2024-01-10T02:00:00.000Z',
          fileName: 'replay-fixture.json',
          fileSize: 2048,
          detectedEncoding: 'UTF-8',
          parserId: 'szlib',
          stats: {
            totalRawRecords: 6,
            newBooks: 3,
            updatedBooks: 0,
            newBorrowCycles: 3,
            skippedRecords: 0,
            filteredRows: 0,
            warningCount: 0,
            errorCount: 0,
          },
          warnings: [],
        },
      ],
    },
    undefined,
    2,
  )
}

test.describe('preference persistence (S-3, settings 规格 §9-1/§9-2)', () => {
  test('dark theme + timezone switch persist across reload', async ({ page }) => {
    await page.goto('/settings')

    // 暗色：SegmentedControl 单选 → <html class="dark">。
    await page.getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    // 时区：开 Select → 输查询过滤（实时生效）→ 选 Asia/Tokyo。
    // 条目主文本为城市（macOS 式标签：城市 · 国家 (偏移)），断言用城市名。
    const tzSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Preferences' }),
    })
    await tzSection.getByRole('combobox').click()
    await page.getByPlaceholder(/Search city or timezone…|搜索城市或时区…/).fill('Tokyo')
    await page.getByRole('option', { name: /Tokyo/ }).click()
    await expect(tzSection.getByRole('combobox')).toContainText('Tokyo')

    // reload 后保留。
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/dark/)
    await expect(tzSection.getByRole('combobox')).toContainText('Tokyo')
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

test.describe('restore modes (settings 规格 §4 重建模式对照)', () => {
  test('snapshot restore overwrites divergent data back to the backup dataset', async ({ page }) => {
    await seed(page)
    await page.goto('/settings')
    await exportBackup(page, BACKUP_PATH)

    // 先期写入差异记录：改掉 小说A 的题名（覆盖语义的「差异数据」）。
    await page.goto('/library/book-1')
    await page.getByRole('button', { name: 'Edit' }).click()
    await page.locator('input[value="小说A"]').fill('小说A改')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: '小说A改' })).toBeVisible()

    // snapshot（默认）恢复 → 覆盖现有数据：数据集与备份一致，差异记录消失。
    await page.goto('/settings')
    await restoreBackup(page, BACKUP_PATH, 'snapshot')
    await page.goto('/library')
    await expect(page.locator('tbody tr')).toHaveCount(3)
    await expect(page.getByRole('link', { name: '小说A' })).toBeVisible()
    await expect(page.getByRole('link', { name: '哲学B' })).toBeVisible()
    await expect(page.getByRole('link', { name: '历史C' })).toBeVisible()
    await expect(page.getByText('小说A改', { exact: true })).toHaveCount(0)
  })

  test('replay restore of the same backup keeps the full dataset (rebuild equivalence)', async ({ page }) => {
    const replayPath = 'test-results/settings-backup-replay.json'
    writeFileSync(replayPath, buildReplayBackupText())

    await page.goto('/settings')

    // snapshot 恢复（同一可重放备份）→ 书库完整。
    await restoreBackup(page, replayPath, 'snapshot')
    await page.goto('/library')
    await expect(page.locator('tbody tr')).toHaveCount(3)

    // replay 恢复同一备份 → 从 rawRecords 重建：原有记录未被删、数据集与备份一致。
    await page.goto('/settings')
    await restoreBackup(page, replayPath, 'replay')
    await page.goto('/library')
    await expect(page.locator('tbody tr')).toHaveCount(3)
    await expect(page.getByRole('link', { name: '小说A' })).toBeVisible()
    await expect(page.getByRole('link', { name: '哲学B' })).toBeVisible()
    await expect(page.getByRole('link', { name: '历史C' })).toBeVisible()
    // 时间线同样重建（借还周期由 rawRecords 重放产出）。
    await page.goto('/timeline')
    await expect(page.getByText(/No borrow records yet|还没有借阅记录/)).toBeHidden()
  })

  test('snapshot restore rejects a backup with dangling references and writes nothing', async ({ page }) => {
    await seed(page)
    await page.goto('/settings')
    await exportBackup(page, BACKUP_PATH)

    // 构造悬空参照备份：追加一条 catalogRecord 引用不存在的 book。
    const backup = JSON.parse(readFileSync(BACKUP_PATH, 'utf8')) as {
      catalogRecords: Array<Record<string, unknown>>
    }
    backup.catalogRecords.push({
      ...backup.catalogRecords[0],
      id: 'cat-ghost',
      bookId: 'book-ghost',
    })
    writeFileSync('test-results/settings-backup-conflict.json', JSON.stringify(backup))

    // 清库后导入 → 完整性校验拒绝，冲突报告展示（role="alert"，A-4 本地化文案）。
    await resetLibrary(page)
    await page
      .locator('input[type="file"]')
      .setInputFiles('test-results/settings-backup-conflict.json')
    await page.getByRole('button', { name: 'Restore', exact: true }).click()

    await expect(page.getByRole('alert')).toContainText(
      /incomplete or internally inconsistent|不完整或相互矛盾/,
      { timeout: 15000 },
    )
    await expect(page.getByText('Restore complete.')).toHaveCount(0)
    // 拒绝时不落库：库保持重置后的空态。
    await page.goto('/library')
    await expect(page.getByText(/Library is empty|书库为空/)).toBeVisible()
  })
})
