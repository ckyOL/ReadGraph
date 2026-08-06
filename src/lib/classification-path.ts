// 分类法层级解析（classification-hierarchy 规格 §4）。
//
// - `resolveClassificationPath`：纯函数。树/overlay/复分表由调用方传入，函数自身
//   不触发动态 import、不读存储/时钟，可单测（规格 §4.3）。
//   算法：入参归一 → 前缀候选匹配 + 父指针回溯（兼容 1,265 处交错结构，
//   「父 id 是子 id 前缀」不成立，逐层下钻会提前断链）→ 复分拆分兜底（§10：
//   全码未完整命中且含 `-` 时拆 main + aux，复分表查名）→ 降级链
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
  /** 总论复分号段（规格 §10）：`K02-39` 主类解析到 K02 后挂 `{-39, 信息化建设、新技术的应用}`；未命中/表外不设 */
  auxiliary?: ClassificationPathSegment
}

/** 缺口修正表条目（规格 §3.2）。key=code，value 记录类名与可追溯依据。 */
export interface OverlayEntry {
  name: string
  source: string
}
export type OverlayData = Record<string, OverlayEntry>

/** 总论复分表（规格 §10.4）。key=复分号原文（含 `-`，如 `"-39"`），value=5 版类名。 */
export type AuxiliaryData = Record<string, string>

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

/** 入参归一（§4.2）：大写、剥离括号复分、去交替类目方括号、去空白。斜杠保留——范围类目 id 本身带斜杠（如 `K833/837`）。 */
function normalizeCode(code: string): string {
  let c = code.trim().toUpperCase()
  const paren = c.indexOf('(')
  if (paren !== -1) c = c.slice(0, paren)
  return c.replace(/[[\]]/g, '').trim()
}

/** 索书号斜杠后缀形态（§4.2 兜底）：`I247.5/123` → `I247.5`。范围类目斜杠（`K833/837`）保留，由调用方双形态取优。 */
function slashlessForm(code: string): string {
  const slash = code.indexOf('/')
  return slash === -1 ? code : code.slice(0, slash)
}

/** 树匹配结果择优：完整命中（tree）优先于部分命中，然后比路径深度（深者优），再比未解析后缀长度（短者优）。 */
function betterTreeMatch(a: ClassificationPath, b: ClassificationPath): boolean {
  if (a.source !== b.source) return a.source === 'tree'
  if (a.depth !== b.depth) return a.depth > b.depth
  return (a.unresolvedSuffix?.length ?? 0) < (b.unresolvedSuffix?.length ?? 0)
}

/** 前缀边界：命中节点后紧跟的字符须为数字或点（或已到 code 末尾），拒绝字母嵌码。 */
function isBoundaryChar(ch: string | undefined): boolean {
  return ch !== undefined && (ch === '.' || (ch >= '0' && ch <= '9'))
}

/** 范围类目（斜杠 id，如 `K833/837`、`C829.3/.7`）的区间端点。 */
interface RangeSpec {
  id: string
  /** 字母前缀（`K833/837` → `K`） */
  alpha: string
  /** 左端数字段（`C829.3/.7` → ['829', '3']；保留位宽：`093` ≠ `93`） */
  left: string[]
  /** 右端数字段（点开头时补全公共前缀：`C829.3/.7` → ['829', '7']；否则直接用：`E3/7` → ['7']） */
  right: string[]
}

const rangeCache = new WeakMap<object, RangeSpec[]>()

/** 收集树中全部范围类目节点（一次 O(n)，WeakMap 缓存）。 */
function buildRanges(tree: ClcNode[]): RangeSpec[] {
  const cached = rangeCache.get(tree)
  if (cached) return cached
  const ranges: RangeSpec[] = []
  const walk = (nodes: ClcNode[]) => {
    for (const node of nodes) {
      const id = stripBrackets(node.id)
      const m = /^([A-Z]+)([\d.]+)\/(.+)$/.exec(id)
      if (m) {
        const left = m[2].split('.')
        const rightSeg = (m[3].startsWith('.') ? m[3].slice(1) : m[3]).split('.')
        const right = m[3].startsWith('.')
          ? left.slice(0, Math.max(0, left.length - rightSeg.length)).concat(rightSeg)
          : rightSeg
        ranges.push({ id, alpha: m[1], left, right })
      }
      if (node.children) walk(node.children)
    }
  }
  walk(tree)
  rangeCache.set(tree, ranges)
  return ranges
}

/**
 * 段数组比较（字符串字典序，'.' 分隔）：短前缀视为小（`['3'] < ['35']`），
 * 前导零位宽天然区分（`['93'] > ['093']`，D93.5 不误入 D093/097）；
 * 展开号按字典序落入区间（`['35'] < ['7']`，E35 ∈ E3/7）。
 */
function cmpSeg(a: string[], b: string[]): number {
  const sa = a.join('.')
  const sb = b.join('.')
  if (sa === sb) return 0
  return sa < sb ? -1 : 1
}

/**
 * 范围类目归属匹配（CLC 范围类目语义）：`K833/837`（区间 [833, 837]）承接
 * `K833.135.72` —— code 的数字段前缀落在 [left, right] 内即归属该节点（树无更细
 * 节点，如各国人物传记按地区/人物展开）。多个命中取段前缀最长（最深）者。
 * 匹配前缀 = 范围左端号（`K833.135.72` → 左端 `K833`，剩余 `.135.72` 为未解析后缀；
 * 范围节点能表达的最深归属段即左端，与 J238.2 停在 J238 同构）。
 */
function deepestRangeMatch(
  index: Map<string, FlatNode>,
  ranges: RangeSpec[],
  code: string,
): { flat: FlatNode; matchedPrefix: string } | null {
  // 输入即范围 id 形态（`K833/837`）：范围节点已被平级展开替换（不在树中），
  // 归属 = 范围左端展开号在树中的父级（范围容器原位置，`K 历史、地理 › K81 传记`）。
  // 形态判定：右端与左端段数相同（或点开头）——已展开范围全部满足（833/837、
  // E3/7、C829.3/.7）；索书号后缀（I247.5/123、TP311/5000）段数不同且非点开头，
  // 不误判。未展开范围（`D221/227` 仍在树中）由前缀精确命中先行返回，不至此。
  const dm = /^([A-Z]+)([\d.]+)\/(.+)$/.exec(code)
  if (dm) {
    const plausible = dm[3].startsWith('.') || dm[3].split('.').length === dm[2].split('.').length
    if (plausible) {
      const leftFlat = index.get(dm[1] + dm[2])
      const parent = leftFlat?.parentId ? index.get(stripBrackets(leftFlat.parentId)) : null
      if (parent) return { flat: parent, matchedPrefix: code }
    }
  }
  const m = /^([A-Z]+)([\d.]+)$/.exec(code)
  if (!m) return null
  const digits = m[2].split('.')
  let best: { flat: FlatNode; matchedPrefix: string; depth: number } | null = null
  for (const r of ranges) {
    if (r.alpha !== m[1]) continue
    const flat = index.get(r.id)
    if (!flat) continue
    for (let i = 1; i <= digits.length; i++) {
      const p = digits.slice(0, i)
      if (cmpSeg(p, r.left) >= 0 && cmpSeg(p, r.right) <= 0 && i > (best?.depth ?? 0)) {
        best = { flat, matchedPrefix: r.alpha + r.left.join('.'), depth: i }
      }
    }
  }
  return best ? { flat: best.flat, matchedPrefix: best.matchedPrefix } : null
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

/**
 * 复分拆分兜底（§10.5）：`main-aux` 在首个 `-` 处拆分，主类重解 + 复分表查名。
 * - 全码树内显式复分节点（`B81-09`）/overlay 键不至此（上游已完整命中返回）；
 * - aux 查表命中 → 挂 `auxiliary` 段，主类解析契约（source/depth/unresolvedSuffix）不变；
 * - 表外复分号 → 不造名，`-xx` 原文并入 unresolvedSuffix（first-level/none 保持契约不带）；
 * - fallback 为全码解析结果（拆分不可用时原样返回，如 main 为空/主类未命中）。
 */
function resolveWithAuxiliary(
  system: ClassificationSystem,
  code: string,
  tree: ClcNode[],
  overlay: OverlayData | undefined,
  auxiliary: AuxiliaryData | undefined,
  fallback: ClassificationPath | null,
): ClassificationPath {
  const dash = code.indexOf('-')
  if (dash <= 0) return fallback ?? { path: [], depth: 0, source: 'none' }
  const main = code.slice(0, dash)
  const auxRaw = code.slice(dash)
  // 递归解析主类（main 无 `-`，不再进拆分）；overlay 对主类的补录同样生效。
  const mainPath = resolveClassificationPath(system, main, tree, overlay)
  if (mainPath.source === 'none') return fallback ?? mainPath
  const auxName = auxiliary?.[auxRaw]
  if (auxName) {
    return { ...mainPath, auxiliary: { code: auxRaw, name: auxName } }
  }
  if (mainPath.source === 'tree') {
    return { ...mainPath, source: 'tree-partial', unresolvedSuffix: auxRaw }
  }
  if (mainPath.source === 'tree-partial') {
    return { ...mainPath, unresolvedSuffix: (mainPath.unresolvedSuffix ?? '') + auxRaw }
  }
  // first-level / overlay：保持既有契约（不带 unresolvedSuffix）。
  return mainPath
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

/**
 * 树命中 → 路径。matchedPrefix 仅范围类目命中时传入（`K833.135.72` → `K833`），
 * 用于计算未解析后缀；缺省按节点 id 计算。
 */
function treePathFrom(
  index: Map<string, FlatNode>,
  flat: FlatNode,
  form: string,
  matchedPrefix?: string,
): ClassificationPath {
  const matchedId = matchedPrefix ?? stripBrackets(flat.node.id)
  const isPartial = matchedId !== form
  const segments = chainToRoot(index, flat)
  const path: ClassificationPath = {
    path: segments,
    depth: segments.length,
    source: isPartial ? 'tree-partial' : 'tree',
  }
  if (isPartial) path.unresolvedSuffix = form.slice(matchedId.length)
  return path
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
 * @param auxiliary 总论复分表（clc 经 `loadClcAuxiliary()` 传入；缺省 = 旧行为，不拆复分号）
 */
export function resolveClassificationPath(
  system: ClassificationSystem,
  code: string,
  tree: ClcNode[],
  overlay?: OverlayData,
  auxiliary?: AuxiliaryData,
): ClassificationPath {
  const normalized = normalizeCode(code)
  if (!normalized) return { path: [], depth: 0, source: 'none' }

  // 1. overlay 命中（优先于静态树，§4.3）：先查带斜杠形态（范围类目键），再兜底剥斜杠形态（索书号后缀键）。
  let overlayKey = normalized
  if (overlay) {
    if (!overlay[normalized]) {
      const form = slashlessForm(normalized)
      if (form !== normalized && overlay[form]) overlayKey = form
    }
    if (overlay[overlayKey]) {
      return resolveWithOverlay(overlayKey, overlay[overlayKey], tree)
    }
  }

  // 2. 静态树：前缀候选匹配 + 父指针回溯 + 范围类目区间归属。带斜杠范围类目（`K833/837`）
  //    与索书号斜杠后缀（`I247.5/123`）双形态各匹配一次，取解析更深、后缀更短者（§4.2）。
  if (system === 'clc' || system === 'ddc') {
    const index = buildIndex(tree)
    const ranges = buildRanges(tree)
    const forms = normalized.includes('/') ? [normalized, slashlessForm(normalized)] : [normalized]
    let best: ClassificationPath | null = null
    // 择优收录：剥斜杠形态（索书号后缀兜底）不超越原形态的 tree 结果
    // （K833/837 输入不被剥斜杠形态 K833 展开子级抢占）；原形态 partial 时
    // 剥斜杠完整解（I247.5/123 → I247.5）仍可胜出。
    // 返回式择优（不在闭包内赋值，避免 TS 对闭包赋值变量的窄化失效）。
    const consider = (path: ClassificationPath): ClassificationPath | null => {
      if (best?.source === 'tree') return best
      if (!best || betterTreeMatch(path, best)) return path
      return best
    }
    for (const form of forms) {
      const match = deepestPrefixMatch(index, form)
      if (match) {
        // 输入原形态（带斜杠）精确命中 → 最精确解析（如 D221/227 本身），
        // 不被剥斜杠形态的更深入口抢占。
        if (form === normalized && stripBrackets(match.node.id) === form) {
          return treePathFrom(index, match, form)
        }
        best = consider(treePathFrom(index, match, form))
      }
      const range = deepestRangeMatch(index, ranges, form)
      if (range) {
        best = consider(treePathFrom(index, range.flat, form, range.matchedPrefix))
      }
    }
    if (best) {
      // 复分拆分兜底（§10.5）：全码未完整命中（tree-partial / 未命中）且含 `-`
      // → 首 `-` 处拆 main + aux，主类重解 + 复分表查名；树内显式复分节点
      // （`B81-09` 等）与 overlay 键已完整命中，不至此。
      if (best.source !== 'tree' && normalized.includes('-')) {
        return resolveWithAuxiliary(system, normalized, tree, overlay, auxiliary, best)
      }
      return best
    }
    // 全码树内未命中（可能落入一级/未命中）：同样尝试复分拆分。
    if (normalized.includes('-')) {
      return resolveWithAuxiliary(system, normalized, tree, overlay, auxiliary, null)
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

let clcAuxiliaryPromise: Promise<AuxiliaryData> | null = null

/** 懒加载 CLC 总论复分表（§10，与树同机制）。 */
export function loadClcAuxiliary(): Promise<AuxiliaryData> {
  clcAuxiliaryPromise ??= import('@/data/classification/clc-auxiliary.json').then(
    (m) => m.default as unknown as AuxiliaryData,
  )
  return clcAuxiliaryPromise
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
  auxiliary?: AuxiliaryData,
): ClassificationChild[] {
  const counts = new Map<string, ClassificationChild>()
  for (const raw of codes) {
    const res = resolveClassificationPath('clc', raw, tree, overlay, auxiliary)
    const path = res.path
    const idx = path.findIndex((s) => s.code === drillCode)
    const child = idx >= 0 ? path[idx + 1] : undefined
    if (child) {
      const cur = counts.get(child.code)
      if (cur) cur.value += 1
      else counts.set(child.code, { code: child.code, name: child.name, value: 1 })
    }
    // 复分号段（§10.5）：下钻节点即主类路径最末段时，复分号作为其子段计数。
    if (res.auxiliary && idx === path.length - 1) {
      const a = res.auxiliary
      const cur = counts.get(a.code)
      if (cur) cur.value += 1
      else counts.set(a.code, { code: a.code, name: a.name, value: 1 })
    }
  }
  return Array.from(counts.values())
}
