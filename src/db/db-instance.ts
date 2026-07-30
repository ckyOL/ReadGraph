import { ReadGraphDB } from './db'

/**
 * 浏览器侧 Dexie 单例。
 *
 * 组件层一律从此处 import `db`，配合 `dexie-react-hooks` 的 `useLiveQuery`
 * 直连实体表（data-layer §12「UI 响应式由 useLiveQuery 直连 Dexie」）。
 * 测试不直接使用本单例——`src/db/test-helpers.ts` 的 `createTestDB()`
 * 为每条用例生成独立命名库，避免跨用例污染。
 */
export const db = new ReadGraphDB()
