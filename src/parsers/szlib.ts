// 深圳图书馆 Parser（§10.2、szlib-parser.md）。
// 纯函数、同步、无 Node-only API。parse 只读 rawData + source，不写存储。
import type { Book, BorrowCycle, CatalogRecord, ClassificationEntry, ParseWarning } from '@/types/entities'
import { localToUtc } from '@/lib/time'
import { normalizeIsbn } from '@/lib/isbn'
import { decodeHtmlEntities } from '@/lib/encoding'
import { parseTitle } from '@/lib/title'
import type { SourceParser } from './types'
const PLACEHOLDER_TITLE = '福田图书馆读者自选图书'
/** 与借阅状态无关、须在解析与预览阶段一并剔除的操作类型（szlib-parser §1）。 */
const IGNORED_OPTYPES = new Set(['自助查询', '读者续借'])
/** 参与借还周期合成的合法操作类型（szlib-parser §1）。 */
const VALID_OPTYPES = new Set(['读者借出', '读者还回文献'])
interface SzlibRow {
  date: string
  time: string
  optype: string
  cirtype?: string
  metatable?: string
  metaid?: number
  title: string
  ISBN?: string
  addr?: string
  barcode: string
  callno?: string
  [k: string]: unknown
}
function noIsbnKey(parsedTitle: string, firstAuthor: string): string {
  return `noisbn:${parsedTitle}|${firstAuthor}`
}
function extractClassification(callno: string | undefined): ClassificationEntry[] {
  if (!callno) return []
  const code = callno.split('/')[0]!.trim()
  return code ? [{ system: 'clc', code }] : []
}
function metaIdKeyOf(metatable: string | undefined, metaid: number | undefined): string | null {
  if (!metatable || metaid == null || metaid === 0) return null
  return String(metaid)
}
interface RawRow {
  rowIndex: number
  rawRecordId: string
  data: SzlibRow
}
interface GroupedCycle {
  barcode: string
  sorted: RawRow[]
}
/**
 * 行级预过滤（szlib-parser §1）：剔除「自助查询」「读者续借」等与借阅状态无关的
 * 操作，以及未知 optype 行，只保留参与借还周期合成的合法行。parse 与 UI 预览
 * 共用此过滤标准，保证预览所见即导入所得。
 */
export function filterSzlibRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.filter(
    (row): row is Record<string, unknown> =>
      row != null && typeof row === 'object' && VALID_OPTYPES.has(row.optype as string),
  )
}

function szlibToUtc(date: string, time: string, timezone: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(date)
  const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time)
  if (!m || !t) throw new Error(`invalid szlib date/time: ${date} ${time}`)
  const iso = `${m[1]!}-${m[2]!}-${m[3]!}T${t[1]!}:${t[2]!}:${t[3]!}`
  return localToUtc(iso, timezone)
}
export const szlibParser: SourceParser = {
  id: 'szlib',
  name: 'Shenzhen Library',
  supportedFormats: ['json'],
  validate(rawData) {
    if (rawData == null) return false
    let text: string
    if (typeof rawData === 'string') {
      text = rawData
    } else if (rawData instanceof ArrayBuffer) {
      text = new TextDecoder('utf-8', { fatal: false }).decode(rawData)
    } else {
      return false
    }
    const trimmed = text.trim()
    if (!trimmed.startsWith('[') && !trimmed.startsWith('{')) return false
    try {
      const parsed = JSON.parse(trimmed) as unknown
      if (!Array.isArray(parsed)) return false
      const rows = parsed as unknown[]
      if (rows.length === 0) return false
      return rows.every((r) => {
        if (typeof r !== 'object' || r == null) return false
        const row = r as Record<string, unknown>
        return 'optype' in row && 'barcode' in row && 'date' in row && 'time' in row && 'title' in row
      })
    } catch {
      return false
    }
  },
  parse(rawData, source) {
    const warnings: ParseWarning[] = []
    let text: string
    if (typeof rawData === 'string') {
      text = rawData
    } else if (rawData instanceof ArrayBuffer) {
      text = new TextDecoder('utf-8', { fatal: false }).decode(rawData)
    } else {
      throw new Error('szlib.parse: rawData must be string or ArrayBuffer')
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw new Error(`szlib.parse: rawData is not valid JSON: ${(e as Error).message}`)
    }
    if (!Array.isArray(parsed)) {
      throw new Error('szlib.parse: expected a JSON array of circulation rows')
    }
    const rows = parsed as SzlibRow[]
    const tz = source.timezone
    const validRows: RawRow[] = []
    let skippedFiltered = 0
    rows.forEach((row, idx) => {
      const rowIndex = idx + 1
      if (!row || typeof row !== 'object') return
      const rr: RawRow = { rowIndex, rawRecordId: '', data: row }
      if (IGNORED_OPTYPES.has(row.optype)) {
        skippedFiltered++
        return
      }
      if (!VALID_OPTYPES.has(row.optype)) {
        skippedFiltered++
        warnings.push({ type: 'format_error', message: `unknown optype "${row.optype ?? ''}"`, recordRef: `row:${rowIndex}` })
        return
      }
      validRows.push(rr)
    })
    const byBarcode = new Map<string, GroupedCycle>()
    for (const rr of validRows) {
      const barcode = rr.data.barcode ?? ''
      let g = byBarcode.get(barcode)
      if (!g) {
        g = { barcode, sorted: [] }
        byBarcode.set(barcode, g)
      }
      g.sorted.push(rr)
    }
    for (const g of byBarcode.values()) {
      g.sorted.sort((a, b) => {
        const ta = `${a.data.date}${a.data.time}`
        const tb = `${b.data.date}${b.data.time}`
        if (ta !== tb) return ta < tb ? -1 : 1
        return a.rowIndex - b.rowIndex
      })
    }
    const borrowCycles: Partial<BorrowCycle>[] = []
    // 周期标注其消费的原始行（文件行号，与 buildRawRecords.rowIndex 一致）；
    // pipeline 按行号取 rawRecordIds 与 metaid 消歧（瞬态字段，不入库）。
    const pushCycle = (c: Partial<BorrowCycle>, rows: RawRow[]): void => {
      ;(c as Record<string, unknown>)._rowIndexes = rows.map((r) => r.rowIndex)
      borrowCycles.push(c)
    }
    for (const g of byBarcode.values()) {
      // 借还配对按书目身份（metaid）而非「最近一次借出」：同组（尤其空条码
      // 期刊）交错借还（借A 借B 还A 还B）时栈式配对会把还回错配成纯还回，
      // 或把开放周期挂到错误的书。同一 metaid 的借出未还又借（异常）时先关闭旧周期。
      const openByMetaId = new Map<
        string,
        { borrowedAt: Date; borrowLocation: string | null; rows: RawRow[] }
      >()
      for (const rr of g.sorted) {
        const { optype } = rr.data
        let utc: Date
        try {
          utc = szlibToUtc(rr.data.date, rr.data.time, tz)
        } catch {
          warnings.push({ type: 'invalid_date', message: `无法解析日期/时间: "${rr.data.date} ${rr.data.time}"`, recordRef: `row:${rr.rowIndex}` })
          continue
        }
        if (optype === '读者借出') {
          const metaKey = metaIdKeyOf(rr.data.metatable, rr.data.metaid) ?? ''
          const prev = openByMetaId.get(metaKey)
          if (prev) {
            pushCycle({ sourceId: source.id, barcode: g.barcode || null, borrowedAt: prev.borrowedAt, returnedAt: null, status: 'unknown', borrowLocation: prev.borrowLocation, returnLocation: null, rawRecordIds: [] } as Partial<BorrowCycle>, prev.rows)
          }
          openByMetaId.set(metaKey, { borrowedAt: utc, borrowLocation: (rr.data.addr as string | undefined) ?? null, rows: [rr] })
        } else if (optype === '读者还回文献') {
          const metaKey = metaIdKeyOf(rr.data.metatable, rr.data.metaid) ?? ''
          const open = openByMetaId.get(metaKey)
          if (open) {
            pushCycle({ sourceId: source.id, barcode: g.barcode || null, borrowedAt: open.borrowedAt, returnedAt: utc, status: 'returned', borrowLocation: open.borrowLocation, returnLocation: (rr.data.addr as string | undefined) ?? null, rawRecordIds: [] } as Partial<BorrowCycle>, [...open.rows, rr])
            openByMetaId.delete(metaKey)
          } else {
            pushCycle({ sourceId: source.id, barcode: g.barcode || null, borrowedAt: utc, returnedAt: utc, status: 'unknown', borrowLocation: null, returnLocation: (rr.data.addr as string | undefined) ?? null, rawRecordIds: [] } as Partial<BorrowCycle>, [rr])
          }
        }
      }
      for (const open of openByMetaId.values()) {
        pushCycle({ sourceId: source.id, barcode: g.barcode || null, borrowedAt: open.borrowedAt, returnedAt: null, status: 'unknown', borrowLocation: open.borrowLocation, returnLocation: null, rawRecordIds: [] } as Partial<BorrowCycle>, open.rows)
      }
    }
    const books: Partial<Book>[] = []
    const catalogRecords: Partial<CatalogRecord>[] = []
    const bookByKey = new Map<string, number>()
    const catalogByKey = new Map<string, number>()
    for (const rr of validRows) {
      const row = rr.data
      // OPAC 导出标题可能含 HTML 实体（如 `&apos;`）；先解码再解析，
      // 保证正题名/并列题名/责任者干净且去重键一致（§10.13）。
      const rawTitle = decodeHtmlEntities(row.title ?? '')
      const isPlaceholder = rawTitle === PLACEHOLDER_TITLE && (row.ISBN ?? '') === ''
      const parsed = parseTitle(rawTitle)
      const { isbn13, isbn10 } = normalizeIsbn(row.ISBN)
      let key: string
      if (isPlaceholder) {
        key = `ph:${row.barcode}`
      } else if (isbn13) {
        key = `isbn:${isbn13}`
      } else {
        key = noIsbnKey(parsed.title, parsed.authors[0] ?? '')
      }
      if (!bookByKey.has(key)) {
        bookByKey.set(key, books.length)
        if (isPlaceholder) {
          const b = { isbn13: null, isbn10: null, title: rawTitle, subtitle: null, authors: [], translators: [], publisher: null, publishDate: null, edition: null, pages: null, price: null, subjects: [], tags: [], coverUrl: null, description: null, needsReview: true, sourceIds: [source.id], parallelTitles: [] } as Partial<Book>
          ;(b as Record<string, unknown>)._bookKey = key
          books.push(b)
        } else {
          const b = { isbn13, isbn10, title: parsed.title, subtitle: null, authors: parsed.authors, translators: parsed.translators, publisher: null, publishDate: null, edition: null, pages: null, price: null, subjects: [], tags: [], coverUrl: null, description: null, needsReview: false, sourceIds: [source.id], parallelTitles: parsed.parallelTitles } as Partial<Book>
          ;(b as Record<string, unknown>)._bookKey = key
          books.push(b)
        }
      }
const catKey = `${source.id}|${row.barcode}|${row.metaid ?? ''}`
if (!catalogByKey.has(catKey)) {
  catalogByKey.set(catKey, catalogRecords.length)
  const crPartial = { sourceId: source.id, metaId: row.metaid ?? null, metaIdKey: metaIdKeyOf(row.metatable, row.metaid), barcodes: [row.barcode], classifications: extractClassification(row.callno) } as Partial<CatalogRecord>
  // 瞬态键：pipeline 按 bookKey 与候选 Book 对齐（非类型字段，不入库）。
  ;(crPartial as Record<string, unknown>)._bookKey = key
  catalogRecords.push(crPartial)
}
    }
    const stats = { totalRawRecords: rows.length, parsedBooks: books.length, parsedCatalogRecords: catalogRecords.length, parsedCycles: borrowCycles.length, skippedRecords: skippedFiltered }
    return { books, catalogRecords, borrowCycles, warnings, stats }
  },
  filterRows(rows) {
    return filterSzlibRows(rows)
  },
}
