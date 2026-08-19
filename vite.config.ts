import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tanRouterPlugin from '@tanstack/router-plugin/vite'
import { fileURLToPath, URL } from 'node:url'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * SEC-1 CSP meta 注入（docs/tasks/quality-hardening.md §阶段5 SEC-1）：
 * - 仅 build 注入（apply: 'build'）：dev 不注入——Vite/plugin-react 有内联脚本，注入即坏。
 * - style-src 'unsafe-inline' 为 ECharts/Radix 内联样式保留。
 * - frame-ancestors 经 meta 无效——自有托管须加 `X-Frame-Options: DENY` header（部署清单记录）。
 * - Worker（import-worker/stats-worker）经 Vite 产出独立同源文件，由 script-src 'self' 兜底
 *   （worker-src 未声明时回退 script-src），无需 worker-src。
 */
const CSP_META_CONTENT =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://www.szlib.org.cn; font-src 'self'; object-src 'none'; base-uri 'self'"

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    cspMetaPlugin(),
    inlineEntryCssPlugin(),
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
})
