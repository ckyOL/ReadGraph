// AI 解读区（ai-features §4.1）：价值卡行之下、图表 Tabs 之上。
// Markdown 文本洞察（2026-08-25 由 JSON 条目切换）：ReactMarkdown + remark-gfm
// 单块排版（.ai-markdown）；流式逐字渐进渲染——上送在途时累积文本逐步落位、
// 尾部「生成中」占位；定稿后块尾标注「AI 生成，基于本地数据」；整体可重新生成。
// 条件渲染（§2.1/§8）：ai.enabled !== true 时返回 null——未启用时全站无 AI 痕迹
// （含 loading 态也不渲染）；配合路由侧 lazy + 开关门控，AI 默认关闭不拉主包。
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { useAiInsights } from '@/ai/use-ai'
import { AiSendPreviewDialog } from '@/components/ai-send-preview'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/use-toast'
import { clearAiCache } from '@/lib/ai-cache'
import { readPreferences } from '@/lib/preferences'
import type { ClassificationSystem } from '@/types/entities'

export interface AiInsightsSectionProps {
  classificationSystem: ClassificationSystem | null
  displayTimezone: string
  /** 借阅日历「今天」锚（与画像 opts 同锚，透传 useAiInsights）。 */
  calendarAnchor: Date | null
}

export function AiInsightsSection({
  classificationSystem,
  displayTimezone,
  calendarAnchor,
}: AiInsightsSectionProps) {
  const { t } = useTranslation('pages')
  // 挂载时读取开关：设置页改开关后重新挂载即生效（§2.1 默认关闭）。
  const [aiEnabled] = useState(() => readPreferences().ai.enabled)
  const {
    markdown,
    streamingMarkdown,
    loading,
    error,
    pendingPreview,
    generate,
    confirmGenerate,
    cancelGenerate,
  } = useAiInsights({ classificationSystem, displayTimezone, calendarAnchor })

  // 错误分级 toast（§5.4）：网络失败/超时、响应校验失败、未配置端点/模型；
  // 错误态不渲染结果（hook 保证 markdown 与 error 互斥）。
  // description 展示模块内构造的诊断 message（401/429/HTTP 状态/CORS/超时区分），
  // 避免固定 network 文案把鉴权失败误报成「跨域」；AbortError 的 'Aborted' 无信息量则省略。
  useEffect(() => {
    if (error === null) return
    const key =
      error.kind === 'network'
        ? 'profile.ai.error.network'
        : error.kind === 'validation'
          ? 'profile.ai.error.validation'
          : 'profile.ai.error.unconfigured'
    // AbortError（超时/中止）的 message 为 'Aborted' 无信息量：给明确超时文案，避免误读为 CORS。
    const description =
      error.kind === 'network' && error.message === 'Aborted'
        ? t('profile.ai.error.timeout')
        : error.kind !== 'unconfigured' && error.message
          ? error.message
          : undefined
    toast({ variant: 'destructive', title: t(key), description })
  }, [error, t])

  // 未启用（§2.1）：全站无 AI 痕迹——含 loading 态也不渲染。
  if (aiEnabled !== true) return null

  const handleClearCache = () => {
    clearAiCache()
    toast({ title: t('profile.ai.cacheCleared') })
  }

  return (
    <>
      <section
        className="mt-4"
        data-slot="profile-ai"
        aria-busy={loading}
        aria-live="polite"
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{t('profile.ai.title')}</h2>
          {markdown === null ? (
            <Button size="sm" onClick={() => generate()} disabled={loading}>
              {t('profile.ai.generate')}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => generate(true)} disabled={loading}>
                {t('profile.ai.regenerate')}
              </Button>
              <Button variant="outline" size="sm" onClick={handleClearCache}>
                {t('profile.ai.clearCache')}
              </Button>
            </div>
          )}
        </div>
        {loading ? (
          // 生成/重新生成 loading 态（§8 rerender-transitions）：流式已出文本时
          // 渲染累积 markdown + 尾部「生成中」占位，否则 Skeleton 占位 + 按钮禁用，
          // 不阻塞页面其余渲染。
          streamingMarkdown !== null && streamingMarkdown.length > 0 ? (
            <>
              <MarkdownBody text={streamingMarkdown} />
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                {t('profile.ai.generating')}
              </div>
            </>
          ) : (
            <div className="mt-3">
              <Skeleton className="h-24 w-full" />
              <p className="mt-2 text-sm text-muted-foreground">{t('profile.ai.generating')}</p>
            </div>
          )
        ) : (
          markdown !== null && (
            <>
              <MarkdownBody text={markdown} />
              <p className="mt-2 text-xs text-muted-foreground/70">
                {t('profile.ai.generated')}
              </p>
            </>
          )
        )}
      </section>
      <AiSendPreviewDialog
        open={pendingPreview !== null}
        payload={pendingPreview}
        onConfirm={confirmGenerate}
        onCancel={cancelGenerate}
      />
    </>
  )
}

/** Markdown 渲染体（ReactMarkdown + remark-gfm）：流式增量与定稿共用；样式见 index.css .ai-markdown。 */
function MarkdownBody({ text }: { text: string }) {
  return (
    <div
      className="ai-markdown mt-3 rounded-lg border border-border p-3"
      data-slot="profile-ai-markdown"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}
