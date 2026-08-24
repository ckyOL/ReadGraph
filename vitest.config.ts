import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // AI dev 同源代理开关（vite.config.ts aiDevProxyPlugin）：测试走直连语义（与 build/preview 一致）。
  define: {
    __AI_DEV_PROXY__: JSON.stringify(false),
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
})
