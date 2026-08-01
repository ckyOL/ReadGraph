// 存量 classCodes 回填单测：缺字段记录补派生、幂等、已有字段不动。
import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import type { ReadGraphDB } from '@/db/db'
import { backfillClassCodes } from '@/db/backfill-class-codes'
import {
  createTestDB,
  closeTestDB,
  makeBook,
  makeCatalog,
  makeSource,
} from '@/db/test-helpers'
import type { CatalogRecord } from '@/types/entities'

/** classCodes 为 schema 外派生字段，测试侧用交集类型访问。 */
type WithClassCodes = CatalogRecord & { classCodes: string[] }

let db: ReadGraphDB
beforeEach(() => {
  db = createTestDB()
})
afterEach(async () => {
  await closeTestDB(db)
})

async function seedRecords(): Promise<void> {
  const srcId = 'src-sz'
  await db.sources.put(makeSource(srcId))
  await db.books.put(makeBook('b1', '9787000000001', 'T'))
  // 直接表写入（绕过 repository），模拟旧写路径产生的缺字段记录。
  await db.catalogRecords.put(
    makeCatalog('cr1', 'b1', srcId, 'BC1', 'K1', [{ system: 'clc', code: 'TP312' }]),
  )
  await db.catalogRecords.put(
    makeCatalog('cr2', 'b1', srcId, 'BC2', 'K2', [{ system: 'clc', code: 'J218.2' }]),
  )
}

describe('backfillClassCodes', () => {
  it('为缺失 classCodes 的记录补派生字段', async () => {
    await seedRecords()
    expect(await db.catalogRecords.get('cr1')).not.toHaveProperty('classCodes')

    const n = await backfillClassCodes(db)

    expect(n).toBe(2)
    const cr1 = (await db.catalogRecords.get('cr1')) as WithClassCodes | undefined
    expect(cr1!.classCodes).toEqual(['TP312'])
    const cr2 = (await db.catalogRecords.get('cr2')) as WithClassCodes | undefined
    expect(cr2!.classCodes).toEqual(['J218.2'])
  })

  it('幂等：无缺失记录时返回 0 且不改写', async () => {
    await seedRecords()
    await backfillClassCodes(db)
    const afterFirst = await db.catalogRecords.toArray()

    const n = await backfillClassCodes(db)

    expect(n).toBe(0)
    expect(await db.catalogRecords.toArray()).toEqual(afterFirst)
  })

  it('已有 classCodes 字段的记录保持原样（含空数组）', async () => {
    await seedRecords()
    // 带字段的记录（模拟已派生数据）。
    const srcId = 'src-sz'
    await db.catalogRecords.put({
      ...makeCatalog('cr3', 'b1', srcId, 'BC3', 'K3', [{ system: 'clc', code: 'I247.5' }]),
      classCodes: ['I247.5'],
    } as WithClassCodes)
    const n = await backfillClassCodes(db)
    expect(n).toBe(2) // 仅 cr1/cr2 缺失
    const cr3 = (await db.catalogRecords.get('cr3')) as WithClassCodes | undefined
    expect(cr3!.classCodes).toEqual(['I247.5'])
  })
})
