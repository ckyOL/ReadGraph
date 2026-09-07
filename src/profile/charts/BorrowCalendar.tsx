// 借阅日历热力图（reading-profile §2.6/§4，bookology-benchmark §5.1）。
//
// ECharts heatmap：年视图（GitHub 贡献图式，x=周列 y=7 行星期）与月视图
// （x=7 列星期 y=月内周行）；格色 = `--chart-2` 松叶色按在借数分阶，无数据日
// 弱底格；tooltip 列当日书名与封面缩略图（HTML 转义防注入）。
// 语义为「借阅」口径（手上有书），非阅读行为日历。
import { memo, useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { EChartsOption } from 'echarts'

import type { CalendarStats } from '@/lib/profile-stats'
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty'
import { Button } from '@/components/ui/button'
import { SegmentedControl } from '@/components/ui/segmented-control'

import { useECharts, useChartPalette } from './use-echarts'
import {
  buildYearGrid,
  buildMonthGrid,
  calendarCellColor,
  buildCalendarTooltip,
} from './calendar-grid'

interface Props {
  data: CalendarStats['days']
  bookIndex: CalendarStats['bookIndex']
  emptyTitle: string
  emptyDescription: string
}

type ViewKey = 'month' | 'year'

interface Cursor {
  year: number
  month: number
}

/** 周起始日随 locale：zh 周一（1）/ 其他周日（0）。 */
function weekStartsOn(language: string): 0 | 1 {
  return language.toLowerCase().startsWith('zh') ? 1 : 0
}

function parseDayKey(date: string): Cursor {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) }
}


/** 日键 'YYYY-MM-DD' → UTC 日 Date（tooltip 呈现用）。 */
function dateFromKey(key: string): Date {
  return new Date(
    Date.UTC(
      Number(key.slice(0, 4)),
      Number(key.slice(5, 7)) - 1,
      Number(key.slice(8, 10)),
    ),
  )
}
function BorrowCalendarImpl({ data, bookIndex, emptyTitle, emptyDescription }: Props) {
  const { t, i18n } = useTranslation('pages')
  const palette = useChartPalette()
  const language = i18n.language

  const [view, setView] = useState<ViewKey>('month')
  const [cursor, setCursor] = useState<Cursor | null>(null)

  // 默认锚定最新有数据月（data 升序）；一次初始化后导航状态归用户。
  useEffect(() => {
    if (cursor || data.length === 0) return
    setCursor(parseDayKey(data[data.length - 1].date))
  }, [data, cursor])

  const shift = (delta: number) => {
    if (!cursor) return
    if (view === 'year') {
      setCursor({ year: cursor.year + delta, month: cursor.month })
      return
    }
    const m = cursor.month + delta
    const year = cursor.year + Math.floor((m - 1) / 12)
    const month = ((((m - 1) % 12) + 12) % 12) + 1
    setCursor({ year, month })
  }

  const grid = useMemo(() => {
    if (!cursor) return null
    const ws = weekStartsOn(language)
    return view === 'year'
      ? buildYearGrid(data, cursor.year, ws, language)
      : buildMonthGrid(data, cursor.year, cursor.month, ws, language)
  }, [data, cursor, view, language])

  const tooltipDate = useMemo(
    () =>
      new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeZone: 'UTC' }),
    [language],
  )

  const option = useMemo<EChartsOption | null>(() => {
    if (!grid) return null
    const cells = grid.cells
    const xAxisData = Array.from(
      { length: grid.xCount },
      (_, i) => grid.xLabels.find((l) => l.index === i)?.label ?? '',
    )
    const seriesData = cells.map((c) => ({
      value: [c.x, c.y, c.count],
      itemStyle: {
        color: calendarCellColor(c.count, palette.chart2, palette.border),
      },
    }))
    return {
      // heatmap series 强制要求 visualMap 组件；颜色由逐格 itemStyle 显式给出
      // （显式样式优先于 visualMap 映射），此处仅提供隐藏的最小 visualMap 满足约束。
      visualMap: { show: false, min: 0, max: 4 },
      tooltip: {
        formatter: (p) => {
          // echarts formatter 参数为 union，heatmap 单项 tooltip 的 dataIndex
          // 在类型层丢失 → 命名常量按已知形状取（对照 BorrowGantt 同款处理）。
          const param = p as { dataIndex?: number }
          const cell = cells[param.dataIndex ?? -1]
          if (!cell) return ''
          return buildCalendarTooltip(cell, bookIndex, {
            dateText: tooltipDate.format(dateFromKey(cell.date)),
            countText: t('profile.calendar.tooltip.count', { count: cell.count }),
            moreText: (n) => t('profile.calendar.tooltip.more', { count: n }),
          })
        },
        backgroundColor: palette.popover,
        textStyle: { color: palette.popoverForeground },
      },
      grid: {
        left: 8,
        right: 16,
        // x 轴移顶（星期/月名标签在上）后，顶部留标签空间；y 轴 inverse 使
        // 第一周（星期首行）在顶部，符合常见日历自上而下的阅读方向。
        top: view === 'year' ? 28 : 26,
        bottom: 16,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: xAxisData,
        position: 'top',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: palette.mutedForeground,
          interval: 0,
          fontSize: 10,
          hideOverlap: false,
        },
      },
      yAxis: {
        type: 'category',
        data: grid.yLabels,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: palette.mutedForeground, fontSize: 10 },
      },
      series: [
        {
          type: 'heatmap',
          data: seriesData,
          itemStyle: {
            borderColor: palette.border,
            borderWidth: 2,
            borderRadius: 0,
          },
          emphasis: {
            itemStyle: { borderColor: palette.mutedForeground, borderWidth: 1 },
          },
        },
      ],
    }
  }, [grid, palette, bookIndex, tooltipDate, t, view])

  const ref = useECharts(option)

  if (data.length === 0) {
    return (
      <Empty className="min-h-[240px]">
        <EmptyHeader>
          <EmptyTitle>{emptyTitle}</EmptyTitle>
          <EmptyDescription>{emptyDescription}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  const cursorSafe = cursor ?? parseDayKey(data[data.length - 1].date)
  const prefix =
    view === 'year'
      ? `${cursorSafe.year}-`
      : `${cursorSafe.year}-${String(cursorSafe.month).padStart(2, '0')}-`
  const scopeDays = data.filter((d) => d.date.startsWith(prefix)).length
  const monthLabel = new Intl.DateTimeFormat(language, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(cursorSafe.year, cursorSafe.month - 1, 1)))
  const scopeText =
    view === 'year'
      ? t('profile.calendar.yearScope', { year: cursorSafe.year, days: scopeDays })
      : t('profile.calendar.monthScope', { month: monthLabel, days: scopeDays })
  const navAria =
    view === 'year'
      ? [t('profile.calendar.prevYear'), t('profile.calendar.nextYear')]
      : [t('profile.calendar.prevMonth'), t('profile.calendar.nextMonth')]

  return (
    <div className="flex flex-col gap-2">
      {/* tab 内薄工具条：口径显示 + 视图切换 + 月/年导航（§4 借阅日历 tab 内部） */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs text-muted-foreground">{scopeText}</span>
        <SegmentedControl
          value={view}
          onValueChange={(v) => setView(v as ViewKey)}
          options={[
            { value: 'month', label: t('profile.calendar.view.month') },
            { value: 'year', label: t('profile.calendar.view.year') },
          ]}
          aria-label={t('profile.chart.calendar.title')}
        />
        <span className="ml-auto flex items-center gap-1">
          {view === 'year' && (
            /* 年视图「年度回顾」链接（reading-profile §4 入口导航）：跳当前可见年。 */
            <Link to="/profile/$year" params={{ year: String(cursorSafe.year) }}>
              <Button variant="outline" size="sm">
                {t('profile.calendar.yearReview')}
              </Button>
            </Link>
          )}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={navAria[0]}
            onClick={() => shift(-1)}
          >
            ‹
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={navAria[1]}
            onClick={() => shift(1)}
          >
            ›
          </Button>
        </span>
      </div>
      {/* 容器带 role="img" + aria-label（WCAG 1.1.1）。 */}
      <div
        ref={ref}
        className={view === 'year' ? 'h-[280px] w-full' : 'h-[380px] w-full'}
        lang={language}
        role="img"
        aria-label={t('profile.chart.calendar.ariaLabel')}
      />
    </div>
  )
}

export const BorrowCalendar = memo(BorrowCalendarImpl)
