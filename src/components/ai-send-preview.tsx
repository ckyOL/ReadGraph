// 发送预览（ai-features §4.3）：首次生成前展示将发送的 payload JSON，确认后才上送。
// 受控组件：open/payload/onConfirm/onCancel 均由 use-ai Hook 驱动（F-1）；展示的
// payload 与实际上送为同一装配函数产物（§3.3 防漂移）。
// 超阈值分层采样时（payload.sampled 存在）标注「已采样（N/M 本）」（§3.2 极端档案防护）；
// 隐私承诺文案（§2.3）：发送预览弹窗专属展示，i18n key profile.ai.privacyNotice。
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
/** 预览 payload 兼容形态（§3.2/§9.1 白名单场景共用）：仅约束 JSON 展示所需的
 *  sampled 标记；ProfilePayload / YearPayload 均可赋值（宽结构类型，展示层只序列化）。 */
export type AiPreviewPayload = {
  sampled?: { total: number; sent: number }
}

export interface AiSendPreviewDialogProps {
  open: boolean
  /** 待审阅 payload；null 时仅空对话框（配合 open=false 使用，不渲染内容）。 */
  payload: AiPreviewPayload | null
  onConfirm: () => void
  onCancel: () => void
}

/** 发送预览对话框（ai-features §4.3）：确认/取消均回传调用方，由调用方决定上送。 */
export function AiSendPreviewDialog({
  open,
  payload,
  onConfirm,
  onCancel,
}: AiSendPreviewDialogProps) {
  const { t } = useTranslation('pages')

  // payload 大（全量书目 JSON 可达数百 KB），父组件重渲染时避免重复序列化。
  const payloadText = useMemo(
    () => (payload === null ? null : JSON.stringify(payload, null, 2)),
    [payload],
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Esc / 遮罩 / 右上角关闭按钮均视为取消（规格 §4.3 确认/取消二选一）。
        if (!next) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('profile.ai.preview.title')}</DialogTitle>
          <DialogDescription>{t('profile.ai.preview.desc')}</DialogDescription>
        </DialogHeader>
        {payload !== null && payloadText !== null && (
          <>
            {payload.sampled && (
              <p className="text-xs text-muted-foreground">
                {t('profile.ai.preview.sampled', {
                  sent: payload.sampled.sent,
                  total: payload.sampled.total,
                })}
              </p>
            )}
            <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
              {payloadText}
            </pre>
            <p className="text-xs text-muted-foreground">{t('profile.ai.privacyNotice')}</p>
          </>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('profile.ai.preview.cancel')}
          </Button>
          <Button onClick={onConfirm}>{t('profile.ai.preview.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
