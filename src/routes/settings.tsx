import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CheckIcon, LanguagesIcon } from 'lucide-react'

import { useLocale } from '@/hooks/use-locale'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { t } = useTranslation('pages')
  const { locale, setLocale, locales } = useLocale()
  return (
    <div className="p-6 space-y-6">
      <section className="flex items-center gap-3">
        <span className="text-muted-foreground">{t('settings.language.label')}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">
              <LanguagesIcon />
              {t(`settings.language.${locale.replace('-', '')}`)}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {locales.map((lng) => (
              <DropdownMenuItem
                key={lng}
                onClick={() => void setLocale(lng)}
                className="gap-2"
              >
                {t(`settings.language.${lng.replace('-', '')}`)}
                {lng === locale && <CheckIcon className="ml-auto size-4" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </section>
      <h1 className="text-2xl font-bold">{t('settings.title')}</h1>
      <p className="text-muted-foreground">{t('settings.subtitle')}</p>
    </div>
  )
}
