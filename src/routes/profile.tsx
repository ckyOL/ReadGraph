import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">阅读画像</h1>
      <p className="text-muted-foreground">图谱</p>
    </div>
  )
}
