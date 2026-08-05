import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tanRouterPlugin from '@tanstack/router-plugin/vite'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
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
