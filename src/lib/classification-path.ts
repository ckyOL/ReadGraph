// 分类法层级解析（classification-hierarchy 规格 §4）。
//
// - `resolveClassificationPath`：纯函数。树/overlay 由调用方传入，函数自身
//   不触发动态 import、不读存储/时钟，可单测（规格 §4.3）。
//   算法：入参归一 → 前缀候选匹配 + 父指针回溯（兼容 1,265 处交错结构，
//   「父 id 是子 id 前缀」不成立，逐层下钻会提前断链）→ 降级链
//   overlay > tree/tree-partial > first-level > none。
// - `loadClcTree` / `loadClcOverlay`：懒加载器，动态 import 独立 chunk
//   （bundle-dynamic-imports），单例缓存 Promise。
import type { ClassificationSystem } from '@/types/entities'
import { classificationCategory } from './classification'

/** 静态分类树节点（规格 §3.1）。交替类目 id 形如 `[J59]`。 */
export interface ClcNode {
  id: string
  desc: string
  children?: ClcNode[]
}

export interface ClassificationPathSegment {
  code: string
  name: string
}

/** 命中来源（规格 §3.3）：'overlay' | 'tree' | 'tree-partial' | 'first-level' | 'none' */
export type ClassificationSource =
  | 'overlay'
  | 'tree'
  | 'tree-partial'
  | 'first-level'
  | 'none'

export interface ClassificationPath {
  /** 根到叶的完整路径，至少含一级；code 在表中无命中时为空数组 */
  path: ClassificationPathSegment[]
  /** 解析深度（path 长度） */
  depth: number
  source: ClassificationSource
  /** 仅 tree-partial：code 比最深命中节点长的剩余后缀（如 'J238.2' 停在 J238 时 '.2'） */
  unresolvedSuffix?: string
}

/** 缺口修正表条目（规格 §3.2）。key=code，value 记录类名与可追溯依据。 */
export interface OverlayEntry {
  name: string
  source: string
}
export type OverlayData = Record<string, OverlayEntry>

/** 拍平索引：去括号 id → 节点 + 真实父链指针（一次 O(n) 构建）。 */
interface FlatNode {
  node: ClcNode
  parentId: string | null
}

const indexCache = new WeakMap<object, Map<string, FlatNode>>()

function stripBrackets(id: string): string {
  return id.replace(/[[\]]/g, '')
}

function buildIndex(tree: ClcNode[]): Map<string, FlatNode> {
  const cached = indexCache.get(tree)
  if (cached) return cached
  const index = new Map<string, FlatNode>()
  const walk = (nodes: ClcNode[], parentId: string | null) => {
    for (const node of nodes) {
      index.set(stripBrackets(node.id), { node, parentId })
      if (node.children) walk(node.children, node.id)
    }
  }
  walk(tree, null)
  indexCache.set(tree, index)
  return index
}

/** 入参归一（§4.2）：大写、剥离括号复分、兜底剥离斜杠、去交替类目方括号、去空白。 */
function normalizeCode(code: string): string {
  let c = code.trim().toUpperCase()
  const paren = c.indexOf('(')
  if (paren !== -1) c = c.slice(0, paren)
  const slash = c.indexOf('/')
  if (slash !== -1) c = c.slice(0, slash)
  return c.replace(/[[\]]/g, '').trim()
}

/** 前缀边界：命中节点后紧跟的字符须为数字或点（或已到 code 末尾），拒绝字母嵌码。 */
function isBoundaryChar(ch: string | undefined): boolean {
  return ch !== undefined && (ch === '.' || (ch >= '0' && ch <= '9'))
}

/**
 * 前缀候选匹配（§4.1）：生成长度递减前缀候选，从长到短哈希查命中即最深节点。
 * 命中条件：id 存在 且（完整 code 或 下一字符为数字/点）——`QZ9` 之类字母嵌码
 * 只在首字母处命中时被拒，落入降级链。
 */
function deepestPrefixMatch(
  index: Map<string, FlatNode>,
  code: string,
): FlatNode | null {
  for (let len = code.length; len >= 1; len--) {
    const flat = index.get(code.slice(0, len))
    if (!flat) continue
    if (len === code.length || isBoundaryChar(code[len])) return flat
  }
  return null
}

/** 一级表兜底的有效形态门：首字符后仅数字/点（或空），拒绝字母嵌码。 */
function isValidFirstLevelShape(system: ClassificationSystem, code: string): boolean {
  if (system === 'clc') return /^[A-Z](?:[0-9.].*)?$/.test(code)
  if (system === 'ddc') return /^[0-9](?:[0-9.].*)?$/.test(code)
  return false
}

/** 沿真实父链回溯到根，构建展示路径（交替类目 id 去括号）。 */
function chainToRoot(index: Map<string, FlatNode>, from: FlatNode): ClassificationPathSegment[] {
  const segments: ClassificationPathSegment[] = []
  let cur: FlatNode | null = from
  while (cur) {
    segments.unshift({ code: stripBrackets(cur.node.id), name: cur.node.desc })
    cur = cur.parentId ? index.get(stripBrackets(cur.parentId)) ?? null : null
  }
  return segments
}

/** overlay 命中：overlay 段 + 静态树补足其余段（§4.3 规则 1）。 */
function resolveWithOverlay(
  code: string,
  entry: OverlayEntry,
  tree: ClcNode[],
): ClassificationPath {
  const index = buildIndex(tree)
  // 树中最深的 code 前缀节点（overlay 已确证此 code，无需边界门）。
  let prefixLen = code.length
  let prefix: FlatNode | null = null
  for (; prefixLen >= 1; prefixLen--) {
    const flat = index.get(code.slice(0, prefixLen))
    if (flat) {
      prefix = flat
      break
    }
  }
  let from: FlatNode | null = null
  if (prefix) {
    if (prefixLen === code.length) {
      // 树已含该节点 → overlay 类名替换节点自身，从其父节点回溯。
      from = prefix.parentId ? index.get(stripBrackets(prefix.parentId)) ?? null : null
    } else {
      from = prefix
    }
  }
  const chain = from ? chainToRoot(index, from) : []
  chain.push({ code, name: entry.name })
  return { path: chain, depth: chain.length, source: 'overlay' }
}

/**
 * 分类号 → 分类路径（根到叶）+ 命中来源（纯函数）。
 *
 * @param tree 静态分类树（clc 经 `loadClcTree()` 懒加载后传入；空数组 = 树未就绪）
 * @param overlay 缺口修正表（按体系键控，clc 经 `loadClcOverlay()` 传入；缺省跳过）
 */
export function resolveClassificationPath(
  system: ClassificationSystem,
  code: string,
  tree: ClcNode[],
  overlay?: OverlayData,
): ClassificationPath {
  const normalized = normalizeCode(code)
  if (!normalized) return { path: [], depth: 0, source: 'none' }

  // 1. overlay 命中（优先于静态树，§4.3）。
  if (overlay && overlay[normalized]) {
    return resolveWithOverlay(normalized, overlay[normalized], tree)
  }

  // 2. 静态树：前缀候选匹配 + 父指针回溯。
  if (system === 'clc' || system === 'ddc') {
    const index = buildIndex(tree)
    const match = deepestPrefixMatch(index, normalized)
    if (match) {
      const matchedId = stripBrackets(match.node.id)
      const isPartial = matchedId !== normalized
      const segments = chainToRoot(index, match)
      const path: ClassificationPath = {
        path: segments,
        depth: segments.length,
        source: isPartial ? 'tree-partial' : 'tree',
      }
      if (isPartial) path.unresolvedSuffix = normalized.slice(matchedId.length)
      return path
    }
  }

  // 3. 一级表兜底（保留为降级层；树完整时几乎不可达，加载前/空表时生效）。
  if (isValidFirstLevelShape(system, normalized)) {
    const category = classificationCategory(system, normalized)
    if (category) {
      return {
        path: [{ code: normalized.charAt(0), name: category }],
        depth: 1,
        source: 'first-level',
      }
    }
  }

  // 4. 未命中。
  return { path: [], depth: 0, source: 'none' }
}

let clcTreePromise: Promise<ClcNode[]> | null = null

/** 懒加载 CLC 静态树（动态 import 独立 chunk，单例缓存）。 */
export function loadClcTree(): Promise<ClcNode[]> {
  clcTreePromise ??= import('@/data/classification/clc-tree.json').then(
    (m) => m.default as unknown as ClcNode[],
  )
  return clcTreePromise
}

let clcOverlayPromise: Promise<OverlayData> | null = null

/** 懒加载 CLC 缺口修正表（与树同机制）。 */
export function loadClcOverlay(): Promise<OverlayData> {
  clcOverlayPromise ??= import('@/data/classification/clc-overlay.json').then(
    (m) => m.default as unknown as OverlayData,
  )
  return clcOverlayPromise
}

/**
 * treemap 下钻数据派生（规格 §5.3，UI 层数据链）：给定下钻节点 code 与桶内
 * 书目分类号集合，解析每条 code 的路径，按下钻节点的直接子段分组计数。
 * 无法解析出子段的条目（未分类 / 路径止于下钻节点）跳过。
 */
export interface ClassificationChild {
  code: string
  name: string
  value: number
}

export function buildClassificationChildren(
  drillCode: string,
  codes: string[],
  tree: ClcNode[],
  overlay?: OverlayData,
): ClassificationChild[] {
  const counts = new Map<string, ClassificationChild>()
  for (const raw of codes) {
    const path = resolveClassificationPath('clc', raw, tree, overlay).path
    const idx = path.findIndex((s) => s.code === drillCode)
    const child = idx >= 0 ? path[idx + 1] : undefined
    if (!child) continue
    const cur = counts.get(child.code)
    if (cur) cur.value += 1
    else counts.set(child.code, { code: child.code, name: child.name, value: 1 })
  }
  return Array.from(counts.values())
}
