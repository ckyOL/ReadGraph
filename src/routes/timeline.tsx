import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/timeline')({
  component: TimelinePage,
})

function TimelinePage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">时间线</h1>
      <p className="text-muted-foreground">BorrowCycle 脊柱</p>
    </div>
  )
}
