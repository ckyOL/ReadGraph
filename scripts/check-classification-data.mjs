#!/usr/bin/env node
// 分类法数据契约校验器（用户自备 JSON → public/classification/，见 docs/specs/classification-hierarchy.md §0）。
// 零依赖：结构与内容门与数据契约对齐（ClcNode/OverlayEntry/AuxiliaryData，见规格 §2）。
// 用法: node scripts/check-classification-data.mjs [--dir public/classification]
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = process.argv.includes('--dir')
  ? process.argv[process.argv.indexOf('--dir') + 1]
  : 'public/classification'

// 顶层 22 个字母类（中图法无 L/M/W/Y），与 src/lib/classification.ts CLC_FIRST_LEVEL 一致。
const TOP_LEVEL = 'ABCDEFGHIJKNOPQRSTUVXZ'
const NODE_FIELDS = new Set(['id', 'desc', 'src', 'status', 'redirect', 'children'])
const STATUSES = new Set(['alternate', 'superseded'])
const ID_PATTERN = /^[\[\{]?[A-Z][A-Z0-9./+\-]*[\]\}]?$/
const AUX_KEY_PATTERN = /^-?[0-9.]+$/

const problems = []
const read = (file) => {
  try {
    return JSON.parse(readFileSync(join(DIR, file), 'utf8'))
  } catch (e) {
    problems.push(`缺失或无法解析: ${join(DIR, file)}（${e.message}）`)
    return undefined
  }
}

function checkTree(data) {
  if (!data) return
  if (!Array.isArray(data)) return void problems.push('clc-tree.json: 根应为数组')
  const seen = new Set()
  const stack = [['root', data, null]]
  while (stack.length) {
    const [where, nodes, parent] = stack.pop()
    if (!Array.isArray(nodes)) return void problems.push(`${where}: children 应为数组`)
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      const loc = `${where}[${i}]`
      if (typeof node !== 'object' || node === null) return void problems.push(`${loc}: 应为对象`)
      for (const req of ['id', 'desc']) if (!(req in node)) problems.push(`${loc}: 缺 required 字段 ${req}`)
      for (const extra of Object.keys(node)) if (!NODE_FIELDS.has(extra)) problems.push(`${loc}: 未知字段 ${extra}`)
      const id = node.id
      if (typeof id === 'string') {
        if (!ID_PATTERN.test(id)) problems.push(`${loc}: id 形态非法 ${id}`)
        const bare = id.replace(/[[\]{}]/g, '')
        if (seen.has(bare)) problems.push(`${loc}: 去括号 id 重复 ${bare}（${parent ?? '顶层'} 之下）`)
        seen.add(bare)
      } else {
        problems.push(`${loc}: id 应为字符串`)
      }
      if (typeof node.desc !== 'string' || !node.desc) problems.push(`${loc}: desc 应为非空字符串`)
      if (node.status != null && !STATUSES.has(node.status)) problems.push(`${loc}: status 非法 ${node.status}`)
      if ('children' in node) stack.push([`${loc}.children`, node.children, id])
    }
  }
  const top = data.map((n) => n.id).sort().join('')
  if (top !== TOP_LEVEL) problems.push(`clc-tree.json: 顶层类目不完整，得 ${top}，期望 ${TOP_LEVEL}`)
}

function checkOverlay(data) {
  if (!data) return
  if (typeof data !== 'object' || Array.isArray(data)) return void problems.push('clc-overlay.json: 应为对象（code → 修正条目）')
  for (const [code, entry] of Object.entries(data)) {
    if (typeof entry !== 'object' || !('name' in entry) || !('source' in entry)) {
      problems.push(`clc-overlay.json[${code}]: 条目应含 name/source`)
      continue
    }
    if (!entry.name || !entry.source) problems.push(`clc-overlay.json[${code}]: name/source 应为非空字符串`)
  }
}

function checkAux(data) {
  if (!data) return
  if (typeof data !== 'object' || Array.isArray(data)) return void problems.push('clc-auxiliary.json: 应为对象（复分号 → 类名）')
  for (const [key, name] of Object.entries(data)) {
    if (!AUX_KEY_PATTERN.test(key)) problems.push(`clc-auxiliary.json[${key}]: 复分号形态非法`)
    if (typeof name !== 'string' || !name) problems.push(`clc-auxiliary.json[${key}]: 类名应为非空字符串`)
  }
}

checkTree(read('clc-tree.json'))
checkOverlay(read('clc-overlay.json'))
checkAux(read('clc-auxiliary.json'))

if (problems.length) {
  console.error(`分类法数据契约校验失败（${problems.length} 处）:`)
  for (const p of problems.slice(0, 50)) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`分类法数据契约校验通过（目录 ${DIR}）。`)
