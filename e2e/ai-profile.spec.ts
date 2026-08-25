import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { buildDesensitizedFixture } from './fixtures'

/**
 * AI 阅读画像 E2E（ai-features §7 / §3.3 / §4.1 / §5.3 / §5.4）。
 * 脱敏夹具经 `localStorage['readgraph:e2e-seed']` 注入（同 profile.spec.ts 模式）；
 * AI 偏好经 `readgraph:preferences` 注入（addInitScript 每 page 生效，locale 固定
 * zh-CN 使断言确定）。
 * AI 端点用 page.route 拦截：baseUrl 取应用源之外的回环端口（127.0.0.1:4174）→
 * 跨源 fetch 必带预检（OPTIONS），mock 必须放行并携带 CORS 头（冒烟已确认此坑）；
 * CSP（build 产物 meta connect-src 含 http://127.0.0.1:* 与 https:）放行该端点。
 */

const SEED_KEY = 'readgraph:e2e-seed'
const PREFS_KEY = 'readgraph:preferences'

/** AI 端点 mock 端口：与应用源（4173）不同 → 跨源，触发真实预检流程。 */
const AI_BASE_URL = 'http://127.0.0.1:4174'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
}

/** 端点 mock 响应 content（过 profileInsightsSchema：2–4 条、taste ≤ 1）。 */
const INSIGHTS_V1 = JSON.stringify({
  insights: [
    {
      kind: 'fact',
      title: '偏爱文学类',
      body: '藏书中文学类占比最高，共 2 本。',
      dimension: 'classification',
    },
    { kind: 'fact', body: '最近 30 天内借阅了 2 本。', dimension: 'volume' },
    { kind: 'taste', body: '整体书单以虚构类为主，风格偏向细腻叙事。' },
  ],
})

/** 重新生成用第二份响应：内容与 V1 完全不同（覆盖渲染断言）。 */
const INSIGHTS_V2 = JSON.stringify({
  insights: [
    {
      kind: 'fact',
      title: '偏爱历史类',
      body: '历史类书籍借阅次数最多。',
      dimension: 'classification',
    },
    { kind: 'fact', body: '全年借阅节奏稳定。', dimension: 'duration' },
    { kind: 'taste', body: '书单呈现出对长篇小说体裁的偏好。' },
  ],
})

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

/** 注入 AI 偏好（readgraph:preferences）：locale 固定 zh-CN，ai 字段逐项给定。 */
async function injectAiPrefs(
  page: Page,
  ai: { enabled: boolean; baseUrl: string; model: string; sendPreview: boolean },
): Promise<void> {
  const prefs = { locale: 'zh-CN', theme: 'auto', displayTimezone: 'Asia/Shanghai', ai }
  await page.addInitScript(([key, value]) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      // ignore
    }
  }, [PREFS_KEY, JSON.stringify(prefs)] as const)
}

/** 拦截的 chat 请求捕获：body + prompt user content 中的 books JSON 提取。 */
interface ChatCapture {
  body: { model: string; stream: boolean; messages: Array<{ role: string; content: string }> }
  booksJson: string
}

/**
 * 挂 AI 端点 mock：/v1/chat/completions（跨源，OPTIONS 预检放行 + CORS 头）与
 * /v1/models（空列表）。chat 响应按调用次数取 chatResponses（函数或数组，越界回退
 * INSIGHTS_V1）；shouldFailChat 返回 true 时该次请求 abort（断网模拟）；
 * stream=true 时以 SSE 分片响应（chatStream 路径：content 拆多段 delta + [DONE]）。
 */

async function mockAiEndpoints(
  page: Page,
  opts: {
    chatResponses?: Array<string> | string | (() => string)
    shouldFailChat?: () => boolean
    /** 以 SSE 流式响应（chatStream 路径）：body 拆为多段 delta + [DONE]。 */
    stream?: boolean
  } = {},
): Promise<{ chatRequests: ChatCapture[] }> {
  const chatRequests: ChatCapture[] = []
  let callIndex = 0
  const respondChat = (): string => {
    if (typeof opts.chatResponses === 'function') return opts.chatResponses()
    if (Array.isArray(opts.chatResponses)) return opts.chatResponses[callIndex] ?? INSIGHTS_V1
    return opts.chatResponses ?? INSIGHTS_V1
  }
  await page.route('**/v1/chat/completions', async (route) => {
    if (route.request().method() === 'OPTIONS') {
      // 跨源预检：放行（缺 CORS 头时浏览器直接拦截实际请求）。
      await route.fulfill({ status: 204, headers: CORS_HEADERS })
      return
    }
    const body = route.request().postDataJSON() as ChatCapture['body']
    const userContent = body.messages.find((m) => m.role === 'user')?.content ?? ''
    // prompt user content（locale zh-CN，prompts 契约）：
    // '…\n— books：书单，每本书仅含…8 个字段 —\n<books JSON>'——取 marker 行后内容。
    const marker = '— books：'
    const markerIdx = userContent.indexOf(marker)
    const booksJson =
      markerIdx >= 0 ? userContent.slice(userContent.indexOf('\n', markerIdx) + 1) : ''
    chatRequests.push({ body, booksJson })
    if (opts.shouldFailChat?.() === true) {
      await route.abort('failed')
      return
    }
    callIndex += 1
    const content = respondChat()
    if (opts.stream) {
      // SSE 分片：content 拆两段 delta 逐步到达 + [DONE] 终止（chatStream 增量路径）。
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

test.describe('AI 阅读画像（ai-features §4.1）', () => {
  test('未启用 AI → /profile 无 AI 区块（无标题、无生成按钮）', async ({ page }) => {
    await seed(page)
    // 显式 ai.enabled=false（§2.1 默认关闭）：全站无 AI 痕迹。
    await injectAiPrefs(page, { enabled: false, baseUrl: '', model: '', sendPreview: true })
    await page.goto('/profile')
    // 画像页已加载（数据注入成功）。
    await expect(page.getByText(/藏书数/).first()).toBeVisible()
    await expect(page.getByText('AI 解读')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '生成 AI 解读' })).toHaveCount(0)
    await expect(page.locator('[data-slot="profile-ai"]')).toHaveCount(0)
  })

  test('启用 AI → /profile 显示「生成 AI 解读」按钮', async ({ page }) => {
    await seed(page)
    await injectAiPrefs(page, {
      enabled: true,
      baseUrl: AI_BASE_URL,
      model: 'test-model',
      sendPreview: true,
    })
    await page.goto('/profile')
    await expect(page.getByText('AI 解读').first()).toBeVisible()
    await expect(page.getByRole('button', { name: '生成 AI 解读' })).toBeVisible()
  })

  test('触发生成 → 预览弹窗展示 payload；确认前无请求；请求 books 与预览 payload 深等价（§3.3）', async ({
    page,
  }) => {
    await seed(page)
    await injectAiPrefs(page, {
      enabled: true,
      baseUrl: AI_BASE_URL,
      model: 'test-model',
      sendPreview: true,
    })
    const { chatRequests } = await mockAiEndpoints(page, {
      chatResponses: INSIGHTS_V1,
      stream: true,
    })
    await page.goto('/profile')
    await page.getByRole('button', { name: '生成 AI 解读' }).click()
    // 预览弹窗（§4.3）：发送预览标题 + 将发送的 payload JSON（<pre>）。
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('发送预览')).toBeVisible()
    const pre = dialog.locator('pre')
    await expect(pre).toBeVisible()
    // 预览门（§3.1 ④）：确认前不发出任何 chat 请求。
    expect(chatRequests).toHaveLength(0)
    // 预览 payload 结构完整（全量书目 books 非空）。
    const previewPayload = JSON.parse((await pre.textContent()) ?? '') as { books: unknown[] }
    expect(previewPayload.books.length).toBeGreaterThan(0)
    await dialog.getByRole('button', { name: '确认发送' }).click()
    // 确认后恰好一次 chat 请求（非流式 + 配置的 model）。
    await expect.poll(() => chatRequests.length, { timeout: 10_000 }).toBe(1)
    const captured = chatRequests[0]
    expect(captured.body.stream).toBe(true)
    expect(captured.body.model).toBe('test-model')
    // 拦截断言：prompt user content 中的 books 与预览 payload.books 深等价
    // ——同一装配产物（§3.3 防「预览一套、上送一套」漂移）。
    expect(JSON.parse(captured.booksJson)).toEqual(previewPayload.books)
  })

  test('确认生成 → fact 卡（title/body/维度 chip）+ taste 段，每条含「AI 生成」标注', async ({
    page,
  }) => {
    await seed(page)
    await injectAiPrefs(page, {
      enabled: true,
      baseUrl: AI_BASE_URL,
      model: 'test-model',
      sendPreview: true,
    })
    const { chatRequests } = await mockAiEndpoints(page, {
      chatResponses: INSIGHTS_V1,
      stream: true,
    })
    await page.goto('/profile')
    await page.getByRole('button', { name: '生成 AI 解读' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认发送' }).click()
    // fact 卡 ×2：title + body + 维度 chip（引用定位，命中图表 Tabs 值集合 → 可点击）。
    const factCards = page.locator('[data-slot="profile-ai-fact"]')
    await expect(factCards).toHaveCount(2)
    await expect(page.getByText('偏爱文学类')).toBeVisible()
    await expect(page.getByText('藏书中文学类占比最高，共 2 本。')).toBeVisible()
    await expect(page.getByRole('button', { name: 'classification' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'volume' })).toBeVisible()
    // taste 全宽段 ×1。
    const taste = page.locator('[data-slot="profile-ai-taste"]')
    await expect(taste).toHaveCount(1)
    await expect(page.getByText('整体书单以虚构类为主，风格偏向细腻叙事。')).toBeVisible()
    // 每条标注「AI 生成，基于本地数据」（fact×2 + taste×1）。
    await expect(page.getByText('AI 生成，基于本地数据')).toHaveCount(3)
    // 生成后按钮切换为「重新生成」。
    await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible()
    expect(chatRequests).toHaveLength(1)
  })

  test('重新生成 → 再次预览并重新请求，新结果覆盖旧渲染', async ({ page }) => {
    await seed(page)
    await injectAiPrefs(page, {
      enabled: true,
      baseUrl: AI_BASE_URL,
      model: 'test-model',
      sendPreview: true,
    })
    let chatCall = 0
    const { chatRequests } = await mockAiEndpoints(page, {
      chatResponses: () => (chatCall++ === 0 ? INSIGHTS_V1 : INSIGHTS_V2),
      stream: true,
    })
    await page.goto('/profile')
    await page.getByRole('button', { name: '生成 AI 解读' }).click()
    await page.getByRole('dialog').getByRole('button', { name: '确认发送' }).click()
    await expect(page.getByText('偏爱文学类')).toBeVisible()
    // 重新生成（§6-4）：按预览开关再次走预览 → 确认 → 第二次请求。
    await page.getByRole('button', { name: '重新生成' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '确认发送' }).click()
    // 新内容渲染、旧内容消失（覆盖，§4.1 整体可重新生成）。
    await expect(page.getByText('偏爱历史类')).toBeVisible()
    await expect(page.getByText('偏爱文学类')).toHaveCount(0)
    await expect(page.getByText('历史类书籍借阅次数最多。')).toBeVisible()
    expect(chatRequests).toHaveLength(2)
  })

  test('流式（chatStream）：请求 body stream:true；SSE 分片响应最终渲染成功（条目级时序归 Vitest）', async ({
    page,
  }) => {
    await seed(page)
    // sendPreview=false：直接走上送，最短路径验证流式链路。
    await injectAiPrefs(page, {
      enabled: true,
      baseUrl: AI_BASE_URL,
      model: 'test-model',
      sendPreview: false,
    })
    const { chatRequests } = await mockAiEndpoints(page, {
      chatResponses: INSIGHTS_V1,
      stream: true,
    })
    await page.goto('/profile')
    await page.getByRole('button', { name: '生成 AI 解读' }).click()
    // 流式响应完整到达后：fact 卡 ×2 + taste 段全部渲染（与 INSIGHTS_V1 一致）。
    await expect(page.locator('[data-slot="profile-ai-fact"]')).toHaveCount(2)
    await expect(page.getByText('偏爱文学类')).toBeVisible()
    await expect(page.getByText('藏书中文学类占比最高，共 2 本。')).toBeVisible()
    await expect(page.getByText('整体书单以虚构类为主，风格偏向细腻叙事。')).toBeVisible()
    // 请求契约：stream:true（区别于非流式用例的 stream:false）。
    expect(chatRequests).toHaveLength(1)
    expect(chatRequests[0]!.body.stream).toBe(true)
    // 生成后按钮切换为「重新生成」（流式成功定稿路径）。
    await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible()
  })
})
