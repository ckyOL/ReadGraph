import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import commonZh from './locales/zh-CN/common.json'
import commonEn from './locales/en/common.json'
import navZh from './locales/zh-CN/nav.json'
import navEn from './locales/en/nav.json'
import pagesZh from './locales/zh-CN/pages.json'
import pagesEn from './locales/en/pages.json'
import editZh from './locales/zh-CN/edit.json'
import editEn from './locales/en/edit.json'
import enrichZh from './locales/zh-CN/enrich.json'
import enrichEn from './locales/en/enrich.json'

import { getStoredLocale, type Locale } from '@/lib/locale'

const initialLocale = getStoredLocale()

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': {
      common: commonZh,
      nav: navZh,
      pages: pagesZh,
      edit: editZh,
      enrich: enrichZh,
    },
    en: {
      common: commonEn,
      nav: navEn,
      pages: pagesEn,
      edit: editEn,
      enrich: enrichEn,
    },
  },
  lng: initialLocale,
  fallbackLng: 'zh-CN',
  defaultNS: 'common',
  ns: ['common', 'nav', 'pages', 'edit', 'enrich'],
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
})

// Bootstrap sync: index.html `lang` 默认 zh-CN，必须随持久化 locale 对齐（i18n-conventions §5）。
if (typeof document !== 'undefined') document.documentElement.lang = initialLocale

/** Change locale at runtime; persists and syncs <html lang>. */
export async function changeLanguage(lng: Locale): Promise<void> {
  await i18n.changeLanguage(lng)
  if (typeof document !== 'undefined') document.documentElement.lang = lng
}

export { i18n }
export default i18n
