import { describe, it, expect } from 'vitest'
import Dexie from 'dexie'
import { z } from 'zod'

import zhPages from '@/i18n/locales/zh-CN/pages.json'
import enPages from '@/i18n/locales/en/pages.json'
import { classifyError, type ErrorMessage } from '@/lib/error-messages'

const zh = zhPages as Record<string, string>
const en = enPages as Record<string, string>

/** 断言分类结果的 messageKey/suggestionKey 在 zh-CN 与 en 两个 bundle 中都存在（A-4 验收）。 */
function expectKeysInBundles(result: ErrorMessage): void {
  for (const key of [result.messageKey, result.suggestionKey]) {
    expect(zh[key], `zh-CN bundle 缺少 key: ${key}`).toBeTypeOf('string')
    expect(en[key], `en bundle 缺少 key: ${key}`).toBeTypeOf('string')
  }
}

describe('classifyError — ZodError（settings 备份导入：结构/字段非法）', () => {
  it('映射到备份无效 messageKey + 重新导出 suggestionKey', () => {
    const parsed = z.object({ version: z.string() }).safeParse({ version: 1 })
    expect(parsed.success).toBe(false)
    const result = classifyError(parsed.error)
    expect(result.kind).toBe('zod-parse')
    expect(result.messageKey).toBe('settings.data.import.invalid')
    expect(result.suggestionKey).toBe('settings.import.error.invalid.suggest')
    expectKeysInBundles(result)
  })
})

describe('classifyError — 网络 TypeError', () => {
  it('fetch 类 message → network kind', () => {
    const result = classifyError(new TypeError('Failed to fetch'))
    expect(result.kind).toBe('network')
    expect(result.messageKey).toBe('import.error.network.message')
    expect(result.suggestionKey).toBe('import.error.network.suggest')
    expectKeysInBundles(result)
  })

  it('非网络的普通 TypeError → generic kind', () => {
    const result = classifyError(new TypeError('x is not a function'))
    expect(result.kind).toBe('generic')
    expectKeysInBundles(result)
  })
})

describe('classifyError — Dexie / IndexedDB 错误', () => {
  it('Dexie.ConstraintError → dexie kind，detail 保留原始 message', () => {
    const result = classifyError(new Dexie.ConstraintError('Key already exists'))
    expect(result.kind).toBe('dexie')
    expect(result.messageKey).toBe('import.error.dexie.message')
    expect(result.suggestionKey).toBe('import.error.dexie.suggest')
    expect(result.detail).toBe('Key already exists')
    expectKeysInBundles(result)
  })

  it('裸 DOMException 名（QuotaExceededError）→ dexie kind（无 Dexie 包装兜底）', () => {
    const err = new Error('quota exceeded')
    err.name = 'QuotaExceededError'
    const result = classifyError(err)
    expect(result.kind).toBe('dexie')
    expectKeysInBundles(result)
  })
})

describe('classifyError — import 页已知消息前缀的普通 Error', () => {
  it('invalid JSON file → file-invalid kind', () => {
    const result = classifyError(new Error('invalid JSON file'))
    expect(result.kind).toBe('file-invalid')
    expect(result.messageKey).toBe('import.error.fileInvalid.message')
    expect(result.suggestionKey).toBe('import.error.fileInvalid.suggest')
    expectKeysInBundles(result)
  })

  it('parser 与文件内容不匹配 → file-invalid kind', () => {
    const result = classifyError(new Error('parser "szlib" does not match file content'))
    expect(result.kind).toBe('file-invalid')
    expectKeysInBundles(result)
  })

  it('过滤后无有效行 → file-empty kind', () => {
    const result = classifyError(
      new Error('import contains no valid rows after filtering (42 rows filtered)'),
    )
    expect(result.kind).toBe('file-empty')
    expect(result.messageKey).toBe('import.error.fileEmpty.message')
    expect(result.suggestionKey).toBe('import.error.fileEmpty.suggest')
    expectKeysInBundles(result)
  })

  it('parseExportText 前缀（备份非 JSON）→ backup-invalid kind', () => {
    const result = classifyError(new Error('parseExportText: invalid JSON (Unexpected token)'))
    expect(result.kind).toBe('backup-invalid')
    expect(result.messageKey).toBe('settings.import.error.corrupt.message')
    expect(result.suggestionKey).toBe('settings.import.error.corrupt.suggest')
    expectKeysInBundles(result)
  })

  it('importDatabase 前缀（完整性/重放错误）→ backup-invalid kind', () => {
    const result = classifyError(
      new Error('importDatabase: rawRecord r1 references unknown importLog l9'),
    )
    expect(result.kind).toBe('backup-invalid')
    expectKeysInBundles(result)
  })

  it('未知消息的普通 Error → generic kind，detail 保留 message', () => {
    const result = classifyError(new Error('some unexpected failure'))
    expect(result.kind).toBe('generic')
    expect(result.detail).toBe('some unexpected failure')
    expectKeysInBundles(result)
  })
})

describe('classifyError — 非 Error 值', () => {
  it('字符串 → unknown kind，detail 为该字符串', () => {
    const result = classifyError('boom')
    expect(result.kind).toBe('unknown')
    expect(result.detail).toBe('boom')
    expectKeysInBundles(result)
  })

  it('undefined → unknown kind', () => {
    const result = classifyError(undefined)
    expect(result.kind).toBe('unknown')
    expectKeysInBundles(result)
  })

  it('null → unknown kind', () => {
    const result = classifyError(null)
    expect(result.kind).toBe('unknown')
    expectKeysInBundles(result)
  })

  it('普通对象 → unknown kind', () => {
    const result = classifyError({ code: 42 })
    expect(result.kind).toBe('unknown')
    expectKeysInBundles(result)
  })
})
