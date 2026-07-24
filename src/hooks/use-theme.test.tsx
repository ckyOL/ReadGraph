import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  ThemeProvider,
  useTheme,
  resolveTheme,
  applyThemeClass,
  resetThemeStore,
  useEChartsTheme,
} from './use-theme'
import type { EChartsTheme } from '@/lib/echarts-theme'
import type { ThemeContextValue } from './use-theme'
import { STORAGE_KEY } from '@/lib/locale'

// ---------------------------------------------------------------------------
// Minimal DOM mocks for the node test environment.
// ---------------------------------------------------------------------------
let savedDocument: Document | undefined
let savedMatchMedia: typeof window.matchMedia | undefined
let savedNavigator: Navigator | undefined
let savedLocalStorage: Storage | undefined

let classList: Set<string>
let mediaListeners: Set<(event: MediaQueryListEvent) => void>
let mediaMatches: boolean

function createClassList() {
  classList = new Set()
  return {
    add: (c: string) => classList.add(c),
    remove: (c: string) => classList.delete(c),
    toggle: (c: string, force?: boolean) => {
      if (force === true) classList.add(c)
      else if (force === false) classList.delete(c)
      else if (classList.has(c)) classList.delete(c)
      else classList.add(c)
      return classList.has(c)
    },
    contains: (c: string) => classList.has(c),
  }
}

function createMatchMedia() {
  mediaListeners = new Set()
  mediaMatches = false
  return (query: string) => {
    if (query === '(prefers-color-scheme: dark)') {
      return {
        get media() {
          return query
        },
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => true,
        get matches() {
          return mediaMatches
        },
        addEventListener: (
          _event: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => {
          mediaListeners.add(listener)
        },
        removeEventListener: (
          _event: string,
          listener: (event: MediaQueryListEvent) => void,
        ) => {
          mediaListeners.delete(listener)
        },
      } as MediaQueryList
    }
    return {
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => true,
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    } as MediaQueryList
  }
}

function createLocalStorage(store: Map<string, string>): Storage {
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size
    },
  } as Storage
}

function installMocks(preferences: Record<string, unknown> = {}) {
  savedDocument = globalThis.document
  savedMatchMedia = globalThis.matchMedia
  savedNavigator = globalThis.navigator
  savedLocalStorage = globalThis.localStorage

  const store = new Map<string, string>()
  store.set(
    STORAGE_KEY,
    JSON.stringify({
      locale: 'zh-CN',
      theme: 'auto',
      displayTimezone: 'Asia/Shanghai',
      ...preferences,
    }),
  )

  defineGlobal('localStorage', createLocalStorage(store))
  defineGlobal('navigator', { language: 'zh-CN' } as Navigator)
  defineGlobal('matchMedia', createMatchMedia())
  defineGlobal('document', {
    documentElement: { classList: createClassList() },
  } as unknown as Document)
}

function defineGlobal(key: string, value: unknown) {
  Object.defineProperty(globalThis, key, {
    value,
    configurable: true,
    writable: true,
    enumerable: true,
  })
}

function restoreMocks() {
  restoreGlobal('document', savedDocument)
  restoreGlobal('matchMedia', savedMatchMedia)
  restoreGlobal('navigator', savedNavigator)
  restoreGlobal('localStorage', savedLocalStorage)
}

function restoreGlobal(key: string, saved: unknown) {
  if (saved === undefined) {
    delete (globalThis as unknown as Record<string, unknown>)[key]
  } else {
    Object.defineProperty(globalThis, key, {
      value: saved,
      configurable: true,
      writable: true,
      enumerable: true,
    })
  }
}

function renderProbe() {
  let api: ThemeContextValue | undefined
  function Probe() {
    api = useTheme()
    return null
  }
  renderToStaticMarkup(
    createElement(ThemeProvider, null, createElement(Probe)),
  )
  if (!api) throw new Error('Probe failed to capture useTheme')
  return api
}

function renderEChartsProbe(cssVars: Record<string, string>) {
  let theme: EChartsTheme | undefined
  function Probe() {
    theme = useEChartsTheme(cssVars)
    return null
  }
  renderToStaticMarkup(
    createElement(ThemeProvider, null, createElement(Probe)),
  )
  if (!theme) throw new Error('Probe failed to capture useEChartsTheme')
  return theme
}

beforeEach(() => {
  resetThemeStore()
  installMocks()
})

afterEach(() => {
  restoreMocks()
})

// ---------------------------------------------------------------------------
describe('resolveTheme', () => {
  it('auto resolves to light when system is light', () => {
    expect(resolveTheme('auto', false)).toBe('light')
  })

  it('auto resolves to dark when system is dark', () => {
    expect(resolveTheme('auto', true)).toBe('dark')
  })

  it('preserves explicit light and dark regardless of system', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

// ---------------------------------------------------------------------------
describe('applyThemeClass', () => {
  it('adds dark class for dark', () => {
    classList = new Set()
    applyThemeClass('dark')
    expect(classList.has('dark')).toBe(true)
  })

  it('removes dark class for light', () => {
    classList = new Set(['dark'])
    applyThemeClass('light')
    expect(classList.has('dark')).toBe(false)
  })

  it('is idempotent', () => {
    classList = new Set(['dark'])
    applyThemeClass('dark')
    applyThemeClass('dark')
    expect(classList.has('dark')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('ThemeProvider initial class', () => {
  it('applies dark class when stored theme is dark', () => {
    installMocks({ theme: 'dark' })
    renderProbe()
    expect(classList.has('dark')).toBe(true)
  })

  it('does not apply dark class when stored theme is light', () => {
    installMocks({ theme: 'light' })
    renderProbe()
    expect(classList.has('dark')).toBe(false)
  })

  it('auto resolves to light when system prefers light', () => {
    installMocks({ theme: 'auto' })
    mediaMatches = false
    renderProbe()
    expect(classList.has('dark')).toBe(false)
  })

  it('auto resolves to dark when system prefers dark', () => {
    installMocks({ theme: 'auto' })
    mediaMatches = true
    renderProbe()
    expect(classList.has('dark')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('ThemeProvider resolved value', () => {
  it('exposes the stored theme and resolved theme', () => {
    installMocks({ theme: 'dark' })
    const api = renderProbe()
    expect(api.theme).toBe('dark')
    expect(api.resolved).toBe('dark')
  })

  it('exposes auto as auto and resolved as system-derived', () => {
    installMocks({ theme: 'auto' })
    mediaMatches = true
    const api = renderProbe()
    expect(api.theme).toBe('auto')
    expect(api.resolved).toBe('dark')
  })
})

// ---------------------------------------------------------------------------
describe('setTheme', () => {
  it('switches from light to dark and persists to localStorage', () => {
    installMocks({ theme: 'light' })
    const api = renderProbe()
    expect(api.theme).toBe('light')
    expect(classList.has('dark')).toBe(false)

    api.setTheme('dark')
    const stored = JSON.parse(globalThis.localStorage.getItem(STORAGE_KEY)!)
    expect(stored.theme).toBe('dark')
  })

  it('applies the new class on the next render', () => {
    installMocks({ theme: 'light' })
    const api = renderProbe()
    expect(api.theme).toBe('light')
    expect(classList.has('dark')).toBe(false)

    api.setTheme('dark')
    const api2 = renderProbe()
    expect(api2.theme).toBe('dark')
    expect(classList.has('dark')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('reload persistence', () => {
  it('keeps dark after store reset (simulating reload)', () => {
    installMocks({ theme: 'dark' })
    renderProbe()
    expect(classList.has('dark')).toBe(true)

    resetThemeStore()
    const api = renderProbe()
    expect(api.theme).toBe('dark')
    expect(classList.has('dark')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
describe('useTheme outside Provider', () => {
  it('throws when used without ThemeProvider', () => {
    function Probe() {
      useTheme()
      return null
    }
    expect(() => renderToStaticMarkup(createElement(Probe))).toThrow(
      'useTheme must be used within a ThemeProvider',
    )
  })
})

// ---------------------------------------------------------------------------
describe('useEChartsTheme', () => {
  const lightVars: Record<string, string> = {
    '--chart-1': '#27477A',
    '--chart-2': '#61764B',
    '--chart-3': '#576D79',
    '--chart-4': '#AD3140',
    '--chart-5': '#998D86',
    '--border': '#E8E4DC',
    '--muted-foreground': '#666F68',
    '--popover': '#FFFFFF',
    '--popover-foreground': '#2A2A2A',
  }

  const darkVars: Record<string, string> = {
    '--chart-1': '#73B3C1',
    '--chart-2': '#A9C087',
    '--chart-3': '#8A9DA8',
    '--chart-4': '#D96A75',
    '--chart-5': '#B0A89E',
    '--border': '#3A3A38',
    '--muted-foreground': '#A99F96',
    '--popover': '#2A2A2A',
    '--popover-foreground': '#F0EDE5',
  }

  it('rebuilds light theme from resolved light', () => {
    installMocks({ theme: 'light' })
    const theme = renderEChartsProbe(lightVars)
    expect(theme.color).toEqual([
      '#27477A',
      '#61764B',
      '#576D79',
      '#AD3140',
      '#998D86',
    ])
  })

  it('rebuilds dark theme from resolved dark', () => {
    installMocks({ theme: 'dark' })
    const theme = renderEChartsProbe(darkVars)
    expect(theme.color).toEqual([
      '#73B3C1',
      '#A9C087',
      '#8A9DA8',
      '#D96A75',
      '#B0A89E',
    ])
  })
})
