#!/usr/bin/env node
// 生成 src/lib/tz-cities.json：zh-CN 时区→城市映射（macOS 式「城市」标签的数据源）。
// 来源：Unicode CLDR（cldr-dates-full@48.2.0）timeZoneNames.json 的 exemplarCity——
// 与 macOS/iOS 时区选择器同源（Apple 即用 CLDR exemplar city 本地化城市名）。
// 仅保留 @vvo/tzdb 名单内的 IANA 时区；未覆盖项（如 Etc/UTC、链接别名）由运行时
// 回退 tzdb mainCities。重新生成：pnpm generate:cities（需联网）。
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import rawTimeZones from '@vvo/tzdb/raw-time-zones.json' with { type: 'json' }

const CLDR_VERSION = '48.2.0'
const SOURCES = [
  `https://cdn.jsdelivr.net/npm/cldr-dates-full@${CLDR_VERSION}/main/zh/timeZoneNames.json`,
  `https://unpkg.com/cldr-dates-full@${CLDR_VERSION}/main/zh/timeZoneNames.json`,
]
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib', 'tz-cities.json')

async function fetchCldr() {
  let lastError
  for (const url of SOURCES) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(url)
        if (res.ok) return await res.json()
        lastError = new Error(`HTTP ${res.status}`)
      } catch (err) {
        lastError = err
      }
      await new Promise((r) => setTimeout(r, 800 * attempt))
    }
  }
  throw lastError
}

const data = await fetchCldr()

const clrZone = data.main.zh.dates.timeZoneNames.zone
const clrCities = {}
for (const [continent, zones] of Object.entries(clrZone)) {
  for (const [city, meta] of Object.entries(zones)) {
    if (meta._type === 'zone' && typeof meta.exemplarCity === 'string') {
      clrCities[`${continent}/${city}`] = meta.exemplarCity
    }
  }
}

const tzdbNames = new Set(rawTimeZones.map((z) => z.name))
const out = {}
for (const [iana, city] of Object.entries(clrCities).sort()) {
  if (tzdbNames.has(iana)) out[iana] = city
}

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`)
console.log(`wrote ${Object.keys(out).length} cities -> ${OUT} (CLDR ${CLDR_VERSION})`)
