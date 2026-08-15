// szlib getBookDetail 响应解析（opac-enrichment §3.2/§3.3/§3.4）。
// 纯函数：无时钟、无 I/O；fetchDetail 仅负责网络 + 调用本函数。
// HTML 实体解码复用 lib/encoding 的 decodeHtmlEntities（与 szlib 导入 parser 共用同一
// 转码方法，opac-enrichment §10.13 同理）：OPAC 响应与流通记录同源，标题/责任者等
// 可能含 `&apos;`/`&amp;`——解码后与库中已解码值一致，补全对照不误判 conflict。
import type { OpacDetail, OpacDetailResult } from '@/enrich/opac-provider'
import { decodeHtmlEntities } from '@/lib/encoding'

/** 字符串字段：非空 string 解码 HTML 实体后返回，空串/缺失 → null。 */
function str(json: Record<string, unknown>, key: string): string | null {
  const v = json[key]
  return typeof v === 'string' && v !== '' ? decodeHtmlEntities(v) : null
}

/**
 * abstract 落点（§3.3）：`abstracts` 可能为数组 → 按 `\n` join；
 * 其次 `abstracts`/`abstract` 非空字符串；否则 null。join 后统一解码实体。
 */
function rawAbstract(json: Record<string, unknown>): string | null {
  const abs = json['abstracts']
  if (Array.isArray(abs)) {
    const joined = abs.filter((x): x is string => typeof x === 'string').join('\n')
    return joined === '' ? null : decodeHtmlEntities(joined)
  }
  if (typeof abs === 'string' && abs !== '') return decodeHtmlEntities(abs)
  const single = json['abstract']
  return typeof single === 'string' && single !== '' ? decodeHtmlEntities(single) : null
}

/**
 * 未找到判定（§3.4，szlib 特有）：metaId 不存在 → HTTP 200 + 全空负载
 * （title/isbn 全空 + districtList 空数组）。**不能看 HTTP 状态码**。
 */
function isNotFound(json: Record<string, unknown>): boolean {
  const districtList = Array.isArray(json.districtList) ? json.districtList : []
  return (json.title ?? '') === '' && (json.isbn ?? '') === '' && districtList.length === 0
}

/**
 * 解析 getBookDetail 响应文本 → OpacDetailResult。
 * sourceUrl 由 fetchDetail 注入（纯函数无法自建 URL：需要 metaId/metaTable）。
 * JSON.parse 失败 → parse_error（不抛异常）。
 */
export function parseSzlibDetail(text: string, sourceUrl: string): OpacDetailResult {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return { ok: false, reason: 'parse_error' }
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { ok: false, reason: 'parse_error' }
  }
  const j = json as Record<string, unknown>
  if (isNotFound(j)) return { ok: false, reason: 'not_found' }

  const detail: OpacDetail = {
    title: str(j, 'title'),
    author: str(j, 'author'),
    publish: str(j, 'publish'),
    page: str(j, 'page'),
    price: str(j, 'price'),
    subject: str(j, 'subject'),
    classno: str(j, 'classno'),
    abstract: rawAbstract(j),
    isbn: str(j, 'isbn'),
    img: str(j, 'img'),
  }
  return { ok: true, detail, sourceUrl }
}
