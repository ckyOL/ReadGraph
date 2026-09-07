import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { db } from './db/db-instance'
import { runStartupBackfills } from './db/startup-backfills'
import { maybeSeedFromE2E } from './db/e2e-seed'
// dev-only 调试钩子（debug-mode spec §3.2）：直引 __DEBUG_MODE__（define 构建
// 期静态替换，同 ai-client.ts __AI_DEV_PROXY__ 先例）——生产构建 if(false) 被
// minifier 剔除，trace-log 模块整体摇树（US4 产物零残留）；测试环境
// vi.stubGlobal('__DEBUG_MODE__') 可切换（debug.test.ts 同语义）。
declare const __DEBUG_MODE__: boolean
import { installDebugHooks } from './import/trace-log'

if (__DEBUG_MODE__) installDebugHooks()

// 存量回填（幂等，缺失才写）：classCodes 派生字段 + 借阅周期状态归一 +
// 设备材料类型（device-borrows 规格 §6）。
// 顺序执行：先完成 E2E seed 的清库/灌库，避免回填把 seed 清掉的旧记录写回。
// 失败不阻断启动（H-5）：runStartupBackfills 内逐项 console.error 保留诊断；
// classCodes 回填失败的缺口由读取侧 withClassCodes 自愈（内存物化路径）。
void maybeSeedFromE2E().then(() => runStartupBackfills(db))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
