import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { testConnection, AiHttpError, AiNetworkError, AiNetworkMessage } from '@/ai/ai-client'
import { readPreferences, writePreferences, type UserPreferencesInput } from '@/lib/preferences'
import { readAiApiKey, writeAiApiKey } from '@/lib/ai-api-key'
import { clearAiModelList, readAiModelList, writeAiModelList } from '@/lib/ai-model-list'
import { toast } from '@/components/ui/use-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

/** 连接测试失败分级（ai-features §5.4/§9.2）：AiNetworkError 按端点形态再分——本地服务（回环 http）给本地指引，云端给 CORS/代理指引；401 → auth；429 → rateLimited；其余 HTTP → http（带 status）。 */
function testErrorKey(e: unknown): { key: string; options?: Record<string, unknown> } {
  if (e instanceof AiHttpError) {
    if (e.status === 401) return { key: 'settings.ai.test.error.auth' }
    if (e.status === 429) return { key: 'settings.ai.test.error.rateLimited' }
    return { key: 'settings.ai.test.error.http', options: { status: e.status } }
  }
  if (e instanceof AiNetworkError) {
    // 跨域（CORS）拦截 / 端点不可达：与超时（AbortError）区分；本地/云端再分级。
    return { key: e.message === AiNetworkMessage.local
      ? 'settings.ai.test.error.local'
      : 'settings.ai.test.error.cors' }
  }
  return { key: 'settings.ai.test.error.network' }
}

/**
 * AI 区（ai-features §4.2）：启用开关（默认关）→ 启用后展开端点 URL（含「测试并获取模型」按钮）/
 * API Key（独立存储）/ 模型名（用户自填）/「发送预览」开关（默认开）/「清除 AI 缓存」（独立一行）；
 * 隐私承诺文案不设于此——发送预览弹窗展示（§2.3）。
 * 配置输入即写即存（偏好 + 独立 Key key，Key 不进偏好）；错误与结果经 toast 呈现。
 */
export function AiSection() {
  const { t } = useTranslation('pages')
  const [enabled, setEnabled] = useState(() => readPreferences().ai.enabled)
  const [baseUrl, setBaseUrl] = useState(() => readPreferences().ai.baseUrl)
  const [model, setModel] = useState(() => readPreferences().ai.model)
  const [apiKey, setApiKey] = useState(() => readAiApiKey())
  const [sendPreview, setSendPreview] = useState(() => readPreferences().ai.sendPreview)
  const [testing, setTesting] = useState(false)
  /** 连接测试抓取的模型 ID 列表（§4.2）：独立存储跨会话保留；端点变更即清除（ai-features §4.2）。 */
  const [models, setModels] = useState<string[]>(() => readAiModelList())

  /** 模型选项：端点列表 + 当前已保存值（可能不在列表，保留可选中/可回退手输）。 */
  const modelOptions = useMemo(() => {
    const set = new Set(models)
    if (model) set.add(model)
    return [...set]
  }, [models, model])

  const patchAi = (patch: Partial<UserPreferencesInput['ai']>) => {
    writePreferences({ ai: { ...readPreferences().ai, ...patch } })
  }

  const handleEnabledChange = (v: boolean) => {
    setEnabled(v)
    patchAi({ enabled: v })
  }

  const handleBaseUrlChange = (v: string) => {
    setBaseUrl(v)
    setModels([])
    clearAiModelList()
    // 端点变更 → 已保存模型名一并清除：旧端点的模型对新端点无意义，留空待重新测试/手输。
    setModel('')
    patchAi({ baseUrl: v, model: '' })
  }

  const handleApiKeyChange = (v: string) => {
    setApiKey(v)
    writeAiApiKey(v)
  }

  const handleModelChange = (v: string) => {
    setModel(v)
    patchAi({ model: v })
  }

  const handleSendPreviewChange = (v: boolean) => {
    setSendPreview(v)
    patchAi({ sendPreview: v })
  }

  const runTest = async () => {
    const trimmed = baseUrl.trim()
    if (!trimmed || testing) return
    setTesting(true)
    try {
      const list = await testConnection({ baseUrl: trimmed, apiKey: apiKey.trim() || undefined })
      setModels(list)
      writeAiModelList(list)
      if (list.length > 0) {
        // 模型为空时自动选中列表首项（测试连接即选定，省一次操作）；已填值保留。
        if (!model) {
          const first = list[0]!
          setModel(first)
          patchAi({ model: first })
        }
        toast({ title: t('settings.ai.test.okModels', { count: list.length }) })
      } else {
        // 端点可达但未提供模型列表（响应结构不兼容）：回退手输。
        toast({ title: t('settings.ai.test.okNoModels') })
      }
    } catch (e) {
      // 用户可见文案一律本地化（WCAG 3.1.2）；原始错误保留在控制台供诊断。
      console.error('[settings] AI connection test failed:', e)
      const { key, options } = testErrorKey(e)
      toast({
        variant: 'destructive',
        title: t('settings.ai.test.error'),
        description: t(key, options),
      })
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="space-y-4 border-t pt-4">
      <h2 className="text-sm font-semibold">{t('settings.ai.title')}</h2>

      {/* 启用开关：默认关；未启用时全站无 AI 痕迹（设置页开关常驻，展开区条件渲染） */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="w-32 shrink-0 text-sm text-muted-foreground">
          {t('settings.ai.enable')}
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={handleEnabledChange}
          aria-label={t('settings.ai.enable')}
        />
      </div>

      {enabled && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <span className="w-32 shrink-0 text-sm text-muted-foreground">
              {t('settings.ai.endpoint')}
            </span>
            <Input
              value={baseUrl}
              onChange={(e) => handleBaseUrlChange(e.target.value)}
              placeholder={t('settings.ai.endpointPlaceholder')}
              className="w-72"
              aria-label={t('settings.ai.endpoint')}
            />
            <Button
              variant="outline"
              onClick={() => void runTest()}
              disabled={!baseUrl.trim() || testing}
            >
              {testing ? t('settings.ai.testing') : t('settings.ai.test')}
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="w-32 shrink-0 text-sm text-muted-foreground">
              {t('settings.ai.apiKey')}
            </span>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => handleApiKeyChange(e.target.value)}
              placeholder={t('settings.ai.apiKeyHint')}
              className="w-72"
              autoComplete="off"
              aria-label={t('settings.ai.apiKey')}
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="w-32 shrink-0 text-sm text-muted-foreground">
              {t('settings.ai.model')}
            </span>
            {modelOptions.length > 0 ? (
              <Select value={model} onValueChange={handleModelChange}>
                <SelectTrigger className="w-72" aria-label={t('settings.ai.model')}>
                  <SelectValue placeholder={t('settings.ai.modelPlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={model}
                onChange={(e) => handleModelChange(e.target.value)}
                placeholder={t('settings.ai.modelPlaceholder')}
                className="w-72"
                aria-label={t('settings.ai.model')}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="w-32 shrink-0 text-sm text-muted-foreground">
              {t('settings.ai.preview')}
            </span>
            <Switch
              checked={sendPreview}
              onCheckedChange={handleSendPreviewChange}
              aria-label={t('settings.ai.preview')}
            />
            <p className="text-xs text-muted-foreground">{t('settings.ai.previewDesc')}</p>
          </div>

        </>
      )}
    </section>
  )
}
