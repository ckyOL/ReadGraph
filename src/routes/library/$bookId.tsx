import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/library/$bookId')({
  component: BookDetailPage,
})

function BookDetailPage() {
  const { t } = useTranslation('pages')
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{t('bookDetail.title')}</h1>
      <p className="text-muted-foreground">{t('bookDetail.subtitle')}</p>
    </div>
  )
}
