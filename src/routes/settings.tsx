import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">设置</h1>
      <p className="text-muted-foreground">偏好与系统</p>
    </div>
  )
}
