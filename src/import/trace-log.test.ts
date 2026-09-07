// trace-log（src/import/trace-log.ts）单测：DevTools Console 输出通道 + 全局钩子
// （debug-mode spec §3.2/§4.1）。vitest define 固定 __DEBUG_MODE__=false
// （直连语义）；debug 行为 vi.stubGlobal('__DEBUG_MODE__', true) 切换（先例
// src/lib/debug.test.ts）。node 环境无 window/document/URL/navigator/localStorage：
// defineGlobal stub + afterEach 恢复（先例 src/hooks/use-theme.test.tsx:99-151）。
// lastImport 是模块态——「未导入静默」前置用例用 vi.resetModules + 动态 import 取
// 全新模块实例，避免跨用例状态顺序依赖。
import { afterEach, describe, expect, it, vi } from 'vitest'

import { installDebugHooks, logImportTrace } from '@/import/trace-log'
import { VERBOSE_STORAGE_KEY } from '@/lib/debug'
import type { ImportTrace } from '@/parsers/trace'
import type { ReadgraphDebug } from '@/types/debug'

const GROUP_TITLE = '[readgraph:import] 导入决策 trace'

/** 会话级 trace 夹具（spec §5.1 扁平契约；warnings 为顶层字段）。 */
function makeTrace(): ImportTrace {
  return {
    importLogId: 'log-1',
    sourceId: 'src-szlib',
    parserId: 'szlib',
    importedAt: new Date('2026-09-07T08:00:00.000Z'),
    fileName: '借阅明细-2026.json',
    fileSize: 4096,
    detectedEncoding: 'utf-8',
    stats: {
      totalRawRecords: 2,
      newBooks: 1,
      updatedBooks: 0,
      newBorrowCycles: 1,
      skippedRecords: 1,
      filteredRows: 0,
      warningCount: 1,
      errorCount: 0,
    },
    rows: [
      {
        rowIndex: 1,
        rawRecordId: 'raw-1',
        status: 'imported',
        decision: 'new-book',
        reason: '首次导入：新建书目与借阅周期',
        barcode: 'BC001',
        title: '三体',
        bookId: 'bk-1',
        catalogRecordId: 'cr-1',
        borrowCycleId: 'cy-1',
        warningType: null,
        // verbose 收集才填；非 verbose 恒缺省——供 verbose 门控用例使用。
        idDerivation: 'cr-{fnv1a32(src-szlib|metaId-1)}',
      },
      {
        rowIndex: 2,
        rawRecordId: 'raw-2',
        status: 'skipped',
        decision: 'cycle-skipped-duplicate',
        reason: '精确重复周期（sourceId+barcode+borrowedAt）',
        barcode: 'BC001',
        title: '三体',
        bookId: 'bk-1',
        catalogRecordId: 'cr-1',
        borrowCycleId: 'cy-1',
        warningType: 'duplicate',
        // 无 idDerivation：验证逐行输出只覆盖已填写行。
      },
    ],
    entityDelta: {
      newBooks: ['bk-1'],
      mergedBooks: [],
      newCatalogRecords: ['cr-1'],
      newBorrowCycles: ['cy-1'],
      skippedRows: [2],
    },
    durationMs: 12,
    warnings: [{ type: 'duplicate', message: '行 2：重复周期，已跳过', recordRef: 'raw:raw-2' }],
  }
}

const savedGlobals = new Map<string, unknown>()

function defineGlobal(key: string, value: unknown): void {
  if (!(key in globalThis)) savedGlobals.set(key, undefined)
  else if (!savedGlobals.has(key)) savedGlobals.set(key, (globalThis as Record<string, unknown>)[key])
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
}

function restoreGlobals(): void {
  for (const [key, value] of savedGlobals) {
    if (value === undefined) {
      delete (globalThis as Record<string, unknown>)[key]
    } else {
      Object.defineProperty(globalThis, key, {
        value,
        configurable: true,
        writable: true,
        enumerable: true,
      })
    }
  }
  savedGlobals.clear()
}

/** in-memory localStorage stub（debug.ts isDebugVerbose 只读 getItem）。 */
function storageWith(entries: Record<string, string>) {
  const map = new Map(Object.entries(entries))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => map.set(k, v),
    removeItem: (k: string) => map.delete(k),
  } as unknown as Storage
}

function defineWindow(): void {
  defineGlobal('window', {})
}

/** 读取当前 window stub 上已安装的钩子（未安装抛错，防静默漏装）。 */
function hooks(): ReadgraphDebug {
  const w = globalThis.window as unknown as { __readgraphDebug?: ReadgraphDebug }
  const h = w.__readgraphDebug
  if (!h) throw new Error('__readgraphDebug 未安装')
  return h
}

function spyConsole() {
  return {
    groupCollapsed: vi.spyOn(console, 'groupCollapsed'),
    table: vi.spyOn(console, 'table'),
    debug: vi.spyOn(console, 'debug'),
    groupEnd: vi.spyOn(console, 'groupEnd'),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  restoreGlobals()
})

describe('logImportTrace（非 debug：vitest define __DEBUG_MODE__=false）', () => {
  it('零 console 输出（groupCollapsed/table/debug/groupEnd 均不被调）', () => {
    const c = spyConsole()
    logImportTrace(makeTrace())
    expect(c.groupCollapsed).not.toHaveBeenCalled()
    expect(c.table).not.toHaveBeenCalled()
    expect(c.debug).not.toHaveBeenCalled()
    expect(c.groupEnd).not.toHaveBeenCalled()
  })

  it('installDebugHooks 不挂载 __readgraphDebug', () => {
    defineWindow()
    installDebugHooks()
    const w = globalThis.window as unknown as { __readgraphDebug?: unknown }
    expect(w.__readgraphDebug).toBeUndefined()
  })
})

describe('logImportTrace（debug：stubGlobal true）五步输出', () => {
  it('五步参数（group 标题含 importLogId；table 列裁剪恰 5 列；debug 三连）与顺序', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    const c = spyConsole()
    const trace = makeTrace()
    logImportTrace(trace)

    expect(c.groupCollapsed).toHaveBeenCalledTimes(1)
    expect(c.groupCollapsed).toHaveBeenCalledWith(GROUP_TITLE, trace.importLogId)
    expect(c.table).toHaveBeenCalledTimes(1)
    expect(c.table).toHaveBeenCalledWith(trace.rows, [
      'rowIndex',
      'barcode',
      'title',
      'decision',
      'reason',
    ])
    expect(c.debug).toHaveBeenCalledTimes(3)
    expect(c.debug).toHaveBeenNthCalledWith(1, '[readgraph:import] rows', trace.rows)
    expect(c.debug).toHaveBeenNthCalledWith(2, '[readgraph:import] summary', trace.stats, trace.durationMs)
    expect(c.debug).toHaveBeenNthCalledWith(3, '[readgraph:import] warnings', trace.warnings)
    expect(c.groupEnd).toHaveBeenCalledTimes(1)

    // 顺序：groupCollapsed → table → debug×3 → groupEnd（全部在组内）。
    const [gc] = c.groupCollapsed.mock.invocationCallOrder
    const [tb] = c.table.mock.invocationCallOrder
    const debugOrders = c.debug.mock.invocationCallOrder
    const [ge] = c.groupEnd.mock.invocationCallOrder
    expect(tb).toBeGreaterThan(gc!)
    expect(debugOrders[0]).toBeGreaterThan(tb!)
    expect(debugOrders[2]).toBeGreaterThan(debugOrders[1]!)
    expect(ge).toBeGreaterThan(debugOrders[2]!)
  })

  it('trace=null 完全 no-op', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    const c = spyConsole()
    logImportTrace(null)
    expect(c.groupCollapsed).not.toHaveBeenCalled()
    expect(c.table).not.toHaveBeenCalled()
    expect(c.debug).not.toHaveBeenCalled()
    expect(c.groupEnd).not.toHaveBeenCalled()
  })
})

describe('logImportTrace verbose 细分（spec §4.1）', () => {
  it('verbose 位开：追加 entityDelta 与已填行的 idDerivation 逐行（未填行不输出）', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    defineGlobal('localStorage', storageWith({ [VERBOSE_STORAGE_KEY]: 'verbose' }))
    const c = spyConsole()
    const trace = makeTrace()
    logImportTrace(trace)

    expect(c.debug).toHaveBeenCalledTimes(5)
    expect(c.debug).toHaveBeenNthCalledWith(4, '[readgraph:import] entityDelta', trace.entityDelta)
    expect(c.debug).toHaveBeenNthCalledWith(5, '[readgraph:import] idDerivation', {
      rowIndex: 1,
      idDerivation: trace.rows[0]!.idDerivation,
    })
    const debugOrders = c.debug.mock.invocationCallOrder
    const [ge] = c.groupEnd.mock.invocationCallOrder
    expect(ge).toBeGreaterThan(debugOrders[4]!)
  })

  it('verbose 位关（storage 缺失）：无 entityDelta/idDerivation 附加输出', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    const c = spyConsole()
    const trace = makeTrace()
    logImportTrace(trace)

    expect(c.debug).toHaveBeenCalledTimes(3)
    const prefixes = c.debug.mock.calls.map((call) => call[0])
    expect(prefixes).toEqual([
      '[readgraph:import] rows',
      '[readgraph:import] summary',
      '[readgraph:import] warnings',
    ])
  })
})

describe('installDebugHooks 全局钩子（spec §3.2）', () => {
  it('debug 模式挂载四字段对象：初始 lastImport/getImportTrace 为 null，logImportTrace 后指向同一 trace', async () => {
    vi.resetModules()
    vi.stubGlobal('__DEBUG_MODE__', true)
    defineWindow()
    const mod = await import('@/import/trace-log')
    mod.installDebugHooks()

    const h = hooks()
    expect(typeof h.getImportTrace).toBe('function')
    expect(typeof h.exportImportTrace).toBe('function')
    expect(typeof h.copyImportTrace).toBe('function')
    expect(h.lastImport).toBeNull()
    expect(h.getImportTrace()).toBeNull()

    const trace = makeTrace()
    mod.logImportTrace(trace)
    expect(h.lastImport).toBe(trace)
    expect(h.getImportTrace()).toBe(trace)
  })

  it('重复安装幂等：覆盖旧对象、模块态不丢', async () => {
    vi.resetModules()
    vi.stubGlobal('__DEBUG_MODE__', true)
    defineWindow()
    const mod = await import('@/import/trace-log')
    const trace = makeTrace()
    mod.installDebugHooks()
    mod.logImportTrace(trace)

    const first = hooks()
    mod.installDebugHooks()
    const second = hooks()
    expect(second).not.toBe(first)
    expect(second.lastImport).toBe(trace)
    expect(second.getImportTrace()).toBe(trace)
  })
})

describe('exportImportTrace（spec US6：JSON 文件下载）', () => {
  it('lastImport 存在：Blob(application/json) → anchor[download].json → click → revoke', async () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    defineWindow()
    const click = vi.fn()
    const anchor = { href: '', download: '', click } as unknown as HTMLAnchorElement
    defineGlobal('document', {
      createElement: vi.fn(() => anchor),
    } as unknown as Document)
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:trace-1')
    const revokeObjectURL = vi.fn()
    defineGlobal('URL', { createObjectURL, revokeObjectURL } as unknown as typeof URL)
    installDebugHooks()
    const trace = makeTrace()
    logImportTrace(trace)

    expect(() => hooks().exportImportTrace()).not.toThrow()
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0]![0] as Blob
    expect(blob.type).toBe('application/json')
    // Date 经 JSON 序列化为 ISO 串（同 backup.ts 风格）；2 空格缩进。
    expect(await blob.text()).toBe(JSON.stringify(trace, null, 2))
    expect(anchor.download.endsWith('.json')).toBe(true)
    expect(anchor.href).toBe('blob:trace-1')
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:trace-1')
  })

  it('document/URL 缺失（node/SSR）静默返回不抛', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    defineWindow()
    installDebugHooks()
    logImportTrace(makeTrace())
    expect(() => hooks().exportImportTrace()).not.toThrow()
  })
})

describe('copyImportTrace（剪贴板）', () => {
  it('lastImport 存在：clipboard.writeText 收到 JSON.stringify(trace,null,2)（Date→ISO）', async () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    defineWindow()
    const writeText = vi.fn(async (_text: string) => undefined)
    defineGlobal('navigator', { clipboard: { writeText } } as unknown as Navigator)
    installDebugHooks()
    const trace = makeTrace()
    logImportTrace(trace)

    await expect(hooks().copyImportTrace()).resolves.toBeUndefined()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(JSON.stringify(trace, null, 2))
    expect(writeText.mock.calls[0]![0]).toContain('"importedAt": "2026-09-07T08:00:00.000Z"')
  })

  it('clipboard 缺失：静默 resolve', async () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    defineWindow()
    defineGlobal('navigator', {} as unknown as Navigator)
    installDebugHooks()
    logImportTrace(makeTrace())
    await expect(hooks().copyImportTrace()).resolves.toBeUndefined()
  })

  it('writeText 拒绝（权限/非安全上下文）：静默 resolve 不抛', async () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    defineWindow()
    const writeText = vi.fn(async () => {
      throw new DOMException('denied', 'NotAllowedError')
    })
    defineGlobal('navigator', { clipboard: { writeText } } as unknown as Navigator)
    installDebugHooks()
    logImportTrace(makeTrace())
    await expect(hooks().copyImportTrace()).resolves.toBeUndefined()
  })
})

describe('未导入（lastImport=null）静默', () => {
  it('exportImportTrace/copyImportTrace 均静默（fresh 模块实例，安装后未 log 任何 trace）', async () => {
    vi.resetModules()
    vi.stubGlobal('__DEBUG_MODE__', true)
    defineWindow()
    const mod = await import('@/import/trace-log')
    mod.installDebugHooks()
    const h = hooks()
    expect(h.lastImport).toBeNull()
    expect(() => h.exportImportTrace()).not.toThrow()
    await expect(h.copyImportTrace()).resolves.toBeUndefined()
  })
})
