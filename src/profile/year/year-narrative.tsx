// 年度叙事 AI 区（ai-features §9.1 / reading-profile §4 年度视图，Phase 2 U-2）：
// /profile/$year 年度书单区块之后，与 /profile「AI 解读区」同构（ai-section-view
// 共享展示层）——是年度视图内的区块而非独立孤岛。
// 形态复用：Markdown 文本流 + 流式逐字渲染（chatStream/onPartial 链路）+ 停止生成/
// 打字光标/复制 + 重新生成（bypassCache）+ 发送预览（ai-send-preview 复用，sampled
// 标注）+「AI 生成，基于本地数据」标注。
// 数字同源（§2.7）：输入 slice/entities 与页面静态骨架同一 computeYearSlice 产物。
// 白名单边界（§9.1）：payload 不含年度目标值（serializeYearPayload 不消费偏好）。
// i18n：profile.year.ai.* 独立命名空间（与 profile.ai.* 同构，防混淆）。
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useYearNarrative } from '@/ai/use-year-narrative'
import { AiSendPreviewDialog } from '@/components/ai-send-preview'
import { clearAiCache } from '@/lib/ai-cache'
import { toast } from '@/components/ui/use-toast'
import { readPreferences } from '@/lib/preferences'
import type { ProfileStatsInput, YearSliceResult } from '@/lib/profile-stats'
import { AiSectionView, useAiSectionErrorToast } from './ai-section-view'

export interface YearNarrativeSectionProps {
  year: number
  /** 年切片（与页面静态骨架同一 computeYearSlice 产物，数字同源）。 */
  slice: YearSliceResult
  /** 本地实体（与页面数据源同源）。 */
  entities: ProfileStatsInput
}

/**
 * 年度叙事区（路由侧 lazy + aiEnabled 门控双保险）：AI 未启用 → null（无 AI 痕迹）。
 * 空年由路由渲染条件保证不挂载（bookCount > 0）；hook ready 门再兜底静默。
 */
export function YearNarrativeSection({ year, slice, entities }: YearNarrativeSectionProps) {
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
  } = useYearNarrative({ year, slice, entities })

  // 错误分级 toast（§5.4）：共享实现，labels 以年度命名空间解析。
  useAiSectionErrorToast(error, {
    network: t('profile.year.ai.error.network'),
    timeout: t('profile.year.ai.error.timeout'),
    validation: t('profile.year.ai.error.validation'),
    unconfigured: t('profile.year.ai.error.unconfigured'),
  })

  // 未启用（§2.1）：年度视图无叙事痕迹——含 loading 态也不渲染。
  if (aiEnabled !== true) return null

  const handleClearCache = () => {
    clearAiCache()
    toast({ title: t('profile.year.ai.cacheCleared') })
  }

  const handleCopy = () => {
    if (markdown === null) return
    // 剪贴板不可用（权限/非安全上下文）时静默降级。
    navigator.clipboard?.writeText(markdown).then(
      () => toast({ title: t('profile.year.ai.copied') }),
      () => undefined,
    )
  }

  return (
    <AiSectionView
      ariaBusy={loading}
      labels={{
        title: t('profile.year.ai.title'),
        generate: t('profile.year.ai.generate'),
        regenerate: t('profile.year.ai.regenerate'),
        reasoning: t('profile.year.ai.reasoning'),
        stop: t('profile.year.ai.stop'),
        copy: t('profile.year.ai.copy'),
        generating: t('profile.year.ai.generating'),
        generated: t('profile.year.ai.generated'),
      }}
      markdown={markdown}
      streamingMarkdown={streamingMarkdown}
      streamingReasoning={streamingReasoning}
      loading={loading}
      onGenerate={() => void generate()}
      onRegenerate={() => void generate(true)}
      onCopy={handleCopy}
      onClearCache={markdown === null ? undefined : handleClearCache}
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
