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
  // 构建期常量测试直连语义（与 build/preview 一致）：__AI_DEV_PROXY__=false → 直连；
  // __DEBUG_MODE__=false（debug-mode spec §8）→ 测 debug 行为用
  // vi.stubGlobal('__DEBUG_MODE__', true) 切换（先例 ai-client.test.ts）。
  define: {
    __AI_DEV_PROXY__: JSON.stringify(false),
    __DEBUG_MODE__: JSON.stringify(false),
  },
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
    environment: 'node',
  },
})
