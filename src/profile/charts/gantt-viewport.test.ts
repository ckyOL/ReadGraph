// 甘特视口纯函数测试（reading-profile §4 布局 / §7 测试清单）。
// 高度自适应契约：lane 可视高 24px，视口 clamp [280, 624]；超可视上限启用 y 缩放。
import { describe, it, expect } from 'vitest'

import {
  computeGanttViewport,
  GANTT_LANE_HEIGHT,
  GANTT_MIN_HEIGHT,
  GANTT_MAX_HEIGHT,
  GANTT_MAX_VISIBLE_LANES,
} from './gantt-viewport'

describe('computeGanttViewport', () => {
  it('lane 少时取下限高度，不塌缩、不启用缩放', () => {
    expect(computeGanttViewport(1).height).toBe(GANTT_MIN_HEIGHT)
    expect(computeGanttViewport(10).height).toBe(GANTT_MIN_HEIGHT)
    expect(computeGanttViewport(10).yZoom).toBe(false)
  })

  it('可视范围内按 lane 高度线性增长', () => {
    const v = computeGanttViewport(13)
    expect(v.height).toBe(13 * GANTT_LANE_HEIGHT)
    expect(v.yZoom).toBe(false)
  })

  it('恰为可视上限封顶不缩放，超一 lane 即启用缩放', () => {
    const at = computeGanttViewport(GANTT_MAX_VISIBLE_LANES)
    expect(at.height).toBe(GANTT_MAX_HEIGHT)
    expect(at.yZoom).toBe(false)

    const over = computeGanttViewport(GANTT_MAX_VISIBLE_LANES + 1)
    expect(over.height).toBe(GANTT_MAX_HEIGHT)
    expect(over.yZoom).toBe(true)
  })

  it('大库高度封顶，不再压扁 lane', () => {
    const v = computeGanttViewport(150)
    expect(v.height).toBe(GANTT_MAX_HEIGHT)
    expect(v.yZoom).toBe(true)
  })
})
