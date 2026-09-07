import { test, expect, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { buildDesensitizedFixture } from './fixtures'

/**
 * 导入负路径 E2E（错误分级契约见 src/lib/error-messages.ts；WCAG 3.3.1/3.3.3）。
 * 覆盖 4 个负路径：不支持文件类型拒绝、坏 JSON 失败报告、取消（预览后不执行）
 * 无落库、二次导入同文件去重合并（期望从样本派生，不硬编码绝对数字）。
 * 默认上下文 locale 为 en-US（无存储偏好 → browserLocale 'en'），断言用英文
 * 文案、正则兼容中文（参照 app.spec 既有 /Warning(s)?|警告/ 风格）。
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

/** 导入页：等空库自动落库预置模板（深圳图书馆）并选中。 */
async function gotoImportWithAutoSource(page: Page): Promise<void> {
  await page.goto('/import')
  await expect(page.getByText('深圳图书馆').first()).toBeVisible()
}

const SAMPLE_PATH = 'src/tests/fixtures/szlib-sample.json'

test.describe('import negative paths', () => {
  test('rejects an unsupported file type with a localized error', async ({ page }) => {
    await gotoImportWithAutoSource(page)

    // 非 JSON/CSV（txt）→ 拒绝提示（role=alert），不进入预览。
    const buffer = Buffer.from('this is a plain text file, not a library export\n', 'utf-8')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer,
    })
    await expect(page.getByRole('alert')).toContainText(/Could not recognize|无法识别文件/)
    await expect(page.getByText(/First 10 rows preview|前 10 条预览/)).toHaveCount(0)
  })

  test('reports a malformed JSON file as a localized failure', async ({ page }) => {
    await gotoImportWithAutoSource(page)

    // 损坏 JSON（`{broken`）→ 失败报告展示：本地化提示可见，
    // 且不是原始英文技术异常文本（SyntaxError 等）。
    const buffer = Buffer.from('{broken', 'utf-8')
    await page.locator('input[type="file"]').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer,
    })
    const alert = page.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(alert).toContainText(/Could not recognize|无法识别文件/)
    await expect(alert).not.toContainText(/SyntaxError|Unexpected token/)
    await expect(page.getByText(/First 10 rows preview|前 10 条预览/)).toHaveCount(0)
  })

  test('preview without execute: report stays empty and nothing is written', async ({ page }) => {
    await seed(page)
    await page.goto('/')
    // 基线统计（从 seed 夹具派生，非硬编码）。
    const booksBefore = (await page.locator('[data-stat="books"]').textContent())?.trim() ?? ''
    const cyclesBefore = (await page.locator('[data-stat="cycles"]').textContent())?.trim() ?? ''

    await page.goto('/import')
    // seed 自带唯一来源（测试图书馆）→ 自动选中。
    await expect(page.getByText('测试图书馆').first()).toBeVisible()
    const buffer = readFileSync(SAMPLE_PATH)
    await page.locator('input[type="file"]').setInputFiles({
      name: 'szlib-sample.json',
      mimeType: 'application/json',
      buffer,
    })
    await expect(page.getByText(/First 10 rows preview|前 10 条预览/)).toBeVisible()

    // 未执行导入 → 报告区保持空态，不出现完成态。
    await expect(page.getByText(/The import report will appear here|导入完成后/)).toBeVisible()
    await expect(page.getByText(/Import complete|导入完成/)).toHaveCount(0)

    // 取消离开 → 无落库：仪表盘统计不变、书库行数不变。
    await page.goto('/')
    await expect(page.locator('[data-stat="books"]')).toHaveText(booksBefore)
    await expect(page.locator('[data-stat="cycles"]')).toHaveText(cyclesBefore)
    await page.goto('/library')
    await expect(page.locator('tbody tr')).toHaveCount(3)
  })

  test('re-importing the same file adds zero new books/cycles (dedupe)', async ({ page }) => {
    await gotoImportWithAutoSource(page)
    const buffer = readFileSync(SAMPLE_PATH)
    const choose = () =>
      page.locator('input[type="file"]').setInputFiles({
        name: 'szlib-sample.json',
        mimeType: 'application/json',
        buffer,
      })

    // 第一次导入：报告出现，新增书目数从样本派生（>0），不硬编码绝对数字。
    await choose()
    await expect(page.getByText(/First 10 rows preview|前 10 条预览/)).toBeVisible()
    await page.getByRole('button', { name: /Start import|开始导入/ }).click()
    await expect(page.getByText(/Import complete|导入完成/)).toBeVisible({ timeout: 15000 })
    const firstNewBooks = await reportStat(page, /New books|新增书目/).innerText()
    expect(firstNewBooks).not.toBe('0')

    // 回到空态，二次导入同文件。
    await page.getByRole('button', { name: /Import another file|再导入一次/ }).click()
    await expect(page.getByText(/The import report will appear here|导入完成后/)).toBeVisible()
    await choose()
    await expect(page.getByText(/First 10 rows preview|前 10 条预览/)).toBeVisible()
    await page.getByRole('button', { name: /Start import|开始导入/ }).click()
    await expect(page.getByText(/Import complete|导入完成/)).toBeVisible({ timeout: 15000 })

    // 第二次导入新增为 0（去重合并生效，期望从报告字段直接断言）。
    await expect(reportStat(page, /New books|新增书目/)).toHaveText('0')
    await expect(reportStat(page, /New borrow cycles|新增借阅周期/)).toHaveText('0')
  })
})

/** 报告统计卡数字：label 所在 p 的父卡片内的第一个 p（数值）。 */
function reportStat(page: Page, label: RegExp): Locator {
  return page
    .locator('p')
    .filter({ hasText: label })
    .locator('xpath=..')
    .locator('p')
    .first()
}
