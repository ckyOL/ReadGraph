import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'

import { getTimeZoneGroups } from '@/lib/timezones'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface TimezoneSelectProps {
  value: string
  onValueChange: (timezone: string) => void
  className?: string
  triggerClassName?: string
}

/**
 * IANA 时区 Combobox：搜索 + 按国家分组（settings 规格 §2/§7）。
 * 候选数据源 @vvo/tzdb（timezones.ts 按 locale 生成本地化名/偏移/国家分组），
 * 搜索经 cmdk 对 IANA 标识、别名、主要城市、国家名模糊匹配。
 * 当前值始终在列（非法持久值也可显示并重选）。
 */
export function TimezoneSelect({
  value,
  onValueChange,
  className,
  triggerClassName,
}: TimezoneSelectProps) {
  const { t, i18n } = useTranslation('pages')
  const [open, setOpen] = useState(false)
  const groups = useMemo(() => getTimeZoneGroups(i18n.language, value), [i18n.language, value])
  const selectedEntry = groups
    .flatMap((group) => group.zones.map((zone) => ({ zone, group })))
    .find(({ zone }) => zone.iana === value)

  // macOS 式标签：城市 · 国家 (偏移)；无城市（UTC/非法持久值）回退本地化名。
  const triggerLabel = (() => {
    const zone = selectedEntry?.zone
    if (!zone) return value || t('settings.preferences.timezonePlaceholder')
    const base = zone.city || zone.localizedName
    const offset = zone.offsetLabel ? ` (${zone.offsetLabel})` : ''
    const country =
      selectedEntry.group.countryCode && selectedEntry.group.countryLabel
        ? ` · ${selectedEntry.group.countryLabel}`
        : ''
    return `${base}${country}${offset}`
  })()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={t('settings.preferences.timezone')}
          className={cn('w-72 justify-between font-normal', className, triggerClassName)}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDownIcon className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-(--radix-popover-trigger-width) min-w-60 p-0">
        <Command>
          <CommandInput placeholder={t('settings.preferences.timezoneSearch')} />
          <CommandList>
            <CommandEmpty>{t('settings.preferences.timezoneEmpty')}</CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.countryCode || group.countryLabel} heading={group.countryLabel}>
                {group.zones.map((zone) => {
                  const main = zone.city || zone.localizedName
                  const secondary = zone.city
                    ? `${zone.localizedName} · ${zone.offsetLabel}`
                    : zone.offsetLabel
                  return (
                    <CommandItem
                      key={zone.iana}
                      value={zone.iana}
                      keywords={zone.searchTerms}
                      onSelect={(iana) => {
                        onValueChange(iana)
                        setOpen(false)
                      }}
                    >
                      <span className="truncate">{main}</span>
                      {secondary && (
                        <span className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground">
                          {secondary}
                        </span>
                      )}
                      {zone.iana === value && <CheckIcon className="size-4 shrink-0" />}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
