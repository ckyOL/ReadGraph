// szlib provider metaId 反查键判定测试（opac-enrichment §12）。
// metaId 空/0 语义（0、'0'、null、undefined、'' 均无效）在 metaIdIsEmpty 单点收口，
// provider 的 detailUrl/fetchDetail 均复用——字符串 '0'（导入形态）不得发请求（R4）。
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeBook, makeCatalog } from '@/db/test-helpers'
import { metaIdIsEmpty, szlibProvider } from '@/enrich/providers/szlib'

const record = (metaId: string | number | null) =>
  makeCatalog('cr-1', 'bk-1', 'src-szlib', 'BC1', metaId)
const book = makeBook('bk-1', null, '合成绘本甲')

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('metaIdIsEmpty', () => {
  it.each([0, '0', null, undefined, ''] as const)('无效值 %j → true', (v) => {
    expect(metaIdIsEmpty(v)).toBe(true)
  })

  it.each([6092919, '6092919', 1, 'abc'] as const)('有效值 %j → false', (v) => {
    expect(metaIdIsEmpty(v)).toBe(false)
  })
})

describe('szlibProvider metaId 反查键判定（复用 metaIdIsEmpty）', () => {
  it('metaId 字符串 "0" → detailUrl 返回 null（不产出外链）', () => {
    expect(szlibProvider.detailUrl(record('0'), book)).toBeNull()
  })

  it('metaId 字符串 "0" → fetchDetail 直接 not_found，不发请求', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('metaId "0" 不应触发抓取请求')
    })
    vi.stubGlobal('fetch', fetchFn)
    const res = await szlibProvider.fetchDetail(record('0'), book, { timeoutMs: 1000 })
    expect(res).toEqual({ ok: false, reason: 'not_found' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('有效 metaId → detailUrl 含 recordid（正常形态不受影响）', () => {
    expect(szlibProvider.detailUrl(record(6092919), book)).toContain('recordid=6092919')
  })
})
