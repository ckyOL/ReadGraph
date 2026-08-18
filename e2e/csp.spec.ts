import { test, expect } from '@playwright/test'

/**
 * 阶段 5 E2E（SEC-1，docs/tasks/quality-hardening.md §阶段5）：
 * (a) 生产构建响应 HTML 携带 CSP meta（default-src/script-src 'self' 等）；
 * (b) 主流程无 CSP violation——「主流程代理」：大数据导入 Worker 路径不在 e2e 覆盖，
 *     但 Worker（import-worker/stats-worker）经 Vite 产出独立同源文件，由
 *     script-src 'self' 兜底（worker-src 未声明时回退 script-src），无需 worker-src。
 * 注意：CSP meta 仅 build 注入（vite 插件 apply:'build'）；dev 模式不注入，本 spec
 * 只面向 webServer 的生产 preview（端口 4173）。
 */

test.describe('CSP (SEC-1)', () => {
  /** Vite 序列化会把属性值中的 ' 转义为 &#39;（浏览器解析时还原）；断言前先解码。 */
  const decodeHtmlEntities = (s: string) =>
    s.replace(/&(amp|quot|#39);/g, (m) => (m === '&amp;' ? '&' : m === '&quot;' ? '"' : "'"))

  test('production HTML includes CSP meta with self-only script default', async ({ request }) => {
    const res = await request.get('/')
    expect(res.ok()).toBeTruthy()
    const html = await res.text()
    const meta = html.match(/<meta[^>]*http-equiv="Content-Security-Policy"[^>]*>/)
    expect(meta).not.toBeNull()
    // 逐字 CSP 字符串的两个关键指令（default-src / script-src 'self'）。
    const content = decodeHtmlEntities(meta![0])
    expect(content).toContain("default-src 'self'")
    expect(content).toContain("script-src 'self'")
  })

  test('main flow has no CSP violations', async ({ page }) => {
    const violations: string[] = []
    page.on('console', (msg) => {
      if (msg.type() === 'error' && /Content Security Policy|Refused to/i.test(msg.text())) {
        violations.push(msg.text())
      }
    })

    // 主流程代理：首页（仪表盘）→ 书库列表 → 画像页 → 设置页。
    for (const path of ['/', '/library', '/profile', '/settings']) {
      await page.goto(path)
      // 等待网络空闲（无后台轮询；OPAC 补全仅在用户触发时发起）。
      await page.waitForLoadState('networkidle')
      // 路由内容就绪标记：AppShell 常驻侧栏可见。
      await expect(page.locator('[data-slot="sidebar"]')).toBeVisible()
    }
    expect(violations).toEqual([])
  })
})
