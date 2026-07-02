import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/library/')({
  component: LibraryPage,
})

function LibraryPage() {
  const { t } = useTranslation('pages')
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{t('library.title')}</h1>
      <p className="text-muted-foreground">{t('library.subtitle')}</p>
    </div>
  )
}
