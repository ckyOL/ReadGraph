import { describe, it, expect } from 'vitest'

import type { ExportData } from '@/types/entities'
import {
  buildBackupFilename,
  parseExportText,
  serializeExportText,
} from '@/db/backup'
import {
  makeBook,
  makeCatalog,
  makeCycle,
  makeImportLog,
  makeRawRecord,
  makeSource,
  now,
} from '@/db/test-helpers'
import { uuid } from '@/db/uuid'

const EXPORTED_AT = new Date('2026-07-08T05:30:45.123Z')

/** 与 test-helpers.seedAll 等价的最小 ExportData 构造（不依赖 IndexedDB）。 */
function sampleExportData(): ExportData {
  const srcId = 'src-sz'
  const src = makeSource(srcId)
  return {
    version: '1',
    exportedAt: EXPORTED_AT,
    sources: [src],
    rawRecords: [makeRawRecord(uuid(), 'log-1', srcId)],
    books: [makeBook('b1', '9787000000001', 'T')],
    catalogRecords: [
      {
        // 与真实库导出一致：classCodes 为索引派生字段，schema 校验输出恒补写。
        ...makeCatalog('cr1', 'b1', srcId, 'BC1', 'K1', [
          { system: 'clc', code: 'TP312' },
        ]),
        classCodes: ['TP312'],
      },
    ],
    borrowCycles: [makeCycle('cyc1', 'b1', srcId, now())],
    importLogs: [makeImportLog('log-1', srcId)],
  }
}

describe('buildBackupFilename', () => {
  it('produces readgraph-backup-YYYYMMDD-HHmmss.json from UTC components', () => {
    expect(buildBackupFilename(EXPORTED_AT)).toBe(
      'readgraph-backup-20260708-053045.json',
    )
  })

  it('is independent of the host local timezone', () => {
    const utc = new Date(Date.UTC(2025, 0, 31, 23, 59, 0))
    expect(buildBackupFilename(utc)).toBe('readgraph-backup-20250131-235900.json')
  })
})

describe('serializeExportText', () => {
  it('serializes Date fields to ISO 8601 Z strings', () => {
    const text = serializeExportText(sampleExportData())
    // exportedAt 出现为 ISO Z 串（带毫秒），而非 Date 对象/原型字面量。
    expect(text).toContain('"exportedAt": "2026-07-08T05:30:45.123Z"')
  })

  it('uses a fixed top-level key order', () => {
    const text = serializeExportText(sampleExportData())
    const topKeys = ['version', 'exportedAt', 'sources', 'rawRecords', 'books', 'catalogRecords', 'borrowCycles', 'importLogs']
    const indices = topKeys.map((k) => text.indexOf(`"${k}"`))
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]!)
    }
  })

  it('always includes rawRecords and sources (mandatory export)', () => {
    const text = serializeExportText(sampleExportData())
    expect(text).toContain('"sources"')
    expect(text).toContain('"rawRecords"')
  })
})

describe('parseExportText', () => {
  it('round-trips to deep-equal ExportData (Date comparison by value)', () => {
    const original = sampleExportData()
    const text = serializeExportText(original)
    const parsed = parseExportText(text)
    expect(parsed).toEqual(original)
  })

  it('rejects unsupported export version', () => {
    const data = sampleExportData()
    const text = serializeExportText({ ...data, version: '2' })
    expect(() => parseExportText(text)).toThrow()
  })

  it('rejects missing rawRecords', () => {
    const data: Record<string, unknown> = JSON.parse(serializeExportText(sampleExportData()))
    delete data.rawRecords
    const text = JSON.stringify(data)
    expect(() => parseExportText(text)).toThrow()
  })

  it('rejects malformed JSON', () => {
    expect(() => parseExportText('{ not json')).toThrow()
  })

  it('rejects when a book isbn13 is malformed', () => {
    const data = sampleExportData()
    data.books[0]!.isbn13 = 'not-13-digits'
    const text = serializeExportText(data)
    expect(() => parseExportText(text)).toThrow()
  })
})
