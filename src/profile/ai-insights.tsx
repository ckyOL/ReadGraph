// AI 解读区（ai-features §4.1）：价值卡行之下、图表 Tabs 之上；与价值卡行同构
// （窄卡、不卡片套卡片、不抢图表全幅）。fact 窄卡 = 标题 + 正文 + 维度 chip
// （点击激活对应图表 tab = 引用定位）；taste 全宽评价段（整段到达即渲染）；
// 流式（§4.1 条目级渐进渲染）：上送在途时已闭合条目逐步渲染、尾部「生成中」占位；
// 固定全量口径、不与 range 联动；整体可重新生成；每条标注「AI 生成，基于本地数据」；
// 「清除 AI 缓存」（§4.1，原设置页 §4.2）在标题行「重新生成」旁，仅已有结果时显示。
// 条件渲染（§2.1/§8）：ai.enabled !== true 时返回 null——未启用时全站无 AI 痕迹
// （含 loading 态也不渲染）；配合路由侧 lazy + 开关门控，AI 默认关闭不拉主包。
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type { AIInsight } from '@/ai/prompts/profile-insights'
import { useAiInsights } from '@/ai/use-ai'
import { AiSendPreviewDialog } from '@/components/ai-send-preview'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/use-toast'
import { clearAiCache } from '@/lib/ai-cache'
import { readPreferences } from '@/lib/preferences'
import type { ClassificationSystem } from '@/types/entities'

/** 图表 Tabs 值集合（引用定位）：dimension 小写化后命中才可点（dimension 为 LLM 自由文本）。 */
const CHART_TABS: Record<string, true> = {
  classification: true,
  gantt: true,
  volume: true,
  duration: true,
  price: true,
  calendar: true,
}

export interface AiInsightsSectionProps {
  classificationSystem: ClassificationSystem | null
  displayTimezone: string
  /** 借阅日历「今天」锚（与画像 opts 同锚，透传 useAiInsights）。 */
  calendarAnchor: Date | null
  /** 激活图表 tab（引用定位）：传入受控 Tabs 的 setter，dimension 命中才触发。 */
  onActivateTab: (tab: string) => void
}

export function AiInsightsSection({
  classificationSystem,
  displayTimezone,
  calendarAnchor,
  onActivateTab,
}: AiInsightsSectionProps) {
  const { t } = useTranslation('pages')
  // 挂载时读取开关：设置页改开关后重新挂载即生效（§2.1 默认关闭）。
  const [aiEnabled] = useState(() => readPreferences().ai.enabled)
  const {
    insights,
    streamingInsights,
    loading,
    error,
    pendingPreview,
    generate,
    confirmGenerate,
    cancelGenerate,
  } = useAiInsights({ classificationSystem, displayTimezone, calendarAnchor })

  // 错误分级 toast（§5.4）：网络失败/超时、响应校验失败、未配置端点/模型；
  // 错误态不渲染结果（hook 保证 insights 与 error 互斥）。
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
          {insights === null ? (
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
          // 生成/重新生成 loading 态（§8 rerender-transitions）：流式增量已出条目时
          // 渲染真实卡 + 尾部「生成中」占位，否则 Skeleton 占位 + 按钮禁用，
          // 不阻塞页面其余渲染。
          streamingInsights !== null && streamingInsights.length > 0 ? (
            <>
              {renderInsightGrid(streamingInsights, onActivateTab, t)}
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
                {t('profile.ai.generating')}
              </div>
            </>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-24 w-full md:col-span-2" />
            </div>
          )
        ) : (
          insights !== null && renderInsightGrid(insights, onActivateTab, t)
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

/** 洞察卡网格：fact 窄卡（标题+正文+维度 chip）+ taste 全宽段；定稿结果与流式增量共用同一渲染。 */
function renderInsightGrid(
  insights: AIInsight[],
  onActivateTab: (tab: string) => void,
  t: (key: string) => string,
): ReactNode {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
      {insights.map((insight, i) =>
        insight.kind === 'fact' ? (
          <article
            key={i}
            className="rounded-lg border border-border p-3"
            data-slot="profile-ai-fact"
          >
            {insight.title && (
              <h3 className="text-sm font-medium">{insight.title}</h3>
            )}
            <p className="mt-1 text-sm text-muted-foreground">{insight.body}</p>
            {insight.dimension && (
              <DimensionChip dimension={insight.dimension} onActivateTab={onActivateTab} />
            )}
            <p className="mt-2 text-xs text-muted-foreground/70">
              {t('profile.ai.generated')}
            </p>
          </article>
        ) : (
          <article
            key={i}
            className="rounded-lg border border-border p-3 md:col-span-2"
            data-slot="profile-ai-taste"
          >
            <p className="text-sm leading-relaxed">{insight.body}</p>
            <p className="mt-2 text-xs text-muted-foreground/70">
              {t('profile.ai.generated')}
            </p>
          </article>
        ),
      )}
    </div>
  )
}

/** 维度 chip（引用定位）：小写化后命中图表 Tabs 值集合才可点；不命中降级为纯展示。 */
function DimensionChip({
  dimension,
  onActivateTab,
}: {
  dimension: string
  onActivateTab: (tab: string) => void
}) {
  const normalized = dimension.toLowerCase().trim()
  const target = CHART_TABS[normalized] === true ? normalized : null
  if (target === null) {
    return (
      <Badge variant="outline" className="mt-2">
        {dimension}
      </Badge>
    )
  }
  return (
    <Badge asChild variant="outline" className="mt-2 cursor-pointer hover:bg-muted">
      <button type="button" onClick={() => onActivateTab(target)}>
        {dimension}
      </button>
    </Badge>
  )
}
