// 去重合并纯函数（§10.6、internal-schema 去重策略 + szlib-parser §4/§5）。
// existing 由调用方显式传入；本模块只做映射、不读写存储、不带时钟。
import type { Book, BorrowCycle, CatalogRecord, MaterialType, ParseWarning } from '@/types/entities'
import { normalize } from '@/lib/normalize'
import type { SourceParser } from './types'

/** 期间状态：existing 与本次输入的合并去重结果。 */
export interface DedupeState {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
}

/** 候选编目（pipeline 内部装配，含 bookId 关联与原始 barcode 候选）。 */
export interface CandidateCatalog {
  partial: Partial<CatalogRecord>
  bookPartial: Partial<Book>
  isPlaceholder: boolean
}

/** 候选周期（borrowedAt/returnedAt/sourceId/barcode/rawRecordIds 已定；id 借 stableHash）。 */
export interface CandidateCycle {
  sourceId: string
  barcode: string | null
  /** 周期归属原始行的 metaIdKey（同 barcode 多编目时按行消歧；pipeline 填充）。 */
  metaIdKey?: string | null
  /** 归属书目（pipeline 按 metaIdKey 预解析；跨文件闭合按此配对，空条码不串挂）。 */
  bookId?: string
  borrowedAt: Date
  returnedAt: Date | null
  status: 'borrowed' | 'returned' | 'unknown'
  borrowLocation: string | null
  returnLocation: string | null
  rawRecordIds: string[]
}

/** 去重/合并产出。 */
export interface DedupeResult {
  state: DedupeState
  warnings: ParseWarning[]
}

/**
 * 编目级 + 书目级去重（§10.6 第 1~3 条 + 选书帮第 4 条覆写）。
 * candidates 为本次解析产出的去重前候选；返回合并后的 DedupeState。
 * bookIdByBarcode 收集「barcode → bookId/`new:` token」映射（供 rawRecord 回填）；
 * bookIds 与 candidates 对齐的逐候选结果（同 barcode 多候选时不受 map 覆盖影响）。
 */
export function dedupeCatalogsAndBooks(
  candidates: CandidateCatalog[],
  barcodes: string[],
  existing: DedupeState,
  _parser: SourceParser,
): {
  state: DedupeState
  bookIdByBarcode: Map<string, string>
  bookIds: string[]
  /** 逐候选命中的既有编目 id（§10.6 第 1 条；未命中为空串）：pipeline 据此复用既有编目，不产出新 CatalogRecord。 */
  existingCrIds: string[]
  /** 逐候选待审标记（review 规格 §2/§9.2）：同 ISBN 多卷合并/跨源异题名合并 → 套装候选。 */
  reviewFlags: boolean[]
  warnings: ParseWarning[]
} {
  const warnings: ParseWarning[] = []
  const state: DedupeState = {
    books: [...existing.books],
    catalogRecords: [...existing.catalogRecords],
    borrowCycles: [...existing.borrowCycles],
  }
  const bookIdByBarcode = new Map<string, string>()
  const bookIds: string[] = []
  const existingCrIds: string[] = candidates.map(() => '')
  const reviewFlags: boolean[] = candidates.map(() => false)

  // existing 索引：编目按 sourceId+barcode 与 sourceId+metaIdKey；书按 isbn13。
  const crByBarcode = new Map<string, CatalogRecord>()
  const crByMetaIdKey = new Map<string, CatalogRecord>()
  for (const cr of existing.catalogRecords) {
    crByBarcode.set(`${cr.sourceId}|${cr.barcodes[0] ?? ''}`, cr)
    if (cr.metaIdKey) crByMetaIdKey.set(`${cr.sourceId}|${cr.metaIdKey}`, cr)
  }
  const bookByIsbn = new Map<string, Book>()
  for (const b of existing.books) {
    if (b.isbn13) bookByIsbn.set(b.isbn13, b)
  }
  const bookByTitleAuthor = new Map<string, Book[]>()
  for (const b of existing.books) {
    if (b.isbn13) continue
    const key = `${normalize(b.title)}|${normalize(b.authors[0] ?? '')}`
    if (!bookByTitleAuthor.has(key)) bookByTitleAuthor.set(key, [])
    bookByTitleAuthor.get(key)!.push(b)
  }
  // 批次内书目索引（§10.6 第 2/3 条批内版）：本批已建书目的候选可被后续同书
  // 候选复用。否则同 ISBN 的一书多册（不同 barcode）会产出多条 ISBN 相同的
  // Book，违反 books 表 &isbn13 唯一索引（bulkPut ConstraintError）。
  // 值即 pipeline 的 `new:` 派生 token：`new:isbn:<isbn13>` / `new:noisbn:<题名|著者>`。
  const batchBookByIsbn = new Map<string, string>()
  const batchBookByTitleAuthor = new Map<string, string>()
  // 无 ISBN 同题同著者 token 的材料类型（device-borrows 规格 §5）：
  // 设备与图书材料类型不同，不得复用同一 token（设备不并入图书 Book）。
  const batchTitleAuthorKind = new Map<string, MaterialType>()
  // 批内同 ISBN 多 metaid（套装候选）追踪：组首候选索引/metaid + 已警告的 metaid 对。
  const batchIsbnFirstIdx = new Map<string, number>()
  const batchIsbnFirstMetaId = new Map<string, string | null>()
  const batchIsbnFlaggedMeta = new Set<string>()
  // 批内无 ISBN 同题同著者合并追踪（H2）：组首候选索引/metaid——
  // 同 metaIdKey 为同编目复本（不置标），异/缺 metaIdKey 的模糊合并置待审。
  const batchTitleAuthorFirstIdx = new Map<string, number>()
  const batchTitleAuthorFirstMeta = new Map<string, string | null>()
  // 本批次内已置 needsReview 的既有 Book（避免同批多候选重复置标/重复警告）。
  const flaggedBookIds = new Set<string>()

  candidates.forEach((cand, i) => {
    const barcode = barcodes[i] ?? ''
    const bookP = cand.bookPartial
    const cr = cand.partial
    const sourceId = cr.sourceId ?? bookP.sourceIds?.[0] ?? ''
    // 统一写出口：map 供 rawRecord 按 barcode 回填；bookIds 按候选序供 pipeline
    // 建书（同 barcode 多候选不互相覆盖）。
    const assignBook = (value: string): void => {
      bookIdByBarcode.set(barcode, value)
      bookIds[i] = value
    }

    // 第 4 条：选书帮占位 → 各 barcode 独立 Book、不与任何 existing 合并。
    if (cand.isPlaceholder) {
      const matchedCr = crByBarcode.get(`${sourceId}|${barcode}`)
      if (matchedCr) {
        existingCrIds[i] = matchedCr.id
        assignBook(matchedCr.bookId)
        return
      }
      // 新建独立 Book（占位 token 按 barcode 唯一；ID 由 pipeline 用 stableHash 派生）。
      assignBook(`new:ph:${barcode}`)
      return
    }

    // 第 1 条：编目级匹配（最优先）。空条码无物理副本身份：barcode 索引
    // 被同源所有空条码编目共享（last-wins），命中的是别的书；直接按 metaIdKey。
    let matchedCr =
      barcode === '' ? undefined : crByBarcode.get(`${sourceId}|${barcode}`)
    if (!matchedCr && cr.metaIdKey) {
      matchedCr = crByMetaIdKey.get(`${sourceId}|${cr.metaIdKey}`)
    }
    if (matchedCr) {
      existingCrIds[i] = matchedCr.id
      assignBook(matchedCr.bookId)
      return
    }

    // 第 2 条：书目级 ISBN 匹配。
    const isbn = bookP.isbn13 ?? null
    if (isbn) {
      const matchedBook = bookByIsbn.get(isbn)
      if (matchedBook) {
        assignBook(matchedBook.id)
        // 同 ISBN 多卷/多作品（review 规格 §1.2）：同源异 metaid 或跨源异题名
        // → 合并仍进行，但 Book 置 needsReview 作为套装候选，警告含双方 metaid。
        if (!flaggedBookIds.has(matchedBook.id)) {
          const crsOfBook = existing.catalogRecords.filter(
            (c) => c.bookId === matchedBook.id,
          )
          const sameSourceCrs = crsOfBook.filter((c) => c.sourceId === sourceId)
          const sameSourceDiffMeta =
            cr.metaIdKey != null &&
            sameSourceCrs.length > 0 &&
            sameSourceCrs.some((c) => c.metaIdKey !== cr.metaIdKey)
          const crossSourceDiffTitle =
            crsOfBook.some((c) => c.sourceId !== sourceId) &&
            normalize(bookP.title ?? '') !== '' &&
            normalize(bookP.title ?? '') !== normalize(matchedBook.title)
          if (sameSourceDiffMeta || crossSourceDiffTitle) {
            flaggedBookIds.add(matchedBook.id)
            state.books = state.books.map((b) =>
              b.id === matchedBook.id ? { ...b, needsReview: true } : b,
            )
            reviewFlags[i] = true
            warnings.push({
              type: 'duplicate',
              message: `同 ISBN 多卷候选：metaid ${crsOfBook[0]?.metaIdKey ?? '无'} ↔ ${cr.metaIdKey ?? '无'} 并入同一 Book「${matchedBook.title}」，请到书库筛选「套装候选」，在详情页编辑`,
              recordRef: barcode ? `barcode:${barcode}` : null,
            })
          }
        }
        return
      }
    }

    // 第 3 条：无 ISBN 兜底模糊匹配（flag review）。
    const titleKey = normalize(bookP.title ?? '')
    const authorKey = normalize((bookP.authors ?? [])[0] ?? '')
    if (titleKey !== '' && authorKey !== '') {
      const list = bookByTitleAuthor.get(`${titleKey}|${authorKey}`)
      if (list && list.length > 0) {
        const target = list[0]!
        // 材料类型不一致（设备 vs 图书）不合并，独立处理（device-borrows 规格 §5）。
        if (!target.needsReview && (bookP.materialType ?? 'book') === target.materialType) {
          assignBook(target.id)
          // H2 回归：书名+作者模糊合并 → 置待审（design-decisions §4「需标记为
          // 待确认」），目标 Book 与候选均标记——同名同著者的不同作品（无 ISBN
          // 多卷/再版/丛书分册）不再被静默合并。组内首次置标去重（flaggedBookIds）。
          if (!flaggedBookIds.has(target.id)) {
            flaggedBookIds.add(target.id)
            reviewFlags[i] = true
            state.books = state.books.map((b) =>
              b.id === target.id ? { ...b, needsReview: true } : b,
            )
          }
          warnings.push({
            type: 'duplicate',
            message: `建议合并到已存在书目「${target.title}」（标题/作者模糊匹配）`,
            recordRef: barcode ? `barcode:${barcode}` : null,
          })
          return
        }
      }
    }

    // 第 2 条（批内）：同 ISBN → 复用本批已建书目（与跨文件行为一致）。
    const batchIsbn = bookP.isbn13 ?? null
    if (batchIsbn) {
      const token = batchBookByIsbn.get(batchIsbn) ?? `new:isbn:${batchIsbn}`
      if (batchBookByIsbn.has(batchIsbn)) {
        // 批内同 ISBN 多 metaid（如卷 3/卷 4 共用 ISBN）→ 套装候选：
        // 置标传播到组首候选（pipeline 在组首建 Book），警告含双方 metaid。
        const firstMeta = batchIsbnFirstMetaId.get(batchIsbn) ?? null
        const candMeta = cr.metaIdKey ?? null
        if (
          firstMeta != null &&
          candMeta != null &&
          firstMeta !== candMeta &&
          !batchIsbnFlaggedMeta.has(`${batchIsbn}|${candMeta}`)
        ) {
          batchIsbnFlaggedMeta.add(`${batchIsbn}|${candMeta}`)
          const firstIdx = batchIsbnFirstIdx.get(batchIsbn)
          if (firstIdx != null) reviewFlags[firstIdx] = true
          reviewFlags[i] = true
          warnings.push({
            type: 'duplicate',
            message: `同 ISBN 多卷候选：metaid ${firstMeta} ↔ ${candMeta} 并入同一 Book，请到书库筛选「套装候选」，在详情页编辑`,
            recordRef: barcode ? `barcode:${barcode}` : null,
          })
        }
      } else {
        batchIsbnFirstIdx.set(batchIsbn, i)
        batchIsbnFirstMetaId.set(batchIsbn, cr.metaIdKey ?? null)
      }
      batchBookByIsbn.set(batchIsbn, token)
      assignBook(token)
      return
    }

    // 第 3 条（批内）：无 ISBN 同题同著者 → 复用本批已建书目（占位已在上方排除）。
    const batchTitleKey = normalize(bookP.title ?? '')
    const batchAuthorKey = normalize((bookP.authors ?? [])[0] ?? '')
    if (batchTitleKey !== '' && batchAuthorKey !== '') {
      const k = `${batchTitleKey}|${batchAuthorKey}`
      // 材料类型不一致（设备 vs 图书）不复用同键 token → 独立书目（device-borrows 规格 §5）。
      const candKind: MaterialType = bookP.materialType ?? 'book'
      if (batchTitleAuthorKind.has(k) && batchTitleAuthorKind.get(k) !== candKind) {
        assignBook(`new:u:${i}`)
        return
      }
      const token = batchBookByTitleAuthor.get(k) ?? `new:noisbn:${k}`
      if (batchBookByTitleAuthor.has(k)) {
        // H2 回归：批内同题同著者合并（无 ISBN 模糊合并）→ 置待审，置标传播
        // 到组首候选（pipeline 在组首建 Book）；同 metaIdKey 为同编目复本
        // （internal-schema：同源同 metaid 多复本不置标）。
        const firstMeta = batchTitleAuthorFirstMeta.get(k) ?? null
        const candMeta = cr.metaIdKey ?? null
        if (firstMeta == null || firstMeta !== candMeta) {
          const firstIdx = batchTitleAuthorFirstIdx.get(k)
          if (firstIdx != null) reviewFlags[firstIdx] = true
          reviewFlags[i] = true
        }
      } else {
        batchTitleAuthorFirstIdx.set(k, i)
        batchTitleAuthorFirstMeta.set(k, cr.metaIdKey ?? null)
      }
      batchBookByTitleAuthor.set(k, token)
      batchTitleAuthorKind.set(k, candKind)
      assignBook(token)
      return
    }

    // 无 ISBN/题名/著者身份键：逐候选独立书目（token 唯一，不会复用）。
    assignBook(`new:u:${i}`)
  })

  return { state, bookIdByBarcode, bookIds, existingCrIds, reviewFlags, warnings }
}

/**
 * BorrowCycle 去重（§10.6 后段）。
 * 精确重复（sourceId + barcode + borrowedAt + bookId）跳过并记 duplicate 警告；
 * 时间重叠（同 bookId + barcode 已有周期范围内再出现借出）记 unpaired_record 警告但仍建周期。
 * 返回合并后的 borrowCycles 与去重后的有效候选（带 dedupeResult）。
 */
export function dedupeBorrowCycles(
  candidates: CandidateCycle[],
  existingCycles: BorrowCycle[],
): { cycles: BorrowCycle[]; warnings: ParseWarning[]; skippedFlags: boolean[] } {
  const warnings: ParseWarning[] = []
  const cycles = [...existingCycles]
  const skippedFlags: boolean[] = candidates.map(() => false)

  // 批次内已接受候选的精确键（sourceId+barcode+borrowedAt+bookId）。
  // 同一批次内重复行（如爬虫分页边界重复记录）也会各自成为候选，
  // 必须与已接受的批内候选比对，否则同批重复会产出多条相同周期。
  const batchKeys = new Set<string>()
  // L4：既有周期精确键索引——替代逐候选全量扫描（O(n×m) → O(n+m)）。
  const exactByKey = new Set<string>()
  for (const ex of existingCycles) {
    exactByKey.add(`${ex.sourceId}|${ex.barcode ?? ''}|${ex.borrowedAt.getTime()}|${ex.bookId}`)
  }

  const timeOverlap = (a: BorrowCycle, b: BorrowCycle): boolean => {
    if (a.barcode !== b.barcode || a.sourceId !== b.sourceId) return false
    // b 的借出落在 a 的开区间（a.borrowedAt, a.returnedAt）内即时间重叠。
    return a.returnedAt != null && b.borrowedAt.getTime() > a.borrowedAt.getTime() && b.borrowedAt.getTime() < a.returnedAt.getTime()
  }

  candidates.forEach((cand, i) => {
    const exactKey = `${cand.sourceId}|${cand.barcode ?? ''}|${cand.borrowedAt.getTime()}|${cand.bookId ?? ''}`
    // 精确重复（索引化）：命中既有周期即跳过。独立于时间重叠警告——
    // 旧逻辑同循环内先撞上时间重叠 break 会跳过后续周期的精确比对，
    // 重导时（既有周期已闭合）会把同书周期重复新建。
    const exactDup = exactByKey.has(exactKey)
    if (exactDup) {
      skippedFlags[i] = true
      warnings.push({
        type: 'duplicate',
        message: `BorrowCycle 重复：sourceId=${cand.sourceId} barcode=${cand.barcode ?? ''} borrowedAt=${cand.borrowedAt.toISOString()}`,
        recordRef: cand.rawRecordIds.map((r) => `raw:${r}`).join(','),
      })
      return
    }
    // 时间重叠警告（只记警告，不影响接受）。空条码无物理副本身份，
    // 多书天然重叠（同一天借多本），不做重叠检查。
    if (
      cand.status !== 'unknown' &&
      cand.barcode != null &&
      cand.barcode !== ''
    ) {
      for (const ex of existingCycles) {
        if (
          ex.barcode === cand.barcode &&
          ex.sourceId === cand.sourceId &&
          timeOverlap(ex, { id: '', bookId: '', catalogRecordId: '', sourceId: cand.sourceId, borrowedAt: cand.borrowedAt, returnedAt: cand.returnedAt, status: cand.status, borrowLocation: cand.borrowLocation, returnLocation: cand.returnLocation, rawRecordIds: cand.rawRecordIds, barcode: cand.barcode, createdAt: cand.borrowedAt, updatedAt: cand.borrowedAt })
        ) {
          warnings.push({
            type: 'unpaired_record',
            message: `周期时间重叠：barcode=${cand.barcode ?? ''} borrowedAt=${cand.borrowedAt.toISOString()}`,
            recordRef: cand.rawRecordIds.map((r) => `raw:${r}`).join(','),
          })
          break
        }
      }
    }
    if (skippedFlags[i]) return
    // 跨文件闭合：只有还回、无配对借出的候选（borrowedAt==returnedAt、
    // status unknown），配对同 barcode/sourceId 的既有开放周期——借出在上一
    // 文件、还回在本文件时，把还回合并进既有周期而非新建零长度周期。
    // 这是正常配对（跨文件边界），不是数据问题，不产生警告。
    const returnedAt = cand.returnedAt
    if (
      returnedAt != null &&
      cand.borrowedAt.getTime() === returnedAt.getTime() &&
      cand.status === 'unknown'
    ) {
      // 重导幂等：该还回事件已在库（同书同 returnedAt 的已闭合周期）→ 跳过，
      // 不新建重复的纯还回周期。
      const alreadyClosed = cycles.some(
        (ex) =>
          ex.sourceId === cand.sourceId &&
          ex.returnedAt != null &&
          ex.returnedAt.getTime() === returnedAt.getTime() &&
          (cand.bookId
            ? ex.bookId === cand.bookId
            : cand.barcode != null &&
              cand.barcode !== '' &&
              ex.barcode === cand.barcode),
      )
      if (alreadyClosed) {
        skippedFlags[i] = true
        return
      }
      const openIdx = cycles.findIndex((ex) => {
        if (ex.sourceId !== cand.sourceId || ex.returnedAt != null) return false
        if (ex.borrowedAt.getTime() >= returnedAt.getTime()) return false
        // 有书目身份（metaid）时按 bookId 配对：空条码多书/跨文件不串挂
        // （旧逻辑按条码找「第一个」开放周期，空条码会把还回错配给最早借出的书）。
        if (cand.bookId) return ex.bookId === cand.bookId
        // 无身份键：仅限非空条码一致才配对；空条码无 metaid 无法消歧，宁可不配。
        return (
          cand.barcode != null &&
          cand.barcode !== '' &&
          ex.barcode === cand.barcode
        )
      })
      if (openIdx >= 0) {
        const open = cycles[openIdx]!
        cycles[openIdx] = {
          ...open,
          returnedAt,
          status: 'returned',
          returnLocation: cand.returnLocation,
          rawRecordIds: [...open.rawRecordIds, ...cand.rawRecordIds],
          updatedAt: returnedAt,
        }
        skippedFlags[i] = true
        return
      }
    }
    // 批次内去重：同批已有完全相同（sourceId+barcode+borrowedAt+bookId）的候选时跳过。
    if (batchKeys.has(exactKey)) {
      skippedFlags[i] = true
      warnings.push({
        type: 'duplicate',
        message: `BorrowCycle 重复（批次内）：sourceId=${cand.sourceId} barcode=${cand.barcode ?? ''} borrowedAt=${cand.borrowedAt.toISOString()}`,
        recordRef: cand.rawRecordIds.map((r) => `raw:${r}`).join(','),
      })
      return
    }
    // L5 回归：跨文件连续借出——同文件内 szlib 解析器会把连续借出的旧开放
    // 周期置 unknown（borrow-cycle.md 规则表「连续两次借出，前一周期归还日期
    // 无从确定」），跨文件边界需等价处理：接受新借出候选时，同书（bookId，
    // 无书目身份则同 barcode）的既有开放周期关闭为 unknown。
    if (cand.status === 'borrowed') {
      const openIdx = cycles.findIndex(
        (ex) =>
          ex.sourceId === cand.sourceId &&
          ex.returnedAt == null &&
          ex.borrowedAt.getTime() < cand.borrowedAt.getTime() &&
          (cand.bookId
            ? ex.bookId === cand.bookId
            : cand.barcode != null &&
              cand.barcode !== '' &&
              ex.barcode === cand.barcode),
      )
      if (openIdx >= 0) {
        cycles[openIdx] = {
          ...cycles[openIdx]!,
          status: 'unknown',
          updatedAt: cand.borrowedAt,
        }
      }
    }
    batchKeys.add(exactKey)
    cycles.push({
      id: '',
      bookId: cand.bookId ?? '',
      catalogRecordId: '',
      sourceId: cand.sourceId,
      barcode: cand.barcode,
      borrowedAt: cand.borrowedAt,
      returnedAt: cand.returnedAt,
      status: cand.status,
      borrowLocation: cand.borrowLocation,
      returnLocation: cand.returnLocation,
      rawRecordIds: cand.rawRecordIds,
      createdAt: cand.borrowedAt,
      updatedAt: cand.borrowedAt,
    })
  })

  return { cycles, warnings, skippedFlags }
}
