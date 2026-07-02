import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/import')({
  component: ImportPage,
})

function ImportPage() {
  const { t } = useTranslation('pages')
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{t('import.title')}</h1>
      <p className="text-muted-foreground">{t('import.subtitle')}</p>
    </div>
  )
}
