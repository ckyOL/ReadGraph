import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tanRouterPlugin from '@tanstack/router-plugin/vite'
import { fileURLToPath, URL } from 'node:url'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    cspMetaPlugin(),
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
