declare const __DEBUG_MODE__: boolean

import type { ImportTrace } from '@/parsers/trace'

/** window.__readgraphDebug 全局钩子（spec §3.2）。 */
export interface ReadgraphDebug {
  /** 最近一次导入的 trace（会话内；未导入/未开启收集为 null）。 */
  lastImport: ImportTrace | null
  /** 读取最近一次导入的 trace。 */
  getImportTrace(): ImportTrace | null
  /** 导出 trace 为 JSON 文件（Blob + a[download]，spec US6）。 */
  exportImportTrace(): void
  /** 复制 trace JSON 到剪贴板。 */
  copyImportTrace(): Promise<void>
}

declare global {
  interface Window {
    __readgraphDebug?: ReadgraphDebug
  }
}
