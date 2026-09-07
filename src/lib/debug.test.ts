// 调试开关测试（debug-mode spec §3.1/§8）：门控常量 + localStorage verbose 位。
// vitest define 固定 __DEBUG_MODE__=false；切换用 vi.stubGlobal（先例 ai-client.test.ts:371）。
import { afterEach, describe, expect, it, vi } from 'vitest'

// 本地 ambient 声明（同 ai-client.test.ts 对 __AI_DEV_PROXY__ 的用法）。
declare const __DEBUG_MODE__: boolean
import {
  isDebugMode,
  isDebugVerbose,
  writeVerboseFlag,
  VERBOSE_STORAGE_KEY,
} from './debug'

const VERBOSE_KEY = VERBOSE_STORAGE_KEY

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('isDebugMode', () => {
  it('vitest define 下恒为 false（测试直连语义）', () => {
    // __DEBUG_MODE__ 由 vitest.config.ts define 注入 false。
    expect(__DEBUG_MODE__).toBe(false)
    expect(isDebugMode()).toBe(false)
  })

  it('vi.stubGlobal 切换为 true（模拟 dev 构建）', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    expect(isDebugMode()).toBe(true)
  })
})

describe('isDebugVerbose', () => {
  it('非 debug 模式下恒 false（即使 verbose 位为 true）', () => {
    vi.stubGlobal('localStorage', stubStorage({ [VERBOSE_KEY]: 'verbose' }))
    expect(isDebugVerbose()).toBe(false)
  })

  it('debug 模式 + verbose 位为 true', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    vi.stubGlobal('localStorage', stubStorage({ [VERBOSE_KEY]: 'verbose' }))
    expect(isDebugVerbose()).toBe(true)
  })

  it('debug 模式 + 非 verbose 值为 false', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    vi.stubGlobal('localStorage', stubStorage({ [VERBOSE_KEY]: 'yes' }))
    expect(isDebugVerbose()).toBe(false)
  })

  it('localStorage 缺失（node 测试环境）回退关、不抛', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    vi.stubGlobal('localStorage', undefined)
    expect(isDebugVerbose()).toBe(false)
  })

  it('localStorage 抛错（Safari 隐私模式）回退关、不抛', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    vi.stubGlobal('localStorage', throwingStorage())
    expect(isDebugVerbose()).toBe(false)
  })
})

describe('writeVerboseFlag', () => {
  it('writeVerboseFlag(true) 写、(false) 清；isDebugVerbose 读写一致', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    const store = stubStorage()
    vi.stubGlobal('localStorage', store)
    writeVerboseFlag(true)
    expect(store.getItem(VERBOSE_KEY)).toBe('verbose')
    expect(isDebugVerbose()).toBe(true)
    writeVerboseFlag(false)
    expect(store.getItem(VERBOSE_KEY)).toBe(null)
    expect(isDebugVerbose()).toBe(false)
  })

  it('localStorage 缺失/抛错时写操作静默不抛', () => {
    vi.stubGlobal('__DEBUG_MODE__', true)
    vi.stubGlobal('localStorage', undefined)
    expect(() => writeVerboseFlag(true)).not.toThrow()
    vi.stubGlobal('localStorage', throwingStorage())
    expect(() => writeVerboseFlag(true)).not.toThrow()
  })
})

/** in-memory localStorage stub（node 环境无 localStorage）。 */
function stubStorage(initial?: Record<string, string>) {
  const map: Record<string, string> = { ...(initial ?? {}) }
  return {
    getItem: (k: string) => (k in map ? map[k] : null),
    setItem: (k: string, v: string) => {
      map[k] = v
    },
    removeItem: (k: string) => {
      delete map[k]
    },
  }
}

/** getItem 抛错的存储（模拟 Safari 隐私模式）。 */
function throwingStorage() {
  return {
    getItem: () => {
      throw new DOMException('denied', 'SecurityError')
    },
    setItem: () => {
      throw new DOMException('denied', 'SecurityError')
    },
    removeItem: () => {
      throw new DOMException('denied', 'SecurityError')
    },
  }
}
