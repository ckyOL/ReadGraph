import { beforeEach, afterEach, describe, it, expect } from 'vitest'

import { DEFAULT_LOCALE } from '@/lib/locale'
import {
  readPreferences, writePreferences,
  DEFAULT_PREFERENCES, type Theme,
} from '@/lib/preferences'

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
  })
})

describe('readPreferences', () => {
  it('returns defaults when nothing is stored', () => {
    installStorage(new Map())
    const r = readPreferences()
    expect(r).toEqual({ locale: DEFAULT_LOCALE, theme: 'auto', displayTimezone: 'Asia/Shanghai' })
  })

  it('reads fully valid persisted preferences', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'en', theme: 'dark', displayTimezone: 'Europe/London' })]]))
    setNavLng('en-US')
    expect(readPreferences()).toEqual({ locale: 'en', theme: 'dark', displayTimezone: 'Europe/London' })
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

  it('falls back to browser locale when stored locale is invalid', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'fr-FR', theme: 'auto', displayTimezone: 'UTC' })]]))
    setNavLng('en-US')
    expect(readPreferences().locale).toBe('en')
  })
})

describe('writePreferences', () => {
  it('merges a patch into existing prefs and preserves siblings', () => {
    installStorage(new Map([['readgraph:preferences', JSON.stringify({ locale: 'zh-CN', theme: 'light', displayTimezone: 'UTC' })]]))
    setNavLng('zh-CN')
    const r = writePreferences({ theme: 'dark' as Theme })
    expect(r).toEqual({ locale: 'zh-CN', theme: 'dark', displayTimezone: 'UTC' })
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
})
