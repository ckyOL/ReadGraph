import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/library/$bookId')({
  component: BookDetailPage,
})

function BookDetailPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">书目详情</h1>
      <p className="text-muted-foreground">Book detail</p>
    </div>
  )
}
