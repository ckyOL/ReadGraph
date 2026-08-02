// 存量借阅周期状态回填单测：'unknown'+returnedAt=null 且为 lane 最新周期时
// 归一为 'borrowed'；连续两次借出的旧周期、半闭合纯还回周期保持 'unknown'；
// 幂等。
import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import type { ReadGraphDB } from '@/db/db'
import { backfillBorrowStatus } from '@/db/backfill-borrow-status'
import {
  createTestDB,
  closeTestDB,
  makeCycle,
} from '@/db/test-helpers'
import type { BorrowCycle } from '@/types/entities'

let db: ReadGraphDB
beforeEach(() => {
  db = createTestDB()
})
afterEach(async () => {
  await closeTestDB(db)
})

const U = (isoUtc: string) => new Date(isoUtc)

/** unknown 状态周期：makeCycle 只产出 borrowed/returned，此处覆写。 */
function makeUnknown(
  id: string,
  bookId: string,
  borrowedAt: Date,
  barcode: string | null = 'BC1',
  returnedAt: Date | null = null,
): BorrowCycle {
  return {
    ...makeCycle(id, bookId, 'src-sz', borrowedAt, 'borrowed', barcode),
    status: 'unknown' as const,
    returnedAt,
  }
}

describe('backfillBorrowStatus', () => {
  it('lane 最新且 returnedAt=null 的 unknown 周期归一为 borrowed，其余不动', async () => {
    // lane b1:BC1 —— 最新开放周期，应转 borrowed。
    await db.borrowCycles.put(makeUnknown('cy1', 'b1', U('2026-01-01T00:00:00Z')))
    // lane b2:BC1 —— unknown 开放，但其后有更晚周期（连续两次借出），保持 unknown。
    await db.borrowCycles.put(makeUnknown('cy2', 'b2', U('2026-02-01T00:00:00Z')))
    await db.borrowCycles.put(makeCycle('cy3', 'b2', 'src-sz', U('2026-03-01T00:00:00Z'), 'returned'))
    // lane b3:BC1 —— 半闭合纯还回（returnedAt 非空），保持 unknown。
    await db.borrowCycles.put(
      makeUnknown('cy4', 'b3', U('2026-04-01T00:00:00Z'), 'BC1', U('2026-04-02T00:00:00Z')),
    )
    // lane b4:BC1 —— 已是 borrowed，不动。
    await db.borrowCycles.put(makeCycle('cy5', 'b4', 'src-sz', U('2026-05-01T00:00:00Z'), 'borrowed'))
    // lane b5:BC1 —— 另一条最新开放周期，一并转。
    await db.borrowCycles.put(makeUnknown('cy6', 'b5', U('2026-06-01T00:00:00Z')))

    const n = await backfillBorrowStatus(db)

    expect(n).toBe(2)
    expect((await db.borrowCycles.get('cy1'))!.status).toBe('borrowed')
    expect((await db.borrowCycles.get('cy6'))!.status).toBe('borrowed')
    expect((await db.borrowCycles.get('cy2'))!.status).toBe('unknown')
    expect((await db.borrowCycles.get('cy4'))!.status).toBe('unknown')
    expect((await db.borrowCycles.get('cy5'))!.status).toBe('borrowed')
    expect((await db.borrowCycles.get('cy3'))!.status).toBe('returned')
  })

  it('无 barcode 的开放周期同样按 lane（bookId:__noBarcode__）归一', async () => {
    await db.borrowCycles.put(makeUnknown('cy1', 'b1', U('2026-01-01T00:00:00Z'), null))
    const n = await backfillBorrowStatus(db)
    expect(n).toBe(1)
    expect((await db.borrowCycles.get('cy1'))!.status).toBe('borrowed')
  })

  it('幂等：无候选时返回 0 且不改写', async () => {
    await db.borrowCycles.put(makeUnknown('cy1', 'b1', U('2026-01-01T00:00:00Z')))
    await backfillBorrowStatus(db)
    const afterFirst = await db.borrowCycles.toArray()

    const n = await backfillBorrowStatus(db)

    expect(n).toBe(0)
    expect(await db.borrowCycles.toArray()).toEqual(afterFirst)
  })
})
