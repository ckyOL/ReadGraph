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

/** 常见 HTML 命名实体（OPAC 导出常见 `&apos;`/`&amp;`/`&quot;` 等）。 */
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  quot: '"',
  lt: '<',
  gt: '>',
  nbsp: '\u00a0',
}

/**
 * 解码常见 HTML 实体：命名实体子集 + 数字实体（十进制/十六进制）。
 * 未知实体与裸 `&` 原样保留（单遍，不重复解码）。
 */
export function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-z][a-z0-9]+);/g, (m, body: string) => {
    if (body.startsWith('#')) {
      const hex = body[1] === 'x' || body[1] === 'X'
      const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (!Number.isNaN(code) && code >= 0 && code <= 0x10ffff) {
        return String.fromCodePoint(code)
      }
      return m
    }
    const decoded = NAMED_ENTITIES[body.toLowerCase()]
    return decoded ?? m
  })
}
