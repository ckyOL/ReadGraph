import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getTimeZoneCandidates } from '@/lib/timezones'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface TimezoneSelectProps {
  value: string
  onValueChange: (timezone: string) => void
  className?: string
  triggerClassName?: string
}

/**
 * IANA 时区选择：搜索过滤 + Select（settings 规格 §2/§7）。
 * 候选取 Intl.supportedValuesOf（timezones.ts 纯函数兜底），
 * 当前值始终在列（非法持久值也可显示并重选）。
 */
export function TimezoneSelect({
  value,
  onValueChange,
  className,
  triggerClassName,
}: TimezoneSelectProps) {
  const { t } = useTranslation('pages')
  const [query, setQuery] = useState('')
  const candidates = useMemo(() => getTimeZoneCandidates(value), [value])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((z) => z.toLowerCase().includes(q))
  }, [candidates, query])

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('settings.preferences.timezoneSearch')}
        aria-label={t('settings.preferences.timezoneSearch')}
        className="h-8"
      />
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className={triggerClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {filtered.map((z) => (
            <SelectItem key={z} value={z}>
              {z}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
