import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { i18n, changeLanguage } from '@/i18n'
import type { Locale } from '@/lib/locale'

// `changeLanguage` touches `document.documentElement.lang`; in the `node`
// test environment there is no DOM, so we install a minimal stand-in per test.

interface FakeDocument {
  documentElement: { lang: string }
}

let savedDoc: Document | undefined

function installDocument(): FakeDocument {
  const doc: FakeDocument = { documentElement: { lang: '' } }
  ;(globalThis as unknown as { document: Document }).document = doc as unknown as Document
  return doc
}

function removeDocument(): void {
  delete (globalThis as unknown as { document?: Document }).document
}

beforeEach(() => {
  savedDoc = (globalThis as unknown as { document?: Document }).document
})

afterEach(() => {
  const g = globalThis as unknown as { document?: Document }
  if (savedDoc === undefined) delete g.document
  else g.document = savedDoc
})

describe('i18n bootstrap', () => {
  it('initializes with zh-CN as the fallback language', () => {
    expect(i18n.options.fallbackLng).toContain('zh-CN')
  })

  it('loads the three configured namespaces', () => {
    expect(i18n.options.defaultNS).toBe('common')
    expect(Array.isArray(i18n.options.ns)).toBe(true)
    expect(i18n.options.ns).toContain('nav')
    expect(i18n.options.ns).toContain('pages')
  })

  it('translates a nav key in both configured languages', async () => {
    await i18n.changeLanguage('zh-CN')
    expect(i18n.t('nav:dashboard')).toBe('概览')
    await i18n.changeLanguage('en')
    expect(i18n.t('nav:dashboard')).toBe('Overview')
  })

  it('falls back to zh-CN bundles for a language with no resources', async () => {
    // 'fr' has no resources; fallbackLng must kick in so nav renders in zh-CN.
    await i18n.changeLanguage('fr')
    expect(i18n.t('nav:library')).toBe('书库')
  })
})

describe('changeLanguage', () => {
  it('switches i18n.language and syncs <html lang>', async () => {
    const doc = installDocument()
    await changeLanguage('en' as Locale)
    expect(i18n.language).toBe('en')
    expect(doc.documentElement.lang).toBe('en')
  })

  it('switches back to zh-CN and syncs <html lang>', async () => {
    const doc = installDocument()
    await changeLanguage('zh-CN' as Locale)
    expect(i18n.language).toBe('zh-CN')
    expect(doc.documentElement.lang).toBe('zh-CN')
  })

  it('leaves <html lang> untouched when the DOM is unavailable (SSR guard)', async () => {
    removeDocument()
    await expect(changeLanguage('en' as Locale)).resolves.not.toThrow()
    // The function guards on `typeof document !== 'undefined'` and skips DOM sync.
  })
})
