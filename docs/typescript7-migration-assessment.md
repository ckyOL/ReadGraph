# TypeScript 7.0 升级评估

> 评估日期: 2026-07-30　现版本: typescript 6.0.3 → 目标: 7.0.2
> 决策依据: [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) · [TS 6.0 发布说明](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/) · `tsconfig*.json`
> **状态: 已执行验证** — `pnpm build` / `test` / `lint` 全绿（2026-07-30）

---

## 0. 前置阻断：lockfile 与 manifest 不同步（已修复）

`pnpm install --frozen-lockfile` 此前**失败**：lockfile 的 specifier 是精确版本（如 `6.0.3`），manifest 是 `^6.0.3`，31 个依赖全部不匹配。系 commit `4be1aed`（恢复 `^` 范围）后未重新生成 lockfile 所致。

**已修复**（本次执行）：

```bash
pnpm install --no-frozen-lockfile   # 重生成 lockfile 使 specifier 对齐 ^ 范围
pnpm install --frozen-lockfile      # 验证通过
```

lockfile diff 仅 31 行 specifier 对齐，无 resolution 变化，不弱化任何供应链策略（实际版本仍由 lockfile 钉死）。

> pnpm 11 在 CI 环境默认 `frozen-lockfile=true`；普通 `pnpm install` 也会被当 frozen。重生成须显式 `--no-frozen-lockfile`。

## 1. 本仓 TS 用法面

| 维度 | 现状 | 来源 |
|------|------|------|
| 编译器版本 | 6.0.3 → **7.0.2**（已升） | `package.json` |
| 程序化 `import from 'typescript'` | **零命中** | 全仓 grep |
| tsconfig 体系 | `tsconfig.json` → `tsconfig.app.json` + `tsconfig.node.json`（project references，无 extends） | 根目录 |
| 已启用 TS6 新式约束 | `erasableSyntaxOnly: true`（禁 enum/namespace/构造器参数属性）、`verbatimModuleSyntax`、`moduleDetection: force` | `tsconfig.app.json` |
| 模块解析 | app=`bundler`，node=`nodenext` | tsconfig |
| 路径映射 | `paths` 无 `baseUrl`（TS6 允许的写法） | `tsconfig.app.json` |
| side-effect import | 仅 `import './index.css'`、`import './i18n'` | `src/main.tsx` |
| 模板字面量类型推断（`infer` in template literal） | **零命中** | 全仓 grep |

## 2. 工具链兼容性（TS7 无编译器 API 的影响）

TS7.0 **不发布程序化 API**（预计 7.1 补）。依赖 `import * as ts from 'typescript'` 的工具会坏。本仓工具链核查：

| 工具 | 是否程序化引用 typescript | TS7 兼容 |
|------|--------------------------|----------|
| `oxlint` | 否（Rust oxc 自带 TS 解析器，不依赖 typescript 包） | ✅ 实测通过 |
| `vite` | 否（esbuild/rolldown 转译，不调 TS API） | ✅ 实测通过 |
| `@vitejs/plugin-react` | 否（babel/rolldown） | ✅ 实测通过 |
| `vitest` | 否（走 vite/esbuild 转换） | ✅ 实测通过 |
| `tsc -b`（build 脚本） | 调 tsc **二进制**，非 API | ✅ 实测通过 |

**结论**：本仓无任何 TS 程序化 API 消费者，TS7「无 API」限制**不波及**。Volar/Vue/Angular 等需语言服务插件的工作流才受此限，本项目不涉及。

## 3. TS7 hard-error 废弃项 vs 本仓

TS7 把 TS6 废弃的配置/语法转为硬错误。逐项核对：

| 废弃项（TS7 硬错误） | 本仓 | 风险 |
|---------------------|------|------|
| `target: es5` | 用 `es2023` | 🟢 |
| `downlevelIteration` | 未设 | 🟢 |
| `moduleResolution: node/node10/classic` | 用 `bundler`/`nodenext` | 🟢 |
| `module: amd/umd/systemjs/none` | 用 `esnext`/`nodenext` | 🟢 |
| `baseUrl` | 未用（`paths` 相对项目根） | 🟢 |
| `esModuleInterop`/`allowSyntheticDefaultImports: false` | 未设（取默认 true） | 🟢 |
| `alwaysStrict: false` | 未设 | 🟢 |
| `module` 关键字声明命名空间 | 已被 `erasableSyntaxOnly` 禁用 | 🟢 |
| `asserts` 导入属性（须改 `with`） | 未用 `asserts` | 🟢 |
| `/// <reference no-default-lib />` | 未用 | 🟢 |

## 4. TS7 新默认值 vs 本仓（已实测）

| 新默认 | 本仓现状 | 影响 |
|--------|----------|------|
| `strict: true` | **未显式设 strict** | ✅ **已实测**：`tsc -b` 全绿，无 strict 新报错。代码本就按 strict 风格编写 |
| `noUncheckedSideEffectImports: true` | side-effect import 仅 `./index.css` | 🟢 `vite/client.d.ts` 已 `declare module '*.css' {}`，可解析 |
| `stableTypeOrdering: true`（不可关） | 未依赖类型排序 | 🟢 |
| `rootDir` 默认 `./` | `noEmit: true`，无输出结构影响 | 🟢 |
| `types` 默认 `[]` | 显式设 `["vite/client"]`/`["node"]` | 🟢 |
| `libReplacement: false` | 未用 lib 替换 | 🟢 |

## 5. 语言层 breaking changes vs 本仓

| 变更 | 本仓 | 风险 |
|------|------|------|
| 模板字面量类型按 Unicode 码点推断（`"😀"` 视为一单元，旧 UTF-16 拆代理对） | 无 `infer` in template literal 类型 | 🟢 |
| JS 文件支持重构（JSDoc `@enum`/`@class`/Closure 语法等不再特殊识别） | 纯 TS，无 `.js` 类型检查 | 🟢 |

## 6. 收益

TS7 为 Go 原生移植，全量构建 8–12x 提速、内存降 6–26%、语言服务首错时间从 ~17.5s 降至 <1.3s（官方数据）。本仓体量提速幅度有限，但 `tsc -b` 与编辑器响应仍有改善；CI 类型检查耗时下降对 AI 代理迭代循环友好。TS7 以平台二进制包形式分发（如 `@typescript/typescript-darwin-arm64`），安装时按平台拉取。

## 7. 执行记录（已完成）

```bash
pnpm install --no-frozen-lockfile     # 1. 修复 lockfile specifier 对齐
pnpm install --frozen-lockfile        #    验证
pnpm add -D typescript@^7.0.2         # 2. 升 TS7
pnpm install --frozen-lockfile        #    验证
pnpm build   # 3. tsc -b + vite build → ✅ 全绿
pnpm test    # 4. vitest → ✅ 22 文件 / 224 测试全绿
pnpm lint    # 5. oxlint → ✅ 仅既有 warning（fast-refresh only-export-components / control-regex），无 TS7 相关新问题
```

## 8. peer 依赖滞后（非阻断）

`pnpm peers check` 报：

- `i18next@26.3.4`、`react-i18next@17.0.8` 声明 peer `typescript: ^5 || ^6`，实际装 `7.0.2`。

此为上游 peer range 滞后，非硬约束。实测 `tsc -b` 与 `vitest` 均通过，证明 i18next 类型在 TS7 下兼容。无需处理；待上游放宽 peer range 即自然消失。

## 9. 结论

| 维度 | 评级 |
|------|------|
| 工具链兼容 | 🟢 无程序化 TS API 消费者，实测通过 |
| 废弃配置/语法 | 🟢 零命中 |
| 新默认值（strict 等） | 🟢 **已实测无报错** |
| 语言层 breaking | 🟢 零命中 |
| 供应链门控 | 🟢 7.0.2 发布 2026-07-08 > 7 天冷却 |
| 前置 lockfile | 🟢 已修复 |
| peer 滞后 | 🟢 非阻断，实测兼容 |

**结论**：TS7 升级**已完成验证**，无结构性阻断。`package.json` `typescript ^6.0.3 → ^7.0.2`，lockfile 同步更新。

> 编辑器注意：VS Code 需安装 [TypeScript 7 扩展](https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview)或等内置 TS7 支持；不影响 CLI 构建与 CI。