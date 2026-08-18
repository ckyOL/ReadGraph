// OPAC 补全 Provider 抽象与注册表（opac-enrichment 规格 §2）。
// 来源差异（URL/参数/响应解析/未找到判定/候选键）全部收口在 OpacProvider 实现内；
// 映射（mapOpacDetail）与预填（prefillFromChanges）来源无关，见 src/lib/opac-mapping.ts。
// 与 SourceParser 注册表（src/parsers/registry.ts）同构，但 getProvider 未注册返回 null
// 不抛错——补全是可选能力（入口隐藏），导入是硬依赖。
import type { Book, CatalogRecord } from '@/types/entities'
import { szlibProvider } from './providers/szlib'

/** 统一中间态：provider 输出的原始形态平铺字段（MARC 风格，opac-enrichment §2.1）。
 *  字段全部可空：provider 只填接口实际提供的字段，缺省为 null → 不产出对应 change。 */
export interface OpacDetail {
  /** 编目正题名原文（可含并列题名串） */
  title: string | null
  /** 责任者声明原文 */
  author: string | null
  /** 出版地:出版社,出版年 原文 */
  publish: string | null
  /** 页数原文文本（如 "198页"） */
  page: string | null
  /** 定价原文（如 "CNY35.00"） */
  price: string | null
  /** 关键词原文（分隔串） */
  subject: string | null
  /** 分类号原文（可含复分后缀） */
  classno: string | null
  /** 内容简介原文（provider 已把数组按统一规则拼串） */
  abstract: string | null
  /** ISBN 原文（可含连字符） */
  isbn: string | null
  /** 封面图 URL */
  img: string | null
}

export type OpacDetailResult =
  | { ok: true; detail: OpacDetail; sourceUrl: string }
  | { ok: false; reason: 'parse_error' | 'not_found' }

/** OPAC 补全来源（opac-enrichment §2.2）。id = Source.parserId（二合一键）。 */
export interface OpacProvider {
  /** 唯一标识 = Source.parserId，如 'szlib' */
  id: string
  /** UI 文案用显示名，如「深圳图书馆 OPAC」 */
  displayName: string
  /** 短名（徽标用，如「深图」）；缺省回退 displayName。多来源并存时字段级徽标/目标编目标记用它区分来源 */
  shortName?: string
  /** 候选键：以什么实体字段反查本来源 OPAC */
  lookupKey: 'metaId' | 'isbn13'
  /** 用户可访问的详情页外链（降级/溯源）；无 → null。
   *  仅返回 https: URL 或 null——渲染层（$bookId.tsx）有 scheme 白名单守卫，
   *  非 https 一律不渲染，provider 不得从外部数据构造 javascript: 等非 https URL。 */
  detailUrl(record: CatalogRecord, book: Book): string | null
  /** 传输 + 响应解析 + 未找到判定（来源特有）；经传输基元 opac-client 发网络 */
  fetchDetail(
    record: CatalogRecord,
    book: Book,
    opts: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<OpacDetailResult>
}

/** 注册表：按 parserId（= provider.id）查找。 */
export interface OpacProviderRegistry {
  register(provider: OpacProvider): void
  unregister(providerId: string): void
  getProvider(parserId: string): OpacProvider | null
  size(): number
}

function createRegistryCore(): OpacProviderRegistry {
  const byId = new Map<string, OpacProvider>()
  return {
    register(provider) {
      byId.set(provider.id, provider)
    },
    unregister(providerId) {
      byId.delete(providerId)
    },
    getProvider(parserId) {
      return byId.get(parserId) ?? null
    },
    size() {
      return byId.size
    },
  }
}

/** 创建一个隔离注册表（测试用），与全局互不影响。 */
export function createOpacProviderRegistry(): OpacProviderRegistry {
  return createRegistryCore()
}

/** 默认全局注册表，默认注册 szlibProvider；其它 provider 按 §2.4 清单增量接入。
 *  导出供测试注入临时 provider（与 parsers/registry.ts defaultRegistry 同款接缝）。 */
export const defaultOpacRegistry: OpacProviderRegistry = createRegistryCore()
defaultOpacRegistry.register(szlibProvider)

/** 便捷：默认注册表查找；未注册返回 null（不抛——补全是可选能力，UI 隐藏入口）。 */
export function getProvider(parserId: string): OpacProvider | null {
  return defaultOpacRegistry.getProvider(parserId)
}
