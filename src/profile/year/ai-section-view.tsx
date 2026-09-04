// AI 场景共享展示层（ai-features §4.1 / §9.1）：画像「AI 解读区」与年度
// 「年度叙事区」的同构形态——标题行按钮组（生成/复制/重新生成/清除缓存）、loading 三态
// （thinking 折叠块 / 流式 markdown + 打字光标 / 停止生成条）、定稿态（markdown + AI 生成
// 标注）、错误分级 toast。渲染标记（data-slot/aria/className）与抽取前逐字节一致。
// 调用方（ai-insights.tsx / year-narrative.tsx）注入引擎状态 + t() 解析好的 labels +
// 回调；本组件不读偏好/存储（aiEnabled 门控由调用方负责）。
import { useEffect } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown } from 'lucide-react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/components/ui/use-toast'
import type { AiInsightError } from '@/ai/insight-pipeline'

/** 标题/按钮/占位文案（调用方以各自 i18n namespace 解析后传入）。 */
export interface AiSectionLabels {
  title: string
  generate: string
  regenerate: string
  reasoning: string
  stop: string
  copy: string
  generating: string
  generated: string
  /** 仅定稿后标题行「清除 AI 缓存」按钮展示；省略则不渲染该按钮。 */
  clearCache?: string
}

/** 错误分级 toast 文案（调用方解析；timeout 用于 AbortError 'Aborted' 无信息量 message）。 */
export interface AiSectionErrorLabels {
  network: string
  timeout: string
  validation: string
  unconfigured: string
}

export interface AiSectionCopyLabels {
  copied: string
}

export function useAiSectionErrorToast(
  error: AiInsightError | null,
  labels: AiSectionErrorLabels,
): void {
  useEffect(() => {
    if (error === null) return
    const title =
      error.kind === 'network'
        ? labels.network
        : error.kind === 'validation'
          ? labels.validation
          : labels.unconfigured
    const description =
      error.kind === 'network' && error.message === 'Aborted'
        ? labels.timeout
        : error.kind !== 'unconfigured' && error.message
          ? error.message
          : undefined
    toast({ variant: 'destructive', title, description })
    // labels 每渲染新对象：仅按 error 变化触发（文案随 locale 切换的极小窗口可忽略，
    // toast 为一次性副作用）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error])
}

/** AI 场景区块主体：状态机渲染（loading 三态 → 定稿态）。 */
export function AiSectionView({
  ariaBusy,
  labels,
  markdown,
  streamingMarkdown,
  streamingReasoning,
  loading,
  onGenerate,
  onRegenerate,
  onCopy,
  onClearCache,
  onStop,
  children,
}: {
  /** 区块 aria-busy（= 引擎 loading）。 */
  ariaBusy: boolean
  labels: AiSectionLabels
  markdown: string | null
  streamingMarkdown: string | null
  streamingReasoning: string | null
  loading: boolean
  onGenerate: () => void
  onRegenerate: () => void
  onCopy: () => void
  onClearCache?: () => void
  onStop: () => void
  /** 预览门对话框等附加渲染（AiSendPreviewDialog）。 */
  children?: React.ReactNode
}) {
  return (
    <>
      <section className="mt-4" data-slot="profile-ai" aria-busy={ariaBusy} aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">{labels.title}</h2>
          {markdown === null ? (
            <Button size="sm" onClick={onGenerate} disabled={loading}>
              {labels.generate}
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onCopy}>
                {labels.copy}
              </Button>
              <Button variant="outline" size="sm" onClick={onRegenerate} disabled={loading}>
                {labels.regenerate}
              </Button>
              {onClearCache && labels.clearCache && (
                <Button variant="outline" size="sm" onClick={onClearCache}>
                  {labels.clearCache}
                </Button>
              )}
            </div>
          )}
        </div>
        {loading ? (
          // 生成/重新生成 loading 态（§8 rerender-transitions）：thinking 思考过程
          // 以灰色思考块渐进显示；流式已出文本时渲染累积 markdown + 尾部「生成中」
          // 占位，否则 Skeleton 占位 + 按钮禁用，不阻塞页面其余渲染。
          <>
            {streamingReasoning !== null && streamingReasoning.length > 0 && (
              <Collapsible
                defaultOpen={false}
                className="mt-3 rounded-lg border border-border bg-muted/50"
                data-slot="profile-ai-reasoning"
              >
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="flex w-full items-center gap-1.5 p-3 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <ChevronDown className="size-3.5 shrink-0 transition-transform data-open:rotate-180" />
                    {labels.reasoning}
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="px-3 pb-3">
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {streamingReasoning}
                  </p>
                </CollapsibleContent>
              </Collapsible>
            )}
            {streamingMarkdown !== null && streamingMarkdown.length > 0 ? (
              <MarkdownBody text={streamingMarkdown} streaming />
            ) : (
              <div className="mt-3">
                <Skeleton className="h-24 w-full" />
              </div>
            )}
            <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-dashed border-border p-3 text-sm text-muted-foreground">
              <span>{labels.generating}</span>
              <Button variant="outline" size="sm" onClick={onStop} data-slot="profile-ai-stop">
                {labels.stop}
              </Button>
            </div>
          </>
        ) : (
          markdown !== null && (
            <>
              <MarkdownBody text={markdown} />
              <p className="mt-2 text-xs text-muted-foreground/70">{labels.generated}</p>
            </>
          )
        )}
      </section>
      {children}
    </>
  )
}

/** Markdown 渲染体（ReactMarkdown + remark-gfm）：流式增量与定稿共用；样式见 index.css .ai-markdown。 */
function MarkdownBody({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return (
    <div
      className="ai-markdown mt-3 rounded-lg border border-border p-3"
      data-slot="profile-ai-markdown"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
      {streaming && (
        <span
          className="ai-markdown-caret"
          data-slot="profile-ai-caret"
          aria-hidden="true"
        >
          ▍
        </span>
      )}
    </div>
  )
}
