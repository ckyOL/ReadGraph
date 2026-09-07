// import-worker api 直测（debug-mode spec §5.4）：不经真实 Worker，直接
// 调用导出的 api。jsdom 依赖未装（零新增依赖约束，任务书备选路径），以
// vi.mock('comlink') 空替身让模块在 node 环境可导入（expose 不执行）。
// vitest define 固定 __DEBUG_MODE__=false；Worker 内不读该常量（透传语义），
// 无需 stub。performance.now 在 node 可用（spec §4.2 Worker 计时口径）。
import { describe, expect, it, vi } from 'vitest'

vi.mock('comlink', () => ({ expose: () => undefined, wrap: () => undefined }))

import type { ExistingState, ImportMeta } from '@/parsers/pipeline'
import { buildRawRecords } from './run-import'
import { api } from './import-worker'
import { szlibParser } from '@/parsers/szlib'
import type { RawRecord, Source } from '@/types/entities'
import type { ImportTraceRow } from '@/parsers/trace'
import sample from '@/tests/fixtures/szlib-sample.json'

const SOURCE: Source = {
  id: 'src-szlib',
  type: 'library',
  name: '深圳图书馆',
  parserId: 'szlib',
  parserVersion: '1.0.0',
  timezone: 'Asia/Shanghai',
  library: {
    libraryType: 'public',
    city: '深圳市',
    province: '广东省',
    website: null,
    opacUrl: null,
    classificationSystem: 'clc',
  },
  notes: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  lastImportAt: null,
  totalImportedRecords: 0,
}

const META: ImportMeta = {
  id: 'log-worker-1',
  fileName: 'szlib-sample.json',
  fileSize: 4096,
  detectedEncoding: 'utf-8',
  importedAt: new Date('2026-09-07T00:00:00.000Z'),
}

function makeInput(traceOptions?: { verbose?: boolean }) {
  const rows = buildRawRecords(
    szlibParser.filterRows(sample as Record<string, unknown>[]),
    META,
    SOURCE.id,
  )
  const existing: ExistingState = { books: [], catalogRecords: [], borrowCycles: [] }
  return { rows, source: SOURCE, existing, meta: META, traceOptions }
}

describe('import-worker api.run — trace 回传契约', () => {
  it('不传 traceOptions：返回 { result, trace: null }（缺省零收集）', async () => {
    const { trace, result } = await api.run(makeInput())
    expect(trace).toBeNull()
    expect(result.trace).toBeNull()
    expect(result.books.length).toBeGreaterThan(0)
    expect(result.borrowCycles.length).toBeGreaterThan(0)
    expect(result.importLog.id).toBe(META.id)
  })

  it('透传 traceOptions：trace 非空、rows 与 rows 入参对齐、durationMs 为 number', async () => {
    const { trace, result } = await api.run(makeInput({ verbose: false }))
    expect(trace).not.toBeNull()
    expect(result.trace).not.toBeNull()
    // Worker 内以 performance.now 差值填写（spec §4.2；纯函数内恒 null → 非空即已填）。
    expect(typeof trace!.durationMs).toBe('number')
    expect(trace!.durationMs).toBeGreaterThanOrEqual(0)
    // rows 按 rowIndex 与管线入参对齐（{verbose:false} 契约）。
    expect(trace!.rows.map((r: ImportTraceRow) => r.rowIndex)).toEqual(
      result.rawRecords.map((r: RawRecord) => r.rowIndex),
    )
    expect(trace!.sourceId).toBe(SOURCE.id)
    expect(trace!.parserId).toBe('szlib')
    // 首次导入有效行 = new-book（spec §8 用例 1 在 Worker 路径同样成立）。
    expect(trace!.rows.filter((r: ImportTraceRow) => r.decision === 'new-book')).not.toHaveLength(0)
  })

  it('透传 { verbose: true }：命中派生 ID 的行补 idDerivation（verbose 细化）', async () => {
    const { trace } = await api.run(makeInput({ verbose: true }))
    expect(trace).not.toBeNull()
    // sample 含条码行（bk-{fnv1a32(sourceId|barcode)} 派生），verbose 下应有推导串。
    const withDerivation = trace!.rows.filter((r: ImportTraceRow) => r.idDerivation !== undefined)
    expect(withDerivation).not.toHaveLength(0)
  })
})
