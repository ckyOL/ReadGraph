// 设置页备份下载装配（settings 规格 §3/§5）。
// exportDatabase → serializeExportText → buildBackupFilename → 触发下载。
// 导出/重置为一次性 onClick 微任务，不阻塞渲染与导航。
import type { ReadGraphDB } from '@/db/db'
import { exportDatabase } from '@/db/export-import'
import { buildBackupFilename, serializeExportText } from '@/db/backup'

/** 触发浏览器下载（Blob + 临时 anchor）。 */
export function triggerDownload(text: string, filename: string): void {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** 导出当前库并下载备份（文件名为 UTC 分量：readgraph-backup-YYYYMMDD-HHmmss.json）。 */
export async function exportBackupAndDownload(db: ReadGraphDB): Promise<void> {
  const data = await exportDatabase(db)
  triggerDownload(serializeExportText(data), buildBackupFilename(data.exportedAt))
}
