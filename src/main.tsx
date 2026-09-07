import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { db } from './db/db-instance'
import { runStartupBackfills } from './db/startup-backfills'
import { maybeSeedFromE2E } from './db/e2e-seed'
// dev-only 调试钩子（debug-mode spec §3.2）：函数内部 isDebugMode() 自门控，
// 生产构建不挂载、不渲染任何内容；import 决策 console 输出在 trace-log 内自门控。
import { installDebugHooks } from './import/trace-log'

installDebugHooks()

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
