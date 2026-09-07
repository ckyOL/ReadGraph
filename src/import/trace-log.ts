// DevTools 输出通道与全局钩子（debug-mode spec §3.2/§4.1，DBG-2）。
// logImportTrace 仅由 dev 装配层在导入成功后调用（DBG-3 接线）；内部
// isDebugMode() 自门控——生产构建（__DEBUG_MODE__=false）下整个函数体被
// minifier 剔除，零输出零分配（D5）。lastImport 为模块态单例：logImportTrace
// 与 window.__readgraphDebug 始终指向同一 state（钩子未安装时更新不丢，
// installDebugHooks 后 lastImport 可见）。
import { isDebugMode, isDebugVerbose } from '@/lib/debug'
import type { ImportTrace } from '@/parsers/trace'
import type { ReadgraphDebug } from '@/types/debug'

const PREFIX = '[readgraph:import]'
const GROUP_TITLE = `${PREFIX} 导入决策 trace`
/** console.table 列裁剪（spec §4.1 第 2 步：避免 DevTools 表过宽）。 */
const TABLE_COLUMNS = ['rowIndex', 'barcode', 'title', 'decision', 'reason'] as const

/** 模块级最近 trace（spec §3.2：会话内最近一次导入）。 */
let lastImport: ImportTrace | null = null

/**
 * 输出导入决策 trace（spec §4.1 五步 + verbose 附加）。
 * trace=null 与 isDebugMode()=false 时完全 no-op（零输出、零对象遍历）。
 * 输出前先更新模块态/全局钩子 lastImport（group 打开时钩子已可见）。
 */
export function logImportTrace(trace: ImportTrace | null): void {
  if (!isDebugMode() || trace === null) return

  lastImport = trace
  // 钩子未安装 / 环境无 window（node/SSR）时静默；lastImport 为 getter 代理
  // 模块态，赋值无需回写钩子（group 打开时 __readgraphDebug 已可见，spec §3.2）。

  console.groupCollapsed(GROUP_TITLE, trace.importLogId)
  console.table(trace.rows, [...TABLE_COLUMNS])
  console.debug(`${PREFIX} rows`, trace.rows)
  console.debug(`${PREFIX} summary`, trace.stats, trace.durationMs)
  console.debug(`${PREFIX} warnings`, trace.warnings)

  if (isDebugVerbose()) {
    console.debug(`${PREFIX} entityDelta`, trace.entityDelta)
    for (const row of trace.rows) {
      // 仅 verbose 且命中派生 ID 的行有该字段（DBG-1 收集契约）；未填行跳过。
      if (row.idDerivation !== undefined) {
        console.debug(`${PREFIX} idDerivation`, { rowIndex: row.rowIndex, idDerivation: row.idDerivation })
      }
    }
  }

  console.groupEnd()
}

/** 导出最近 trace 为 JSON 文件（Blob + a[download]；同 backup.ts 序列化风格，Date→ISO）。 */
function exportImportTrace(): void {
  if (lastImport === null) return
  try {
    const text = JSON.stringify(lastImport, null, 2)
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    // trace 随会话消亡（D4），文件名无需 UTC 分量（区别于 backup.ts）。
    a.download = `readgraph-import-trace-${lastImport.importLogId}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    // document/URL/Blob 缺失（node/SSR 测试环境等）：静默返回。
  }
}

/** 复制最近 trace JSON 到剪贴板（navigator.clipboard 缺失/拒绝时静默 resolve）。 */
async function copyImportTrace(): Promise<void> {
  if (lastImport === null) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastImport, null, 2))
  } catch {
    // 剪贴板不可用（权限/非安全上下文）：静默降级（先例 ai-insights.tsx:66-70）。
  }
}

/**
 * 挂载 window.__readgraphDebug（spec §3.2；DBG-3 装配层调用 logImportTrace 前安装）。
 * isDebugMode() false（生产构建）不挂载直接返回；幂等——重复安装整体覆盖，
 * 无事件监听器累积。main.tsx 顶层装配区调用（dev-only，不渲染）。
 */
export function installDebugHooks(): void {
  if (!isDebugMode() || typeof window === 'undefined') return
  // lastImport 用 getter 代理模块态：logImportTrace 先于安装发生时值不丢。
  const hooks: ReadgraphDebug = {
    get lastImport() {
      return lastImport
    },
    getImportTrace: () => lastImport,
    exportImportTrace,
    copyImportTrace,
  }
  window.__readgraphDebug = hooks
}
