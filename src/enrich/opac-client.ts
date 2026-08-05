// 传输基元（opac-enrichment §2.3）：唯一接触网络处。
// 超时/中止 fetch 封装；浏览器 CORS 拦截（无 ACAO 头）抛 TypeError → OpacFetchError('cors')。
// provider 复用本基元；同源代理 / 直连切换不动 provider 与映射层（§8）。
// 网络错误一律以 OpacFetchError 抛出，由抓取编排（enrich-service）捕获 → status='failed'。

export type OpacFetchErrorReason = 'cors' | 'timeout' | 'aborted' | 'network'

/** 传输层错误：reason 区分 CORS 拦截 / 超时 / 外部中止 / 其它网络错误。 */
export class OpacFetchError extends Error {
  readonly reason: OpacFetchErrorReason

  constructor(reason: OpacFetchErrorReason, message: string) {
    super(message)
    this.name = 'OpacFetchError'
    this.reason = reason
  }
}

export interface FetchTimeoutOptions {
  timeoutMs: number
  signal?: AbortSignal
}

/**
 * fetch + 超时/中止封装，返回响应体文本（状态码不在此判定——szlib 未找到是
 * HTTP 200 + 空负载，见 providers/szlib/detail.ts；其余 provider 各自处理）。
 */
export async function fetchWithTimeout(
  url: string,
  opts: FetchTimeoutOptions,
): Promise<string> {
  const controller = new AbortController()
  const timer: ReturnType<typeof setTimeout> = setTimeout(
    () => controller.abort(),
    opts.timeoutMs,
  )
  const onOuterAbort = (): void => controller.abort()
  opts.signal?.addEventListener('abort', onOuterAbort, { once: true })
  try {
    const res = await fetch(url, { signal: controller.signal })
    return await res.text()
  } catch (e) {
    if (opts.signal?.aborted) {
      throw new OpacFetchError('aborted', 'request aborted by caller')
    }
    if (controller.signal.aborted) {
      throw new OpacFetchError('timeout', `request timed out after ${opts.timeoutMs}ms`)
    }
    if (e instanceof TypeError) {
      // 浏览器跨源 fetch 被 CORS 拦截时抛 TypeError（"Failed to fetch"）。
      throw new OpacFetchError('cors', 'request blocked by browser (CORS or network)')
    }
    throw new OpacFetchError('network', e instanceof Error ? e.message : String(e))
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onOuterAbort)
  }
}
