// OPAC 编目语义映射与预填（opac-enrichment 规格 §5.2/§5.3）。
// 来源无关纯函数：输入统一 OpacDetail（任何 provider 产物）+ 当前 Book/CatalogRecord/Source，
// 产出建议改动集（fill/conflict）与格式警告；不做合并裁决（裁决权在用户，保存即采纳）。
// 编目结构化解析复用 parseTitle（import-pipeline §13）与 lib/isbn 清洗。
import type { Book, CatalogRecord, ClassificationEntry, ClassificationSystem, ParseWarning, Source } from '@/types/entities'
import type { OpacDetail } from '@/enrich/opac-provider'
import { normalizeIsbn } from '@/lib/isbn'
import { parseTitle } from '@/lib/title'
// type-only：BookDraft 定义在统一编辑表单动作层（book-editing 规格 §2.1），
// 预填输出与其字段同构，编译期擦除、不引入运行时依赖。
import type { BookDraft } from '@/routes/library/-edit-actions'

/** 建议改动目标字段：BookDraft 可编辑字段名（book-editing §2.1）或 'classifications'（编目侧）。 */
export type EnrichmentField =
  | 'title'
  | 'subtitle'
  | 'parallelTitles'
  | 'authors'
  | 'translators'
  | 'publisher'
  | 'publishDate'
  | 'pages'
  | 'price'
  | 'subjects'
  | 'description'
  | 'coverUrl'
  | 'isbn13'
  | 'isbn10'
  | 'classifications'

/**
 * 建议改动：只描述「OPAC 建议什么、现状是什么」。
 * fill = 现有为空 → 表单预填建议值，无对照；conflict = 现有非空且不同 → 同样预填，
 * 以「现有：…」对照 + 恢复按钮呈现（§5.3/§10）。proposed 与表单字段同构，可直接写入表单状态。
 */
export interface EnrichmentChange {
  field: EnrichmentField
  kind: 'fill' | 'conflict'
  /** 现有值（表单同构形态；null = 空） */
  current: unknown
  /** OPAC 建议值（与表单字段同构） */
  proposed: unknown
}

/** mapOpacDetail 输入：当前 Book + CatalogRecord + Source（classifications.system 取 source.library.classificationSystem）。 */
export interface OpacMappingInput {
  book: Book
  record: CatalogRecord
  source: Source
}

export interface OpacMappingResult {
  changes: EnrichmentChange[]
  warnings: ParseWarning[]
}

function formatWarning(message: string): ParseWarning {
  return { type: 'format_error', message, recordRef: null }
}

function sameArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** subjects 集合语义：顺序无关。 */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(b)
  return a.every((v) => set.has(v))
}

/** 标量字段（string/number/Price 除外）：空 → fill；相同 → 不产出；不同 → conflict。 */
function pushValueChange(
  changes: EnrichmentChange[],
  field: EnrichmentField,
  current: unknown,
  proposed: unknown,
): void {
  if (current == null || current === '') {
    changes.push({ field, kind: 'fill', current, proposed })
  } else if (current !== proposed) {
    changes.push({ field, kind: 'conflict', current, proposed })
  }
}

/** 列表字段（authors/translators）：空建议不产出；空现有 → fill；不同 → conflict。 */
function pushListChange(
  changes: EnrichmentChange[],
  field: 'authors' | 'translators',
  current: string[],
  proposed: string[],
): void {
  if (proposed.length === 0) return
  if (current.length === 0) {
    changes.push({ field, kind: 'fill', current, proposed })
  } else if (!sameArray(current, proposed)) {
    changes.push({ field, kind: 'conflict', current, proposed })
  }
}

/** publish（"出版地:出版社,出版年"）→ publisher/publishDate；不可解析 → null。 */
function parsePublish(raw: string): { publisher: string | null; publishDate: string | null } | null {
  const colon = raw.indexOf(':')
  const rest = (colon >= 0 ? raw.slice(colon + 1) : raw).trim()
  if (rest === '') return null
  const segments = rest
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter((s) => s !== '')
  if (segments.length === 0) return null
  const last = segments[segments.length - 1]!
  const isYear = /^\d{4}$/.test(last)
  const publisherParts = isYear ? segments.slice(0, -1) : segments
  const publisher = publisherParts.join(',').trim()
  return { publisher: publisher === '' ? null : publisher, publishDate: isYear ? last : null }
}

/**
 * price（"CNY35.00"/"¥35.00"/"35.00"）→ { amount, currency }；不可解析 → null。
 * 台版等书价实测形态「CNY110.00(TWD350.00,HKD117.00)」：括号前为主价
 * （馆方定价口径），括号内为原币种参考价——Book.price 只存主价
 * （opac-enrichment §5.2 实测样本补充）；主价为空时回退整体解析。
 */
function parsePrice(raw: string): { amount: number; currency: string } | null {
  const primary = raw.split(/[（(]/)[0]!.trim() || raw.trim()
  const m = /^(?:([¥￥])|([A-Za-z]+))?\s*(\d+(?:\.\d+)?)$/.exec(primary)
  if (!m) return null
  const currency = m[1] != null ? 'CNY' : (m[2] ?? '').toUpperCase() || 'CNY'
  return { amount: Number(m[3]), currency }
}

/**
 * 把统一 OpacDetail 映射为建议改动集（§5.2 字段映射表）。
 * - detail 字段为 null 的项不产出 change（来源无关：缺字段的 provider 不产生建议）。
 * - title 走 `\s*=\s*` → ` = ` 归一化后 parseTitle；author 走 `　`/` 　` → `;` 归一化后 parseTitle 责任区。
 * - 空建议不产出；conflict 的 current/proposed 均与表单字段同构，供 UI 对照渲染。
 */
export function mapOpacDetail(detail: OpacDetail, existing: OpacMappingInput): OpacMappingResult {
  const changes: EnrichmentChange[] = []
  const warnings: ParseWarning[] = []
  const { book, record, source } = existing

  // — Book.title / parallelTitles（detail.title） —
  if (detail.title != null) {
    const parsed = parseTitle(detail.title.replace(/\s*=\s*/g, ' = '))
    if (!parsed.isPlaceholder) {
      if (parsed.title !== '') {
        const current = book.title
        if (current === '' || parseTitle(current).isPlaceholder) {
          changes.push({ field: 'title', kind: 'fill', current, proposed: parsed.title })
        } else if (current !== parsed.title) {
          changes.push({ field: 'title', kind: 'conflict', current, proposed: parsed.title })
        }
      }
      const currentParallel = book.parallelTitles
      if (parsed.parallelTitles.length > 0) {
        if (currentParallel.length === 0) {
          changes.push({
            field: 'parallelTitles',
            kind: 'fill',
            current: currentParallel,
            proposed: parsed.parallelTitles,
          })
        } else if (!sameArray(currentParallel, parsed.parallelTitles)) {
          changes.push({
            field: 'parallelTitles',
            kind: 'conflict',
            current: currentParallel,
            proposed: parsed.parallelTitles,
          })
        }
      } else if (currentParallel.length > 0) {
        // 现有并列题名非空而 OPAC 无并列段 → 结构化回显串不同 → conflict（建议清空，可恢复）。
        changes.push({ field: 'parallelTitles', kind: 'conflict', current: currentParallel, proposed: [] })
      }
    }
  }

  // — Book.authors / translators（detail.author） —
  if (detail.author != null) {
    const parsed = parseTitle(`/${detail.author.replace(/[ \u3000]+/g, ';')}`)
    pushListChange(changes, 'authors', book.authors, parsed.authors)
    pushListChange(changes, 'translators', book.translators, parsed.translators)
  }

  // — Book.isbn13 / isbn10（detail.isbn） —
  if (detail.isbn != null) {
    const { isbn13, isbn10 } = normalizeIsbn(detail.isbn)
    if (isbn13 != null) pushValueChange(changes, 'isbn13', book.isbn13, isbn13)
    if (isbn10 != null) pushValueChange(changes, 'isbn10', book.isbn10, isbn10)
  }

  // — Book.publisher / publishDate（detail.publish） —
  if (detail.publish != null) {
    const parsed = parsePublish(detail.publish)
    if (parsed == null) {
      warnings.push(formatWarning(`无法解析出版信息: "${detail.publish}"`))
    } else {
      if (parsed.publisher != null) pushValueChange(changes, 'publisher', book.publisher, parsed.publisher)
      if (parsed.publishDate != null) {
        pushValueChange(changes, 'publishDate', book.publishDate, parsed.publishDate)
      }
    }
  }

  // — Book.pages（detail.page 首个整数序列） —
  if (detail.page != null) {
    const m = /(\d+)/.exec(detail.page)
    if (m == null) {
      warnings.push(formatWarning(`无法解析页数: "${detail.page}"`))
    } else {
      pushValueChange(changes, 'pages', book.pages, Number(m[1]))
    }
  }

  // — Book.price（货币前缀 + 金额；无前缀默认 CNY） —
  if (detail.price != null) {
    const parsed = parsePrice(detail.price)
    if (parsed == null) {
      warnings.push(formatWarning(`无法解析定价: "${detail.price}"`))
    } else {
      const current = book.price
      if (current == null) {
        changes.push({ field: 'price', kind: 'fill', current, proposed: parsed })
      } else if (current.amount !== parsed.amount || current.currency !== parsed.currency) {
        changes.push({ field: 'price', kind: 'conflict', current, proposed: parsed })
      }
    }
  }

  // — Book.subjects（detail.subject 按 `-` 拆分；集合比较） —
  if (detail.subject != null) {
    const proposed = detail.subject
      .split('-')
      .map((s) => s.trim())
      .filter((s) => s !== '')
    if (proposed.length > 0) {
      if (book.subjects.length === 0) {
        changes.push({ field: 'subjects', kind: 'fill', current: book.subjects, proposed })
      } else if (!sameSet(book.subjects, proposed)) {
        changes.push({ field: 'subjects', kind: 'conflict', current: book.subjects, proposed })
      }
    }
  }

  // — Book.description（detail.abstract） —
  if (detail.abstract != null) pushValueChange(changes, 'description', book.description, detail.abstract)

  // — Book.coverUrl（detail.img） —
  if (detail.img != null) pushValueChange(changes, 'coverUrl', book.coverUrl, detail.img)

  // — CatalogRecord.classifications（detail.classno 去 `(...)` 后缀；追加语义） —
  if (detail.classno != null) {
    const code = detail.classno.replace(/\([^)]*\)$/, '').trim()
    if (code !== '') {
      const system: ClassificationSystem = source.library?.classificationSystem ?? 'clc'
      const entry: ClassificationEntry = { system, code }
      const exists = record.classifications.some((c) => c.system === system && c.code === code)
      if (!exists) {
        changes.push({
          field: 'classifications',
          kind: 'fill',
          current: record.classifications,
          proposed: [entry],
        })
      }
    }
  }

  return { changes, warnings }
}

/**
 * 把有建议值的 change（fill **与** conflict）落成表单初始预填值（§5.3）。
 * - 编辑表单初始化 = bookToDraft(book) ∪ bookPrefill；
 *   recordPrefill.classifications = 现有分类 ∪ 建议分类（按 code+system 去重）后的完整数组。
 * - applied = 实际发生预填的字段（fill 与 conflict 均计入），供 UI 标注「OPAC」徽标；
 *   conflict 项的现有值对照由表单结合 changes 渲染，恢复动作回读初始 book 快照。
 * - kind 由 changes 原样保留（本函数不改写），供 UI 决定对照与徽标展示。
 */
export function prefillFromChanges(
  _book: Book,
  record: CatalogRecord,
  changes: EnrichmentChange[],
): {
  bookPrefill: Partial<BookDraft>
  recordPrefill: { classifications: ClassificationEntry[] } | null
  applied: EnrichmentField[]
} {
  const bookPrefill: Record<string, unknown> = {}
  const applied: EnrichmentField[] = []
  let recordPrefill: { classifications: ClassificationEntry[] } | null = null

  for (const c of changes) {
    if (c.field === 'classifications') {
      const existing = record.classifications
      const seen = new Set(existing.map((e) => `${e.system}\u0000${e.code}`))
      const merged: ClassificationEntry[] = [...existing]
      for (const e of c.proposed as ClassificationEntry[]) {
        const key = `${e.system}\u0000${e.code}`
        if (!seen.has(key)) {
          seen.add(key)
          merged.push(e)
        }
      }
      recordPrefill = { classifications: merged }
    } else {
      bookPrefill[c.field] = c.proposed
    }
    if (!applied.includes(c.field)) applied.push(c.field)
  }

  return {
    bookPrefill: bookPrefill as Partial<BookDraft>,
    recordPrefill,
    applied,
  }
}
