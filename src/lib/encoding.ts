// 编码检测纯函数（import-workflow.md 编码检测 / import-pipeline §7）。
// 运行时 TextDecoder 原生支持 utf-8/gbk（Chromium 与 Node 22 full-icu），
// 不引入第三方解码库。仅依赖运行时能力，纯管线层只消费解码后的 text。
// 注：TextDecoder('gbk') 在浏览器/Node 为 built-in label，无环境差异。

/** 单文件大小上限（ui-navigation §6 大文件阈值，≥50MB 下放 Worker）。 */
export const IMPORT_MAX_FILE_SIZE = 50 * 1024 * 1024

export interface DecodeResult {
  text: string
  detectedEncoding: string
}

/**
 * 编码检测与解码：先 UTF-8（fatal）尝试，失败回退 GBK。
 * 返回 { text, detectedEncoding }，detectedEncoding 为 'utf-8' | 'gbk'。
 */
export function detectAndDecode(buffer: ArrayBuffer): DecodeResult {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return { text, detectedEncoding: 'utf-8' }
  } catch {
    const text = new TextDecoder('gbk').decode(buffer)
    return { text, detectedEncoding: 'gbk' }
  }
}
