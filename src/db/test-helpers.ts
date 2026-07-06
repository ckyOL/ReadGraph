import fakeIndexedDB, { IDBKeyRange as fakeIDBKeyRange } from 'fake-indexeddb'
import Dexie from 'dexie'

import { ReadGraphDB } from './db'
import { uuid } from './uuid'
import type {
  Book,
  BorrowCycle,
  CatalogRecord,
  ImportLog,
  RawRecord,
  Source,
} from '@/types/entities'

const NOW = new Date('2025-03-01T08:00:00.000Z')

/** Install fake-indexeddb onto globalThis + Dexie.dependencies; returns nothing. */
export function installFakeIndexedDB(): void {
  const g = globalThis as unknown as { indexedDB: unknown; IDBKeyRange: unknown }
  g.indexedDB = fakeIndexedDB
  g.IDBKeyRange = fakeIDBKeyRange
  Dexie.dependencies.indexedDB = fakeIndexedDB
  Dexie.dependencies.IDBKeyRange = fakeIDBKeyRange as unknown as typeof IDBKeyRange
}

export function createTestDB(): ReadGraphDB {
  installFakeIndexedDB()
  return new ReadGraphDB(`rg-test-${Math.random().toString(36).slice(2)}`)
}

export function closeTestDB(db: ReadGraphDB): void {
  db.close()
}

export function now(): Date {
  return NOW
}

export function makeSource(id = 'src-sz'): Source {
  return {
    id,
    type: 'library',
    name: '深圳图书馆',
    parserId: `pid-${id}`,
    parserVersion: '1',
    timezone: 'Asia/Shanghai',
    library: {
      libraryType: 'public',
      city: '深圳',
      province: '广东',
      website: null,
      opacUrl: null,
      classificationSystem: 'clc',
    },
    notes: null,
    createdAt: NOW,
    lastImportAt: null,
    totalImportedRecords: 0,
  }
}

export function makeBook(
  id: string,
  isbn13: string | null,
  title: string,
  needsReview = false,
  sourceIds: string[] = ['src-sz'],
): Book {
  return {
    id,
    isbn13,
    isbn10: null,
    title,
    subtitle: null,
    authors: ['A'],
    translators: [],
    publisher: null,
    publishDate: null,
    edition: null,
    pages: null,
    price: null,
    subjects: [],
    tags: [],
    coverUrl: null,
    description: null,
    createdAt: NOW,
    updatedAt: NOW,
    needsReview,
    sourceIds,
    parallelTitles: [],
  }
}

export function makeCatalog(
  id: string,
  bookId: string,
  sourceId: string,
  barcode: string,
  metaId: string | number | null,
  classifications: { system: 'clc'; code: string }[] = [],
): CatalogRecord {
  return {
    id,
    bookId,
    sourceId,
    metaId,
    metaIdKey: metaId === null || metaId === '' ? null : String(metaId),
    barcodes: barcode ? [barcode] : [],
    classifications,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function makeCycle(
  id: string,
  bookId: string,
  srcId: string,
  borrowedAt: Date,
  status: 'borrowed' | 'returned' = 'borrowed',
  barcode: string | null = 'BC1',
): BorrowCycle {
  return {
    id,
    bookId,
    catalogRecordId: 'cr-' + id,
    sourceId: srcId,
    borrowedAt,
    returnedAt: status === 'returned' ? new Date(borrowedAt.getTime() + 86400000) : null,
    status,
    borrowLocation: null,
    returnLocation: null,
    rawRecordIds: [],
    barcode,
    createdAt: NOW,
    updatedAt: NOW,
  }
}

export function makeRawRecord(
  id: string,
  importLogId = 'log-1',
  sourceId = 'src-sz',
): RawRecord {
  return {
    id,
    importLogId,
    sourceId,
    data: { title: 'x', barCode: 'BC001' },
    rowIndex: 0,
    borrowCycleId: null,
    bookId: null,
    parseStatus: 'success',
    parseNote: null,
  }
}

export function makeImportLog(id = 'log-1', sourceId = 'src-sz'): ImportLog {
  return {
    id,
    sourceId,
    importedAt: NOW,
    fileName: 'export.json',
    fileSize: 1024,
    detectedEncoding: 'utf-8',
    parserId: 'szlib',
    stats: {
      totalRawRecords: 1,
      newBooks: 1,
      updatedBooks: 0,
      newBorrowCycles: 1,
      skippedRecords: 0,
      warningCount: 0,
      errorCount: 0,
    },
    warnings: [],
  }
}

export { uuid }
