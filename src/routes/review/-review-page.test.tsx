// review 规格 §9.7：/review 页与审核 Sheet 的 SSR 静态标记测试（node 环境，仓库既有模式）。
// 数据流与写库动作已由 review-actions.test.ts（fake-indexeddb）覆盖；这里锁定
// 渲染契约：列表行/徽标/空态、Sheet 预填与按钮结构。
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import i18n, { changeLanguage } from '@/i18n'
import type { Book, BorrowCycle, CatalogRecord, RawRecord, Source } from '@/types/entities'
import { ReviewPage } from './-review-page'
import { PlaceholderForm } from './-placeholder-sheet'
import { SetForm, suggestSetTitle } from './-set-sheet'
import { useLiveQuery } from 'dexie-react-hooks'

// dexie-react-hooks 在 node 测试环境无法跑真实 Dexie 订阅，mock 为受控返回值；
// db 单例仅被事件处理器引用，SSR 渲染不触发，桩空对象即可。
vi.mock('dexie-react-hooks', () => ({ useLiveQuery: vi.fn() }))
vi.mock('@/db/db-instance', () => ({ db: {} }))

const useLiveQueryMock = vi.mocked(useLiveQuery)

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
    volume: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }
}

function mkCycle(over: Partial<BorrowCycle>): BorrowCycle {
  return {
    id: 'cy-1',
    bookId: 'bk-1',
    catalogRecordId: 'cr-1',
    sourceId: 'src-sz',
    borrowedAt: NOW,
    returnedAt: null,
    status: 'borrowed',
    borrowLocation: null,
    returnLocation: null,
    rawRecordIds: [],
    barcode: null,
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

describe('ReviewPage — 列表渲染与空态', () => {
  beforeEach(() => {
    useLiveQueryMock.mockReset()
  })

  function renderPage(books: Book[], crs: CatalogRecord[], cycles: BorrowCycle[]) {
    useLiveQueryMock.mockReturnValue([books, crs, cycles, [], [source]])
    return renderToStaticMarkup(createElement(ReviewPage))
  }

  it('两类待审行渲染：题名/类型徽标（占位 destructive、套装 outline）/ISBN/借阅数', () => {
    const ph = mkBook({ id: 'bk-ph', needsReview: true, isbn13: null, title: '福田图书馆读者自选图书' })
    const set = mkBook({ id: 'bk-set', needsReview: true, isbn13: '9787574012745', title: '合成书目052' })
    const html = renderPage(
      [set, ph],
      [mkCr({ id: 'cr-1', bookId: 'bk-ph', barcodes: ['PH1'] })],
      [mkCycle({ id: 'cy-1', bookId: 'bk-set' })],
    )
    expect(html).toContain('福田图书馆读者自选图书')
    expect(html).toContain('合成书目052')
    expect(html).toContain('9787574012745')
    expect(html).toContain('占位')
    expect(html).toContain('套装候选')
    expect(html).toContain('审核')
    // 占位徽标 destructive、套装 outline。
    expect(html).toContain('data-variant="destructive"')
    expect(html).toContain('data-variant="outline"')
  })

  it('无待审 → Empty 空态', () => {
    const html = renderPage([], [], [])
    expect(html).toContain('无待审')
    expect(html).not.toContain('>审核<')
  })
})

describe('PlaceholderForm — 补全表单渲染', () => {
  it('已知信息（条码/借阅数）+ 书名预填占位原文 + 保存/合并区', () => {
    const ph = mkBook({ id: 'bk-ph', needsReview: true, isbn13: null, title: '福田图书馆读者自选图书' })
    const cr = mkCr({ id: 'cr-1', bookId: 'bk-ph', barcodes: ['04400820112345'], metaId: 7777777 })
    const cycles = [mkCycle({ id: 'cy-1', bookId: 'bk-ph' })]
    const html = renderToStaticMarkup(
      createElement(PlaceholderForm, {
        book: ph,
        catalogRecords: [cr],
        borrowCycles: cycles,
        sources: [source],
        displayTimezone: 'UTC',
        onDone: () => undefined,
      }),
    )
    expect(html).toContain('04400820112345')
    expect(html).toContain('借阅次数')
    expect(html).toContain('深圳图书馆')
    // 书名输入预填占位原文（value 属性）。
    expect(html).toContain('value="福田图书馆读者自选图书"')
    expect(html).toContain('保存')
    expect(html).toContain('合并到已有书目')
  })
})

describe('SetForm — 套装表单渲染', () => {
  it('题名预填公共前缀建议；每编目一行卷号输入预填 parseVolumeFromTitle', () => {
    const set = mkBook({ id: 'bk-set', needsReview: true, isbn13: '9787574012745', title: '合成书目052 : 合成副题 52 . 3' })
    const cr3 = mkCr({ id: 'cr-v3', bookId: 'bk-set', metaId: 7109377, metaIdKey: '7109377', barcodes: ['B3'] })
    const cr4 = mkCr({ id: 'cr-v4', bookId: 'bk-set', metaId: 7109378, metaIdKey: '7109378', barcodes: ['B4'] })
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
    const html = renderToStaticMarkup(
      createElement(SetForm, {
        book: set,
        catalogRecords: [cr3, cr4],
        rawRecords: raws,
        borrowCycles: [],
        sources: [source],
        onDone: () => undefined,
      }),
    )
    // 题名预填 = 首个编目题名去卷号段。
    expect(html).toContain('value="合成书目052 : 合成副题 52"')
    // 每行题名原文 + 卷号输入预填。
    expect(html).toContain('合成书目052 : 合成副题 52 . 3')
    expect(html).toContain('合成书目053 : 合成副题 53 . 4')
    expect(html).toContain('value="3"')
    expect(html).toContain('value="4"')
    // 馆藏号等宽显示。
    expect(html).toContain('7109377')
    expect(html).toContain('7109378')
    // 三个操作：保存为套装 / 不是套装 / 拆为独立 Book。
    expect(html).toContain('保存为套装')
    expect(html).toContain('不是套装')
    expect(html).toContain('拆为独立 Book')
  })
})

describe('suggestSetTitle — 公共前缀建议', () => {
  it('取首个编目题名去卷号段；无卷号段原样', () => {
    const set = mkBook({ id: 'bk-set', needsReview: true, isbn13: '9787574012745', title: '合成书目052 : 合成副题 52 . 3' })
    const cr3 = mkCr({ id: 'cr-v3', bookId: 'bk-set', metaIdKey: '7109377' })
    const raws: RawRecord[] = [
      {
        id: 'raw-3',
        importLogId: 'log-1',
        sourceId: 'src-sz',
        data: { metaid: 7109377, title: '合成书目052 : 合成副题 52 . 3' },
        rowIndex: 1,
        borrowCycleId: null,
        bookId: 'bk-set',
        parseStatus: 'success',
        parseNote: null,
      },
    ]
    expect(suggestSetTitle(set, [cr3], raws)).toBe('合成书目052 : 合成副题 52')
    // 无原始行：回退 Book.title 去卷号段。
    expect(suggestSetTitle(set, [], [])).toBe('合成书目052 : 合成副题 52')
  })
})
