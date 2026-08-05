// 建议改动上下文会话传递（opac-enrichment 规格 §7.2：不落 URL、不落库）。
// 批量入口在书库列表/导入完成页抓取，编辑 Dialog 在书目详情页消费——跨路由组件状态
// 经模块级会话内存传递；页面刷新即丢失（重新触发将重新抓取）。
import type { EnrichmentContext } from './enrich-service'

let pending: EnrichmentContext | null = null

/** 写入待消费的补全上下文（单条入口与批量入口共用）。 */
export function setPendingEnrichment(context: EnrichmentContext | null): void {
  pending = context
}

/** 读取并清空（详情页打开编辑 Dialog 时消费一次）。 */
export function takePendingEnrichment(): EnrichmentContext | null {
  const context = pending
  pending = null
  return context
}
