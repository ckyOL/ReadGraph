import * as React from "react"

import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'

interface ErrorBoundaryProps {
  children: React.ReactNode
  title: string
  description: string
}

interface ErrorBoundaryState {
  hasError: boolean
}

/**
 * 图表块错误边界（reading-profile §4 错误态）：聚合/实例化抛错时
 * 降级为 Empty + 错误文案，不崩溃整页。
 */
class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true }
  }

  componentDidCatch(error: unknown): void {
    // 仅降级，不上报；保留错误便于调试。
    // eslint-disable-next-line no-console
    console.error('[profile chart] render error:', error)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <Empty className="min-h-[200px]">
          <EmptyHeader>
            <EmptyTitle>{this.props.title}</EmptyTitle>
            <EmptyDescription>{this.props.description}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )
    }
    return this.props.children
  }
}

export { ErrorBoundary }
