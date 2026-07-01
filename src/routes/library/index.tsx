import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library/')({
  component: LibraryPage,
})

function LibraryPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">书库</h1>
      <p className="text-muted-foreground">Book 列表</p>
    </div>
  )
}
