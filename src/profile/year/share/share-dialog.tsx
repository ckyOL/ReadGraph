// 年度分享图 Dialog 预览组件（reading-profile §4.1
// 「交互设计」+ v2 §4.2 扩展）。打开时一次构建：buildShareContent → i18n summary/
// delta/badge/collageMore 文案渲染（t()）→ computeShareLayout（variant 选项）→
// renderShareCard 到预览 canvas（role="img" + aria-label）；封面由 loadShareCovers
// 渐进补入（回调局部重绘；拼贴候选集 = 甲的超集，variant 切换仅重绘不重载）。
// v2：SegmentedControl 版式切换（'3:4'/'9:16'，切换即重绘，UI 态不进快照）；
// 导出文件名随 variant（'3:4' 原名兼容 / '9:16' -story 后缀）。动作：下载 PNG
// （exportSharePng，失败 toast，Dialog 不关闭）；系统分享（navigator.share({ files })
// 特性检测，支持才渲染）。无任何持久化（关闭即弃）；打开时刻快照语义（数据变更不实时重绘）。
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

import { SegmentedControl } from '@/components/ui/segmented-control'
import type { SegmentedOption } from '@/components/ui/segmented-control'

import { buildShareContent, collageBookIds } from './share-content'
import type { ShareContentInput } from './share-content'
import { computeShareLayout } from './share-layout'
import { exportSharePng, renderShareCard, sharePngFilename } from './share-canvas'
import { loadShareCovers } from './share-cover-loader'

/** Dialog props：页传入切片产物与书目索引；打开时刻快照（数据变更不重绘）。 */
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

/**
 * 封面加载目标（v2 §4.2.3 单一事实源）：拼贴候选（≤ 8）覆盖三联 Top 3（前缀包含），
 * 与数据形态（bookCount ≥ 阈值）无关一次加载——variant 切换仅重绘不重载。
 */
function coverTargetIds(input: ShareContentInput): string[] {
  return collageBookIds(input)
}

/**
 * 年度分享图预览 Dialog。canvas 绘制走唯一渲染路径（computeShareLayout +
 * renderShareCard，预览即导出）；打开时刻快照：open false→true 时固化输入，
 * 之后 props 变化不重绘（关闭即弃，无持久化）。
 */
export function ShareDialog({ open, onOpenChange, year, slice, bookIndex, prevYear }: ShareDialogProps) {
  const { t, i18n } = useTranslation('pages')
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 封面渐进补图：slotIndex → 已就绪 Image（回调注入；渲染器按槽位 drawImage；
  // v2 拼贴键扩 0..7——候选集是三联的超集，variant 切换不重载）
  const coverImagesRef = useRef<Map<number, HTMLImageElement>>(new Map())
  // 打开时刻快照（规格交互流程：数据变更不实时重绘）
  const snapshotRef = useRef<ShareContentInput | null>(null)
  // 版式变体（v2 §4.2.2）：UI 态不进快照（数据快照语义不变），切换即重绘
  const [variant, setVariant] = useState<'3:4' | '9:16'>('3:4')

  // 最新 props → 内容输入（每次渲染刷新，供下一次打开时快照）；collageOrder 传
  // slice.bookIds 升序（v2 §4.2.3 拼贴候选顺序，既有公开字段透传）。
  const inputRef = useRef<ShareContentInput | null>(null)
  inputRef.current = {
    year,
    bookCount: slice.bookCount,
    topBooks: slice.topBooks,
    classification: slice.classification.map((c) => ({ name: c.name, value: c.value })),
    covers: bookIndex,
    prevYear,
    collageOrder: slice.bookIds,
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
      // R3 总结句 / R4 对照行 / v2 称号行 / v2 +K 角标：t() 渲染后传入布局（布局只消费字符串，C5）
      summaryText: t(content.summary.key, content.summary.params),
      deltaText: content.delta
        ? t('profile.year.share.delta', {
            year: prevYear?.year ?? content.year - 1,
            prevCount: content.delta.prevBookCount,
          })
        : null,
      badgeText:
        content.badge !== null ? t(content.badge.key, content.badge.params) : null,
      collageMoreText:
        content.collage !== null
          ? t('profile.year.share.collageMore', { count: content.collage.overflow })
          : undefined,
      brandText: t('profile.year.share.brand'),
      fontStack: fonts,
      variant,
    })
    const covers: Record<number, HTMLImageElement> = {}
    for (const [slot, img] of coverImagesRef.current) covers[slot] = img
    renderShareCard(canvas, layout, fonts, covers)
  }, [t, i18n, prevYear, variant])

  // 打开：固化快照 → 首绘（无封面立即可见）→ 封面逐张渐进补入局部重绘。
  // 首绘延迟到 rAF：Dialog 内容经 Portal 异步挂载，effect 首拍 ref 可能尚未绑定。
  useEffect(() => {
    if (!open) return
    snapshotRef.current = inputRef.current
    coverImagesRef.current.clear()
    let raf = requestAnimationFrame(() => draw())
    const snapshot = snapshotRef.current
    if (!snapshot) return () => cancelAnimationFrame(raf)
    const ids = coverTargetIds(snapshot)
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
    return () => cancelAnimationFrame(raf)
    // 快照语义：仅随 open 触发（draw 依赖收窄，不随语言/variant 重建时重载封面）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // 版式切换重绘（v2 §4.2.2「切换即重绘」）：draw 随 variant 重建（依赖含 variant），
  // open 已为 true 期间切 variant → effect 重跑重绘；封面不重载（候选集与 variant 无关）。
  useEffect(() => {
    if (!open) return
    const raf = requestAnimationFrame(() => draw())
    return () => cancelAnimationFrame(raf)
  }, [open, variant, draw])

  const handleDownload = useCallback((): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    exportSharePng(canvas, year, variant).catch(() => {
      // toBlob 失败（极端：内存不足）→ toast 错误，Dialog 不关闭可重试（规格状态表）
      toast({ variant: 'destructive', title: t('profile.year.share.error') })
    })
  }, [year, variant, t])

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
      // File 构造自同一 Blob（同一渲染函数产物，规格「预览即导出」）；文件名随 variant
      const file = new File([blob], sharePngFilename(year, variant), { type: 'image/png' })
      await navigator.share({ files: [file] })
    } catch {
      // 用户取消（AbortError）与失败同样静默：分享是增强路径，不 toast 打断
    }
  }, [year, variant])

  const ariaLabel = t('profile.year.share.previewAria', { year })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 视口适配（2026-09-04）：3:4 预览在笔记本竖向空间不足 → canvas 高度锚定
          min(55vh, 540px 宽对应高)，宽度随之自适应（aspect-ratio 保形，不裁切不滚动）；
          Dialog 本体 max-h + overflow-y-auto 兜底极矮视口（动作行永不因溢出不可达）。
          DialogFooter 置底吸边，按钮常可见。 */}
      <DialogContent
        className="flex max-h-[100dvh-2rem] flex-col gap-3 overflow-y-auto p-4 sm:max-w-[560px]"
        data-slot="share-dialog"
      >
        <DialogHeader>
          <DialogTitle>{t('profile.year.share.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('profile.year.share.privacyNote')}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2">
          {/* v2 §4.2.2 版式切换（profile.calendar.view.* 同款 SegmentedControl 先例）：
              切换即重绘（同一 computeShareLayout 两次调用，预览即导出不变） */}
          <SegmentedControl<'3:4' | '9:16'>
            value={variant}
            onValueChange={setVariant}
            aria-label={t('profile.year.share.variant.label')}
            data-slot="share-variant-switch"
            options={
              [
                { value: '3:4', label: t('profile.year.share.variant.classic') },
                { value: '9:16', label: t('profile.year.share.variant.story') },
              ] satisfies SegmentedOption<'3:4' | '9:16'>[]
            }
          />
          <canvas
            ref={canvasRef}
            role="img"
            aria-label={ariaLabel}
            data-slot="share-preview-canvas"
            className="h-auto max-h-[min(55vh,720px)] w-auto max-w-full self-center rounded-md border border-border bg-background"
            style={{ aspectRatio: variant === '9:16' ? '9 / 16' : '3 / 4' }}
          />
        </div>
        <div className="sticky bottom-0 flex items-center justify-end gap-2 bg-popover pb-1">
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
