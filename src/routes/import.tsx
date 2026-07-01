import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/import')({
  component: ImportPage,
})

function ImportPage() {
  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold">导入</h1>
      <p className="text-muted-foreground">导入向导</p>
    </div>
  )
}
