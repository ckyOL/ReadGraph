// AI 解读区（ai-features §4.1）：价值卡行之下、图表 Tabs 之上。
// Markdown 文本洞察（2026-08-25 由 JSON 条目切换）：ReactMarkdown + remark-gfm
// 单块排版（.ai-markdown）；流式逐字渐进渲染——上送在途时累积文本逐步落位、
// 尾部「生成中」占位；定稿后块尾标注「AI 生成，基于本地数据」；整体可重新生成。
// 条件渲染（§2.1/§8）：ai.enabled !== true 时返回 null——未启用时全站无 AI 痕迹
// （含 loading 态也不渲染）；配合路由侧 lazy + 开关门控，AI 默认关闭不拉主包。
// Phase 2：渲染形态抽取为 ai-section-view.tsx 共享展示层（年度叙事区同构复用），
// 本组件只保留画像场景数据接线（useAiInsights）与 labels/回调注入。
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAiInsights } from '@/ai/use-ai'
import { AiSendPreviewDialog } from '@/components/ai-send-preview'
import { clearAiCache } from '@/lib/ai-cache'
import { readPreferences } from '@/lib/preferences'
import { toast } from '@/components/ui/use-toast'
import { AiSectionView, useAiSectionErrorToast } from '@/profile/year/ai-section-view'
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
    streamingReasoning,
    loading,
    error,
    pendingPreview,
    generate,
    confirmGenerate,
    cancelGenerate,
    stop,
  } = useAiInsights({ classificationSystem, displayTimezone, calendarAnchor })

  // 错误分级 toast（§5.4）：共享实现，labels 以画像 namespace 解析。
  useAiSectionErrorToast(error, {
    network: t('profile.ai.error.network'),
    timeout: t('profile.ai.error.timeout'),
    validation: t('profile.ai.error.validation'),
    unconfigured: t('profile.ai.error.unconfigured'),
  })

  // 未启用（§2.1）：全站无 AI 痕迹——含 loading 态也不渲染。
  if (aiEnabled !== true) return null

  const handleClearCache = () => {
    clearAiCache()
    toast({ title: t('profile.ai.cacheCleared') })
  }

  const handleCopy = () => {
    if (markdown === null) return
    // 剪贴板不可用（权限/非安全上下文）时静默降级。
    navigator.clipboard?.writeText(markdown).then(
      () => toast({ title: t('profile.ai.copied') }),
      () => undefined,
    )
  }

  return (
    <AiSectionView
      ariaBusy={loading}
      labels={{
        title: t('profile.ai.title'),
        generate: t('profile.ai.generate'),
        regenerate: t('profile.ai.regenerate'),
        reasoning: t('profile.ai.reasoning'),
        stop: t('profile.ai.stop'),
        copy: t('profile.ai.copy'),
        generating: t('profile.ai.generating'),
        generated: t('profile.ai.generated'),
        clearCache: t('profile.ai.clearCache'),
      }}
      markdown={markdown}
      streamingMarkdown={streamingMarkdown}
      streamingReasoning={streamingReasoning}
      loading={loading}
      onGenerate={() => void generate()}
      onRegenerate={() => void generate(true)}
      onCopy={handleCopy}
      onClearCache={handleClearCache}
      onStop={stop}
    >
      <AiSendPreviewDialog
        open={pendingPreview !== null}
        payload={pendingPreview}
        onConfirm={() => void confirmGenerate()}
        onCancel={cancelGenerate}
      />
    </AiSectionView>
  )
}
