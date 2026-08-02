// 甘特视口布局纯函数（reading-profile §4，Tabs 布局 + lane 自适应）。
// lane 可视高固定 24px；视口高度 = clamp(laneCount × LANE_HEIGHT, MIN, MAX)。
// lane 数超过可视上限（= MAX / LANE_HEIGHT）时启用 y 轴缩放（右侧 slider），
// lane 保持可读高度不被压扁（书库书多时甘特显示不全的根治）。
export const GANTT_LANE_HEIGHT = 24
export const GANTT_MIN_HEIGHT = 280
export const GANTT_MAX_HEIGHT = 624
/** 视口内可完整显示的 lane 数上限（624 / 24）。 */
export const GANTT_MAX_VISIBLE_LANES = Math.floor(GANTT_MAX_HEIGHT / GANTT_LANE_HEIGHT)

export interface GanttViewport {
  /** 容器高度（px）。 */
  height: number
  /** lane 数超过可视上限 → 启用 y 轴缩放。 */
  yZoom: boolean
}

/** 甘特视口计算（纯函数，TDD；`laneCount` 为实际渲染的 lane 数）。 */
export function computeGanttViewport(laneCount: number): GanttViewport {
  const height = Math.min(
    Math.max(laneCount * GANTT_LANE_HEIGHT, GANTT_MIN_HEIGHT),
    GANTT_MAX_HEIGHT,
  )
  return { height, yZoom: laneCount > GANTT_MAX_VISIBLE_LANES }
}
