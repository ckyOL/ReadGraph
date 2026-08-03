import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { i18n, changeLanguage } from '@/i18n'
import type { Locale } from '@/lib/locale'

// `changeLanguage` touches `document.documentElement.lang`; in the `node`
// test environment there is no DOM, so we install a minimal stand-in per test.

interface FakeDocument {
  documentElement: { lang: string }
}

let savedDoc: Document | undefined
let savedStorage: unknown
let savedNavigatorDescriptor: PropertyDescriptor | undefined

function installDocument(): FakeDocument {
  const doc: FakeDocument = { documentElement: { lang: '' } }
  ;(globalThis as unknown as { document: Document }).document = doc as unknown as Document
  return doc
}

function removeDocument(): void {
  delete (globalThis as unknown as { document?: Document }).document
}

/** Node 21+ 自带全局 navigator（getter 不可赋值），用 defineProperty 模拟浏览器语言。 */
function installNavigator(language: string): void {
  Object.defineProperty(globalThis, 'navigator', {
    value: { language },
    configurable: true,
    writable: true,
  })
}

function removeNavigator(): void {
  delete (globalThis as unknown as { navigator?: unknown }).navigator
}

function installStorage(locale: string): void {
  ;(globalThis as unknown as { localStorage?: unknown }).localStorage = {
    getItem: (key: string) =>
      key === 'readgraph:preferences' ? JSON.stringify({ locale }) : null,
  }
}

function removeStorage(): void {
  delete (globalThis as unknown as { localStorage?: unknown }).localStorage
}

beforeEach(() => {
  savedDoc = (globalThis as unknown as { document?: Document }).document
  savedStorage = (globalThis as unknown as { localStorage?: unknown }).localStorage
  savedNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
})

afterEach(() => {
  const g = globalThis as unknown as { document?: Document; localStorage?: unknown }
  if (savedDoc === undefined) delete g.document
  else g.document = savedDoc
  if (savedStorage === undefined) delete g.localStorage
  else g.localStorage = savedStorage
  if (savedNavigatorDescriptor === undefined) removeNavigator()
  else Object.defineProperty(globalThis, 'navigator', savedNavigatorDescriptor)
})

describe('i18n bootstrap', () => {
  it('initializes with zh-CN as the fallback language', () => {
    expect(i18n.options.fallbackLng).toContain('zh-CN')
  })

  it('loads the four configured namespaces', () => {
    expect(i18n.options.defaultNS).toBe('common')
    expect(Array.isArray(i18n.options.ns)).toBe(true)
    expect(i18n.options.ns).toContain('nav')
    expect(i18n.options.ns).toContain('pages')
    expect(i18n.options.ns).toContain('review')
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

  it('syncs <html lang> to the persisted locale at bootstrap', async () => {
    const doc = installDocument()
    installStorage('en')
    try {
      // Bootstrap 同步在模块求值期捕获 initialLocale，必须动态重导入以重新求值（测试专用例外）。
      vi.resetModules()
      await import('@/i18n')
      expect(doc.documentElement.lang).toBe('en')
    } finally {
      removeStorage()
    }
  })

  it('defaults <html lang> to the browser language at bootstrap when nothing is persisted', async () => {
    const doc = installDocument()
    installNavigator('zh-CN')
    try {
      // 同上：重导入以重新求值模块级 initialLocale。
      vi.resetModules()
      await import('@/i18n')
      expect(doc.documentElement.lang).toBe('zh-CN')
    } finally {
      removeNavigator()
    }
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
