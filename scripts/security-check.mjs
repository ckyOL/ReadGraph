#!/usr/bin/env node
// npm/pnpm 安全配置自检 — 对照 docs/npm-supply-chain-security.md 附录 A
// min-release-age 在 pnpm 下为 no-op，此项仅告警不阻断。
import { spawnSync } from 'node:child_process'

const required = {
  'ignore-scripts': 'true',
  'save-exact': 'true',
  'audit': 'true',
  'strict-ssl': 'true',
  'registry': 'https://registry.npmjs.org/',
  'min-release-age': '7d',
}

const res = spawnSync('npm', ['config', 'list'], { encoding: 'utf8' })
const out = res.stdout || ''

const failures = []
console.log('=== npm/pnpm 安全配置检查 ===')
for (const [key, expected] of Object.entries(required)) {
  const got = getConfig(key, out)
  const status = got === expected ? 'OK' : (key === 'min-release-age' ? 'WARN' : 'FAIL')
  const note = status === 'OK' ? '' : ` (expected ${expected})`
  console.log(`${key}: ${got}  [${status}${note}]`)
  if (status === 'FAIL') failures.push(key)
}
console.log('===========================')

if (failures.length > 0) {
  console.error(`\n不合规配置: ${failures.join(', ')}`)
  process.exit(1)
}

function getConfig(key, output) {
  const re = new RegExp(`^${key}\\s*=\\s*'?([^'\\s,]+)'?`, 'm')
  const m = output.match(re)
  return m ? m[1].replace(/^["']|["']$/g, '') : ''
}
