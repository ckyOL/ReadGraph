export const AI_CACHE_PREFIX = 'ai:'

/** 生成结果缓存条目：生成结果 JSON + 生成时间戳。 */
export interface AiCacheEntry {
  result: unknown
  generatedAt: number
}

/** 缓存键形态：ai:{scene}:{locale}:{key}。 */
function cacheKey(scene: string, locale: string, key: string): string {
  return `${AI_CACHE_PREFIX}${scene}:${locale}:${key}`
}

/**
 * 读取生成结果缓存。缺失或损坏 JSON → null；
 * localStorage 不可用时静默降级（与 preferences.ts 同模式）。
 */
export function readAiCache(scene: string, locale: string, key: string): AiCacheEntry | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(cacheKey(scene, locale, key))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const entry = parsed as Partial<AiCacheEntry>
    if (typeof entry.generatedAt !== 'number' || !('result' in entry)) return null
    return { result: entry.result, generatedAt: entry.generatedAt }
  } catch {
    // 损坏 JSON 或存储不可用——视为未命中
    return null
  }
}

/**
 * 写入生成结果缓存（生成结果 JSON + 时间戳）。
 * localStorage 不可用时静默降级（try/catch，与 preferences.ts 同模式）。
 */
export function writeAiCache(scene: string, locale: string, key: string, result: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return
    const entry: AiCacheEntry = { result, generatedAt: Date.now() }
    localStorage.setItem(cacheKey(scene, locale, key), JSON.stringify(entry))
  } catch {
    // 存储不可用 / 配额超限——非致命，静默降级
  }
}

/**
 * 清除全部 AI 生成结果缓存：只删 `ai:` 前缀键，
 * 不碰 readgraph:* 等其他 localStorage 键（不随备份导出，见 export-import）。
 */
export function clearAiCache(): void {
  if (typeof localStorage === 'undefined') return
  try {
    const doomed: string[] = []
    // 以 key(i)===null 终止：兼容 length 快照不准的存储实现（含测试 mock）
    for (let i = 0; ; i++) {
      const k = localStorage.key(i)
      if (k === null) break
      if (k.startsWith(AI_CACHE_PREFIX)) doomed.push(k)
    }
    for (const k of doomed) localStorage.removeItem(k)
  } catch {
    // 存储不可用——静默降级
  }
}
