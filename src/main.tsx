import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import { RouterProvider } from '@tanstack/react-router'
import { router } from './router'
import { db } from './db/db-instance'
import { backfillClassCodes } from './db/backfill-class-codes'
import { backfillBorrowStatus } from './db/backfill-borrow-status'
import { backfillDeviceKind } from './db/backfill-device-kind'
import { maybeSeedFromE2E } from './db/e2e-seed'

// 存量回填（幂等，缺失才写）：classCodes 派生字段 + 借阅周期状态归一 +
// 设备材料类型（device-borrows 规格 §6）。
// 顺序执行：先完成 E2E seed 的清库/灌库，避免回填把 seed 清掉的旧记录写回。
void maybeSeedFromE2E().then(() => {
  return Promise.all([
    backfillClassCodes(db).catch(() => {}),
    backfillBorrowStatus(db).catch(() => {}),
    backfillDeviceKind(db).catch(() => {}),
  ])
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
