import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { db } from './db/db-instance'
import { backfillClassCodes } from './db/backfill-class-codes'
import { maybeSeedFromE2E } from './db/e2e-seed'

// 存量 classCodes 字段回填（幂等，缺失才写；否则 treemap 下钻等索引查询失效）。
// 顺序执行：先完成 E2E seed 的清库/灌库，避免回填把 seed 清掉的旧记录写回。
void maybeSeedFromE2E().then(() => {
  return backfillClassCodes(db).catch(() => {})
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
