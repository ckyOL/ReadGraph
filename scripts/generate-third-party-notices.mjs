#!/usr/bin/env node
/**
 * 生成 THIRD_PARTY_NOTICES.md —— 汇总运行时依赖的许可证信息。
 *
 * 义务依据:
 * - MIT / ISC: 再分发物须保留版权声明与许可文本(打包进 dist 后原文本消失);
 * - Apache-2.0 §4(a)/(d): 再分发须提供许可证副本并保留 NOTICE 文件。
 *
 * 用法: node scripts/generate-third-party-notices.mjs
 * 只汇总 package.json "dependencies"(进入 dist 产物的运行时依赖);
 * devDependencies 不进产物,不在此列。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const LICENSE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt'];
const NOTICE_FILES = ['NOTICE', 'NOTICE.md', 'NOTICE.txt'];

function readFirst(names, dir) {
  for (const n of names) {
    const p = join(dir, n);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  return null;
}

function licenseOf(pkgJson, dir) {
  const raw = pkgJson.license;
  if (!raw) return 'UNKNOWN';
  return typeof raw === 'object' ? raw.type : raw;
}

function copyrightOf(licenseText, noticeText) {
  const src = `${licenseText ?? ''}\n${noticeText ?? ''}`;
  // 优先带真实年份的版权行;跳过 Apache 模板占位符 "[yyyy] [name of copyright owner]"
  const m = src.match(/^\s*(Copyright[^\n]*\d{4}[^\n]*|©[^\n]*\d{4}[^\n]*)$/m)
    ?? src.match(/^\s*(Copyright[^\n]*|©[^\n]*)$/m);
  const hit = m ? m[0].trim() : '';
  return /[\[{]\s*y{4}/.test(hit) ? '' : hit;
}

/** 取仓库内任意已装依赖的 LICENSE 全文作为该许可证的标准文本 */
function canonicalLicenseText(spdx, sampleDir) {
  return readFirst(LICENSE_FILES, sampleDir);
}

const deps = Object.entries(pkg.dependencies)
  .map(([name, spec]) => {
    const dir = join(root, 'node_modules', name);
    let meta;
    try {
      meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    } catch {
      return { name, version: spec, license: 'UNKNOWN', copyright: '', notice: '' };
    }
    const lic = licenseOf(meta, dir);
    const licText = readFirst(LICENSE_FILES, dir);
    const notice = readFirst(NOTICE_FILES, dir) ?? '';
    return {
      name,
      version: meta.version ?? spec,
      license: lic,
      copyright: copyrightOf(licText, notice),
      notice,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

const licensesUsed = [...new Set(deps.map((d) => d.license))].sort();
const apacheSample = deps.find((d) => d.license === 'Apache-2.0');
const mitSample = deps.find((d) => d.license === 'MIT');
const iscSample = deps.find((d) => d.license === 'ISC');

const out = [];
out.push(`# Third-Party Notices`);
out.push('');
out.push(`ReadGraph is distributed under the **MIT License** (see [LICENSE](./LICENSE)).`);
out.push(`This file lists the license information of its **runtime dependencies** ` +
  `(package.json \`dependencies\`, the packages bundled into the production build).`);
out.push(`Dev-only tools (\`devDependencies\`) are not part of the distributed artifact.`);
out.push('');
out.push(`Regenerate with: \`pnpm generate:notices\``);
out.push('');
out.push(`## Dependency Licenses`);
out.push('');
out.push(`| Package | Version | SPDX License | Copyright notice |`);
out.push(`|---|---|---|---|`);
for (const d of deps) {
  out.push(`| \`${d.name}\` | ${d.version} | ${d.license} | ${d.copyright.replaceAll('|', '\\|') || '—'} |`);
}
out.push('');

for (const d of deps.filter((x) => x.notice)) {
  out.push(`## NOTICE — ${d.name}`);
  out.push('');
  out.push('```text');
  out.push(d.notice.trim());
  out.push('```');
  out.push('');
}

const canonicalTexts = [
  ['Apache License 2.0', apacheSample ? canonicalLicenseText('Apache-2.0', join(root, 'node_modules', apacheSample.name)) : null],
  ['MIT License', mitSample ? canonicalLicenseText('MIT', join(root, 'node_modules', mitSample.name)) : null],
  ['ISC License', iscSample ? canonicalLicenseText('ISC', join(root, 'node_modules', iscSample.name)) : null],
];
for (const [title, text] of canonicalTexts) {
  if (!text) continue;
  out.push(`## ${title}`);
  out.push('');
  out.push('```text');
  out.push(text.trim());
  out.push('```');
  out.push('');
}

const target = join(root, 'THIRD_PARTY_NOTICES.md');
const content = out.join('\n');
const prev = existsSync(target) ? readFileSync(target, 'utf8') : '';
if (prev === content) {
  console.log(`unchanged: ${target} (${deps.length} deps)`);
} else {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(target, content);
  console.log(`written: ${target} (${deps.length} deps, licenses: ${licensesUsed.join(', ')})`);
}
