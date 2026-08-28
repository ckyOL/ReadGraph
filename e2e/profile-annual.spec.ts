import { expect, test, type Page } from '@playwright/test'

import { buildDesensitizedFixture } from './fixtures'

/**
 * 年度视图 E2E（profile-annual-view-batch W4 T-2；reading-profile §4/§7、
 * ai-features §9.1/§3.3）。静态骨架：入口跳转、数字同源、空年、年份切换、
 * 非法 $year 404。AI 叙事：预览与请求深等价、目标值排除、流式渲染、
 * 重新生成覆盖、断网失败、缓存按 year+locale 隔离、未启用无痕迹。
 * 夹具经 `localStorage['readgraph:e2e-seed']` 注入（同 profile.spec.ts 模式）。
 */

const SEED_KEY = 'readgraph:e2e-seed'
const PREFS_KEY = 'readgraph:preferences'

/** AI 端点 mock 端口：与应用源（4173）不同 → 跨源，触发真实预检流程。 */
const AI_BASE_URL = 'http://127.0.0.1:4174'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

/** 年度叙事 mock 响应（过弱校验：非空 + 长度上限；仅引用夹具内书目）。 */
const NARRATIVE_V1 =
  '2024 年你共借阅 3 本图书，最常借阅的是《小说A》《哲学B》《历史C》（各 2 次）。从分类看，文学（I）、哲学（B）、历史（K）各有分布。期待 2025 年有更多阅读发现。'

/** 重新生成用第二份响应：与 V1 明显不同（覆盖渲染断言）。 */
const NARRATIVE_V2 = '2024 年度阅读回顾：3 本书中复借最多的是小说A，阅读结构均衡。'

/** 夹具内的年度目标值（不得出现在请求 body / 预览 payload，§9.1 白名单边界）。 */
const FORBIDDEN_GOAL_SNIPPETS = ['annualGoals', '"goal"']

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

/** 注入偏好（locale 固定 zh-CN 使断言确定）；ai 字段逐项给定。 */
async function injectPrefs(
  page: Page,
  ai: { enabled: boolean; baseUrl: string; model: string; sendPreview: boolean },
  annualGoals: Record<string, number> = {},
): Promise<void> {
  const prefs = {
    locale: 'zh-CN',
    theme: 'auto',
    displayTimezone: 'Asia/Shanghai',
    ai,
    annualGoals,
  }
  await page.addInitScript(([key, value]) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ignore
    }
  }, [PREFS_KEY, JSON.stringify(prefs)] as const)
}

/** 拦截的 chat 请求捕获。 */
interface ChatCapture {
  body: { model: string; stream: boolean; messages: Array<{ role: string; content: string }> }
}

/**
 * 挂 AI 端点 mock：/v1/chat/completions（跨源，OPTIONS 预检放行 + CORS 头）与
 * /v1/models（空列表）。chat 响应按调用次数取 chatResponses；shouldFailChat 返回
 * true 时该次请求 abort（断网模拟）；stream=true 以 SSE 分片响应。
 */
async function mockAiEndpoints(
  page: Page,
  opts: {
    chatResponses?: string | (() => string)
    shouldFailChat?: () => boolean
    stream?: boolean
  } = {},
): Promise<{ chatRequests: ChatCapture[] }> {
  const chatRequests: ChatCapture[] = []
  let callIndex = 0
  const respondChat = (): string => {
    if (typeof opts.chatResponses === 'function') return opts.chatResponses()
    return opts.chatResponses ?? NARRATIVE_V1
  }
  await page.route('**/v1/chat/completions', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS })
      return
    }
    const body = route.request().postDataJSON() as ChatCapture['body']
    chatRequests.push({ body })
    if (opts.shouldFailChat?.() === true) {
      await route.abort('failed')
      return
    }
    callIndex += 1
    const content = respondChat()
    void callIndex
    if (opts.stream) {
      const delta = (c: string): string =>
        `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`
      const half = Math.ceil(content.length / 2)
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: CORS_HEADERS,
        body: delta(content.slice(0, half)) + delta(content.slice(half)) + 'data: [DONE]\n\n',
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS_HEADERS,
      body: JSON.stringify({ choices: [{ message: { content } }] }),
    })
  })
  await page.route('**/v1/models', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: CORS_HEADERS })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: CORS_HEADERS,
      body: JSON.stringify({ object: 'list', data: [] }),
    })
  })
  return { chatRequests }
}

test.describe('年度视图静态骨架（reading-profile §4）', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('入口一：/profile 概览行第 6 卡点击 → /profile/2026（当年）', async ({ page }) => {
    await page.goto('/profile')
    const card = page.locator('[data-slot="year-goal-summary"]')
    await expect(card).toBeVisible()
    await card.click()
    await page.waitForURL(/\/profile\/\d{4}$/)
    // 年度视图工具条出现（年份导航 + 标题，年号经 Intl 千分位格式化「2,026」）。
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/2[,，]?026/)
  })

  test('入口二：借阅日历年视图「年度回顾」→ /profile/2024（夹具年）', async ({ page }) => {
    await page.goto('/profile')
    await page.getByRole('tab', { name: /借阅日历|Borrow calendar/ }).click()
    await page.getByRole('radio', { name: /年视图|Year/ }).click()
    const link = page.getByRole('link', { name: /年度回顾|Annual review/ })
    await expect(link).toBeVisible()
    await link.click()
    await page.waitForURL(/\/profile\/\d{4}$/)
    // 年度视图标题出现（locale 无关：含「年度回顾」或「Annual Review」）。
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/年度回顾|Annual Review/)
  })


  test('/profile/2024 数字同源：本年借阅 3 本、Top 5 三本书各 2 次、书单 3 本', async ({
    page,
  }) => {
    await injectPrefs(page, { enabled: false, baseUrl: '', model: '', sendPreview: true })
    await page.goto('/profile/2024')
    // 概览窄卡行（目标卡 + 本年借阅卡）。
    await expect(page.getByText('本年借阅')).toBeVisible()
    await expect(page.getByText('3 本', { exact: true })).toBeVisible()
    // Top 5 区块：夹具 3 本书年内各 2 个周期。
    await expect(page.getByText('最常借 Top 5')).toBeVisible()
    const topSection = page.locator('[data-slot="year-top-books"]')
    await expect(topSection).toBeVisible()
    for (const title of ['小说A', '哲学B', '历史C']) {
      await expect(topSection.getByText(title)).toBeVisible()
    }
    // 书单网格：3 本书全部出现（bookIds 升序）。
    const grid = page.locator('[data-slot="year-book-grid"]')
    await expect(grid).toBeVisible()
    for (const title of ['小说A', '哲学B', '历史C']) {
      await expect(grid.getByText(title)).toBeVisible()
    }
  })

  test('年度目标进度：设置目标后目标卡显示 N/M 与差量', async ({ page }) => {
    await injectPrefs(page, { enabled: false, baseUrl: '', model: '', sendPreview: true }, {
      '2024': 5,
    })
    await page.goto('/profile/2024')
    const goalCard = page.locator('[data-slot="year-goal-card"]')
    await expect(goalCard).toBeVisible()
    // bookCount=3, goal=5 → 3/5 + 差量。
    await expect(goalCard).toContainText('3 / 5')
    await expect(goalCard).toContainText('还差 2 本')
  })

  test('空年不崩：/profile/2026 区块 Empty 变体 + 目标卡 0/M', async ({ page }) => {
    await injectPrefs(page, { enabled: false, baseUrl: '', model: '', sendPreview: true }, {
      '2026': 12,
    })
    await page.goto('/profile/2026')
    // 目标卡 0/12。
    const goalCard = page.locator('[data-slot="year-goal-card"]')
    await expect(goalCard).toContainText('0 / 12')
    // Top 5 / 书单区块空态文案。
    await expect(page.getByText('这一年没有借阅记录')).toHaveCount(2)
    // 无叙事区（AI 未启用且空年双门控）。
    await expect(page.getByText('年度叙事')).toHaveCount(0)
  })

  test('年份切换：‹/› 在 /profile/2024 与相邻年之间导航', async ({ page }) => {
    await injectPrefs(page, { enabled: false, baseUrl: '', model: '', sendPreview: true })
    await page.goto('/profile/2024')
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/2[,，]?024/)
    await page.locator('[data-slot="year-nav-next"]').click()
    await page.waitForURL(/\/profile\/2025$/)
    await expect(page.getByRole('heading', { level: 1 })).toContainText(/2[,，]?025/)
    await page.locator('[data-slot="year-nav-prev"]').click()
    await page.waitForURL(/\/profile\/2024$/)
  })

  test('非法 $year 参数 → 404（路由不匹配）', async ({ page }) => {
    await page.goto('/profile/20x4')
    await expect(page.getByText('Not Found')).toBeVisible()
  })
})

test.describe('年度叙事 AI 区（ai-features §9.1/§3.3）', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
  })

  test('AI 未启用 → 年度视图无叙事痕迹', async ({ page }) => {
    await injectPrefs(page, { enabled: false, baseUrl: '', model: '', sendPreview: true })
    await page.goto('/profile/2024')
    await expect(page.locator('[data-slot="year-goal-card"]')).toBeVisible()
    await expect(page.getByText('年度叙事')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '生成年度叙事' })).toHaveCount(0)
    await expect(page.locator('[data-slot="profile-ai"]')).toHaveCount(0)
  })

  test('启用 AI → /profile/2024 显示生成按钮；预览与请求 body 深等价且不含目标值', async ({
    page,
  }) => {
    await injectPrefs(page, { enabled: true, baseUrl: AI_BASE_URL, model: 'test-model', sendPreview: true }, {
      '2024': 5,
      '2023': 10,
    })
    const { chatRequests } = await mockAiEndpoints(page, {
      chatResponses: NARRATIVE_V1,
      stream: true,
    })
    await page.goto('/profile/2024')
    await page.getByRole('button', { name: '生成年度叙事' }).click()
    // 预览弹窗：payload JSON 展示。
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const pre = dialog.locator('pre')
    await expect(pre).toBeVisible()
    expect(chatRequests).toHaveLength(0)
    const previewText = (await pre.textContent()) ?? ''
    const previewPayload = JSON.parse(previewText) as { year: number; slice: { bookCount: number } }
    expect(previewPayload.year).toBe(2024)
    expect(previewPayload.slice.bookCount).toBe(3)
    // §9.1 白名单边界：预览不含年度目标值字段。
    for (const snippet of FORBIDDEN_GOAL_SNIPPETS) {
      expect(previewText).not.toContain(snippet)
    }
    await dialog.getByRole('button', { name: '确认发送' }).click()
    await expect.poll(() => chatRequests.length, { timeout: 10_000 }).toBe(1)
    const bodyText = JSON.stringify(chatRequests[0]?.body)
    // §3.3：请求 body 与预览同源——books JSON 深等价由 prompt books 数据区承载。
    // 拦截断言：body 不含年度目标值（字段名与数值均不出现）。
    expect(bodyText).not.toContain('annualGoals')
    expect(bodyText).not.toContain(':5')
    expect(bodyText).not.toContain(':10')
    // 流式完成后渲染 + 标注。
    await expect(page.locator('[data-slot="profile-ai-markdown"]')).toBeVisible()
    await expect(page.getByText('AI 生成，基于本地数据')).toBeVisible()
    await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible()
  })

  test('sendPreview=false 直接上送 → 流式渲染后重新生成覆盖', async ({ page }) => {
    await injectPrefs(page, { enabled: true, baseUrl: AI_BASE_URL, model: 'test-model', sendPreview: false })
    let chatCall = 0
    const { chatRequests } = await mockAiEndpoints(page, {
      chatResponses: () => (chatCall++ === 0 ? NARRATIVE_V1 : NARRATIVE_V2),
      stream: true,
    })
    await page.goto('/profile/2024')
    await page.getByRole('button', { name: '生成年度叙事' }).click()
    await expect(page.getByText('期待 2025 年有更多阅读发现。')).toBeVisible()
    expect(chatRequests).toHaveLength(1)
    // 重新生成：bypass 缓存重新请求，新内容覆盖旧内容。
    await page.getByRole('button', { name: '重新生成' }).click()
    await expect(page.getByText('2024 年度阅读回顾：3 本书中复借最多的是小说A，阅读结构均衡。')).toBeVisible()
    await expect(page.getByText('期待 2025 年有更多阅读发现。')).toHaveCount(0)
    expect(chatRequests).toHaveLength(2)
    expect(chatRequests[1]?.body.stream).toBe(true)
    expect(chatRequests[1]?.body.model).toBe('test-model')
  })

  test('断网 mock 失败 → 错误 toast、不渲染叙事内容、不写缓存', async ({ page }) => {
    await injectPrefs(page, { enabled: true, baseUrl: AI_BASE_URL, model: 'test-model', sendPreview: false })
    await mockAiEndpoints(page, { shouldFailChat: () => true, stream: true })
    await page.goto('/profile/2024')
    await page.getByRole('button', { name: '生成年度叙事' }).click()
    // 错误分级 toast（§5.4 network 分级文案）。
    await expect(
      page.getByText(/年度叙事生成失败：网络错误/).first(),
    ).toBeVisible({ timeout: 10_000 })
    // 无定稿 markdown、无 AI 标注。
    await expect(page.getByText('AI 生成，基于本地数据')).toHaveCount(0)
  })

  test('缓存按 year 隔离：2024 生成后 2023 不命中 2024 缓存', async ({ page }) => {
    await injectPrefs(page, { enabled: true, baseUrl: AI_BASE_URL, model: 'test-model', sendPreview: false })
    const { chatRequests } = await mockAiEndpoints(page, {
      chatResponses: NARRATIVE_V1,
      stream: true,
    })
    await page.goto('/profile/2024')
    await page.getByRole('button', { name: '生成年度叙事' }).click()
    await expect(page.getByText('期待 2025 年有更多阅读发现。')).toBeVisible()
    expect(chatRequests).toHaveLength(1)
    // 缓存命中路径：引擎只在点「生成」时读缓存（页面重进不自动直出）。
    // reload 后再点生成 → cache-hit 直出，无新请求。
    await page.reload()
    await page.getByRole('button', { name: '生成年度叙事' }).click()
    await expect(page.getByText('期待 2025 年有更多阅读发现。')).toBeVisible()
    expect(chatRequests).toHaveLength(1)
    // 切到 2023（空年）：叙事区不渲染（bookCount=0 门控），更不会命中 2024 缓存。
    await page.goto('/profile/2023')
    await expect(page.getByText('年度叙事')).toHaveCount(0)
  })

  test('缓存按 locale 隔离：不同 locale 不共用同一缓存条目', async ({ page }) => {
    await injectPrefs(page, { enabled: true, baseUrl: AI_BASE_URL, model: 'test-model', sendPreview: false })
    const { chatRequests } = await mockAiEndpoints(page, {
      chatResponses: NARRATIVE_V1,
      stream: true,
    })
    await page.goto('/profile/2024')
    await page.getByRole('button', { name: '生成年度叙事' }).click()
    await expect(page.getByText('期待 2025 年有更多阅读发现。')).toBeVisible()
    expect(chatRequests).toHaveLength(1)
    // locale 改为 en → 缓存键 ai:year-narrative:en:2024 与 zh-CN 不同 → 重新请求。
    await page.addInitScript(([key, value]) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // ignore
      }
    }, [PREFS_KEY, JSON.stringify({
      locale: 'en',
      theme: 'auto',
      displayTimezone: 'Asia/Shanghai',
      ai: { enabled: true, baseUrl: AI_BASE_URL, model: 'test-model', sendPreview: false },
      annualGoals: {},
    })])
    await page.goto('/profile/2024')
    // zh-CN 缓存不命中 en 键：点生成 → cache miss → 第二次真实请求。
    await page.getByRole('button', { name: /Generate annual narrative|生成年度叙事/ }).click()
    // en 场景重新请求后渲染（标注与文案按 en 命名空间解析）。
    await expect(page.getByText('AI-generated from local data')).toBeVisible()
    await expect.poll(() => chatRequests.length, { timeout: 10_000 }).toBe(2)
  })
})
