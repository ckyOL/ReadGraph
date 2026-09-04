// 分享图封面渐进加载纯编排（reading-profile §4.1「封面加载时序」）：
// 逐张 Image + crossOrigin='anonymous' 试加载，成功回调触发局部重绘，
// 失败/超时不重试不阻断（失败永降级占位）。纯编排：不触 Dialog/React
// 状态（回调注入，UI 层接线）；Promise 恒 resolve，永不 reject。
import type { YearBookIndexEntry } from '@/profile/year/year-book-index'

/** 单张封面加载超时（3s；setTimeout 后 img.src='' 中断） */
export const SHARE_COVER_TIMEOUT_MS = 3000

export interface ShareCoverLoaderOptions {
  /** 单张加载成功回调（bookId + 已就绪 HTMLImageElement，渲染器直接 drawImage） */
  onEach: (bookId: string, img: HTMLImageElement) => void
  /** 超时毫秒（测试注入；缺省 SHARE_COVER_TIMEOUT_MS） */
  timeoutMs?: number
}

/**
 * 封面渐进加载：Top 3 顺序逐张试加载。
 * - entry 缺失 / coverUrl 为 null/空 → 不发起加载（跳过）；
 * - load → onEach(bookId, img)；error / 超时 → 跳过该张，不重试不阻断；
 * - 每张 settled（成功或失败）后计数，全部 settled → resolve（恒 resolve）。
 * 纯函数性：同输入下回调触发序列确定；不持全局状态。
 */
export function loadShareCovers(
  covers: Record<string, YearBookIndexEntry | undefined> | undefined,
  topBookIds: string[],
  opts: ShareCoverLoaderOptions,
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? SHARE_COVER_TIMEOUT_MS
  // 预筛：发起加载的书目（entry 缺失/无 coverUrl 跳过）
  const targets: { bookId: string; url: string }[] = []
  for (const bookId of topBookIds) {
    const url = covers?.[bookId]?.coverUrl
    if (url) targets.push({ bookId, url })
  }
  if (targets.length === 0) return Promise.resolve()

  return new Promise<void>((resolve) => {
    let settled = 0
    const settle = (): void => {
      settled += 1
      if (settled === targets.length) resolve()
    }

    for (const { bookId, url } of targets) {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      let timer: ReturnType<typeof setTimeout> | null = null
      const finish = (ok: boolean): void => {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        img.onload = null
        img.onerror = null
        if (ok) opts.onEach(bookId, img)
        settle()
      }
      img.onload = () => finish(true)
      img.onerror = () => {
        // 失败中断加载（规格：img.src='' 中断；永降级占位，不重试）
        img.src = ''
        finish(false)
      }
      timer = setTimeout(() => {
        img.src = ''
        finish(false)
      }, timeoutMs)
      img.src = url
    }
  })
}
