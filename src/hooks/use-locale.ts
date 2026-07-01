import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import { setStoredLocale, type Locale, LOCALES } from '@/lib/locale'
import { changeLanguage } from '@/i18n'

/**
 * Reactive locale + typed setter. Combines react-i18next's reactive `i18n.language`
 * with persistence and <html lang> sync, matching the app-spec §8.5 contract.
 */
export function useLocale() {
  const { i18n } = useTranslation()
  const current = (i18n.language as Locale) ?? LOCALES[0]

  const setLocale = useCallback(async (locale: Locale) => {
    setStoredLocale(locale)
    await changeLanguage(locale)
  }, [])

  return { locale: current, setLocale, locales: LOCALES } as const
}
