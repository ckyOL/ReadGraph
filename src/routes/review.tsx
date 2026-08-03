// 待审书目页路由（/review，review 规格 §3）。组件在 ./review/review-page.tsx，
// 本文件只导出 Route，保证 autoCodeSplitting 正常拆包。
import { createFileRoute } from '@tanstack/react-router'

import { ReviewPage } from './review/-review-page'

export const Route = createFileRoute('/review')({
  component: ReviewPage,
})
