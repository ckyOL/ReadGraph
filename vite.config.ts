import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tanRouterPlugin from '@tanstack/router-plugin/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * SEC-1 CSP meta 注入（docs/tasks/quality-hardening.md §阶段5 SEC-1）：
 * - 仅 build 注入（apply: 'build'）：dev 不注入——Vite/plugin-react 有内联脚本，注入即坏。
 * - style-src 'unsafe-inline' 为 ECharts/Radix 内联样式保留。
 * - frame-ancestors 经 meta 无效——自有托管须加 `X-Frame-Options: DENY` header（部署清单记录）。
 * - connect-src 放宽面（AI 功能规格 docs/specs/ai-features.md §5.2）：BYOK 任意云端端点构建期
 *   静态化无法按用户配置动态放行，故放行 `https:`（任意 https 端点）+ `http://127.0.0.1:*`
 *   （Phase 3 本地服务回环路径）。数据只在用户显式启用 AI 并触发功能时发送；保守用户可
 *   自托管 header 收紧（CSP meta 可被响应头策略覆盖收紧）。
 */
const CSP_META_CONTENT =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://www.szlib.org.cn https: http://127.0.0.1:*; font-src 'self'; object-src 'none'; base-uri 'self'"

function cspMetaPlugin(): Plugin {
  return {
    name: 'inject-csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: {
            'http-equiv': 'Content-Security-Policy',
            content: CSP_META_CONTENT,
          },
          // head 最前：策略尽早生效。
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

/**
 * P-1 入口 CSS 内联（docs/tasks/quality-hardening.md §阶段5 衍生 P-1）：
 * 首屏 CSS（Tailwind 86KB raw / 14KB gz）是 render-blocking 关键请求，独立请求在
 * Fast 3G 下增加 RTT + 传输往返（Lighthouse render-blocking 浪费 ~870ms）。
 * 内联进 HTML `<style>` 消除该关键请求——CSP `style-src 'unsafe-inline'` 已允许
 * （ECharts/Radix 内联样式同源）。仅 build 生效；watch 重建幂等（每次匹配当前
 * stylesheet link 替换）。独立 CSS 产物文件保留（无害，HTML 不再引用）。
 */
function inlineEntryCssPlugin(): Plugin {
  return {
    name: 'inline-entry-css',
    apply: 'build',
    closeBundle() {
      const htmlPath = path.resolve('dist/index.html')
      const html = readFileSync(htmlPath, 'utf8')
      const linkRe = /<link[^>]*rel="stylesheet"[^>]*>/i
      const m = html.match(linkRe)
      if (!m) return
      const hrefMatch = /href="([^"]+)"/.exec(m[0])
      if (!hrefMatch) return
      const cssPath = path.resolve('dist', hrefMatch[1]!.replace(/^\//, ''))
      const css = readFileSync(cssPath, 'utf8')
      const inlined = html.replace(m[0], `<style data-inlined="entry-css">${css}</style>`)
      writeFileSync(htmlPath, inlined)
    },
  }
}

/**
 * AI dev 同源代理（ai-features §5.4/§8）：`pnpm dev` 下把 AI 端点请求经 Vite dev server
/**
 * AI dev 同源代理（ai-features §5.4/§8）：`pnpm dev` 下把 AI 端点请求经 Vite dev server
 * 转发，同源消除 CORS——用户 BYOK 任意云端端点（构建期无法静态化 server.proxy target，
 * 故不沿用 OPAC 固定 target 写法）。请求形如 `/__ai-proxy/<encodeURIComponent(完整 URL)>`；
 * 仅放行 https 与 http 回环地址（拒绝任意 http 内网目标）；上游失败中断连接 → 浏览器
 * fetch 抛 TypeError → 前端归一 AiNetworkError（与直连语义一致）。仅 serve 生效；
 * build/preview/E2E 走直连（E2E 有意用跨源 mock 验证真实 CORS 预检流程）。
 */
const AI_PROXY_PREFIX = '/__ai-proxy/'
const PROXY_HOP_BY_HOP: Record<string, true> = {
  connection: true,
  'keep-alive': true,
  'proxy-authenticate': true,
  'proxy-authorization': true,
  te: true,
  trailer: true,
  'transfer-encoding': true,
  upgrade: true,
  host: true,
  'content-length': true,
}

function aiDevProxyPlugin(): Plugin {
  return {
    name: 'ai-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      // 不用 connect 路径前缀 use（会剥离前缀改写 req.url）：手动匹配保留完整路径。
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next) => {
        if (!req.url?.startsWith(AI_PROXY_PREFIX)) {
          next()
          return
        }
        const raw = decodeURIComponent(req.url.slice(AI_PROXY_PREFIX.length))
        let target: URL
        try {
          target = new URL(raw)
        } catch {
          res.statusCode = 400
          res.end('invalid AI proxy target')
          return
        }
        const isHttps = target.protocol === 'https:'
        const isLoopback =
          target.protocol === 'http:' &&
          ['127.0.0.1', 'localhost', '::1'].includes(target.hostname)
        if (!isHttps && !isLoopback) {
          res.statusCode = 400
          res.end('unsupported AI proxy target')
          return
        }
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string' && !(key in PROXY_HOP_BY_HOP)) headers.set(key, value)
        }
        let body: Buffer | undefined
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          body = Buffer.concat(chunks)
        }
        const controller = new AbortController()
        res.on('close', () => controller.abort())
        try {
          const up = await fetch(target, {
            method: req.method,
            headers,
            body,
            redirect: 'manual',
            signal: controller.signal,
          })
          res.statusCode = up.status
          up.headers.forEach((value, key) => {
            if (!(key in PROXY_HOP_BY_HOP)) res.setHeader(key, value)
          })
          res.end(Buffer.from(await up.arrayBuffer()))
        } catch {
          // 上游不可达：中断连接 → 浏览器 fetch TypeError → AiNetworkError。
          res.destroy()
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // AI dev 代理开关（ai-features §5.4）：仅 `pnpm dev`（mode=development）开启；
  // build/preview/vitest（mode=production/test）注入 false → 前端直连。构建期静态替换。
  define: {
    __AI_DEV_PROXY__: JSON.stringify(mode === 'development'),
  },
  plugins: [
    cspMetaPlugin(),
    inlineEntryCssPlugin(),
    aiDevProxyPlugin(),
    tanRouterPlugin({
      target: 'react',
      autoCodeSplitting: true,
    }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // 端口冲突显性化：被占时直接报错，禁止静默 +1 连错实例（见 docs/ai-agent-workflow-rules.md §4）
    strictPort: true,
    // OPAC 补全（opac-enrichment §8）：szlib JSON 接口无 ACAO 头，dev 下同源代理消除 CORS；
    // 生产静态托管由用户自建反代（文档指引），传输基元/provider 层不动。
    proxy: {
      '/api/opacservice': {
        target: 'https://www.szlib.org.cn',
        changeOrigin: true,
      },
    },
  },
}))
