import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { closeTestDB, createTestDB } from '@/db/test-helpers'
import { exportDatabase } from '@/db/export-import'
import {
  AI_CACHE_PREFIX,
  clearAiCache,
  readAiCache,
  writeAiCache,
} from '@/lib/ai-cache'

let savedLS: Storage | undefined

function installStorage(store: Map<string, string>): void {
  const mock = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    length: store.size,
  } as unknown as Storage
  ;(globalThis as unknown as { localStorage: Storage }).localStorage = mock
}
function removeStorage(): void {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage
}

beforeEach(() => {
  savedLS = (globalThis as unknown as { localStorage?: Storage }).localStorage
  removeStorage()
})
afterEach(() => {
  const g = globalThis as unknown as { localStorage?: Storage }
  if (savedLS === undefined) delete g.localStorage
  else g.localStorage = savedLS
})

describe('writeAiCache', () => {
  it('stores under the ai:{scene}:{locale}:{key} key shape', () => {
    const store = new Map<string, string>()
    installStorage(store)
    writeAiCache('profile', 'zh-CN', 'all', { hello: 'world' })
    expect([...store.keys()]).toEqual([`${AI_CACHE_PREFIX}profile:zh-CN:all`])
    expect(store.get(`${AI_CACHE_PREFIX}profile:zh-CN:all`)).not.toBeNull()
  })

  it('keeps distinct scene/locale/key entries separate', () => {
    const store = new Map<string, string>()
    installStorage(store)
    writeAiCache('profile', 'zh-CN', 'all', { locale: 'zh' })
    writeAiCache('profile', 'en', 'all', { locale: 'en' })
    writeAiCache('year-review', 'zh-CN', '2025', { year: 2025 })
    expect([...store.keys()].sort()).toEqual([
      `${AI_CACHE_PREFIX}profile:en:all`,
      `${AI_CACHE_PREFIX}profile:zh-CN:all`,
      `${AI_CACHE_PREFIX}year-review:zh-CN:2025`,
    ])
  })
})

describe('readAiCache', () => {
  it('round-trips the result with a generatedAt timestamp', () => {
    installStorage(new Map())
    const result = {
      insights: [
        { kind: 'fact', title: '偏爱文学类', body: '文学类占 42%', dimension: '分类偏好' },
        { kind: 'taste', body: '选书口味偏经典文学。' },
      ],
    }
    writeAiCache('profile', 'zh-CN', 'all', result)
    const entry = readAiCache('profile', 'zh-CN', 'all')
    expect(entry).not.toBeNull()
    expect(entry?.result).toEqual(result)
    expect(entry?.generatedAt).toBeGreaterThan(0)
    expect(typeof entry?.generatedAt).toBe('number')
  })

  it('returns null when the key is missing', () => {
    installStorage(new Map())
    writeAiCache('profile', 'zh-CN', 'all', { x: 1 })
    expect(readAiCache('profile', 'zh-CN', '2025')).toBeNull()
    expect(readAiCache('year-review', 'zh-CN', 'all')).toBeNull()
  })

  it('returns null on corrupt JSON or malformed entries', () => {
    const store = new Map<string, string>()
    installStorage(store)
    store.set(`${AI_CACHE_PREFIX}profile:zh-CN:all`, '{broken json')
    expect(readAiCache('profile', 'zh-CN', 'all')).toBeNull()
    store.set(`${AI_CACHE_PREFIX}profile:zh-CN:all`, JSON.stringify({ result: 'x' }))
    expect(readAiCache('profile', 'zh-CN', 'all')).toBeNull()
    store.set(`${AI_CACHE_PREFIX}profile:zh-CN:all`, JSON.stringify({ generatedAt: 'yesterday' }))
    expect(readAiCache('profile', 'zh-CN', 'all')).toBeNull()
    store.set(`${AI_CACHE_PREFIX}profile:zh-CN:all`, JSON.stringify('plain string'))
    expect(readAiCache('profile', 'zh-CN', 'all')).toBeNull()
  })
})

describe('clearAiCache', () => {
  it('removes only ai:-prefixed keys, keeps other keys', () => {
    const store = new Map<string, string>([
      ['readgraph:preferences', '{"theme":"dark"}'],
      ['readgraph:ai-api-key', 'sk-test'],
      ['app:other', 'keep-me'],
    ])
    installStorage(store)
    writeAiCache('profile', 'zh-CN', 'all', { a: 1 })
    writeAiCache('profile', 'en', '2025', { b: 2 })
    clearAiCache()
    expect([...store.keys()].sort()).toEqual([
      'app:other',
      'readgraph:ai-api-key',
      'readgraph:preferences',
    ])
    expect(readAiCache('profile', 'zh-CN', 'all')).toBeNull()
    expect(readAiCache('profile', 'en', '2025')).toBeNull()
  })
})

describe('export isolation', () => {
  it('does not include cache entries in exportDatabase serialization', async () => {
    const store = new Map<string, string>()
    installStorage(store)
    const db = createTestDB()
    try {
      writeAiCache('profile', 'zh-CN', 'all', { secret: '缓存值不随备份导出' })
      const exported = JSON.stringify(await exportDatabase(db))
      expect(exported).not.toContain('缓存值不随备份导出')
      expect(exported).not.toContain(`${AI_CACHE_PREFIX}profile:zh-CN:all`)
    } finally {
      closeTestDB(db)
    }
  })
})

describe('offline availability', () => {
  it('reads back written data with no fetch/network dependency', () => {
    installStorage(new Map())
    const result = { insights: [{ kind: 'fact', body: '断网也可读' }] }
    writeAiCache('profile', 'zh-CN', 'all', result)
    // node 环境无任何 fetch mock：不抛、值一致即满足「断网可读」
    expect(readAiCache('profile', 'zh-CN', 'all')?.result).toEqual(result)
  })

  it('degrades silently when localStorage is unavailable', () => {
    // beforeEach 已 removeStorage()
    expect(() => writeAiCache('profile', 'zh-CN', 'all', { x: 1 })).not.toThrow()
    expect(readAiCache('profile', 'zh-CN', 'all')).toBeNull()
    expect(() => clearAiCache()).not.toThrow()
  })
})
