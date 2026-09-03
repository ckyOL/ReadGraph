// 年度分享图 Dialog 预览组件（annual-share-card-batch SC-5；reading-profile §4.1
// 「交互设计」）。打开时一次构建：buildShareContent → i18n summary/delta 文案渲染
// （t()）→ computeShareLayout → renderShareCard 到预览 canvas（role="img" + aria-label）；
// 封面由 loadShareCovers 渐进补入（回调局部重绘）。动作：下载 PNG（exportSharePng，
// 失败 toast，Dialog 不关闭）；系统分享（navigator.share({ files }) 特性检测，支持才
// 渲染）。无任何持久化（关闭即弃）；打开时刻快照语义（数据变更不实时重绘）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { toast } from '@/components/ui/use-toast'
import type { YearBookIndexEntry } from '@/profile/year/year-book-index'
import type { YearSliceResult } from '@/lib/profile-stats'

import { buildShareContent } from './share-content'
import type { ShareContentInput } from './share-content'
import { computeShareLayout } from './share-layout'
import { exportSharePng, renderShareCard, sharePngFilename } from './share-canvas'
import { loadShareCovers } from './share-cover-loader'

/** Dialog props：页（SC-6）传入切片产物与书目索引；打开时刻快照（数据变更不重绘）。 */
export interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  year: number
  slice: YearSliceResult
  bookIndex: Record<string, YearBookIndexEntry>
  prevYear: { year: number; bookCount: number } | null
}

/** locale → canvas 字体栈（规格 §4.1；ja 时明朝栈首提 Hiragino Mincho ProN）。 */
export function fontStacksFor(language: string): { title: string; body: string; mono: string } {
  const ja = language.startsWith('ja')
  const title = ja
    ? '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "Songti SC", "Noto Serif CJK SC", "Noto Serif SC", SimSun, serif'
    : '"Songti SC", "Noto Serif CJK SC", "Noto Serif SC", SimSun, "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif'
  const body =
    'ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
  const mono = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace'
  return { title, body, mono }
}

/** Top 3 封面槽位映射：topItems 顺序（= slotIndex）← bookId（covers 渐进补图用）。 */
function slotBookIds(input: ShareContentInput): string[] {
  const ids: string[] = []
  for (const top of input.topBooks) {
    if (input.covers[top.bookId] === undefined) continue
    ids.push(top.bookId)
    if (ids.length >= 3) break
  }
  return ids
}

/**
 * 年度分享图预览 Dialog。canvas 绘制走唯一渲染路径（computeShareLayout +
 * renderShareCard，预览即导出）；打开时刻快照：open false→true 时固化输入，
 * 之后 props 变化不重绘（关闭即弃，无持久化）。
 */
export function ShareDialog({ open, onOpenChange, year, slice, bookIndex, prevYear }: ShareDialogProps) {
  const { t, i18n } = useTranslation('pages')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 封面渐进补图：slotIndex → 已就绪 Image（回调注入；渲染器按槽位 drawImage）
  const coverImagesRef = useRef<Map<number, HTMLImageElement>>(new Map())
  // 打开时刻快照（规格交互流程：数据变更不实时重绘）
  const snapshotRef = useRef<ShareContentInput | null>(null)

  // 最新 props → 内容输入（每次渲染刷新，供下一次打开时快照）。
  const inputRef = useRef<ShareContentInput | null>(null)
  inputRef.current = {
    year,
    bookCount: slice.bookCount,
    topBooks: slice.topBooks,
    classification: slice.classification.map((c) => ({ name: c.name, value: c.value })),
    covers: bookIndex,
    prevYear,
  }

  const [, forceRedraw] = useState(0)

  const draw = useCallback((): void => {
    const canvas = canvasRef.current
    const input = snapshotRef.current ?? inputRef.current
    if (!canvas || !input) return
    const language = i18n.language || i18n.resolvedLanguage || 'zh-CN'
    const fonts = fontStacksFor(language)
    const content = buildShareContent(input)
    // ① 标识段标题（§4.1「{year} 年度借阅」）：t() 插值纯数字年份——
    // Intl.NumberFormat 千分位分组会把 2026 渲染成「2,026」，年份不得分组。
    const yearLabel = t('profile.year.share.title', { year: content.year })
    const layout = computeShareLayout(content, {
      yearLabel,
      // R3 总结句 / R4 对照行：t() 渲染后传入布局（布局只消费字符串，C5）
      summaryText: t(content.summary.key, content.summary.params),
      deltaText: content.delta
        ? t('profile.year.share.delta', {
            year: prevYear?.year ?? content.year - 1,
            prevCount: content.delta.prevBookCount,
          })
        : null,
      brandText: t('profile.year.share.brand'),
      fontStack: fonts,
    })
    const covers: Record<number, HTMLImageElement> = {}
    for (const [slot, img] of coverImagesRef.current) covers[slot] = img
    renderShareCard(canvas, layout, fonts, covers)
  }, [t, i18n, prevYear])

  // 打开：固化快照 → 首绘（无封面立即可见）→ 封面逐张渐进补入局部重绘。
  // 首绘延迟到 rAF：Dialog 内容经 Portal 异步挂载，effect 首拍 ref 可能尚未绑定。
  useEffect(() => {
    if (!open) return
    snapshotRef.current = inputRef.current
    coverImagesRef.current.clear()
    let raf = requestAnimationFrame(() => draw())
    const snapshot = snapshotRef.current
    if (!snapshot) return () => cancelAnimationFrame(raf)
    const ids = slotBookIds(snapshot)
    if (ids.length === 0) return () => cancelAnimationFrame(raf)
    void loadShareCovers(snapshot.covers, ids, {
      onEach: (bookId, img) => {
        const slot = ids.indexOf(bookId)
        if (slot < 0) return
        coverImagesRef.current.set(slot, img)
        draw()
        forceRedraw((n) => n + 1)
      },
    })
    // 快照语义：仅随 open 触发；draw 为稳定回调（依赖收窄）
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => cancelAnimationFrame(raf)
  }, [open])

  const handleDownload = useCallback((): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    exportSharePng(canvas, year).catch(() => {
      // toBlob 失败（极端：内存不足）→ toast 错误，Dialog 不关闭可重试（规格状态表）
      toast({ variant: 'destructive', title: t('profile.year.share.error') })
    })
  }, [year, t])

  // 系统分享：navigator.share({ files }) 特性检测，支持才渲染按钮。
  const canShare =
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function'

  const handleSystemShare = useCallback(async (): Promise<void> => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('toBlob returned null')
      // File 构造自同一 Blob（同一渲染函数产物，规格「预览即导出」）
      const file = new File([blob], sharePngFilename(year), { type: 'image/png' })
      await navigator.share({ files: [file] })
    } catch {
      // 用户取消（AbortError）与失败同样静默：分享是增强路径，不 toast 打断
    }
  }, [year])

  const ariaLabel = t('profile.year.share.previewAria', { year })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px]" data-slot="share-dialog">
        <DialogHeader>
          <DialogTitle>{t('profile.year.share.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('profile.year.share.privacyNote')}</DialogDescription>
        </DialogHeader>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label={ariaLabel}
          data-slot="share-preview-canvas"
          className="w-full rounded-md border border-border bg-background"
        />
        <div className="flex items-center justify-end gap-2">
          {canShare ? (
            <Button variant="ghost" onClick={() => void handleSystemShare()}>
              {t('profile.year.share.systemShare')}
            </Button>
          ) : null}
          <Button onClick={handleDownload}>{t('profile.year.share.download')}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
