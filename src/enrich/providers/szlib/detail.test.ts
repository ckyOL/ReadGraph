// szlib getBookDetail 响应解析纯函数测试（opac-enrichment §12）。
// 夹具：src/tests/fixtures/opac-detail-sample.json（脱敏自 §3.3 实测样本）。
import { describe, expect, it } from 'vitest'

import { parseSzlibDetail } from '@/enrich/providers/szlib/detail'
import sample from '@/tests/fixtures/opac-detail-sample.json'

const SOURCE_URL =
  'https://www.szlib.org.cn/api/opacservice/getBookDetail?metaTable=bibliosm&metaId=6092919&client_id=t1'

/** §3.4 空负载形态：HTTP 200 + 全空字段 + districtList []。 */
const EMPTY_PAYLOAD = {
  title: '',
  author: '',
  publish: '',
  publishyear: '',
  callno: '',
  series: '',
  page: '',
  price: '',
  subject: '',
  classno: '',
  abstract: '',
  abstracts: '',
  isPreloan: false,
  isbn: '',
  img: '',
  districtList: [],
  CanLoanBook: [],
  OnlyReadBook: [],
  BorrowedBook: [],
}

describe('parseSzlibDetail', () => {
  it('实测样本 JSON → 统一 OpacDetail（空串 → null，忽略 publishyear/callno/series 等）', () => {
    const r = parseSzlibDetail(JSON.stringify(sample), SOURCE_URL)
    expect(r).toEqual({
      ok: true,
      sourceUrl: SOURCE_URL,
      detail: {
        title: '合成绘本甲=Synthetic story',
        author: '(日)合成作者著 　合成译者译',
        publish: '北京:合成出版社,2023',
        page: '198页',
        price: 'CNY35.00',
        subject: '漫画-连环画-日本-现代',
        classno: 'J238.2(313)',
        abstract: null,
        isbn: '978-7-5217-4823-9',
        img: 'https://www.bookcovers.cn/index.php?client=szlib&isbn=978-7-5217-4823-9/cover',
      },
    })
  })

  it('abstracts 为数组 → 按 \\n join 落 abstract', () => {
    const r = parseSzlibDetail(
      JSON.stringify({ ...sample, abstract: '', abstracts: ['第一段', '第二段'] }),
      SOURCE_URL,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.detail.abstract).toBe('第一段\n第二段')
  })

  it('HTML 实体解码（与导入管线共用 decodeHtmlEntities）：命名/数字实体 → 解码；URL &amp; 还原', () => {
    const r = parseSzlibDetail(
      JSON.stringify({
        ...sample,
        title: 'The Book Lovers&apos; Miscellany = 书虫杂记',
        author: 'Tom &amp; Jerry 著',
        subject: '漫画&#39;日本',
        img: 'https://www.bookcovers.cn/index.php?client=szlib&amp;isbn=978-7-5217-4823-9/cover',
      }),
      SOURCE_URL,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.detail.title).toBe("The Book Lovers' Miscellany = 书虫杂记")
    expect(r.detail.author).toBe('Tom & Jerry 著')
    expect(r.detail.subject).toBe("漫画'日本")
    expect(r.detail.img).toBe(
      'https://www.bookcovers.cn/index.php?client=szlib&isbn=978-7-5217-4823-9/cover',
    )
  })

  it('abstracts 数组条目含实体 → join 后统一解码', () => {
    const r = parseSzlibDetail(
      JSON.stringify({
        ...sample,
        abstract: '',
        abstracts: ["Tom &amp; Jerry&apos;s 历险", '第二段'],
      }),
      SOURCE_URL,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.detail.abstract).toBe("Tom & Jerry's 历险\n第二段")
  })

  it('abstracts 数组含非字符串元素 → 过滤后 join', () => {
    const r = parseSzlibDetail(
      JSON.stringify({ ...sample, abstract: '', abstracts: ['第一段', 42] }),
      SOURCE_URL,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.detail.abstract).toBe('第一段')
  })

  it('abstract 为空串、abstracts 缺省 → abstract=null', () => {
    const r = parseSzlibDetail(JSON.stringify({ ...sample, abstract: '' }), SOURCE_URL)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.detail.abstract).toBeNull()
  })

  it('空负载（title/isbn 空 + districtList []）→ not_found（不看 HTTP 状态码）', () => {
    const r = parseSzlibDetail(JSON.stringify(EMPTY_PAYLOAD), SOURCE_URL)
    expect(r).toEqual({ ok: false, reason: 'not_found' })
  })

  it('非法 JSON → parse_error，不抛异常', () => {
    expect(() => parseSzlibDetail('not json {', SOURCE_URL)).not.toThrow()
    expect(parseSzlibDetail('not json {', SOURCE_URL)).toEqual({ ok: false, reason: 'parse_error' })
  })

  it('JSON 非对象（数组/标量）→ parse_error', () => {
    expect(parseSzlibDetail('[1,2]', SOURCE_URL)).toEqual({ ok: false, reason: 'parse_error' })
    expect(parseSzlibDetail('123', SOURCE_URL)).toEqual({ ok: false, reason: 'parse_error' })
  })

  it('缺失字段 → null（防御转换）', () => {
    const r = parseSzlibDetail(JSON.stringify({ title: '只有题名' }), SOURCE_URL)
    expect(r).toEqual({
      ok: true,
      sourceUrl: SOURCE_URL,
      detail: {
        title: '只有题名',
        author: null,
        publish: null,
        page: null,
        price: null,
        subject: null,
        classno: null,
        abstract: null,
        isbn: null,
        img: null,
      },
    })
  })

  it('sourceUrl 透传', () => {
    const r = parseSzlibDetail(JSON.stringify(sample), 'https://example.test/raw')
    expect(r.ok && r.sourceUrl).toBe('https://example.test/raw')
  })

  it('确定性：同输入两次调用深等价', () => {
    const text = JSON.stringify(sample)
    expect(parseSzlibDetail(text, SOURCE_URL)).toEqual(parseSzlibDetail(text, SOURCE_URL))
  })
})
