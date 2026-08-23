import { z } from 'zod'

import { browserLocale, getStoredLocale, STORAGE_KEY } from './locale'

export const LOCALES = ['zh-CN', 'en'] as const

/** Zod schema for the readgraph:preferences localStorage value. */
export const userPreferencesSchema = z.object({
  locale: z.enum(LOCALES),
  theme: z.enum(['light', 'dark', 'auto']),
  displayTimezone: z.string(),
  ai: z.object({
    enabled: z.boolean(),
    baseUrl: z.string(),
    model: z.string(),
    sendPreview: z.boolean(),
  }),
})

export type UserPreferencesInput = z.input<typeof userPreferencesSchema>
export type UserPreferencesParsed = z.output<typeof userPreferencesSchema>

export const DEFAULT_PREFERENCES = {
  locale: 'zh-CN' as const,
  theme: 'auto' as const,
  displayTimezone: 'Asia/Shanghai',
  ai: { enabled: false, baseUrl: '', model: '', sendPreview: true },
}

export type Theme = 'light' | 'dark' | 'auto'

const THEME_VALUES: readonly string[] = ['light', 'dark', 'auto']

function readRawObject(): Record<string, unknown> | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    }
  } catch {
    // corrupt JSON — fall through to defaults
  }
  return null
}

/**
 * 读取并校验用户偏好。locale 沿用 locale.ts 的 getStoredLocale()
 * （不重写，避免回归既有 i18n 测试）；theme、displayTimezone 与 ai 由本函数从
 * localStorage 原始对象读取并补齐。safeParse 失败降级到默认。
 */
export function readPreferences(): UserPreferencesParsed {
  const raw = readRawObject()
  const locale = getStoredLocale()
  let theme: UserPreferencesParsed['theme'] = DEFAULT_PREFERENCES.theme
  let displayTimezone = DEFAULT_PREFERENCES.displayTimezone
  let ai: UserPreferencesParsed['ai'] = DEFAULT_PREFERENCES.ai

  if (raw) {
    if (typeof raw.theme === 'string' && THEME_VALUES.includes(raw.theme)) {
      theme = raw.theme as UserPreferencesParsed['theme']
    }
    if (typeof raw.displayTimezone === 'string' && raw.displayTimezone.length > 0) {
      displayTimezone = raw.displayTimezone
    }
    // ai 缺失/非对象 → 默认 ai；字段逐类型校验（非 boolean/非 string → 降级默认，
    // 与 theme/displayTimezone 同模式，zod .default 只处理缺失不处理错型）
    const rawAi = raw.ai
    if (rawAi && typeof rawAi === 'object') {
      const aiObj = rawAi as Record<string, unknown>
      ai = {
        enabled:
          typeof aiObj.enabled === 'boolean'
            ? aiObj.enabled
            : DEFAULT_PREFERENCES.ai.enabled,
        baseUrl:
          typeof aiObj.baseUrl === 'string' ? aiObj.baseUrl : DEFAULT_PREFERENCES.ai.baseUrl,
        model: typeof aiObj.model === 'string' ? aiObj.model : DEFAULT_PREFERENCES.ai.model,
        sendPreview:
          typeof aiObj.sendPreview === 'boolean'
            ? aiObj.sendPreview
            : DEFAULT_PREFERENCES.ai.sendPreview,
      }
    }
  }

  const candidate = { locale, theme, displayTimezone, ai }
  const result = userPreferencesSchema.safeParse(candidate)
  if (!result.success) {
    return { ...DEFAULT_PREFERENCES, locale }
  }
  return result.data
}

/**
 * 合并写入偏好，整体过 schema 校验。locale 仍通过 locale.ts 的
 * setStoredLocale 持久化（保持既有 i18n 行为），其余字段合并入同一 key。
 */
export function writePreferences(
  patch: Partial<UserPreferencesInput>,
): UserPreferencesParsed {
  const current = readPreferences()
  const next = { ...current, ...patch }
  const parsed = userPreferencesSchema.safeParse(next)
  if (!parsed.success) return current
  const out = parsed.data
  try {
    if (typeof localStorage === 'undefined') return out
    localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
  } catch {
    // storage unavailable / quota — non-fatal
  }
  return out
}

export { browserLocale, getStoredLocale, STORAGE_KEY }
