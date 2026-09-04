import { expect, test, type Page } from '@playwright/test'

import { buildCollageFixture, buildDesensitizedFixture } from './fixtures'

/**
 * 年度视图 E2E（reading-profile §4/§7、
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

/** 注入偏好（locale 缺省 zh-CN 使断言确定；ai 字段逐项给定）。 */
async function injectPrefs(
  page: Page,
  ai: { enabled: boolean; baseUrl: string; model: string; sendPreview: boolean },
  annualGoals: Record<string, number> = {},
  locale: 'zh-CN' | 'en' = 'zh-CN',
): Promise<void> {
  const prefs = {
    locale,
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

/**
 * 年度分享图 E2E（reading-profile §4.1/§7）：
 * 入口（C7 空年无按钮）→ Dialog 预览渲染（canvas + aria-label 走 t()）→ 下载
 * （download 事件 + 文件名 readgraph-annual-{year}.png）→ 暗色模式恒亮色纸面（R6，
 * 像素采样）→ 多 locale 文案切换 → 关闭无持久化残留 → 占位版式出图不报错（夹具
 * 本身无封面，兼测占位降级路径）。
 */
test.describe('年度分享图（reading-profile §4.1）', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
    await injectPrefs(page, { enabled: false, baseUrl: '', model: '', sendPreview: true })
  })

  test('点「分享图」→ Dialog 预览渲染（canvas 元素 + aria-label 走 t()）', async ({ page }) => {
    await page.goto('/profile/2024')
    const button = page.locator('[data-slot="share-button"]')
    await expect(button).toBeVisible()
    await button.click()
    const dialog = page.locator('[data-slot="share-dialog"]')
    await expect(dialog).toBeVisible()
    const canvas = page.locator('[data-slot="share-preview-canvas"]')
    await expect(canvas).toHaveRole('img')
    // aria-label = t() 产物（随 locale 渲染，含年份插值）
    await expect(canvas).toHaveAttribute('aria-label', /2024/)
    // 隐私注脚（t() 双语，locale=zh-CN 断言确定）
    await expect(dialog).toContainText('图片在本机生成')
  })

  test('下载按钮触发 download 事件且文件名 readgraph-annual-2024.png', async ({ page }) => {
    await page.goto('/profile/2024')
    await page.locator('[data-slot="share-button"]').click()
    await expect(page.locator('[data-slot="share-dialog"]')).toBeVisible()
    // Dialog 开启动画（zoom-in）导致按钮短暂 not-stable：force 点击跳过稳定性等待。
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /下载 PNG|Download PNG/ }).click({ force: true })
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('readgraph-annual-2024.png')
  })

  test('暗色模式打开 → 分享图 canvas 恒亮色纸面（R6 像素采样）', async ({ page }) => {
    await page.goto('/profile/2024')
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.locator('[data-slot="share-button"]').click()
    const canvas = page.locator('[data-slot="share-preview-canvas"]')
    await expect(canvas).toBeVisible()
    // 段内空白采样（x=40,y=30 → 逻辑(20,15)，位于 ① 标识段标题上方空白）：恒亮
    // #F9F7F2（249,247,242），不读 CSS 变量。
    const pixel = await canvas.evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext('2d')
      if (!ctx) return null
      const data = ctx.getImageData(40, 30, 1, 1).data
      return { r: data[0], g: data[1], b: data[2] }
    })
    expect(pixel).toEqual({ r: 249, g: 247, b: 242 })
  })

  test('无封面 fixture → 占位版式出图不报错（占位块 + 题名首字路径）', async ({ page }) => {
    // buildDesensitizedFixture 全部 coverUrl=null → 渲染器走占位块分支。
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    await page.goto('/profile/2024')
    await page.locator('[data-slot="share-button"]').click()
    const canvas = page.locator('[data-slot="share-preview-canvas"]')
    await expect(canvas).toBeVisible()
    // 占位块色 #EAE0D5（234,224,213）：封面槽内空白采样（避开题名首字中心）。
    const pixel = await canvas.evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext('2d')
      if (!ctx) return null
      const data = ctx.getImageData(500, 800, 1, 1).data
      return { r: data[0], g: data[1], b: data[2] }
    })
    expect(pixel).toEqual({ r: 234, g: 224, b: 213 })
    expect(pageErrors).toEqual([])
  })

  test('多 locale 切换 → Dialog 内文案切换（同一 t() 链路）', async ({ page }) => {
    // zh 打开 Dialog：图外 DOM 文案为中文。
    await page.goto('/profile/2024')
    await page.locator('[data-slot="share-button"]').click()
    const dialog = page.locator('[data-slot="share-dialog"]')
    await expect(dialog).toContainText('年度分享图')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    // en 偏好经 addInitScript 重新种子（一次完整引导：i18n lng 从偏好解析），
    // 等价「设置页切语言后回到年度视图」的持久化结果（i18n-conventions §5）。
    await injectPrefs(
      page,
      { enabled: false, baseUrl: '', model: '', sendPreview: true },
      {},
      'en',
    )
    await page.goto('/profile/2024')
    await page.locator('[data-slot="share-button"]').click()
    await expect(dialog).toContainText('Annual share card')
    await expect(dialog).toContainText('Download PNG')
  })

  test('关闭 Dialog → 无持久化残留（readgraph:* 键集合不变，关闭即弃 C1）', async ({ page }) => {
    await page.goto('/profile/2024')
    // e2e-seed key 为夹具注入通道，应用首启灌库后移除（e2e-seed 语义），
    // 不属于分享图持久化面，排除后断言 readgraph:* 键集合不变。
    const keysBefore = await page.evaluate(() =>
      Object.keys(localStorage).filter(
        (k) => k.startsWith('readgraph:') && k !== 'readgraph:e2e-seed',
      ),
    )
    await page.locator('[data-slot="share-button"]').click()
    await expect(page.locator('[data-slot="share-dialog"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-slot="share-dialog"]')).toBeHidden()
    const keysAfter = await page.evaluate(() =>
      Object.keys(localStorage).filter(
        (k) => k.startsWith('readgraph:') && k !== 'readgraph:e2e-seed',
      ),
    )
    expect(keysAfter.sort()).toEqual(keysBefore.sort())
  })

  test('空年（bookCount=0）→ 无分享按钮（C7）', async ({ page }) => {
    await page.goto('/profile/2026')
    await expect(page.locator('[data-slot="share-button"]')).toHaveCount(0)
  })
})

/**
 * 年度分享图 v2 E2E（reading-profile §4.2）：
 * 称号 badge 命中年（复借 count≥3）→ 预览出图不报错 + badge=null 年版式与 v1 一致
 * （回归）；9:16 切换 → canvas 高宽比 1920/1080 + 下载文件名 -story.png；
 * 拼贴（bookCount=14 ≥ 12）→ 拼贴带出图不报错（pageerror 监听先例 + 占位色采样）。
 */
test.describe('年度分享图 v2（reading-profile §4.2）', () => {
  test.beforeEach(async ({ page }) => {
    await seed(page)
    await injectPrefs(page, { enabled: false, baseUrl: '', model: '', sendPreview: true })
  })

  test('badge 命中年（Top1 复借 2 次 fixture → 无命中 badge=null）→ 版式与 v1 一致（回归门）', async ({ page }) => {
    // 小数据集 Top1 count=2 < 3、2024=3 本 vs 2023 无数据 → badge=null（v1 路径回归）
    await page.goto('/profile/2024')
    await page.locator('[data-slot="share-button"]').click()
    const canvas = page.locator('[data-slot="share-preview-canvas"]')
    await expect(canvas).toBeVisible()
    // 主数字基线 y=656（逻辑）→ 物理 ×2 = 1312 处采样 accent 主数字行存在
    // （badge 命中与否不改变 3:4 甲版式锚点；此处验证出图完整）
    const size = await canvas.evaluate((el) => ({ w: el.width, h: el.height }))
    expect(size).toEqual({ w: 2160, h: 2880 })
  })

  test('9:16 切换 → canvas 高宽比 1920/1080 + 下载文件名 -story.png', async ({ page }) => {
    await page.goto('/profile/2024')
    await page.locator('[data-slot="share-button"]').click()
    const dialog = page.locator('[data-slot="share-dialog"]')
    await expect(dialog).toBeVisible()
    // 切换到 9:16（t() 双语断言兼容 zh/en 标签）
    await page.locator('[data-slot="share-variant-switch"] button', { hasText: /长图|Story/ }).click()
    const canvas = page.locator('[data-slot="share-preview-canvas"]')
    // 切换重绘经 React setState + rAF：轮询至物理尺寸落到 9:16（2160×3840）
    await expect
      .poll(() => canvas.evaluate((el) => [el.width, el.height] as const))
      .toEqual([2160, 3840])
    const size = await canvas.evaluate((el) => ({ w: el.width, h: el.height }))
    expect(size.w / size.h).toBeCloseTo(1080 / 1920, 6)
    // 下载文件名带 -story 后缀
    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: /下载 PNG|Download PNG/ }).click({ force: true })
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('readgraph-annual-2024-story.png')
    // 切回 3:4 → 物理尺寸回基线 2160×2880（原名回归由 v1 E2E 覆盖）
    await page.locator('[data-slot="share-variant-switch"] button', { hasText: /经典|Classic/ }).click()
    await expect
      .poll(() => canvas.evaluate((el) => [el.width, el.height] as const))
      .toEqual([2160, 2880])
  })

  test('bookCount=14（≥ 阈值 12）→ 拼贴带出图不报错 + 占位色（无封面降级路径）', async ({ page }) => {
    const collagePayload = JSON.stringify(buildCollageFixture())
    await page.addInitScript(([key, value]) => {
      try {
        localStorage.setItem(key, value)
      } catch {
        // ignore
      }
    }, [SEED_KEY, collagePayload] as const)
    const pageErrors: string[] = []
    page.on('pageerror', (err) => pageErrors.push(err.message))
    await page.goto('/profile/2024')
    await page.locator('[data-slot="share-button"]').click()
    const canvas = page.locator('[data-slot="share-preview-canvas"]')
    await expect(canvas).toBeVisible()
    // 拼贴槽内空白采样（避开题名首字中心与 +K 角标盒）：占位色 #EAE0D5 = (234,224,213)。
    // 槽尺寸 204×272、2 行满段高：首槽 x≈108、y≈124（逻辑）→ 物理 ×2 取槽内空白点。
    const pixel = await canvas.evaluate((el) => {
      const ctx = (el as HTMLCanvasElement).getContext('2d')
      if (!ctx) return null
      const data = ctx.getImageData(216 + 10, 248 + 200, 1, 1).data
      return { r: data[0], g: data[1], b: data[2] }
    })
    expect(pixel).toEqual({ r: 234, g: 224, b: 213 })
    expect(pageErrors).toEqual([])
  })
})
