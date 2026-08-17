import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react'

import {
  DEFAULT_PREFERENCES,
  readPreferences,
  writePreferences,
  type Theme,
} from '@/lib/preferences'

type ResolvedTheme = 'light' | 'dark'

export interface ThemeContextValue {
  theme: Theme
  resolved: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

// ---------------------------------------------------------------------------
// External store
//
// Theme is stored in localStorage via `readPreferences` / `writePreferences`,
// but we keep a module-level cache + pub/sub so that:
//   - SSR / static render can resolve the initial theme without a DOM effect.
//   - Tests can reset the store and re-render a fresh Provider in a node env.
// ---------------------------------------------------------------------------
let storeTheme: Theme | null = null
let storeInitialized = false
const storeListeners = new Set<() => void>()

/** Reset the module-level theme store. Exported for tests only. */
export function resetThemeStore(): void {
  storeTheme = null
  storeInitialized = false
  storeListeners.clear()
}

function getStoreTheme(): Theme {
  if (!storeInitialized) {
    storeTheme = readPreferences().theme
    storeInitialized = true
  }
  return storeTheme ?? DEFAULT_PREFERENCES.theme
}

function setStoreTheme(theme: Theme): void {
  storeTheme = theme
  storeInitialized = true
  for (const listener of storeListeners) listener()
}

function subscribeStore(listener: () => void): () => void {
  storeListeners.add(listener)
  return () => {
    storeListeners.delete(listener)
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function resolveTheme(theme: Theme, systemDark: boolean): ResolvedTheme {
  if (theme === 'auto') return systemDark ? 'dark' : 'light'
  return theme
}

export function applyThemeClass(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (resolved === 'dark') {
    root.classList.add('dark')
  } else {
    root.classList.remove('dark')
  }
}

// ---------------------------------------------------------------------------
// System dark mode
// ---------------------------------------------------------------------------

function getMatchMedia(): typeof window.matchMedia | undefined {
  if (typeof window !== 'undefined' && window.matchMedia) return window.matchMedia
  if (typeof globalThis.matchMedia !== 'undefined') return globalThis.matchMedia
  return undefined
}

function useSystemDark(): boolean {
  const [systemDark, setSystemDark] = useState(() => {
    const matchMedia = getMatchMedia()
    if (!matchMedia) return false
    return matchMedia('(prefers-color-scheme: dark)').matches
  })

  useEffect(() => {
    const matchMedia = getMatchMedia()
    if (!matchMedia) return
    const mql = matchMedia('(prefers-color-scheme: dark)')
    const handler = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    mql.addEventListener('change', handler)
    return () => {
      mql.removeEventListener('change', handler)
    }
  }, [])

  return systemDark
}

// ---------------------------------------------------------------------------
// Provider / Hook
// ---------------------------------------------------------------------------

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeStore, getStoreTheme, getStoreTheme)
  const systemDark = useSystemDark()
  const resolved = resolveTheme(theme, systemDark)
  applyThemeClass(resolved)

  const setTheme = useCallback((next: Theme) => {
    setStoreTheme(next)
    writePreferences({ theme: next })
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolved, setTheme }),
    [theme, resolved, setTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
