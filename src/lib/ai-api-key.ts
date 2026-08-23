/**
 * API Key 独立存储（ai-features 规格 §5.1）：存独立 localStorage key，
 * 不进 userPreferencesSchema、不随偏好读写/备份导出；调用时读入内存
 * 参与请求头，不进入 React 状态持久化。
 */

/** 独立存储 key（readgraph: 前缀，系统重置 clearPreferences=true 时一并清除）。 */
export const AI_API_KEY_STORAGE_KEY = 'readgraph:ai-api-key'

/** 读取 API Key；缺失/损坏 JSON → ''。 */
export function readAiApiKey(): string {
  if (typeof localStorage === 'undefined') return ''
  try {
    const raw = localStorage.getItem(AI_API_KEY_STORAGE_KEY)
    if (!raw) return ''
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'string' ? parsed : ''
  } catch {
    // corrupt JSON — fall through to empty
  }
  return ''
}

/** 写入 API Key（JSON 编码存储，损坏时读侧安全降级）。 */
export function writeAiApiKey(key: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(AI_API_KEY_STORAGE_KEY, JSON.stringify(key))
  } catch {
    // storage unavailable / quota — non-fatal
  }
}

/** 清除 API Key。 */
export function clearAiApiKey(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(AI_API_KEY_STORAGE_KEY)
  } catch {
    // storage unavailable — non-fatal
  }
}
