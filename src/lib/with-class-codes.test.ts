// 分类索引读路径自愈：backfillClassCodes 失败后存量记录缺 classCodes 索引字段，
// 已物化到内存的记录（toArray → map）读取侧一次派生补回——缺字段派生、已有字段
// 原样保留、全有字段零分配。派生逻辑与写路径共用 deriveClassCodes（单一事实来源）。
import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import type { ReadGraphDB } from '@/db/db'
import { createTestDB, closeTestDB, makeBook, makeCatalog, makeSource } from '@/db/test-helpers'
import { withClassCodes, withClassCodesAll } from '@/lib/with-class-codes'
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

/** 直接表写入（绕过 repository），模拟回填失败后存量记录缺 classCodes 字段。 */
async function seedMissingClassCodes(): Promise<void> {
  const srcId = 'src-sz'
  await db.sources.put(makeSource(srcId))
  await db.books.put(makeBook('b1', '9787000000001', 'T'))
  await db.catalogRecords.put(
    makeCatalog('cr1', 'b1', srcId, 'BC1', 'K1', [{ system: 'clc', code: 'TP312' }]),
  )
  await db.catalogRecords.put(
    makeCatalog('cr2', 'b1', srcId, 'BC2', 'K2', [{ system: 'clc', code: 'J218.2' }]),
  )
}

describe('withClassCodesAll（读路径自愈，接线与 library/index 同式）', () => {
  it('回填失败后 toArray 读出的记录经读路径归一补 classCodes，不崩', async () => {
    await seedMissingClassCodes()
    expect(await db.catalogRecords.get('cr1')).not.toHaveProperty('classCodes')

    const records = await db.catalogRecords.toArray().then(withClassCodesAll)

    expect(records[0]!.classCodes).toEqual(['TP312'])
    expect(records[1]!.classCodes).toEqual(['J218.2'])
    // 其余字段原样（浅拷贝派生，不丢数据）。
    expect(records[0]!.barcodes).toEqual(['BC1'])
    expect(records[0]!.classifications[0]!.code).toBe('TP312')
  })

  it('混存：缺字段记录派生，已有 classCodes 记录原样保留', async () => {
    await seedMissingClassCodes()
    await db.catalogRecords.put({
      ...makeCatalog('cr3', 'b1', 'src-sz', 'BC3', 'K3', [{ system: 'clc', code: 'I247.5' }]),
      classCodes: ['I247.5'],
    } as WithClassCodes)

    const records = await db.catalogRecords.toArray().then(withClassCodesAll)

    expect(records).toHaveLength(3)
    expect(records.every((r) => Array.isArray(r.classCodes))).toBe(true)
    const cr3 = records.find((r) => r.id === 'cr3')!
    expect(cr3.classCodes).toEqual(['I247.5'])
  })

  it('全有 classCodes 时返回原数组引用（零分配）', async () => {
    await seedMissingClassCodes()
    const healed = await db.catalogRecords.toArray().then(withClassCodesAll)
    const again = withClassCodesAll(healed)
    expect(again).toBe(healed)
  })
})

describe('withClassCodes（单条）', () => {
  it('缺失 → 派生（新引用）；已有字段 → 原引用零分配', () => {
    const missing = makeCatalog('cr1', 'b1', 'src-sz', 'BC1', 'K1', [
      { system: 'clc', code: 'TP312' },
    ])
    const healed = withClassCodes(missing)
    expect(healed.classCodes).toEqual(['TP312'])
    expect(healed).not.toBe(missing)
    // 已有字段不重复派生：原引用返回。
    expect(withClassCodes(healed)).toBe(healed)
  })
})
