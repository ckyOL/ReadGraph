import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import { DEFAULT_LOCALE } from '@/lib/locale'
import {
  readPreferences, writePreferences,
  DEFAULT_PREFERENCES, type Theme,
} from '@/lib/preferences'
import {
  AI_API_KEY_STORAGE_KEY, readAiApiKey, writeAiApiKey, clearAiApiKey,
} from '@/lib/ai-api-key'
import { createTestDB, closeTestDB } from '@/db/test-helpers'
import { exportDatabase } from '@/db/export-import'

let savedLS: Storage | undefined
let savedNav: Navigator | undefined

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
function setNavLng(language: string | null): void {
  const g = globalThis as unknown as { navigator?: Navigator }
  if (language === null) delete g.navigator
  else g.navigator = { language } as Navigator
}

beforeEach(() => {
  savedLS = (globalThis as unknown as { localStorage?: Storage }).localStorage
  savedNav = (globalThis as unknown as { navigator?: Navigator }).navigator
  removeStorage()
  setNavLng(null)
})
afterEach(() => {
  const g = globalThis as unknown as { localStorage?: Storage; navigator?: Navigator }
  if (savedLS === undefined) delete g.localStorage
  else g.localStorage = savedLS
  if (savedNav === undefined) delete g.navigator
  else g.navigator = savedNav
})

describe('DEFAULT_PREFERENCES', () => {
  it('has zh-CN / auto / Asia/Shanghai defaults', () => {
    expect(DEFAULT_PREFERENCES.locale).toBe('zh-CN')
    expect(DEFAULT_PREFERENCES.theme).toBe('auto')
    expect(DEFAULT_PREFERENCES.displayTimezone).toBe('Asia/Shanghai')
    expect(DEFAULT_PREFERENCES.ai).toEqual({ enabled: false, baseUrl: '', model: '', sendPreview: true })
  })
})

describe('readPreferences', () => {
  it('returns defaults when nothing is stored', () => {
    installStorage(new Map())
    const r = readPreferences()
    expect(r).toEqual({ locale: DEFAULT_LOCALE, theme: 'auto', displayTimezone: 'Asia/Shanghai', ai: { enabled: false, baseUrl: '', model: '', sendPreview: true } })
  })

  it('reads fully valid persisted preferences', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'en', theme: 'dark', displayTimezone: 'Europe/London', ai: { enabled: true, baseUrl: 'https://api.example.com/v1', model: 'gpt-4o' } })]]))
    setNavLng('en-US')
    expect(readPreferences()).toEqual({ locale: 'en', theme: 'dark', displayTimezone: 'Europe/London', ai: { enabled: true, baseUrl: 'https://api.example.com/v1', model: 'gpt-4o', sendPreview: true } })
  })

  it('downgrades an out-of-enum theme to default, keeps valid timezone', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'en', theme: 'purple', displayTimezone: 'UTC' })]]))
    setNavLng('en-US')
    const r = readPreferences()
    expect(r.theme).toBe('auto')
    expect(r.displayTimezone).toBe('UTC')
    expect(r.locale).toBe('en')
  })

  it('downgrades a wrong-type theme to default', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 1, displayTimezone: 'UTC' })]]))
    setNavLng('zh-CN')
    expect(readPreferences().theme).toBe('auto')
  })

  it('downgrades an empty timezone to default, keeps valid theme', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'light', displayTimezone: '' })]]))
    setNavLng('zh-CN')
    const r = readPreferences()
    expect(r.displayTimezone).toBe('Asia/Shanghai')
    expect(r.theme).toBe('light')
  })

  it('downgrades a wrong-type timezone to default', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'dark', displayTimezone: 5 })]]))
    setNavLng('zh-CN')
    expect(readPreferences().displayTimezone).toBe('Asia/Shanghai')
  })

  it('does not throw on corrupt JSON', () => {
    installStorage(new Map([['readgraph:preferences', '{not json']]))
    const r = readPreferences()
    expect(r.theme).toBe('auto')
    expect(r.displayTimezone).toBe('Asia/Shanghai')
  })

  it('returns default ai when ai is missing from raw', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC' })]]))
    setNavLng('zh-CN')
    expect(readPreferences().ai).toEqual({ enabled: false, baseUrl: '', model: '', sendPreview: true })
  })

  it('round-trips a fully valid ai config', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'en', theme: 'dark', displayTimezone: 'UTC', ai: { enabled: true, baseUrl: 'https://api.example.com/v1', model: 'gpt-4o' } })]]))
    setNavLng('en-US')
    expect(readPreferences().ai).toEqual({ enabled: true, baseUrl: 'https://api.example.com/v1', model: 'gpt-4o', sendPreview: true })
  })

  it('downgrades ai.baseUrl of wrong type to default, keeps valid siblings', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', ai: { enabled: true, baseUrl: 123, model: 'gpt-4o' } })]]))
    setNavLng('zh-CN')
    expect(readPreferences().ai).toEqual({ enabled: true, baseUrl: '', model: 'gpt-4o', sendPreview: true })
  })

  it('downgrades ai.enabled of wrong type to default, keeps valid siblings', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', ai: { enabled: 'yes', baseUrl: 'https://api.example.com', model: 'gpt-4o' } })]]))
    setNavLng('zh-CN')
    expect(readPreferences().ai).toEqual({ enabled: false, baseUrl: 'https://api.example.com', model: 'gpt-4o', sendPreview: true })
  })

  it('downgrades ai.model of wrong type to default, keeps valid siblings', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', ai: { enabled: true, baseUrl: 'https://api.example.com', model: 7 } })]]))
    setNavLng('zh-CN')
    expect(readPreferences().ai).toEqual({ enabled: true, baseUrl: 'https://api.example.com', model: '', sendPreview: true })
  })

  it('downgrades a non-object ai to default ai', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', ai: 'off' })]]))
    setNavLng('zh-CN')
    expect(readPreferences().ai).toEqual({ enabled: false, baseUrl: '', model: '', sendPreview: true })
  })
  it('downgrades ai.sendPreview of wrong type to default true, keeps valid siblings', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', ai: { enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o', sendPreview: 'no' } })]]))
    setNavLng('zh-CN')
    expect(readPreferences().ai).toEqual({ enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o', sendPreview: true })
  })

  it('round-trips a persisted sendPreview: false', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', ai: { enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o', sendPreview: false } })]]))
    setNavLng('zh-CN')
    expect(readPreferences().ai).toEqual({ enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o', sendPreview: false })
  })
})

describe('writePreferences', () => {
  it('merges a patch into existing prefs and preserves siblings', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'light', displayTimezone: 'UTC' })]]))
    setNavLng('zh-CN')
    const r = writePreferences({ theme: 'dark' as Theme })
    expect(r).toEqual({ locale: 'zh-CN', theme: 'dark', displayTimezone: 'UTC', ai: { enabled: false, baseUrl: '', model: '', sendPreview: true } })
  })

  it('rejects an invalid theme patch, keeping the current valid value', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'light', displayTimezone: 'UTC' })]]))
    setNavLng('zh-CN')
    const r = writePreferences({ theme: 'invalid' as unknown as Theme })
    expect(r.theme).toBe('light')
    expect(r.displayTimezone).toBe('UTC')
  })
  it('does not throw when storage is unavailable', () => {
    removeStorage()
    expect(() => writePreferences({ theme: 'dark' as Theme })).not.toThrow()
  })

  it('persists an ai patch merged with existing prefs and reads it back', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC' })]]))
    setNavLng('zh-CN')
    const r = writePreferences({ ai: { enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o', sendPreview: true } })
    expect(r.ai).toEqual({ enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o', sendPreview: true })
    expect(r.theme).toBe('auto')
    expect(readPreferences().ai).toEqual({ enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o', sendPreview: true })
  })
  it('persists a sendPreview: false ai patch and reads it back', () => {
    installStorage(new Map())
    setNavLng('zh-CN')
    const r = writePreferences({ ai: { enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o', sendPreview: false } })
    expect(r.ai.sendPreview).toBe(false)
    expect(readPreferences().ai.sendPreview).toBe(false)
  })

  it('rejects an invalid ai patch, keeping the current value', () => {
    installStorage(new Map())
    setNavLng('zh-CN')
    const r = writePreferences({ ai: { enabled: 'yes' as unknown as boolean, baseUrl: '', model: '', sendPreview: true } })
    expect(r.ai).toEqual({ enabled: false, baseUrl: '', model: '', sendPreview: true })
  })
})

describe('ai-api-key', () => {
  it('round-trips writeAiApiKey → readAiApiKey', () => {
    installStorage(new Map())
    writeAiApiKey('sk-test-123')
    expect(readAiApiKey()).toBe('sk-test-123')
  })

  it('returns empty string when key is missing', () => {
    installStorage(new Map())
    expect(readAiApiKey()).toBe('')
  })

  it('returns empty string on corrupt JSON or wrong type', () => {
    installStorage(new Map([[AI_API_KEY_STORAGE_KEY, '{not json']]))
    expect(readAiApiKey()).toBe('')
    installStorage(new Map([[AI_API_KEY_STORAGE_KEY, JSON.stringify(42)]]))
    expect(readAiApiKey()).toBe('')
  })

  it('clearAiApiKey removes the key', () => {
    const store = new Map<string, string>([[AI_API_KEY_STORAGE_KEY, JSON.stringify('sk-test')]])
    installStorage(store)
    clearAiApiKey()
    expect(store.has(AI_API_KEY_STORAGE_KEY)).toBe(false)
    expect(readAiApiKey()).toBe('')
  })

  it('readPreferences output never contains the key value', () => {
    installStorage(new Map([
      ['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC' })],
      [AI_API_KEY_STORAGE_KEY, JSON.stringify('sk-secret-123')],
    ]))
    setNavLng('zh-CN')
    expect(JSON.stringify(readPreferences())).not.toContain('sk-secret-123')
  })

  it('readPreferences and writePreferences leave the api key storage untouched', () => {
    const store = new Map<string, string>([
      ['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'light', displayTimezone: 'UTC' })],
      [AI_API_KEY_STORAGE_KEY, JSON.stringify('sk-keep')],
    ])
    installStorage(store)
    setNavLng('zh-CN')
    readPreferences()
    writePreferences({ theme: 'dark' as Theme })
    expect(store.get(AI_API_KEY_STORAGE_KEY)).toBe(JSON.stringify('sk-keep'))
    expect(readAiApiKey()).toBe('sk-keep')
  })

  it('writePreferences never stores the api key inside preferences', () => {
    const store = new Map<string, string>()
    installStorage(store)
    setNavLng('zh-CN')
    writeAiApiKey('sk-secret-123')
    writePreferences({ ai: { enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o', sendPreview: true } })
    const raw = store.get('readgraph:preferences') ?? ''
    expect(raw).not.toContain('sk-secret-123')
    expect(raw).not.toContain('ai-api-key')
  })
})

describe('exportDatabase AI boundaries', () => {
  it('export output contains neither the api key nor ai preferences', async () => {
    const db = createTestDB()
    try {
      installStorage(new Map([
        ['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'auto', displayTimezone: 'UTC', ai: { enabled: true, baseUrl: 'https://api.example.com', model: 'gpt-4o' } })],
        [AI_API_KEY_STORAGE_KEY, JSON.stringify('sk-secret-123')],
      ]))
      setNavLng('zh-CN')
      const exported = JSON.stringify(await exportDatabase(db))
      expect(exported).not.toContain('sk-secret-123')
      expect(exported).not.toContain('"ai":')
      expect(exported).not.toContain('"baseUrl"')
      expect(exported).not.toContain('"model"')
    } finally {
      closeTestDB(db)
    }
  })
})
