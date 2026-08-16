// 错误分类与本地化（quality-hardening 阶段 2 A-4：WCAG 3.3.1 错误识别 /
// 3.3.3 建议 / 3.1.2 语言）。
// 把 unknown 错误分类为有限 ErrorKind，映射到 i18n messageKey + 可行动
// suggestionKey；原始 detail 仅供 console.error 保留诊断，不直接展示给用户。
// 纯函数、无 UI 依赖、零新增依赖（复用 zod / dexie 现有依赖）。
import Dexie from 'dexie'
import { ZodError } from 'zod'

export type ErrorKind =
  | 'zod-parse' // settings 备份导入：结构/字段非法（ZodError）
  | 'backup-invalid' // 备份语义损坏：parseExportText/importDatabase 抛出的完整性错误
  | 'file-invalid' // 导入文件非 JSON 或与所选来源不匹配（import 页）
  | 'file-empty' // 过滤后无有效行（import 页）
  | 'network' // 网络请求失败（fetch 类 TypeError）
  | 'dexie' // IndexedDB/Dexie 事务、约束或配额错误
  | 'generic' // 其他 Error
  | 'unknown' // 非 Error 值

export interface ErrorMessage {
  kind: ErrorKind
  /** 本地化 message 的 i18n key（pages 命名空间）。 */
  messageKey: string
  /** 可行动 suggestion 的 i18n key（pages 命名空间）。 */
  suggestionKey: string
  /** 原始错误摘要（message/name），供 console.error 保留诊断。 */
  detail: string
}

/** IndexedDB/DOMException 错误名（无 Dexie 包装的裸错误兜底）。 */
const DB_ERROR_NAMES = new Set([
  'AbortError',
  'ConstraintError',
  'DataCloneError',
  'DataError',
  'InvalidStateError',
  'QuotaExceededError',
  'ReadOnlyError',
  'SecurityError',
  'TransactionInactiveError',
  'UnknownError',
  'VersionError',
])

/** fetch 类网络错误的 message 特征（TypeError 是常见超类，须先于 generic 匹配）。 */
const NETWORK_ERROR_RE = /failed to fetch|networkerror|network request failed|load failed|fetch failed/i

/** ErrorKind → pages.json key 映射（import.* / settings.* 命名空间，zh/en 同步维护）。 */
const KIND_KEYS: Record<ErrorKind, { messageKey: string; suggestionKey: string }> = {
  'zod-parse': {
    messageKey: 'settings.data.import.invalid',
    suggestionKey: 'settings.import.error.invalid.suggest',
  },
  'backup-invalid': {
    messageKey: 'settings.import.error.corrupt.message',
    suggestionKey: 'settings.import.error.corrupt.suggest',
  },
  'file-invalid': {
    messageKey: 'import.error.fileInvalid.message',
    suggestionKey: 'import.error.fileInvalid.suggest',
  },
  'file-empty': {
    messageKey: 'import.error.fileEmpty.message',
    suggestionKey: 'import.error.fileEmpty.suggest',
  },
  network: {
    messageKey: 'import.error.network.message',
    suggestionKey: 'import.error.network.suggest',
  },
  dexie: {
    messageKey: 'import.error.dexie.message',
    suggestionKey: 'import.error.dexie.suggest',
  },
  generic: {
    messageKey: 'import.error.generic.message',
    suggestionKey: 'import.error.generic.suggest',
  },
  unknown: {
    messageKey: 'import.error.generic.message',
    suggestionKey: 'import.error.generic.suggest',
  },
}

/** Dexie 错误类实例，或携带已知 IndexedDB/DOMException 错误名的裸对象。 */
function isDbError(e: unknown): boolean {
  if (e instanceof Dexie.DexieError) return true
  return (
    typeof e === 'object' &&
    e !== null &&
    'name' in e &&
    typeof (e as { name: unknown }).name === 'string' &&
    DB_ERROR_NAMES.has((e as { name: string }).name)
  )
}

function isNetworkError(e: unknown): e is TypeError {
  return e instanceof TypeError && NETWORK_ERROR_RE.test(e.message)
}

/** unknown → 字符串诊断摘要（供 console.error，非用户可见）。 */
function detailOf(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  try {
    return JSON.stringify(e) ?? String(e)
  } catch {
    return String(e)
  }
}

function of(kind: ErrorKind, e: unknown): ErrorMessage {
  const keys = KIND_KEYS[kind]
  return {
    kind,
    messageKey: keys.messageKey,
    suggestionKey: keys.suggestionKey,
    detail: detailOf(e),
  }
}

/**
 * 把 unknown 错误分类为 ErrorKind 并映射本地化 messageKey/suggestionKey。
 * 调用方展示 messageKey/suggestionKey（经 t()），原始 detail 走 console.error。
 */
export function classifyError(e: unknown): ErrorMessage {
  if (e instanceof ZodError) return of('zod-parse', e)
  if (isDbError(e)) return of('dexie', e)
  if (isNetworkError(e)) return of('network', e)
  if (e instanceof Error) {
    const msg = e.message
    // settings 备份导入路径（parseExportText / importDatabase）抛出的语义错误。
    if (msg.startsWith('parseExportText:') || msg.startsWith('importDatabase:')) {
      return of('backup-invalid', e)
    }
    // import 页 executeImport 抛出的已知错误（run-import.ts 消息前缀）。
    if (msg === 'invalid JSON file' || msg.includes('does not match file content')) {
      return of('file-invalid', e)
    }
    if (msg.startsWith('import contains no valid rows')) {
      return of('file-empty', e)
    }
    return of('generic', e)
  }
  return of('unknown', e)
}
