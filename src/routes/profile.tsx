import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const { t } = useTranslation('pages')
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">{t('profile.title')}</h1>
      <p className="text-muted-foreground">{t('profile.subtitle')}</p>
    </div>
  )
}
