import * as React from "react"

import { cn } from "@/lib/utils"

interface SegmentedOption<T extends string> {
  value: T
  label: React.ReactNode
}

interface SegmentedControlProps<T extends string> {
  value: T
  onValueChange: (value: T) => void
  options: SegmentedOption<T>[]
  className?: string
  /** i18n / a11y label for the group. */
  "aria-label"?: string
}

/**
 * 轻量分段控件（reading-profile §4 工具条分类体系切换）。
 * 受控单选；活跃段以 primary 填充，非活跃段 ghost。
 */
function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  return (
    <div
      role="radiogroup"
      data-slot="segmented-control"
      className={cn(
        "inline-flex items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5",
        className,
      )}
      {...rest}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            data-slot="segmented-item"
            data-active={active || undefined}
            onClick={() => onValueChange(opt.value)}
            className={cn(
              "inline-flex h-7 items-center justify-center rounded-md px-2.5 text-xs font-medium transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              active
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export { SegmentedControl }
export type { SegmentedControlProps, SegmentedOption }
