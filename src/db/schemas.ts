import { z } from 'zod'

import type { ClassificationSystem, ParseStatus, ParseWarningType } from '@/types/entities'

// 时间字段：接受 Date 实例或 ISO 8601 字符串，统一归一为 Date 对象（UTC 语义由调用方保证）。
const utcDate = z.union([
  z.date(),
  z.string().transform((value, ctx): Date => {
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: 'custom', message: `invalid date: ${value}` })
    }
    return parsed
  }),
])

const nullableUtcDate = utcDate.nullable()

// ISBN-13：null 或 13 位纯数字（校验位为软校验，落库前不在此阻断）。
const isbn13 = z.union([z.null(), z.string().regex(/^\d{13}$/)])

const classificationSystemEnum = z.enum([
  'clc',
  'ddc',
  'lcc',
  'udc',
  'other',
] as const satisfies readonly ClassificationSystem[])

const classificationEntrySchema = z.object({
  system: classificationSystemEnum,
  code: z.string(),
  category: z.string().optional(),
})

const priceSchema = z.object({
  amount: z.number(),
  currency: z.string(),
})

export const bookSchema = z.object({
  id: z.string(),
  isbn13,
  isbn10: z.union([z.null(), z.string()]),
  title: z.string(),
  subtitle: z.union([z.null(), z.string()]),
  authors: z.array(z.string()),
  translators: z.array(z.string()),
  publisher: z.union([z.null(), z.string()]),
  publishDate: z.union([z.null(), z.string()]),
  edition: z.union([z.null(), z.string()]),
  pages: z.union([z.null(), z.number()]),
  price: z.union([z.null(), priceSchema]),
  subjects: z.array(z.string()),
  tags: z.array(z.string()),
  coverUrl: z.union([z.null(), z.string()]),
  description: z.union([z.null(), z.string()]),
  createdAt: utcDate,
  updatedAt: utcDate,
  needsReview: z.boolean(),
  sourceIds: z.array(z.string()),
})

export const catalogRecordSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  sourceId: z.string(),
  metaId: z.union([z.null(), z.string(), z.number()]),
  metaIdKey: z.union([z.null(), z.string()]),
  barcodes: z.array(z.string()),
  classifications: z.array(classificationEntrySchema),
  createdAt: utcDate,
  updatedAt: utcDate,
})

const borrowStatusEnum = z.enum(['borrowed', 'returned', 'unknown'])

export const borrowCycleSchema = z.object({
  id: z.string(),
  bookId: z.string(),
  catalogRecordId: z.string(),
  sourceId: z.string(),
  borrowedAt: utcDate,
  returnedAt: nullableUtcDate,
  status: borrowStatusEnum,
  borrowLocation: z.union([z.null(), z.string()]),
  returnLocation: z.union([z.null(), z.string()]),
  rawRecordIds: z.array(z.string()),
  barcode: z.union([z.null(), z.string()]),
  createdAt: utcDate,
  updatedAt: utcDate,
})

const libraryTypeEnum = z.enum(['public', 'academic', 'special'])

const libraryInfoSchema = z.object({
  libraryType: libraryTypeEnum,
  city: z.union([z.null(), z.string()]),
  province: z.union([z.null(), z.string()]),
  website: z.union([z.null(), z.string()]),
  opacUrl: z.union([z.null(), z.string()]),
  classificationSystem: z.union([z.null(), classificationSystemEnum]),
})

const sourceTypeEnum = z.enum(['library', 'manual'])

export const sourceSchema = z.object({
  id: z.string(),
  type: sourceTypeEnum,
  name: z.string(),
  parserId: z.string(),
  parserVersion: z.union([z.null(), z.string()]),
  timezone: z.string(),
  library: z.union([z.null(), libraryInfoSchema]),
  notes: z.union([z.null(), z.string()]),
  createdAt: utcDate,
  lastImportAt: nullableUtcDate,
  totalImportedRecords: z.number(),
})

const parseStatusEnum = z.enum([
  'success',
  'warning',
  'error',
  'skipped',
] as const satisfies readonly ParseStatus[])

export const rawRecordSchema = z.object({
  id: z.string(),
  importLogId: z.string(),
  sourceId: z.string(),
  data: z.record(z.string(), z.unknown()),
  rowIndex: z.number(),
  borrowCycleId: z.union([z.null(), z.string()]),
  bookId: z.union([z.null(), z.string()]),
  parseStatus: parseStatusEnum,
  parseNote: z.union([z.null(), z.string()]),
})

const parseWarningTypeEnum = z.enum([
  'missing_field',
  'invalid_date',
  'unpaired_record',
  'duplicate',
  'format_error',
] as const satisfies readonly ParseWarningType[])

const parseWarningSchema = z.object({
  type: parseWarningTypeEnum,
  message: z.string(),
  recordRef: z.union([z.null(), z.string()]),
})

const importLogStatsSchema = z.object({
  totalRawRecords: z.number(),
  newBooks: z.number(),
  updatedBooks: z.number(),
  newBorrowCycles: z.number(),
  skippedRecords: z.number(),
  warningCount: z.number(),
  errorCount: z.number(),
})

export const importLogSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  importedAt: utcDate,
  fileName: z.string(),
  fileSize: z.number(),
  detectedEncoding: z.string(),
  parserId: z.string(),
  stats: importLogStatsSchema,
  warnings: z.array(parseWarningSchema),
})
