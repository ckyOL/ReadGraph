import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

import { useLocale } from '@/hooks/use-locale'
import { LOCALES, setStoredLocale, type Locale } from '@/lib/locale'
import { changeLanguage } from '@/i18n'

// Keep the real LOCALES/DEFAULT_LOCALE types but stub the persistence + i18n
// switchers so the hook can be exercised in a pure node environment (no DOM,
// no jsdom, no @testing-library). `renderToStaticMarkup` runs the component
// body once, letting us capture the hook return value and invoke its setter.

vi.mock('@/lib/locale', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import('@/lib/locale')
  return { ...actual, setStoredLocale: vi.fn() }
})

vi.mock('@/i18n', () => ({
  changeLanguage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ i18n: { language: 'zh-CN' } }),
}))

const setStoredLocaleMock = vi.mocked(setStoredLocale)
const changeLanguageMock = vi.mocked(changeLanguage)

describe('useLocale', () => {
  let result: ReturnType<typeof useLocale>

  // Render a probe that captures the hook return without flushing any DOM.
  function Probe() {
    result = useLocale()
    return null
  }

  beforeEach(() => {
    result = undefined as unknown as ReturnType<typeof useLocale>
    setStoredLocaleMock.mockClear()
    changeLanguageMock.mockClear()
    renderToStaticMarkup(<Probe />)
  })

  it('exposes the locked LOCALES enum', () => {
    expect(result.locales).toEqual(LOCALES)
    expect(result.locales).toEqual(['zh-CN', 'en'])
  })

  it('reflects the current i18n language', () => {
    expect(result.locale).toBe('zh-CN')
  })

  it('setLocale persists the preference before switching language', async () => {
    await result.setLocale('en' as Locale)
    expect(setStoredLocaleMock).toHaveBeenCalledWith('en')
    expect(changeLanguageMock).toHaveBeenCalledWith('en')
    // persistence is sequenced before the language switch (app-spec §8.5 / i18n-conventions §5)
    expect(setStoredLocaleMock.mock.invocationCallOrder[0]).toBeLessThan(
      changeLanguageMock.mock.invocationCallOrder[0],
    )
  })

  it('setLocale works for zh-CN too', async () => {
    await result.setLocale('zh-CN' as Locale)
    expect(setStoredLocaleMock).toHaveBeenCalledWith('zh-CN')
    expect(changeLanguageMock).toHaveBeenCalledWith('zh-CN')
  })
})
