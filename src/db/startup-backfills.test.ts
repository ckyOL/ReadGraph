// H-5 启动回填失败可见性：runStartupBackfills 并行执行三回填，任一失败不阻断其余、
// 不抛出；失败原因 console.error 保留诊断（此前 main.tsx 的 .catch(() => {}) 静默吞错，
// classCodes 回填失败时分类视图静默不完整且无任何日志）。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/db/backfill-class-codes', () => ({
  backfillClassCodes: vi.fn(),
}))
vi.mock('@/db/backfill-borrow-status', () => ({
  backfillBorrowStatus: vi.fn(),
}))
vi.mock('@/db/backfill-device-kind', () => ({
  backfillDeviceKind: vi.fn(),
}))

import type { ReadGraphDB } from '@/db/db'
import { backfillClassCodes } from '@/db/backfill-class-codes'
import { backfillBorrowStatus } from '@/db/backfill-borrow-status'
import { backfillDeviceKind } from '@/db/backfill-device-kind'
import { runStartupBackfills } from '@/db/startup-backfills'
import { createTestDB, closeTestDB } from '@/db/test-helpers'

const backfillClassCodesMock = vi.mocked(backfillClassCodes)
const backfillBorrowStatusMock = vi.mocked(backfillBorrowStatus)
const backfillDeviceKindMock = vi.mocked(backfillDeviceKind)

let db: ReadGraphDB
beforeEach(() => {
  db = createTestDB()
  backfillClassCodesMock.mockReset()
  backfillBorrowStatusMock.mockReset()
  backfillDeviceKindMock.mockReset()
})
afterEach(async () => {
  await closeTestDB(db)
  vi.restoreAllMocks()
})

describe('runStartupBackfills', () => {
  it('回填失败：console.error 记录且不抛出、不阻断其余回填', async () => {
    const boom = new Error('dexie write failed')
    backfillClassCodesMock.mockRejectedValue(boom)
    backfillBorrowStatusMock.mockResolvedValue(1)
    backfillDeviceKindMock.mockResolvedValue(2)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runStartupBackfills(db)).resolves.toBeUndefined()

    expect(errorSpy).toHaveBeenCalledWith('backfillClassCodes failed', boom)
    // 失败不阻断：其余回填照常执行且收到 db 句柄。
    expect(backfillBorrowStatusMock).toHaveBeenCalledWith(db)
    expect(backfillDeviceKindMock).toHaveBeenCalledWith(db)
  })

  it('全部成功：无 console.error', async () => {
    backfillClassCodesMock.mockResolvedValue(3)
    backfillBorrowStatusMock.mockResolvedValue(1)
    backfillDeviceKindMock.mockResolvedValue(0)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(runStartupBackfills(db)).resolves.toBeUndefined()

    expect(errorSpy).not.toHaveBeenCalled()
  })
})
