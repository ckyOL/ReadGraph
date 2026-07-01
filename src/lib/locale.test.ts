import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import {
  getStoredLocale,
  setStoredLocale,
  browserLocale,
  LOCALES,
  STORAGE_KEY,
  DEFAULT_LOCALE,
  type Locale,
} from '@/lib/locale'

// `localStorage`/`navigator` are real browser globals, but the vitest
// environment is `node`, so we install cheap stand-ins per test. `src/lib/locale.ts`
// guards every access with `typeof ... === 'undefined'`, so deleting the global
// faithfully simulates SSR / unavailable storage.

interface MockStorage {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  removeItem: (k: string) => void
  clear: () => void
}

let savedLS: Storage | undefined
let savedNav: Navigator | undefined

function installLocalStorage(store: Map<string, string>): void {
  const mock: MockStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => void store.set(k, v),
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
  }
  ;(globalThis as unknown as { localStorage: Storage }).localStorage =
    mock as unknown as Storage
}

function removeLocalStorage(): void {
  delete (globalThis as unknown as { localStorage?: Storage }).localStorage
}

function setNavigatorLanguage(language: string | null): void {
  const g = globalThis as unknown as { navigator?: Navigator }
  if (language === null) {
    delete g.navigator
  } else {
    g.navigator = { language } as Navigator
  }
}

beforeEach(() => {
  savedLS = (globalThis as unknown as { localStorage?: Storage }).localStorage
  savedNav = (globalThis as unknown as { navigator?: Navigator }).navigator
  removeLocalStorage()
  setNavigatorLanguage(null)
})

afterEach(() => {
  const g = globalThis as unknown as { localStorage?: Storage; navigator?: Navigator }
  if (savedLS === undefined) delete g.localStorage
  else g.localStorage = savedLS
  if (savedNav === undefined) delete g.navigator
  else g.navigator = savedNav
})

describe('LOCALES', () => {
  it('is locked to zh-CN and en (no zh-TW slot, per internal-schema)', () => {
    expect(LOCALES).toEqual(['zh-CN', 'en'])
    expect(DEFAULT_LOCALE).toBe('zh-CN')
  })
})

describe('browserLocale', () => {
  it('maps zh* navigator languages to zh-CN', () => {
    setNavigatorLanguage('zh-CN')
    expect(browserLocale()).toBe('zh-CN')
    setNavigatorLanguage('zh-TW')
    expect(browserLocale()).toBe('zh-CN') // zh-TW not enumerated; collapses to zh-CN
  })

  it('maps en* navigator languages to en', () => {
    setNavigatorLanguage('en-US')
    expect(browserLocale()).toBe('en')
    setNavigatorLanguage('en-GB')
    expect(browserLocale()).toBe('en')
  })

  it('falls back to DEFAULT_LOCALE for unsupported languages', () => {
    setNavigatorLanguage('ja-JP')
    expect(browserLocale()).toBe(DEFAULT_LOCALE)
  })

  it('falls back to DEFAULT_LOCALE when navigator is unavailable (SSR)', () => {
    setNavigatorLanguage(null)
    expect(browserLocale()).toBe(DEFAULT_LOCALE)
  })
})

describe('getStoredLocale', () => {
  it('returns a valid persisted locale', () => {
    setNavigatorLanguage('en-US')
    installLocalStorage(new Map([[STORAGE_KEY, JSON.stringify({ locale: 'en' })]]))
    expect(getStoredLocale()).toBe('en')
  })

  it('reads locale from a richer preferences object (merges with other prefs)', () => {
    setNavigatorLanguage('en-US')
    installLocalStorage(
      new Map([[STORAGE_KEY, JSON.stringify({ theme: 'dark', locale: 'zh-CN' })]]),
    )
    expect(getStoredLocale()).toBe('zh-CN')
  })

  // The app-spec §8.8 "Zod 校验非法值降级" line. `locale.ts` performs the
  // Zod-equivalent enum check via `isLocale`; an out-of-enum value must be
  // dropped and fall through to the browser language, never thrown or returned.
  const invalid: Array<[string, unknown]> = [
    ['unEnumerated locale', { locale: 'zh-TW' }],
    ['foreign locale', { locale: 'fr-FR' }],
    ['bare garbage string', { locale: 'nope' }],
    ['empty string', { locale: '' }],
    ['wrong type (number)', { locale: 1 }],
    ['wrong type (null)', { locale: null }],
    ['missing key', { theme: 'dark' }],
    ['non-object root', 'zh-CN'],
    ['number root', 42],
  ]

  for (const [label, value] of invalid) {
    it(`downgrades invalid stored value (${label}) to browser language`, () => {
      setNavigatorLanguage('en-US') // browser would yield en
      installLocalStorage(new Map([[STORAGE_KEY, JSON.stringify(value)]]))
      expect(getStoredLocale()).toBe('en')
    })
  }

  it('falls back to DEFAULT_LOCALE when both stored and browser are unusable', () => {
    setNavigatorLanguage('ja-JP')
    installLocalStorage(new Map([[STORAGE_KEY, JSON.stringify({ locale: 'fr' })]]))
    expect(getStoredLocale()).toBe(DEFAULT_LOCALE)
  })

  it('treats corrupt JSON as no preference and downgrades to browser language', () => {
    setNavigatorLanguage('en-US')
    installLocalStorage(new Map([[STORAGE_KEY, '{not json']]))
    expect(getStoredLocale()).toBe('en')
  })

  it('downgrades to browser language when no preference is stored', () => {
    setNavigatorLanguage('zh-HK')
    installLocalStorage(new Map())
    expect(getStoredLocale()).toBe('zh-CN')
  })

  it('returns browserLocale() (which defaults when navigator absent) when storage is unavailable (SSR)', () => {
    setNavigatorLanguage(null)
    removeLocalStorage()
    expect(getStoredLocale()).toBe(DEFAULT_LOCALE)
  })
})

describe('setStoredLocale', () => {
  it('writes locale into an empty preferences store', () => {
    const store = new Map<string, string>()
    installLocalStorage(store)
    setStoredLocale('en')
    expect(JSON.parse(store.get(STORAGE_KEY) ?? 'null')).toEqual({ locale: 'en' })
  })

  it('merges locale into existing preferences without clobbering siblings', () => {
    const store = new Map<string, string>([
      [STORAGE_KEY, JSON.stringify({ theme: 'dark', timezone: 'Asia/Shanghai' })],
    ])
    installLocalStorage(store)
    setStoredLocale('zh-CN')
    expect(JSON.parse(store.get(STORAGE_KEY) ?? 'null')).toEqual({
      theme: 'dark',
      timezone: 'Asia/Shanghai',
      locale: 'zh-CN',
    })
  })

  it('overwrites a previously stored locale while preserving siblings', () => {
    const store = new Map<string, string>([
      [STORAGE_KEY, JSON.stringify({ theme: 'light', locale: 'en' })],
    ])
    installLocalStorage(store)
    setStoredLocale('zh-CN')
    expect(JSON.parse(store.get(STORAGE_KEY) ?? 'null')).toEqual({
      theme: 'light',
      locale: 'zh-CN',
    })
  })

  it('does not throw when storage is unavailable', () => {
    removeLocalStorage()
    expect(() => setStoredLocale('en')).not.toThrow()
  })

  it('does not throw when the store throws (quota / blocked)', () => {
    installLocalStorage(new Map())
    const g = globalThis as unknown as { localStorage: Storage }
    // getItem works but persisting fails, simulating quota
    g.localStorage = {
      ...g.localStorage,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError')
      },
    } as Storage
    expect(() => setStoredLocale('en' as Locale)).not.toThrow()
  })
})
