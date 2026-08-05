// book-editing 规格 §7.2：统一编辑表单 SSR 静态标记测试（node 环境，仓库既有模式）。
// 数据流与写库动作已由 -edit-actions.test.ts（fake-indexeddb）覆盖；这里锁定
// 渲染契约：全字段预填（数组分隔回显）、编目卡（馆藏号/条码/分类/卷号预填）、类型徽标。
// 校验规则抽为纯函数 validateBookFields 单测；保存交互由 E2E 覆盖。
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n, { changeLanguage } from '@/i18n'
import type { Book, CatalogRecord, RawRecord, Source } from '@/types/entities'
import { EditForm, validateBookFields } from './-edit-dialog'

// 表单体的事件处理器引用 db 单例，SSR 渲染不触发，桩空对象即可。
vi.mock('@/db/db-instance', () => ({ db: {} }))

beforeAll(async () => {
  if (!i18n.isInitialized) await i18n.init()
  await changeLanguage('zh-CN')
})

const NOW = new Date('2026-06-01T00:00:00.000Z')

function mkBook(over: Partial<Book>): Book {
  return {
    id: 'bk-1',
    isbn13: null,
    isbn10: null,
    title: '',
    subtitle: null,
    authors: [],
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
    needsReview: false,
    sourceIds: ['src-sz'],
    parallelTitles: [],
    ...over,
  }
}

function mkCr(over: Partial<CatalogRecord>): CatalogRecord {
  return {
    id: 'cr-1',
    bookId: 'bk-1',
    sourceId: 'src-sz',
    metaId: null,
    metaIdKey: null,
    barcodes: [],
    classifications: [],
    opacEnrichment: null,
    volume: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

const source: Source = {
  id: 'src-sz',
  type: 'library',
  name: '深圳图书馆',
  parserId: 'szlib',
  parserVersion: null,
  timezone: 'Asia/Shanghai',
  library: null,
  notes: null,
  createdAt: NOW,
  lastImportAt: null,
  totalImportedRecords: 0,
}

function renderForm(
  book: Book,
  catalogRecords: CatalogRecord[],
  rawRecords: RawRecord[] = [],
) {
  return renderToStaticMarkup(
    createElement(EditForm, {
      book,
      catalogRecords,
      rawRecords,
      sources: [source],
      open: true,
      onOpenChange: () => undefined,
    }),
  )
}

describe('EditForm — 普通书目全字段预填', () => {
  it('Book 字段预填：题名/作者分隔回显/出版字段/ISBN 等宽', () => {
    const book = mkBook({
      id: 'bk-n',
      title: '合成书目',
      subtitle: '副题',
      parallelTitles: ['Parallel'],
      authors: ['作者甲', '作者乙'],
      translators: ['译者丙'],
      publisher: '出版社',
      publishDate: '2024-05',
      edition: '第2版',
      pages: 320,
      price: { amount: 45.5, currency: 'CNY' },
      isbn13: '9787574012745',
      isbn10: null,
      subjects: ['文学', '历史'],
      tags: ['想重读'],
      description: '简介',
      coverUrl: 'https://example.com/c.jpg',
    })
    const html = renderForm(book, [])
    expect(html).toContain('value="合成书目"')
    expect(html).toContain('value="副题"')
    expect(html).toContain('value="Parallel"')
    // 数组字段顿号分隔回显。
    expect(html).toContain('value="作者甲，作者乙"')
    expect(html).toContain('value="译者丙"')
    expect(html).toContain('value="出版社"')
    expect(html).toContain('value="2024-05"')
    expect(html).toContain('value="第2版"')
    expect(html).toContain('value="320"')
    expect(html).toContain('value="45.5"')
    expect(html).toContain('value="CNY"')
    expect(html).toContain('value="9787574012745"')
    expect(html).toContain('value="文学，历史"')
    expect(html).toContain('value="想重读"')
    expect(html).toContain('简介')
    expect(html).toContain('value="https://example.com/c.jpg"')
    // 保存/取消按钮。
    expect(html).toContain('保存')
    expect(html).toContain('取消')
    // 普通书无待审徽标。
    expect(html).not.toContain('占位')
    expect(html).not.toContain('data-variant="destructive"')
  })

  it('可空字段为空值不渲染 value 冲突（null → 空串）', () => {
    const html = renderForm(mkBook({ title: '书' }), [])
    expect(html).toContain('value="书"')
  })
})

describe('EditForm — 占位书徽标', () => {
  it('选书帮占位 → destructive「占位」徽标', () => {
    const ph = mkBook({ id: 'bk-ph', needsReview: true, isbn13: null, title: '福田图书馆读者自选图书' })
    const html = renderForm(ph, [mkCr({ bookId: 'bk-ph', barcodes: ['PH1'] })])
    expect(html).toContain('data-variant="destructive"')
    expect(html).toContain('占位')
  })
})

describe('EditForm — 套装候选预填与编目卡', () => {
  const set = mkBook({ id: 'bk-set', needsReview: true, isbn13: '9787574012745', title: '合成书目052 : 合成副题 52 . 3' })
  const cr3 = mkCr({ id: 'cr-v3', bookId: 'bk-set', metaId: 7109377, metaIdKey: '7109377', barcodes: ['B3', 'B3X'] })
  const cr4 = mkCr({ id: 'cr-v4', bookId: 'bk-set', metaId: 7109378, metaIdKey: '7109378', barcodes: ['B4'], volume: '4' })
  const raws: RawRecord[] = [
    {
      id: 'raw-3',
      importLogId: 'log-1',
      sourceId: 'src-sz',
      data: { metaid: 7109377, barcode: 'B3', title: '合成书目052 : 合成副题 52 . 3' },
      rowIndex: 1,
      borrowCycleId: null,
      bookId: 'bk-set',
      parseStatus: 'success',
      parseNote: null,
    },
    {
      id: 'raw-4',
      importLogId: 'log-1',
      sourceId: 'src-sz',
      data: { metaid: 7109378, barcode: 'B4', title: '合成书目053 : 合成副题 53 . 4' },
      rowIndex: 2,
      borrowCycleId: null,
      bookId: 'bk-set',
      parseStatus: 'success',
      parseNote: null,
    },
  ]

  it('卷号输入预填 parseVolumeFromTitle；已有 volume 保留；条码多行回显；馆藏号等宽', () => {
    const html = renderForm(set, [cr3, cr4], raws)
    // 卷号：cr3 无 volume → 从题名解析「3」；cr4 已有「4」保留。
    expect(html).toContain('value="3"')
    expect(html).toContain('value="4"')
    // 条码多行（textarea 内容）。
    expect(html).toContain('B3\nB3X')
    expect(html).toContain('B4')
    // 馆藏号等宽输入预填（metaId → String 回显）。
    expect(html).toContain('value="7109377"')
    expect(html).toContain('value="7109378"')
    // 馆藏号输入 aria-label 区分编目行。
    expect(html).toContain('aria-label="馆藏号 合成书目052 : 合成副题 52 . 3"')
    expect(html).toContain('aria-label="馆藏号 合成书目053 : 合成副题 53 . 4"')
    // 来源徽标与题名原文。
    expect(html).toContain('深圳图书馆')
    expect(html).toContain('合成书目052 : 合成副题 52 . 3')
    // 「从题名解析」辅助按钮。
    expect(html).toContain('从题名解析')
    // 套装徽标 outline。
    expect(html).toContain('data-variant="outline"')
    expect(html).toContain('套装')
  })

  it('分类行预填：system 下拉值 + code 输入', () => {
    const withCls = mkCr({
      id: 'cr-c1',
      bookId: 'bk-set',
      classifications: [{ system: 'clc', code: 'I247.5' }],
    })
    const html = renderForm(set, [withCls], raws)
    expect(html).toContain('I247.5')
    expect(html).toContain('添加分类')
    // metaId 为 null 的编目：馆藏号输入存在且空白（清空语义）。
    expect(html).toMatch(/aria-label="馆藏号 [^"]*" value=""/)
  })
})

describe('validateBookFields — 前端校验', () => {
  const t = (k: string) => (k === 'field.titleRequired' ? '书名不能为空' : `ERR:${k}`)
  const valid = {
    title: '书',
    isbn13: '',
    publishDate: '',
    pages: '',
    priceAmount: '',
    priceCurrency: '',
    coverUrl: '',
  }

  it('全过 → {}', () => {
    expect(validateBookFields(valid, t)).toEqual({})
  })

  it('空题名 → title 错误', () => {
    expect(validateBookFields({ ...valid, title: '  ' }, t)).toHaveProperty('title')
  })

  it('非法 ISBN（非 13 位数字）→ isbn13 错误；合法通过；校验位非法（软校验）不阻断', () => {
    expect(validateBookFields({ ...valid, isbn13: '123' }, t)).toHaveProperty('isbn13')
    expect(validateBookFields({ ...valid, isbn13: '9787574012745' }, t)).toEqual({})
    // 13 位纯数字但校验位不合法（旧数据/夹具）→ 不阻断，与 bookSchema 硬校验一致。
    expect(validateBookFields({ ...valid, isbn13: '9780000000001' }, t)).toEqual({})
    expect(validateBookFields({ ...valid, isbn13: '978-000-000-000-1' }, t)).toEqual({})
  })

  it('坏日期/坏页数/坏 URL 各自报错', () => {
    expect(validateBookFields({ ...valid, publishDate: '2024-13-40' }, t)).toHaveProperty('publishDate')
    expect(validateBookFields({ ...valid, publishDate: '2024-05' }, t)).toEqual({})
    expect(validateBookFields({ ...valid, pages: '-3' }, t)).toHaveProperty('pages')
    expect(validateBookFields({ ...valid, pages: '320' }, t)).toEqual({})
    expect(validateBookFields({ ...valid, coverUrl: 'not a url' }, t)).toHaveProperty('coverUrl')
    expect(validateBookFields({ ...valid, coverUrl: 'https://example.com' }, t)).toEqual({})
  })

  it('价格半空（有金额无货币）→ price 错误；同空/同填通过', () => {
    expect(validateBookFields({ ...valid, priceAmount: '45' }, t)).toHaveProperty('price')
    expect(validateBookFields({ ...valid, priceCurrency: 'CNY' }, t)).toHaveProperty('price')
    expect(validateBookFields({ ...valid, priceAmount: '45', priceCurrency: 'CNY' }, t)).toEqual({})
    expect(validateBookFields({ ...valid, priceAmount: 'abc', priceCurrency: 'CNY' }, t)).toHaveProperty('price')
  })
})
