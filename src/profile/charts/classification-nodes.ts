// 分类 treemap 数据选择与下钻判定纯逻辑（键盘等价路径与 canvas 共用，单测覆盖）。
// 列表视图与 canvas option 同源：同一选择函数保证两视图当前层级数据一致。

export interface ClassificationNode {
  name: string
  code: string
  value: number
}

export interface DrillLevelLike {
  code: string
  name: string
  value: number
}

export interface SelectNodesInput {
  drill: DrillLevelLike | null
  /** 下钻子级（null = 查询未就绪/加载中）。 */
  drillChildren: ClassificationNode[] | null
  /** 根层一级节点。 */
  topNodes: ClassificationNode[]
}

/**
 * 当前层级待呈现节点（canvas option 与列表视图共用）：
 * - 根态（无下钻）：一级 topNodes；
 * - 下钻态：drillChildren 非空取子级；为空/加载中（null）→ 回退为下钻节点自身，
 *   避免空白（与 treemap option 原兜底分支一致）。
 */
export function selectClassificationNodes({
  drill,
  drillChildren,
  topNodes,
}: SelectNodesInput): ClassificationNode[] {
  if (!drill) return topNodes
  if (drillChildren && drillChildren.length > 0) return drillChildren
  return [{ name: drill.name, code: drill.code, value: drill.value }]
}

/**
 * 节点是否可下钻（列表按钮与 canvas 点击同一规则）：
 * 仅 clc 体系且分类树已加载；排除未分类聚合项（__unclassified__）与
 * 非字母开头的异常 code。
 */
export function canDrillClassification(
  code: string,
  opts: { system: string; treeLoaded: boolean },
): boolean {
  if (opts.system !== 'clc' || !opts.treeLoaded) return false
  if (!code || code === '__unclassified__') return false
  return /^[A-Z]/.test(code)
}
