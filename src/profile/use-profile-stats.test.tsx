import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { useLiveQuery } from 'dexie-react-hooks'

import { computeProfileStats } from '@/lib/profile-stats'
import type {
  Book,
  BorrowCycle,
  CatalogRecord,
  Source,
} from '@/types/entities'
import {
  makeBook,
  makeCatalog,
  makeCycle,
  makeSource,
} from '@/db/test-helpers'

import {
  useProfileStats,
  WORKER_THRESHOLD,
  type ProfileStatsState,
  type UseProfileStatsOptions,
} from './use-profile-stats'

// dexie-react-hooks 在 node 测试环境无法跑真实 Dexie 订阅，按 H-3 契约 mock
// `useLiveQuery` 为受控返回值；`db` 单例亦以空对象桩避免触发 IndexedDB。
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('@/db/db-instance', () => ({ db: {} }))

const useLiveQueryMock = vi.mocked(useLiveQuery)

// ---- 固定 UTC 时刻的实体夹具（与 profile-stats.test 夹具风格一致） ----
const DAY = 86_400_000
const T0 = new Date('2024-01-10T00:00:00.000Z')

function fixtures(): {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  sources: Source[]
} {
  const src = makeSource('src-sz')
  const b1 = makeBook('b1', '9780000000001', '文学一')
  const b2 = makeBook('b2', '9780000000002', '历史二')
  const c1 = makeCatalog('c1', 'b1', 'src-sz', 'BC1', 'm1', [
    { system: 'clc', code: 'I242.4' },
  ])
  const c2 = makeCatalog('c2', 'b2', 'src-sz', 'BC2', 'm2', [
    { system: 'clc', code: 'K252.1' },
  ])
  const cy1 = makeCycle('cy1', 'b1', 'src-sz', T0, 'returned', 'BC1')
  const cy2 = makeCycle('cy2', 'b2', 'src-sz', new Date(T0.getTime() + DAY), 'borrowed', 'BC2')
  return {
    books: [b1, b2],
    catalogRecords: [c1, c2],
    borrowCycles: [cy1, cy2],
    sources: [src],
  }
}

const OPTS_CLC: UseProfileStatsOptions = {
  classificationSystem: 'clc',
  range: null,
  displayTimezone: 'UTC',
  calendarAnchor: null,
}

const OPTS_DDC: UseProfileStatsOptions = {
  classificationSystem: 'ddc',
  range: null,
  displayTimezone: 'UTC',
  calendarAnchor: null,
}

function renderHook(opts: UseProfileStatsOptions) {
  let state: ProfileStatsState | undefined
  function Probe() {
    state = useProfileStats(opts)
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  if (!state) throw new Error('Probe failed to capture useProfileStats')
  return state
}

beforeEach(() => {
  useLiveQueryMock.mockReset()
})

describe('useProfileStats — useLiveQuery 未就绪', () => {
  it('返回 loading=true 且 result=null（Skeleton 契约）', () => {
    useLiveQueryMock.mockReturnValue(undefined)
    const state = renderHook(OPTS_CLC)
    expect(state.loading).toBe(true)
    expect(state.result).toBeNull()
  })
})

describe('useProfileStats — 小数据同步派生', () => {
  it('产出与 computeProfileStats 直调深等价，且 loading=false', () => {
    const f = fixtures()
    useLiveQueryMock.mockReturnValue([
      f.books,
      f.catalogRecords,
      f.borrowCycles,
      f.sources,
    ])
    const state = renderHook(OPTS_CLC)
    const expected = computeProfileStats(
      {
        books: f.books,
        catalogRecords: f.catalogRecords,
        borrowCycles: f.borrowCycles,
        sources: f.sources,
      },
      OPTS_CLC,
    )
    expect(state.loading).toBe(false)
    expect(state.computing).toBe(false)
    expect(state.result).toEqual(expected)
  })

  it('空库（各实体为空数组）返回全零结构，不崩', () => {
    useLiveQueryMock.mockReturnValue([[], [], [], []])
    const state = renderHook(OPTS_CLC)
    expect(state.loading).toBe(false)
    expect(state.result).toEqual(
      computeProfileStats(
        { books: [], catalogRecords: [], borrowCycles: [], sources: [] },
        OPTS_CLC,
      ),
    )
    expect(state.result?.summary.totalBooks).toBe(0)
    expect(state.result?.summary.totalCycles).toBe(0)
  })
})

describe('useProfileStats — 切换分类体系触发重算', () => {
  it('CLC→DDC 结果改变且各自等于直调', () => {
    const f = fixtures()
    useLiveQueryMock.mockReturnValue([
      f.books,
      f.catalogRecords,
      f.borrowCycles,
      f.sources,
    ])
    const fromClc = renderHook(OPTS_CLC)
    const fromDdc = renderHook(OPTS_DDC)
    const expectedClc = computeProfileStats(
      {
        books: f.books,
        catalogRecords: f.catalogRecords,
        borrowCycles: f.borrowCycles,
        sources: f.sources,
      },
      OPTS_CLC,
    )
    const expectedDdc = computeProfileStats(
      {
        books: f.books,
        catalogRecords: f.catalogRecords,
        borrowCycles: f.borrowCycles,
        sources: f.sources,
      },
      OPTS_DDC,
    )
    expect(fromClc.result).toEqual(expectedClc)
    expect(fromDdc.result).toEqual(expectedDdc)
    // DDC 体系下夹具无匹配分类号 → 全部归入 __unclassified__，与 CLC 结果不同
    expect(fromClc.result).not.toEqual(fromDdc.result)
  })
})

describe('useProfileStats — 大数据 Worker 路径', () => {
  it('borrowCycles ≥ 阈值 → computing=true，结果回退同步派生（Worker 完成前不阻塞）', () => {
    const f = fixtures()
    const manyCycles = Array.from({ length: WORKER_THRESHOLD }, (_, i) =>
      makeCycle(`cy-${i}`, 'b1', 'src-sz', new Date(T0.getTime() + i * 1000), 'returned', 'BC1'),
    )
    useLiveQueryMock.mockReturnValue([f.books, f.catalogRecords, manyCycles, f.sources])
    const state = renderHook(OPTS_CLC)
    expect(state.computing).toBe(true)
    expect(state.loading).toBe(false)
    // 计算中展示同步派生结果（非空、非过期占位）。
    expect(state.result).not.toBeNull()
  })
})
