// E2E 数据注入辅助（仅 C-7 测试使用）。
//
// 生产构建不含测试夹具；Playwright 通过在页面 `localStorage` 设置
// `readgraph:e2e-seed` 为脱敏夹具 JSON，应用首启时若检测到该 key
// 则用 Dexie 单例灌库，随后清除 key（一次性）。该路径仅当 key 存在
// 时执行，正常用户环境永不触发。
import type {
  Book,
  BorrowCycle,
  CatalogRecord,
  ImportLog,
  RawRecord,
  Source,
} from '@/types/entities'
import { db } from './db-instance'
import { deriveClassCodes } from './repositories'

const SEED_KEY = 'readgraph:e2e-seed'

interface SeedPayload {
  sources: Source[]
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  importLogs?: ImportLog[]
  rawRecords?: RawRecord[]
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function reviveDates<T>(rows: T[], keys: readonly string[]): T[] {
  return rows.map((r) => {
    const out: Record<string, unknown> = { ...(r as unknown as Record<string, unknown>) }
    for (const k of keys) {
      const v = out[k]
      if (typeof v === 'string') {
        const d = new Date(v)
        if (!Number.isNaN(d.getTime())) out[k] = d
      }
    }
    return out as unknown as T
  })
}

const DATE_KEYS = {
  books: ['createdAt', 'updatedAt', 'publishDate'],
  catalogRecords: ['createdAt', 'updatedAt'],
  borrowCycles: ['borrowedAt', 'returnedAt', 'createdAt', 'updatedAt'],
  sources: ['createdAt', 'lastImportAt'],
  rawRecords: [] as string[],
  importLogs: ['importedAt'],
} as const

/**
 * 若 `localStorage[SEED_KEY]` 存在，则解析脱敏夹具并灌入 IndexedDB；
 * 成功后清除 key（一次性，避免 reload 重复）。失败仅 console.warn，不抛。
 */
export async function maybeSeedFromE2E(): Promise<void> {
  if (typeof localStorage === 'undefined') return
  let raw: string | null = null
  try {
    raw = localStorage.getItem(SEED_KEY)
  } catch {
    return
  }
  if (!raw) return
  let payload: SeedPayload
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!isObject(parsed)) throw new Error('seed payload not object')
    payload = {
      sources: reviveDates(parsed.sources as Source[], DATE_KEYS.sources),
      books: reviveDates(parsed.books as Book[], DATE_KEYS.books),
      catalogRecords: reviveDates(
        parsed.catalogRecords as CatalogRecord[],
        DATE_KEYS.catalogRecords,
      ),
      borrowCycles: reviveDates(
        parsed.borrowCycles as BorrowCycle[],
        DATE_KEYS.borrowCycles,
      ),
      importLogs: parsed.importLogs
        ? reviveDates(parsed.importLogs as ImportLog[], DATE_KEYS.importLogs)
        : [],
      rawRecords: parsed.rawRecords
        ? reviveDates(parsed.rawRecords as RawRecord[], DATE_KEYS.rawRecords)
        : [],
    }
  } catch {
    // 非法夹具：静默忽略
    return
  }

  try {
    await db.transaction(
      'rw',
      [db.sources, db.books, db.catalogRecords, db.borrowCycles, db.rawRecords, db.importLogs],
      async () => {
        await Promise.all([
          db.sources.clear(),
          db.books.clear(),
          db.catalogRecords.clear(),
          db.borrowCycles.clear(),
          db.rawRecords.clear(),
          db.importLogs.clear(),
        ])
        if (payload.sources.length) await db.sources.bulkPut(payload.sources)
        if (payload.books.length) await db.books.bulkPut(payload.books)
        if (payload.catalogRecords.length)
          await db.catalogRecords.bulkPut(
            payload.catalogRecords.map(deriveClassCodes),
          )
        if (payload.borrowCycles.length)
          await db.borrowCycles.bulkPut(payload.borrowCycles)
        if (payload.importLogs?.length)
          await db.importLogs.bulkPut(payload.importLogs)
        if (payload.rawRecords?.length)
          await db.rawRecords.bulkPut(payload.rawRecords)
      },
    )
  } catch {
    // 灌库失败不阻塞应用启动
  }
  try {
    localStorage.removeItem(SEED_KEY)
  } catch {
    // ignore
  }
}
