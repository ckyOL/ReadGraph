/**
 * 模型名列表独立存储：存独立 localStorage key，不进 userPreferencesSchema、
 * 不随偏好读写/备份导出（与 API Key 同类：端点运行时数据而非用户偏好）；
 * 端点变更即清空（ai-features §4.2「端点变更 → 已抓取列表失效」），
 * 系统重置 clearPreferences=true 时按 readgraph: 前缀一并清除。
 */

/** 独立存储 key（readgraph: 前缀，系统重置 clearPreferences=true 时一并清除）。 */
export const AI_MODEL_LIST_STORAGE_KEY = 'readgraph:ai-model-list'

/** 读取模型名列表；缺失/损坏 JSON/非数组 → []，并过滤非字符串元素。 */
export function readAiModelList(): string[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(AI_MODEL_LIST_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string')
  } catch {
    // corrupt JSON — fall through to empty
  }
  return []
}

/** 写入模型名列表（JSON 编码存储，损坏时读侧安全降级）。 */
export function writeAiModelList(models: string[]): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(AI_MODEL_LIST_STORAGE_KEY, JSON.stringify(models))
  } catch {
    // storage unavailable / quota — non-fatal
  }
}

/** 清除模型名列表（换端点时调用）。 */
export function clearAiModelList(): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.removeItem(AI_MODEL_LIST_STORAGE_KEY)
  } catch {
    // storage unavailable — non-fatal
  }
}
