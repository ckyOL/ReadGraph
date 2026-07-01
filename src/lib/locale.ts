export const LOCALES = ['zh-CN', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'zh-CN'
export const STORAGE_KEY = 'readgraph:preferences'

/** Locale portion of UserPreferences (internal-schema). Theme/timezone live elsewhere. */
export interface LocalePreferences {
  locale: Locale
}

const isLocale = (v: unknown): v is Locale =>
  typeof v === 'string' && (LOCALES as readonly string[]).includes(v)

/** Read + validate the persisted locale, falling back to browser language then default. */
export function getStoredLocale(): Locale {
  if (typeof localStorage === 'undefined') return browserLocale()
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && isLocale((parsed as LocalePreferences).locale)) {
        return (parsed as LocalePreferences).locale
      }
    }
  } catch {
    // corrupt JSON, fall through
  }
  return browserLocale()
}

/** Persist just the locale, merging into any existing preferences object. */
export function setStoredLocale(locale: Locale): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const base = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...base, locale }))
  } catch {
    // storage unavailable / quota; non-fatal for a pure-frontend app
  }
}

/** Pick a supported locale from navigator.language, else default. */
export function browserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE
  const lang = navigator.language
  if (lang.startsWith('zh')) return 'zh-CN'
  if (lang.startsWith('en')) return 'en'
  return DEFAULT_LOCALE
}
