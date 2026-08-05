// 深圳图书馆 OPAC Provider（opac-enrichment §3，接口实测 2026-08-01）。
// URL/参数/响应解析/未找到判定/CORS 事实收口在本实现；编目语义解析归映射层
// （src/lib/opac-mapping.ts）。detail.ts 为纯函数响应解析（可单测），
// fetchDetail 仅负责 URL 构造 + 传输基元 + 调用解析。
import type { CatalogRecord } from '@/types/entities'
import type { OpacDetailResult, OpacProvider } from '@/enrich/opac-provider'
import { fetchWithTimeout } from '@/enrich/opac-client'
import { parseSzlibDetail } from './detail'

const API_BASE = 'https://www.szlib.org.cn/api/opacservice'
const DETAIL_PAGE = 'https://www.szlib.org.cn/opac/searchDetail'
/** 编目主表（§3.1：与流通记录 metatable 对应；CatalogRecord 不存 metatable，恒用主表）。 */
const META_TABLE = 'bibliosm'
/** 站点固定参数（§3.2），常量保留。 */
const CLIENT_ID = 't1'

/** metaId 空/0 → 无有效反查键（与候选集 §7.1 判定一致）。 */
function metaIdOf(record: CatalogRecord): string | number | null {
  return record.metaId == null || record.metaId === 0 ? null : record.metaId
}

export const szlibProvider: OpacProvider = {
  id: 'szlib',
  displayName: '深圳图书馆 OPAC',
  lookupKey: 'metaId',
  /** §3.1 详情页 URL（Vue SPA 壳，仅供外链/溯源；程序化补全走 fetchDetail）。 */
  detailUrl(record) {
    const metaId = metaIdOf(record)
    if (metaId == null) return null
    return `${DETAIL_PAGE}?tablename=${META_TABLE}&recordid=${encodeURIComponent(String(metaId))}`
  },
  /** §3.2 JSON 数据接口；未找到判定看负载不看状态码（§3.4）。 */
  async fetchDetail(record, _book, opts): Promise<OpacDetailResult> {
    const metaId = metaIdOf(record)
    if (metaId == null) return { ok: false, reason: 'not_found' }
    const url = `${API_BASE}/getBookDetail?metaTable=${META_TABLE}&metaId=${encodeURIComponent(String(metaId))}&client_id=${CLIENT_ID}`
    const text = await fetchWithTimeout(url, { timeoutMs: opts.timeoutMs, signal: opts.signal })
    return parseSzlibDetail(text, url)
  },
}
