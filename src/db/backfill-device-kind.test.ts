// 存量设备材料类型回填单测（device-borrows 规格 §6）：
// rawRecords 保留 szlib 原始行（含 cirtype），凡 cirtype='电子设备外借' 且
// bookId 非空的原始记录 → 其 Book 置 materialType='device'；幂等。
import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import type { ReadGraphDB } from '@/db/db'
import { backfillDeviceKind } from '@/db/backfill-device-kind'
import {
  createTestDB,
  closeTestDB,
  makeBook,
  makeRawRecord,
} from '@/db/test-helpers'

let db: ReadGraphDB
beforeEach(() => {
  db = createTestDB()
})
afterEach(async () => {
  await closeTestDB(db)
})

/** 设备流通记录（cirtype=电子设备外借），对照 szlib-202604.json 脱敏设备行。 */
function deviceRaw(
  id: string,
  bookId: string,
  over: Record<string, unknown> = {},
) {
  return {
    ...makeRawRecord(id),
    bookId,
    data: {
      date: '20260411',
      time: '16:25:29',
      optype: '读者借出',
      cirtype: '电子设备外借',
      metatable: 'bibliosm',
      metaid: 5952182,
      title: '合成书目036/ 合成著者36著',
      ISBN: '',
      addr: '合成馆16自助借还机',
      barcode: '04400790006607',
      callno: 'TP368.3/168',
      ...over,
    },
  }
}

describe('backfillDeviceKind', () => {
  it('设备 rawRecords 对应 Book 置 materialType=device，其余不动', async () => {
    await db.books.put(makeBook('bk-dev', null, '合成书目036'))
    await db.books.put(makeBook('bk-other', '9787111111111', '普通书'))
    await db.rawRecords.put(deviceRaw('r1', 'bk-dev'))

    const n = await backfillDeviceKind(db)

    expect(n).toBe(1)
    expect((await db.books.get('bk-dev'))!.materialType).toBe('device')
    expect((await db.books.get('bk-other'))!.materialType).toBe('book')
  })

  it('幂等：已置标后二次调用返回 0', async () => {
    await db.books.put(makeBook('bk-dev', null, '合成书目036'))
    await db.rawRecords.put(deviceRaw('r1', 'bk-dev'))

    await backfillDeviceKind(db)
    const afterFirst = await db.books.toArray()
    const n = await backfillDeviceKind(db)

    expect(n).toBe(0)
    expect(await db.books.toArray()).toEqual(afterFirst)
  })

  it('非设备 cirtype / bookId 为空的记录不触发置标', async () => {
    await db.books.put(makeBook('bk-a', null, '甲书'))
    await db.books.put(makeBook('bk-b', null, '乙书'))
    await db.rawRecords.put(
      deviceRaw('r1', 'bk-a', { cirtype: '中文图书外借' }),
    )
    await db.rawRecords.put({
      ...deviceRaw('r2', 'bk-b'),
      bookId: null,
    })

    const n = await backfillDeviceKind(db)

    expect(n).toBe(0)
    expect((await db.books.get('bk-a'))!.materialType).toBe('book')
    expect((await db.books.get('bk-b'))!.materialType).toBe('book')
  })

  it('无候选（无 rawRecords）返回 0', async () => {
    const n = await backfillDeviceKind(db)
    expect(n).toBe(0)
  })
})
