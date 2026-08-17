// 导入管线纯函数（§10.3、§10.4 派生 ID、§10.6 去重、import-workflow 纯度）。
// 不写库、不带时钟、不读全局可变状态。相同入参恒等产出 PipelineResult。
import type {
  Book,
  BorrowCycle,
  CatalogRecord,
  ImportLog,
  ImportLogStats,
  MaterialType,
  ParseWarning,
  RawRecord,
  Source,
} from '@/types/entities'
import { stableHash } from '@/lib/hash'
import type { SourceParser } from './types'
import {
  dedupeBorrowCycles,
  dedupeCatalogsAndBooks,
  type CandidateCatalog,
  type CandidateCycle,
  type DedupeState,
} from './dedupe'

/** 已有库状态（显式入参，纯度要求 import-workflow）。 */
export interface ExistingState {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
}

/** 导入批次的可派生元数据。 */
export interface ImportMeta {
  id: string
  fileName: string
  fileSize: number
  detectedEncoding: string
  importedAt: Date
}

/** 管线产出。 */
export interface PipelineResult {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  importLog: ImportLog
  rawRecords: RawRecord[]
  warnings: ParseWarning[]
}

const makeCrId = (input: string) => `cr-${stableHash(input)}`
const bkId = (input: string) => `bk-${stableHash(input)}`
const cyId = (input: string) => `cy-${stableHash(input)}`

/**
 * importPipeline：导入管线核心纯函数（§10.3）。
 * rows 由调用方预分配 id/importLogId/sourceId/rowIndex；data 保留原始键值。
 * parser.parse 解析 rawData（由调用方从 rows 派生的整码字符串/缓冲）喂入。
 * 返回合并去重后的实体并集与 ImportLog，不写库。
 */
export function importPipeline(
  rows: RawRecord[],
  source: Source,
  parser: SourceParser,
  existing: ExistingState,
  meta: ImportMeta,
): PipelineResult {
  const warnings: ParseWarning[] = []
  const now = meta.importedAt

  // L9 回归：纯函数不变式——入参 rows 不得被原地变异（调用方可能复用）。
  // 浅克隆后处理（只改顶层字段，data 引用共享）；返回的 rawRecords 为克隆。
  const workingRows = rows.map((r) => ({ ...r }))

  // 1. 把 rows 的 data 数组直接喂给 parser（L4：跳过 JSON 两遍全量
  //    stringify/parse；保持纯：不读文件）。
  const parseRes = parser.parse(
    workingRows.map((r) => r.data),
    source,
  )
  warnings.push(...parseRes.warnings)

  // 2. 装配候选编目与书目；按 rowIndex（rows 顺序）对齐 parseRes 产出。
  //    parseRes 内 books/catalogRecords 已去重为「本次新批次」候选；
  //    这里转换为 CandidateCatalog 列表，逐条确定 barcode 与 bookId。
  const candidates: CandidateCatalog[] = []
  const candidateBarcodes: string[] = []

  // parseRes.books 已按出现顺序去重；用其在 parseRes.catalogRecords 内的
  // barcode 关联。简化装配：循环 catalogRecords，每条对应一个候选。
  for (let i = 0; i < parseRes.catalogRecords.length; i++) {
    const cr = parseRes.catalogRecords[i]!
    const barcode = (cr.barcodes?.[0] ?? '') as string
    const bookPartial = findBookForCatalog(parseRes.books, cr)
    const isPlaceholder =
      bookPartial?.needsReview === true && (bookPartial.isbn13 ?? null) === null
    candidates.push({
      partial: cr,
      bookPartial: bookPartial ?? {},
      isPlaceholder,
    })
    candidateBarcodes.push(barcode)
  }

  // 3. 编目/书目去重（§10.6 第 1~4 条 + review 规格 §9.2 套装候选置标）。
  const dedupeInput: DedupeState = {
    books: existing.books,
    catalogRecords: existing.catalogRecords,
    borrowCycles: existing.borrowCycles,
  }
  const {
    state: dedupeState,
    bookIdByBarcode,
    bookIds,
    existingCrIds,
    reviewFlags,
    warnings: ddWarnings,
  } = dedupeCatalogsAndBooks(
    candidates,
    candidateBarcodes,
    dedupeInput,
  )
  warnings.push(...ddWarnings)

  // 4. 实际产出 Books + CatalogRecords（ID 确定性派生，§10.4）。
  const newBooks: Book[] = []
  const newCatalogRecords: CatalogRecord[] = []
  // 编目 ID 按「派生输入」缓存：同输入恒同 id；同 barcode 多候选（如空条码行按
  // metaid 消歧）不会互相覆盖（旧版按 barcode 缓存会让后者复用前者的 id）。
  const crIdByDerived = new Map<string, string>()
  // 批内已建编目（id → 记录）：同 (sourceId, metaIdKey) 多副本候选合并条码。
  const newCrById = new Map<string, CatalogRecord>()
  // 既有编目按 id：命中后补入新副本条码（重导/增量文件恢复，C1 回归）。
  const existingCrById = new Map(existing.catalogRecords.map((cr) => [cr.id, cr] as const))
  // 命中既有编目并补入新条码后的记录：返回时替换原记录（bulkPut 全量写回）。
  const mergedExistingCrs = new Map<string, CatalogRecord>()
  // barcode → 本批次编目 ID 列表：供周期关联判定唯一/歧义。
  const crIdsByBarcode = new Map<string, string[]>()
  // metaIdKey → 本批次编目：同 barcode 多编目时按原始行 metaid 消歧。
  const crByMetaKey = new Map<string, CatalogRecord>()
  // dedupe 的 `new:` 派生 token → 本批已建 Book id：同 ISBN/同题同著者的
  // 多副本候选（一书多册）复用同一书目，避免重复 Book 违反 &isbn13 唯一索引。
  const newBookIdByToken = new Map<string, string>()

  for (let i = 0; i < candidates.length; i++) {
    const cand = candidates[i]!
    const barcode = candidateBarcodes[i]!
    const cr = cand.partial
    const sourceId = (cr.sourceId ?? source.id) as string
    const metaIdKey = (cr.metaIdKey ?? null) as string | null
    // 选书帮占位（§10.6 第 4 条）：按 barcode 各建独立实体，id 派生必须含
    // barcode——共享 metaId 的占位行若走 metaIdKey 会派生同 id 互相覆盖
    // （bulkPut 时后者覆盖前者，独立 Book 契约被破坏）。
    const crDerivedInput =
      cand.isPlaceholder || !metaIdKey
        ? `${sourceId}|${barcode}`
        : `${sourceId}|${metaIdKey}`
    // 编目级命中（§10.6 第 1 条）：物理副本已存在，复用既有编目、不产出
    // 新 CatalogRecord。旧版仍按派生输入建新编目（同 metaIdKey/同条码 → 同
    // 派生 id），bulkPut 时新记录覆盖既有记录，丢失用户编辑的 volume/
    // classifications，已结构化套装的徽标随之消失（跨文件增量导入回归）。
    const matchedCrId = existingCrIds[i] ?? ''
    const cId = matchedCrId
      ? matchedCrId
      : (crIdByDerived.get(crDerivedInput) ?? makeCrId(crDerivedInput))
    const bcCrs = crIdsByBarcode.get(barcode) ?? []
    bcCrs.push(cId)
    crIdsByBarcode.set(barcode, bcCrs)
    if (matchedCrId) {
      // 编目级命中：复用既有记录；若候选带来记录没有的副本条码（同 metaid
      // 新复本 / 旧版缺陷丢码后重导恢复），并入 barcodes——否则副本条码
      // 静默丢失（C1 回归；空串条码无物理副本身份，不并入）。
      const existingCr = existingCrById.get(matchedCrId)
      if (existingCr) {
        const newBarcodes = (cr.barcodes ?? []).filter(
          (bc) => bc !== '' && !existingCr.barcodes.includes(bc),
        )
        if (newBarcodes.length > 0) {
          mergedExistingCrs.set(matchedCrId, {
            ...existingCr,
            barcodes: [...existingCr.barcodes, ...newBarcodes],
          })
        }
      }
      continue
    }
    // 批内同 (sourceId, metaIdKey) 多副本候选（一书多册）：合并为单条编目、
    // barcodes 取并集。szlib 按条码分候选（catKey 含 barcode），而编目级身份
    // 是 metaid——旧版两条候选派生同 id，bulkPut 时后者覆盖前者、副本条码
    // 静默丢失（C1 回归）。
    const batchCr = newCrById.get(cId)
    if (batchCr) {
      for (const bc of cr.barcodes ?? []) {
        if (bc !== '' && !batchCr.barcodes.includes(bc)) batchCr.barcodes.push(bc)
      }
      continue
    }
    crIdByDerived.set(crDerivedInput, cId)

    // 逐候选取结果：同 barcode 多候选（空条码多书）不互相覆盖。
    let bookId = bookIds[i] ?? bookIdByBarcode.get(barcode)
    if (!bookId || bookId.startsWith('new:')) {
      // 新建 Book：token 已建过（同书多副本候选）→ 复用其 id；否则派生新 id。
      const token = bookId && bookId.startsWith('new:') ? bookId : `new:u:${i}`
      const reusedId = newBookIdByToken.get(token)
      if (reusedId) {
        bookId = reusedId
      } else {
        const newBookId = bkId(crDerivedInput)
        newBookIdByToken.set(token, newBookId)
        bookId = newBookId
        const bookPartial = cand.bookPartial
        newBooks.push({
          id: newBookId,
          isbn13: (bookPartial.isbn13 ?? null) as string | null,
          isbn10: (bookPartial.isbn10 ?? null) as string | null,
          title: (bookPartial.title ?? '') as string,
          subtitle: (bookPartial.subtitle ?? null) as string | null,
          authors: (bookPartial.authors ?? []) as string[],
          translators: (bookPartial.translators ?? []) as string[],
          publisher: (bookPartial.publisher ?? null) as string | null,
          publishDate: (bookPartial.publishDate ?? null) as string | null,
          edition: (bookPartial.edition ?? null) as string | null,
          pages: (bookPartial.pages ?? null) as number | null,
          price: (bookPartial.price ?? null) as Book['price'],
          subjects: (bookPartial.subjects ?? []) as string[],
          tags: (bookPartial.tags ?? []) as string[],
          coverUrl: (bookPartial.coverUrl ?? null) as string | null,
          description: (bookPartial.description ?? null) as string | null,
          createdAt: now,
          updatedAt: now,
          // review 规格 §9.2：套装候选（批内同 ISBN 多 metaid 等）置 needsReview。
          needsReview: ((bookPartial.needsReview ?? false) || reviewFlags[i]) as boolean,
          // device-borrows 规格 §3：parser 标记的设备（cirtype=电子设备外借）沿用；
          // 非设备缺省 'book'。
          materialType: (bookPartial.materialType ?? 'book') as MaterialType,
          sourceIds: (bookPartial.sourceIds ?? [source.id]) as string[],
          parallelTitles: (bookPartial.parallelTitles ?? []) as string[],
        })
      }
    }
    const newCr: CatalogRecord = {
      id: cId,
      bookId,
      sourceId,
      metaId: (cr.metaId ?? null) as CatalogRecord['metaId'],
      metaIdKey,
      barcodes: (cr.barcodes ?? []) as string[],
      classifications: (cr.classifications ?? []) as CatalogRecord['classifications'],
      opacEnrichment: null,
      volume: null,
      createdAt: now,
      updatedAt: now,
    }
    newCatalogRecords.push(newCr)
    newCrById.set(cId, newCr)
    if (metaIdKey) crByMetaKey.set(`${sourceId}|${metaIdKey}`, newCr)
  }

  // 5. 装配候选 BorrowCycle：rawRecordIds 直接取自 Parser 在周期上标注的
  //    消费行文件行号（_rowIndexes，与 buildRawRecords.rowIndex 一致），
  //    不再按 barcode 游标猜行——旧法会混入自助查询/续借等无效行（metaid=0）
  //    导致行错位、metaid 消歧失效（空条码多书时周期错挂或无主）。
  const rowByIdx = new Map(workingRows.map((r) => [r.rowIndex, r] as const))
  const candidateCycles: CandidateCycle[] = []
  for (const cyc of parseRes.borrowCycles) {
    const rowIndexes = (cyc as Record<string, unknown>)._rowIndexes as
      | number[]
      | undefined
    const rawIds: string[] = []
    for (const ri of rowIndexes ?? []) {
      const r = rowByIdx.get(ri)
      if (r) rawIds.push(r.id)
    }
    // 周期归属原始行的 metaid（同 barcode 多编目时按行消歧；0/缺失视为无）。
    const firstRow = rowIndexes?.length ? rowByIdx.get(rowIndexes[0]!) : undefined
    const rowMetaId = (firstRow?.data as { metaid?: unknown } | undefined)?.metaid
    const metaIdKey =
      rowMetaId != null && rowMetaId !== 0 ? String(rowMetaId) : null
    candidateCycles.push({
      sourceId: cyc.sourceId ?? source.id,
      barcode: cyc.barcode ?? null,
      metaIdKey,
      borrowedAt: cyc.borrowedAt ?? now,
      returnedAt: cyc.returnedAt ?? null,
      status: cyc.status ?? 'unknown',
      borrowLocation: cyc.borrowLocation ?? null,
      returnLocation: cyc.returnLocation ?? null,
      rawRecordIds: rawIds,
    })
  }

  // 6. 周期去重 + ID 派生（§10.4 + §10.6 后段）。
  // 先建全量编目 metaIdKey 索引（既有 + 本批次），供候选周期预解析归属书目：
  // 纯还回候选（借出在上一文件）跨文件闭合时按书目身份配对，而不是按条码
  // 找「第一个」开放周期（空条码多书会连环错配）。
  const crByMetaKeyFull = new Map<string, CatalogRecord>()
  for (const cr of [...existing.catalogRecords, ...newCatalogRecords]) {
    if (cr.metaIdKey) crByMetaKeyFull.set(`${cr.sourceId}|${cr.metaIdKey}`, cr)
  }
  // 含既有编目：命中既有编目的新周期按 barcode 唯一命中时也要能解析到记录。
  const crById = new Map(
    [...existing.catalogRecords, ...newCatalogRecords].map((cr) => [cr.id, cr] as const),
  )
  // 候选周期预解析归属书目——解析顺序与下方 finalCycles 新周期分支一致
  // （barcode 本批次唯一命中 → 该编目；否则按 metaIdKey 消歧；再否则空）：
  // 精确去重键（Q-1）含 bookId 身份分量，两侧（候选 vs 存库周期）bookId
  // 必须同源可比，否则 metaid=0 但 barcode 唯一命中的候选重导时身份分量
  // 不匹配，破坏重导幂等（Q-1 回归防线）。
  for (const cand of candidateCycles) {
    const bc = cand.barcode ?? ''
    const bcCrs = crIdsByBarcode.get(bc) ?? []
    if (bcCrs.length === 1) {
      cand.bookId = crById.get(bcCrs[0]!)?.bookId ?? ''
    } else if (cand.metaIdKey) {
      cand.bookId =
        crByMetaKeyFull.get(`${cand.sourceId}|${cand.metaIdKey}`)?.bookId ?? ''
    }
  }
  const { cycles, warnings: cyWarnings, skippedFlags } = dedupeBorrowCycles(
    candidateCycles,
    existing.borrowCycles,
  )
  warnings.push(...cyWarnings)

  // 周期 → 编目/书目 关联索引：
  // - 全量编目（既有 + 本批次）按 sourceId+barcode：修复既有周期错挂。
  // - 本批次新编目按 id 与 metaIdKey：为新周期解析归属。
  const crByBarcodeFull = new Map<string, CatalogRecord>()
  // barcode → 去重编目 ID 集合（重导同文件时既有/新编目同 id，不算歧义）。
  const barcodeCrIds = new Map<string, Set<string>>()
  for (const cr of [...existing.catalogRecords, ...newCatalogRecords]) {
    const bcKey = `${cr.sourceId}|${cr.barcodes[0] ?? ''}`
    if (!crByBarcodeFull.has(bcKey)) crByBarcodeFull.set(bcKey, cr)
    const ids = barcodeCrIds.get(bcKey) ?? new Set<string>()
    ids.add(cr.id)
    barcodeCrIds.set(bcKey, ids)
  }
  // 新周期 → 候选对齐（dedupe 输出 = existing + 未跳过候选，按序）。
  const newCandidateByKey = new Map<string, CandidateCycle>()
  for (let i = 0; i < candidateCycles.length; i++) {
    const cand = candidateCycles[i]!
    if (skippedFlags[i]) continue
    newCandidateByKey.set(
      `${cand.sourceId}|${cand.barcode ?? ''}|${cand.borrowedAt.getTime()}`,
      cand,
    )
  }

  const finalCycles: BorrowCycle[] = cycles.map((c) => {
    // 既有周期：保持原关联；仅当其 barcode 在全量编目里唯一命中时修复
    // （旧版会把 barcode 不在本批次的周期兜底错挂到本批次第一本书，
    // 例如第二次导入时破坏首次导入的既有周期关联）。
    if (c.id) {
      const bcKey = `${c.sourceId}|${c.barcode ?? ''}`
      const cr = crByBarcodeFull.get(bcKey)
      if (
        cr &&
        (barcodeCrIds.get(bcKey)?.size ?? 0) === 1 &&
        (cr.id !== c.catalogRecordId || cr.bookId !== c.bookId)
      ) {
        return { ...c, bookId: cr.bookId, catalogRecordId: cr.id }
      }
      return c
    }
    // 新周期：barcode 唯一命中 → 该编目；同 barcode 多编目/缺失 → 按行 metaIdKey 消歧。
    const rawKey = c.rawRecordIds.slice().sort().join(',')
    const id = cyId(`${meta.id}|${rawKey}`)
    const bc = c.barcode ?? ''
    const bcCrs = crIdsByBarcode.get(bc) ?? []
    const cand = newCandidateByKey.get(
      `${c.sourceId}|${bc}|${c.borrowedAt.getTime()}`,
    )
    let cr: CatalogRecord | undefined
    if (bcCrs.length === 1) cr = crById.get(bcCrs[0]!)
    else if (cand?.metaIdKey)
      cr = crByMetaKeyFull.get(`${c.sourceId}|${cand.metaIdKey}`)
    return {
      ...c,
      id,
      bookId: cr?.bookId ?? '',
      catalogRecordId: cr?.id ?? '',
    }
  })

  // skippedFlags 对应 candidateCycles；标记对应 rawRecord.parseStatus='skipped'。
  for (let i = 0; i < candidateCycles.length; i++) {
    if (skippedFlags[i]) {
      const cyc = candidateCycles[i]!
      for (const rid of cyc.rawRecordIds) {
        const rr = workingRows.find((r) => r.id === rid)
        if (rr) rr.parseStatus = 'skipped'
      }
    }
  }

  // 7. 回填 rawRecord 的 bookId/borrowCycleId/parseStatus（简化：有效行 success）。
  //    bookId 取真实书目 id（跳过 bookIdByBarcode 里的 'new:' 占位标记——旧版
  //    会把 'new:…' 直接写进 rawRecord.bookId）；空条码行按 metaid 消歧。
  const cycleIdByRawId = new Map<string, string>()
  for (const c of finalCycles) {
    for (const rid of c.rawRecordIds) cycleIdByRawId.set(rid, c.id)
  }
  for (const r of workingRows) {
    const bc = String((r.data as { barcode?: unknown }).barcode ?? '')
    // 空条码行不用 barcode-keyed 映射（多书共享空键、值被最后候选覆盖）→ 走 metaid 消歧。
    const byBc = bc === '' ? undefined : bookIdByBarcode.get(bc)
    let bookId = byBc && !byBc.startsWith('new:') ? byBc : undefined
    if (!bookId) {
      const metaId = (r.data as { metaid?: unknown }).metaid
      if (metaId != null && metaId !== 0) {
        bookId = crByMetaKeyFull.get(`${r.sourceId}|${String(metaId)}`)?.bookId
      }
    }
    if (bookId) r.bookId = bookId
    const cycId = cycleIdByRawId.get(r.id)
    if (cycId) r.borrowCycleId = cycId
    if (r.parseStatus === 'success' || r.parseStatus === undefined) {
      r.parseStatus = 'success'
    }
  }

  // L8 回归：行级警告（invalid_date 等，recordRef 形如 row:N）→ 对应行
  // parseStatus 置 warning/error。旧版只写 success/skipped，'warning'/'error'
  // 全库从未出现——无效日期行等仍显示 success，审计失真。
  // format_error 为硬错误（error），其余行级警告为 warning；skipped 优先级更高。
  for (const w of warnings) {
    const m = w.recordRef?.match(/^row:(\d+)$/)
    if (!m) continue
    const rr = rowByIdx.get(Number(m[1]))
    if (rr && rr.parseStatus !== 'skipped') {
      rr.parseStatus = w.type === 'format_error' ? 'error' : 'warning'
    }
  }

  // 8. 统计 ImportLog（§10.3）。
  const stats: ImportLogStats = {
    totalRawRecords: workingRows.length,
    newBooks: newBooks.length,
    updatedBooks: 0,
    newBorrowCycles: finalCycles.length - existing.borrowCycles.length,
    skippedRecords: workingRows.filter((r) => r.parseStatus === 'skipped').length,
    // 行级预过滤（filterRows）发生在管线外（executeImport）；管线内无过滤概念。
    filteredRows: 0,
    warningCount: warnings.filter((w) => w.type !== 'format_error').length,
    errorCount: warnings.filter((w) => w.type === 'format_error').length,
  }
  const importLog: ImportLog = {
    id: meta.id,
    sourceId: source.id,
    importedAt: now,
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    detectedEncoding: meta.detectedEncoding,
    parserId: source.parserId,
    stats,
    warnings,
  }

  return {
    // 既有 Book 可能被去重置标（套装候选），用去重后的 state.books 而非 existing.books。
    books: [...dedupeState.books, ...newBooks],
    catalogRecords: [
      ...existing.catalogRecords.map((cr) => mergedExistingCrs.get(cr.id) ?? cr),
      ...newCatalogRecords,
    ],
    borrowCycles: finalCycles,
    importLog,
    rawRecords: workingRows,
    warnings,
  }
}

/** 在 parseRes.books 中为某 catalogRecord 找对应 bookPartial。 */
function findBookForCatalog(
  books: Partial<Book>[],
  cr: Partial<CatalogRecord>,
): Partial<Book> | undefined {
  // 按 szlib 注入的瞬态 _bookKey 对齐（非类型字段，仅解析器内部约定）。
  const key = (cr as Record<string, unknown>)._bookKey
  if (typeof key === 'string') {
    const hit = books.find((b) => (b as Record<string, unknown>)._bookKey === key)
    if (hit) return hit
  }
  return undefined
}
