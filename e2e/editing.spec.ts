import { test, expect, type Locator, type Page } from '@playwright/test'

import { buildEditingFixture } from './fixtures'

/**
 * book-editing 规格 §7.6 E2E：详情页统一编辑（search.edit 驱动）、书库类型筛选与徽标
 * 跳转、占位补全保存、/review 已删除（404）。默认上下文 locale 为 en-US，断言用英文文案。
 */

const SEED_KEY = 'readgraph:e2e-seed'

async function seed(page: Page): Promise<void> {
  const payload = JSON.stringify(buildEditingFixture())
  // sessionStorage 守卫：init script 每次导航都重跑，仅首次注入 seed key
  // （应用灌库后清除 key；避免保存/合并后 goto 又被重新灌库清掉状态——settings.spec 同款）。
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

/** 桌面视口（默认 1280px ≥ lg 断点）下书库列表断言限定表格容器：卡片网格（lg:hidden）与表格
 *  同挂 DOM（748f52a CSS 断点切换），未限定的 getByText/getByRole 命中两份 → strict-mode 冲突。 */
function libraryTable(page: Page): Locator {
  return page.locator('[data-slot="library-table"]')
}

test.describe('book editing (book-editing §7.6)', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('edit dialog opens via ?edit=1 and saves title back to detail', async ({ page }) => {
    await page.goto('/library/book-1')
    // 头部「Edit」按钮 → search.edit=true。
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page).toHaveURL(/\/library\/book-1\?edit=true/)
    // Dialog 预填当前书名。
    const titleInput = page.locator('input[value="小说A"]')
    await expect(titleInput).toBeVisible()
    // 改题名并保存。
    await titleInput.fill('小说A改')
    await page.getByRole('button', { name: 'Save' }).click()
    // Dialog 关闭、URL 回写、详情页标题更新。
    await expect(page).not.toHaveURL(/edit=true/)
    await expect(page.getByRole('heading', { name: '小说A改' })).toBeVisible()
  })

  test('library status filter isolates placeholder and set candidate', async ({ page }) => {
    await page.goto('/library')
    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(4)
    // 徽标：占位书 destructive「Placeholder」、套装（候选与已确认）outline「Set」。
    await expect(libraryTable(page).getByText('Placeholder', { exact: true })).toBeVisible()
    await expect(libraryTable(page).getByText('Set', { exact: true })).toHaveCount(2)

    // 类型筛选：Placeholder（来源筛选也含 “All”，用 ^All$ 精确匹配类型下拉）。
    await page.getByRole('combobox').filter({ hasText: /^All$/ }).click()
    await page.getByRole('option', { name: 'Placeholder' }).click()
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('福田图书馆读者自选图书')

    // 套装：候选与已确认套装同口径命中（M4：徽标与筛选一致）——合成书目052（候选）+ 历史C（已确认）。
    await page.getByRole('combobox').filter({ hasText: 'Placeholder' }).click()
    await page.getByRole('option', { name: 'Set candidate' }).click()
    await expect(rows).toHaveCount(2)
    await expect(libraryTable(page).getByRole('link', { name: '合成书目052', exact: true })).toBeVisible()
    await expect(libraryTable(page).getByRole('link', { name: '历史C', exact: true })).toBeVisible()

    // 待完善：占位 + 套装候选。
    await page.getByRole('combobox').filter({ hasText: 'Set candidate' }).click()
    await page.getByRole('option', { name: 'Needs review' }).click()
    await expect(rows).toHaveCount(2)
  })

  test('placeholder badge links to detail with edit dialog open', async ({ page }) => {
    await page.goto('/library')
    await libraryTable(page).getByRole('link', { name: /Placeholder 福田图书馆读者自选图书/ }).click()
    // 行链接携带实时搜索 q（a67f6b7 L1：空输入也写 ?q=），URL 断言容忍任意参数前缀。
    await expect(page).toHaveURL(/\/library\/book-2\?.*edit=true/)
    await expect(page.locator('input[value="福田图书馆读者自选图书"]')).toBeVisible()
  })

  test('placeholder completion saves and clears needsReview', async ({ page }) => {
    await page.goto('/library/book-2?edit=true')
    await page.locator('input[value="福田图书馆读者自选图书"]').fill('真实的书')
    // 填 ISBN 后保存。
    await page.locator('input.font-mono').first().fill('9787111111115')
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('heading', { name: '真实的书' })).toBeVisible()
    // 书库徽标与侧栏计数消失。
    await page.goto('/library')
    await expect(page.getByText('Placeholder', { exact: true })).toHaveCount(0)
  })

  test('set candidate edits volumes via parse-from-title helper', async ({ page }) => {
    await page.goto('/library/book-3?edit=true')
    // 卷号输入（aria-label 为 `Volume <题名原文>`，夹具无 rawRecords → 兜底空串）。
    const volumeInput = page.getByRole('textbox', { name: /^Volume/ })
    await volumeInput.fill('3')
    await page.getByRole('button', { name: 'Save' }).click()
    // 等待保存事务完成：Dialog 关闭（URL 清 edit）发生在 updateBookWithRecords 提交之后，
    // 避免 goto 与事务竞态读到保存前状态。
    await expect(page).not.toHaveURL(/edit=true/)
    // 保存后解除待审：book-3 单卷非套装 → 徽标只剩已确认套装 book-4（守卫防重灌，
    // 旧断言 2 是重灌恢复夹具的假象）。
    await page.goto('/library')
    await expect(libraryTable(page).getByText('Set', { exact: true })).toHaveCount(1)
  })

  test('structured set detail hides empty more menu', async ({ page }) => {
    // book-4 为已结构化套装（needsReview=false、2 卷编目）：菜单无可用项
    // （拆分为套装候选专属），按钮整体隐藏，不渲染空菜单（book-editing §4.3）。
    await page.goto('/library/book-4')
    await expect(page.getByRole('button', { name: 'More' })).toHaveCount(0)
  })

  test('placeholder detail exposes merge action in more menu', async ({ page }) => {
    await page.goto('/library/book-2')
    await page.getByRole('button', { name: 'More' }).click()
    await expect(page.getByText('Merge into existing book')).toBeVisible()
    // 合并流：搜索目标书 → 选中 → 确认。
    await page.getByText('Merge into existing book').click()
    await page.getByPlaceholder('Search title or ISBN…').fill('小说A')
    await page.getByRole('button', { name: 'Search' }).click()
    await page.getByRole('button', { name: 'Select' }).first().click()
    await page.getByRole('button', { name: 'Merge', exact: true }).click()
    // 合并成功后跳转目标书详情页；占位书消失、目标书仍存（借阅已归入）。
    await expect(page).toHaveURL(/\/library\/book-1/)
    await page.goto('/library')
    await expect(page.getByText('福田图书馆读者自选图书')).toHaveCount(0)
    await expect(libraryTable(page).getByText('小说A', { exact: true })).toBeVisible()
  })

  test('closing edit dialog does not reopen on browser back', async ({ page }) => {
    await page.goto('/library/book-1')
    // 头部「Edit」按钮 → search.edit=true（push）。
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page).toHaveURL(/\/library\/book-1\?edit=true/)
    await expect(page.getByRole('dialog')).toBeVisible()
    // 取消关闭 → replace 回写干净 URL（底部「Cancel」按钮；头部 X 的 aria-label 同为 Cancel）。
    await page.getByText('Cancel', { exact: true }).click()
    await expect(page).not.toHaveURL(/edit=true/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // 浏览器返回：历史中无残留 ?edit=true 条目（关闭已 replace 回写），dialog 不重新弹出。
    await page.goBack()
    await expect(page).not.toHaveURL(/edit=true/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('browser back from detail restores library filters', async ({ page }) => {
    // URL 即筛选状态：直接以待完善筛选进入书库。
    await page.goto('/library?status=needsReview')
    await expect(page).toHaveURL(/\/library\?status=needsReview/)
    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(2)

    // 徽标直达编辑（push ?edit=true；行链接携带视图参数 status=needsReview，opac-enrichment §10）。
    await libraryTable(page).getByRole('link', { name: /Placeholder 福田图书馆读者自选图书/ }).click()
    await expect(page).toHaveURL(/\/library\/book-2\?.*edit=true/)
    await expect(page.locator('input[value="福田图书馆读者自选图书"]')).toBeVisible()

    // 浏览器返回：筛选参数与行数原样恢复。
    await page.goBack()
    await expect(page).toHaveURL(/\/library\?status=needsReview/)
    await expect(rows).toHaveCount(2)

    // 连续审核下一本：筛选仍在。
    await libraryTable(page).getByRole('link', { name: /Set 合成书目052/ }).click()
    await expect(page).toHaveURL(/\/library\/book-3\?.*edit=true/)
  })

  test('/review route is gone (404)', async ({ page }) => {
    await page.goto('/review')
    // 非空库下进入未知路由：AppShell 挂载（空态/错误边界不崩壳）。
    await expect(page.locator('[data-slot="sidebar"]')).toBeVisible()
  })

  test('fetched record shows Re-fetch; unfetched sibling keeps Enrich button (§6 可重新抓取)', async ({ page }) => {
    // 已确认套装 book-4：cat-4a 已补全（fetched）→ 「Re-fetch」；cat-4b 未补全 → 「Enrich from …」。
    await page.goto('/library/book-4')
    await expect(page.getByRole('button', { name: 'Re-fetch' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Enrich from 深圳图书馆 OPAC/ })).toBeVisible()
  })

  test('detail pager walks the library view order (opac-enrichment §10)', async ({ page }) => {    // 视图参数：sort=isbn&dir=asc → isbn 空值排前（book-2 福田），随后 0001/0003/5740。
    await page.goto('/library?sort=isbn&dir=asc')
    const rows = page.locator('tbody tr')
    await expect(rows).toHaveCount(4)
    // 书库列表无任何批量补全入口（§1 定案：补全唯一路径是详情页单条）。
    await expect(page.getByRole('button', { name: /Enrich/ })).toHaveCount(0)

    // 首行进入详情页：URL 延续视图参数。
    await rows.first().getByRole('link').first().click()
    await expect(page).toHaveURL(/\/library\/book-2\?.*sort=isbn/)
    await expect(page.getByRole('heading', { name: '福田图书馆读者自选图书' })).toBeVisible()

    // 首行「上一个」禁用；「下一个」沿视图顺序到 小说A → 历史C → 合成书目052。
    const prev = page.getByRole('button', { name: 'Previous' })
    const next = page.getByRole('button', { name: 'Next' })
    await expect(prev).toBeDisabled()
    await next.click()
    await expect(page).toHaveURL(/\/library\/book-1\?.*sort=isbn/)
    // 单条补全入口（provider 命中 + lookupKey 有效，§7.2）：szlib 来源记录显示补全按钮。
    await expect(
      page.getByRole('button', { name: /Enrich from 深圳图书馆 OPAC/ }),
    ).toBeVisible()
    await next.click()
    await expect(page).toHaveURL(/\/library\/book-4\?.*sort=isbn/)
    await next.click()
    await expect(page).toHaveURL(/\/library\/book-3\?.*sort=isbn/)
    // 末行「下一个」禁用；返回上一本。
    await expect(next).toBeDisabled()
    await prev.click()
    await expect(page).toHaveURL(/\/library\/book-4\?.*sort=isbn/)

    // 编辑 Dialog 打开（覆盖层遮住头部翻页钮）→ 关闭后翻页不受影响。
    await page.getByRole('button', { name: 'Edit' }).click()
    await expect(page).toHaveURL(/\/library\/book-4\?.*edit=true/)
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByText('Cancel', { exact: true }).click()
    await expect(page).not.toHaveURL(/edit=true/)
    await next.click()
    await expect(page).toHaveURL(/\/library\/book-3\?.*sort=isbn/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('mobile 375px: card grid shows fields, table hidden', async ({ page }) => {
    // 双视图同挂 DOM（CSS 断点切换）：375px 视口下表格隐藏、卡片网格可见。
    // 断言锁定 [data-slot="library-cards"]，锁定 card grid 视图不被后续重构破坏。
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/library')
    const cards = page.locator('[data-slot="library-cards"]')
    await expect(page.locator('[data-slot="library-table"]')).toBeHidden()
    await expect(cards).toBeVisible()
    // 卡片视图字段可见性：书名、徽标（Placeholder/Set）、套装候选链接、作者、ISBN、来源。
    await expect(cards.getByText('小说A', { exact: true })).toBeVisible()
    await expect(cards.getByText('Placeholder', { exact: true })).toBeVisible()
    await expect(cards.getByText('Set', { exact: true })).toHaveCount(2)
    await expect(cards.getByRole('link', { name: '合成书目052', exact: true })).toBeVisible()
    await expect(cards.getByText('作者A', { exact: true }).first()).toBeVisible()
    await expect(cards.getByText('9780000000001', { exact: true })).toBeVisible()
    await expect(cards.getByText('测试图书馆', { exact: true })).toHaveCount(4)
  })
})
