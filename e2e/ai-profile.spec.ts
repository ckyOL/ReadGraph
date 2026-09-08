import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import http from 'node:http'
import type { AddressInfo } from 'node:net'

import { buildDesensitizedFixture } from './fixtures'

/**
 * AI 阅读画像 E2E（ai-features §7 / §3.3 / §4.1 / §5.3 / §5.4）。
 * 脱敏夹具经 `localStorage['readgraph:e2e-seed']` 注入（同 profile.spec.ts 模式）；
 * AI 偏好经 `readgraph:preferences` 注入（addInitScript 每 page 生效，locale 固定
 * zh-CN 使断言确定）。
 * AI 端点用 page.route 拦截：baseUrl 取应用源之外的回环端口（127.0.0.1:4174）→
 * 跨源 fetch 必带预检（OPTIONS），mock 必须放行并携带 CORS 头（冒烟已确认此坑）；
 * 且 Allow-Headers 须包含 buildHeaders() 实发的归因头 X-Title / HTTP-Referer
 * （漏放行 → 预检失败 → 实际请求被浏览器拦截，2026-09-06~09-08 CI 三用例持续挂）；
 * CSP（build 产物 meta connect-src 含 http://127.0.0.1:* 与 https:）放行该端点。
 */

const SEED_KEY = 'readgraph:e2e-seed'
const PREFS_KEY = 'readgraph:preferences'

/** AI 端点 mock 端口：与应用源（4173）不同 → 跨源，触发真实预检流程。 */
const AI_BASE_URL = 'http://127.0.0.1:4174'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Title, HTTP-Referer',
  'Access-Control-Max-Age': '86400',
}

/** 端点 mock 响应 content（markdown 文本，过弱校验：非空 + 长度上限）。 */
const INSIGHTS_V1 =
  '## 分类偏好\n\n藏书中文学类占比最高，共 2 本。\n\n## 借阅节奏\n\n最近 30 天内借阅了 2 本。\n\n## 一句话总结\n\n整体书单以虚构类为主，风格偏向细腻叙事。'

/** 重新生成用第二份响应：内容与 V1 完全不同（覆盖渲染断言）。 */
const INSIGHTS_V2 =
  '## 分类偏好\n\n历史类书籍借阅次数最多。\n\n## 借阅节奏\n\n全年借阅节奏稳定。\n\n## 一句话总结\n\n书单呈现出对长篇小说体裁的偏好。'

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
    // 确认后恰好一次 chat 请求（流式 + 配置的 model；markdown 文本流无 response_format）。
    await expect.poll(() => chatRequests.length, { timeout: 10_000 }).toBe(1)
    const captured = chatRequests[0]
    expect(captured.body.stream).toBe(true)
    expect(captured.body.model).toBe('test-model')
    expect(captured.body).not.toHaveProperty('response_format')
    // 拦截断言：prompt user content 中的 books 与预览 payload.books 深等价
    // ——同一装配产物（§3.3 防「预览一套、上送一套」漂移）。
    expect(JSON.parse(captured.booksJson)).toEqual(previewPayload.books)
  })

  test('确认生成 → Markdown 渲染（小节标题/正文/总结）+「AI 生成」标注', async ({ page }) => {
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
    // Markdown 单块渲染：小节标题（## → heading）+ 正文 + 一句话总结。
    const markdown = page.locator('[data-slot="profile-ai-markdown"]')
    await expect(markdown).toBeVisible()
    await expect(page.getByRole('heading', { name: '分类偏好' })).toBeVisible()
    await expect(page.getByText('藏书中文学类占比最高，共 2 本。')).toBeVisible()
    await expect(page.getByText('最近 30 天内借阅了 2 本。')).toBeVisible()
    await expect(page.getByRole('heading', { name: '一句话总结' })).toBeVisible()
    await expect(page.getByText('整体书单以虚构类为主，风格偏向细腻叙事。')).toBeVisible()
    // 定稿标注「AI 生成，基于本地数据」（单块 markdown 尾部 ×1）。
    await expect(page.getByText('AI 生成，基于本地数据')).toHaveCount(1)
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
    await expect(page.getByText('藏书中文学类占比最高，共 2 本。')).toBeVisible()
    // 重新生成（§6-4）：按预览开关再次走预览 → 确认 → 第二次请求。
    await page.getByRole('button', { name: '重新生成' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '确认发送' }).click()
    // 新内容渲染、旧内容消失（覆盖，§4.1 整体可重新生成）。
    await expect(page.getByText('历史类书籍借阅次数最多。')).toBeVisible()
    await expect(page.getByText('藏书中文学类占比最高，共 2 本。')).toHaveCount(0)
    await expect(page.getByText('全年借阅节奏稳定。')).toBeVisible()
    expect(chatRequests).toHaveLength(2)
  })

  test('定稿后「复制」：剪贴板写入 markdown 内容 + 已复制 toast', async ({ page }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
    await seed(page)
    await injectAiPrefs(page, {
      enabled: true,
      baseUrl: AI_BASE_URL,
      model: 'test-model',
      sendPreview: false,
    })
    await mockAiEndpoints(page, { chatResponses: INSIGHTS_V1, stream: true })
    await page.goto('/profile')
    await page.getByRole('button', { name: '生成 AI 解读' }).click()
    await expect(page.getByRole('heading', { name: '一句话总结' })).toBeVisible()
    await page.getByRole('button', { name: '复制' }).click()
    await expect(page.getByText('已复制到剪贴板。', { exact: true })).toBeVisible()
    // 剪贴板内容与渲染的 markdown 一致（INSIGHTS_V1 全文）。
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe(INSIGHTS_V1)
  })

  test('流式（chatStream）：请求 body stream:true；SSE 分片响应最终渲染成功（逐字时序归 Vitest）', async ({
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
    // 流式响应完整到达后：markdown 小节与正文全部渲染（与 INSIGHTS_V1 一致）。
    await expect(page.locator('[data-slot="profile-ai-markdown"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: '分类偏好' })).toBeVisible()
    await expect(page.getByText('藏书中文学类占比最高，共 2 本。')).toBeVisible()
    await expect(page.getByText('整体书单以虚构类为主，风格偏向细腻叙事。')).toBeVisible()
    // 请求契约：stream:true（区别于非流式用例的 stream:false）。
    expect(chatRequests).toHaveLength(1)
    expect(chatRequests[0]!.body.stream).toBe(true)
    // 生成后按钮切换为「重新生成」（流式成功定稿路径）。
    await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible()
  })
})
/** 慢速标准 SSE 响应分段：总时长约 2s（每段 250ms），供流式中途断言。 */
const SLOW_PARTS = [
  '## 分类偏好\n\n',
  '藏书中文学类占比最高，共 ',
  '**2**',
  ' 本。\n\n',
  '## 借阅节奏\n\n最近 30 天内借阅了 2 本。\n\n',
  '## 一句话总结\n\n整体书单以虚构类为主，风格偏向细腻叙事。',
]

test.describe('AI 流式渲染：网络到达即渐进显示（ai-features §4.1 逐字）', () => {
  let server: http.Server

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Title, HTTP-Referer',
        })
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      // 客户端中止（停止生成测试）后继续 write 会报错：吞掉避免 crash server。
      res.on('error', () => {})
      let i = 0
      const timer = setInterval(() => {
        if (i >= SLOW_PARTS.length) {
          res.write('data: [DONE]\n\n')
          clearInterval(timer)
          res.end()
          return
        }
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: SLOW_PARTS[i] } }] })}\n\n`)
        i += 1
      }, 250)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    )
  })

  test('流式进行中 markdown 已可见（非骨架屏），定稿后完整', async ({ page }) => {
    const port = (server.address() as AddressInfo).port
    await seed(page)
    await injectAiPrefs(page, {
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'test-model',
      sendPreview: false,
    })
    await page.goto('/profile')
    await page.getByRole('button', { name: '生成 AI 解读' }).click()
    // 首 token 到达即渲染增量文本（骨架屏仅在 TTFB 窗口）。
    await expect(page.locator('[data-slot="profile-ai-markdown"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: '分类偏好' })).toBeVisible()
    // 此刻流仍在进行（增量渲染，而非最终一次性出现）。
    await expect(page.locator('[data-slot="profile-ai"]')).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByText(/正在生成/)).toBeVisible()
    // 打字光标：流式期间内容尾部可见，定稿后消失。
    await expect(page.locator('[data-slot="profile-ai-caret"]')).toBeVisible()
    // 最终完整定稿（busy 归 false、总结小节出现、光标消失）。
    await expect(page.getByRole('heading', { name: '一句话总结' })).toBeVisible()
    await expect(page.getByText('整体书单以虚构类为主，风格偏向细腻叙事。')).toBeVisible()
    await expect(page.locator('[data-slot="profile-ai-caret"]')).toHaveCount(0)
    await expect(page.locator('[data-slot="profile-ai"]')).toHaveAttribute('aria-busy', 'false')
  })

  test('流式中点停止：保留已生成部分、无错误提示、可重新生成', async ({ page }) => {
    const port = (server.address() as AddressInfo).port
    await seed(page)
    await injectAiPrefs(page, {
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'test-model',
      sendPreview: false,
    })
    await page.goto('/profile')
    await page.getByRole('button', { name: '生成 AI 解读' }).click()
    // 首 token 出现后点停止（server 仍在发：SLOW_PARTS 全程约 1.75s）。
    await expect(page.locator('[data-slot="profile-ai-markdown"]')).toBeVisible()
    await page.getByRole('button', { name: '停止生成' }).click()
    // 已生成部分保留为结果展示（小节标题可见），无失败 toast，按钮切回「重新生成」。
    await expect(page.getByRole('heading', { name: '分类偏好' })).toBeVisible()
    await expect(page.getByText(/AI 解读生成失败/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: '重新生成' })).toBeVisible()
  })
})

/** thinking 模式 SSE：先 reasoning_content 段（思考过程），后 content 段（最终 markdown）。 */
test.describe('AI thinking 渲染（reasoning_content 思考过程，ai-features §4.1）', () => {
  let server: http.Server

  test.beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Title, HTTP-Referer',
        })
        res.end()
        return
      }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      })
      const reasoning = '先分析分类分布：文学类占比最高。再评估借阅节奏与时长习惯。'
      const content =
        '## 分类偏好\n\n藏书中文学类占比最高，共 2 本。\n\n## 一句话总结\n\n整体书单以虚构类为主。'
      const parts = [
        JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning.slice(0, 8) } }] }),
        JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning.slice(8, 20) } }] }),
        JSON.stringify({ choices: [{ delta: { reasoning_content: reasoning.slice(20) } }] }),
        JSON.stringify({ choices: [{ delta: { content: content.slice(0, 20) } }] }),
        JSON.stringify({ choices: [{ delta: { content: content.slice(20) } }] }),
      ]
      let i = 0
      const timer = setInterval(() => {
        if (i >= parts.length) {
          res.write('data: [DONE]\n\n')
          clearInterval(timer)
          res.end()
          return
        }
        res.write(`data: ${parts[i]}\n\n`)
        i += 1
      }, 250)
      res.on('error', () => {})
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    )
  })

  test('思考过程灰色块渐进显示，定稿后消失且只留 markdown', async ({ page }) => {
    const port = (server.address() as AddressInfo).port
    await seed(page)
    await injectAiPrefs(page, {
      enabled: true,
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'test-model',
      sendPreview: false,
    })
    await page.goto('/profile')
    await page.getByRole('button', { name: '生成 AI 解读' }).click()
    // thinking 阶段：思考块出现（默认折叠，仅标题行），流仍在进行。
    const reasoning = page.locator('[data-slot="profile-ai-reasoning"]')
    await expect(reasoning).toBeVisible()
    await expect(reasoning).toContainText('思考过程')
    // 默认折叠：思考内容不在 DOM；点击标题展开后可见（流式增长）。
    await expect(page.getByText('先分析分类分布')).toHaveCount(0)
    await reasoning.getByRole('button').click()
    await expect(page.getByText('先分析分类分布')).toBeVisible()
    await expect(page.locator('[data-slot="profile-ai"]')).toHaveAttribute('aria-busy', 'true')
    // 定稿：思考块消失，仅渲染最终 markdown。
    await expect(page.getByRole('heading', { name: '一句话总结' })).toBeVisible()
    await expect(reasoning).toHaveCount(0)
    await expect(page.locator('[data-slot="profile-ai"]')).toHaveAttribute('aria-busy', 'false')
  })
})
