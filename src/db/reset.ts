import type { ReadGraphDB, ReadGraphTableName } from './db'
import { READGRAPH_TABLES } from './db'

export interface ResetOptions {
  /** 为真时清除 localStorage 下所有 readgraph:* 键。 */
  clearPreferences?: boolean
}

/**
 * 原子系统重置：在单个 rw 事务内清空全部六张 Object Store。
 * 任一 clear 失败则事务整体回滚，绝不留半清空中间态。
 * 可选清除 localStorage 下 readgraph:* 偏好键。本函数不提供导出；
 * UI 层在调用前应强制导出/二次确认（属设置页规格）。
 */
export async function resetDatabase(db: ReadGraphDB, options: ResetOptions = {}): Promise<void> {
  const { clearPreferences = false } = options
  await db.transaction('rw', READGRAPH_TABLES as ReadGraphTableName[], async () => {
    await Promise.all(READGRAPH_TABLES.map((name) => db.table(name).clear()))
  })
  if (clearPreferences) clearReadGraphStorage()
}

/** 清除 localStorage 中所有以 readgraph: 前缀开头的键。 */
function clearReadGraphStorage(): void {
  if (typeof localStorage === 'undefined') return
  const keys: string[] = []
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && key.startsWith('readgraph:')) keys.push(key)
  }
  for (const key of keys) localStorage.removeItem(key)
}
