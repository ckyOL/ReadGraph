
> 本文档是 ReadGraph 的「活规格」骨架，遵循 SDD + TDD 工作流（见 [ai-agent-workflow-rules](./ai-agent-workflow-rules.md)）。任何功能落地前，先补齐本规格对应章节；未经规格覆盖的业务实现代码不予合入。

## 0. 关联文档

| 主题 | 文档 |
|------|------|
| 数据模型 | [README](../README.md) + [docs/metadata](./metadata) |
| 设计决策与约束 | [design-decisions](./design-decisions.md) |
| 供应链安全 | [npm-supply-chain-security](./npm-supply-chain-security.md)（pnpm 等价映射见 §5） |
| AI Agent 工作流 | [ai-agent-workflow-rules](./ai-agent-workflow-rules.md) |
| React 性能规则 | `build-web-apps:react-best-practices` 技能（写/审 React 代码时引用，见 §6） |

## 1. 产品定位与范围

ReadGraph 是一个**纯前端**的个人阅读智能档案系统。用户从个人来源（公共图书馆 OPAC 导出、Libby 等电子借阅平台）获取借阅/归还数据（JSON/CSV），导入后生成个性化阅读画像与可视化分析。无后端、无联网数据上传、可静态部署与离线使用。

### 1.1 初始版本范围

| 模块 | 是否在建 | 说明 |
|------|---------|------|
| 项目骨架（可构建、可导入、可跑通） | ✅ 本里程碑 | 仅工程骨架与空应用入口 |
| 数据层（Dexie + Zod schema） | ⏳ 待规格 | 实现 internal-schema |
| 导入管线（Parser + 纯函数 pipeline） | ⏳ 待规格 | 见 import-workflow |
| 阅读画像与图表 | ⏳ 待规格 | ECharts 统计视图 |
| 设置与系统重置 | ⏳ 待规格 | 见 internal-schema#系统重置 |

### 1.2 非目标

- 不做后端服务、用户登录、云同步（纯前端/i18n 离线）
- 不做按 ImportLog 撤销单次导入（仅支持整体重置）
- 不在 v1 集成本地 AI（预留扩展位，见 design-decisions 未来扩展）
- 不引入 TanStack Start / Remix / Next.js 等带服务端运行时的「全栈框架」——与纯前端约束冲突（见 §5.2）

## 2. 技术栈与版本基线

> 严格遵循 [npm-supply-chain-security](./npm-supply-chain-security.md)：精确版本号、禁止 `^`/`*`、依赖最小化、通过冷却期审查后引入。本表中的版本号需在引入前使用「新依赖安全审查清单」核验；确切版本在 §5 三表中已锁定或标注「安装时核验」。

| 类别 | 选型 | 来源 / 引入节点 | 备注 |
|------|------|----------------|------|
| 构建与脚手架基底 | Vite + React 19 + TypeScript | Vite 官方 `react-ts` 模板生成（§5.1） | 模板默认 React 19 + TS + Vite 8 |
| 包管理器 | pnpm | 本里程碑锁定（§5） | 严格依赖隔离，杜绝幽灵依赖 |
| 静态检查（Lint） | Oxlint | `react-ts` 模板自带 `.oxlintrc.json` | 单包零依赖，替代 ESLint，减少依赖面 |
| 单元测试 | Vitest | **模板不含，本里程碑单独 `pnpm add -D`**（§5.1 脚手架后续步骤） | 与 Vite 原生集成 |
| 类型检查 | TypeScript | 模板自带 tsc project refs 配置 | `pnpm build` 含 `tsc -b` |
| Lockfile 校验 | lockfile-lint | 本里程碑引入 | CI 脚步（pnpm-lock.yaml 适配见 §5） |
| 路由 | TanStack Router + `@tanstack/router-plugin`（Vite 插件，文件路由 + 类型安全 codegen） | 待规格阶段引入（§5.2 公式 = 既有 Vite 工程接入官方插件） | 仅用路由库 + Vite 插件，**不用** TanStack Start 服务端运行时 |
| 状态管理 | Zustand | 待规格阶段锁定 | 最小 boilerplate |
| 本地数据库 | Dexie.js + dexie-react-hooks | 待规格阶段锁定 | 响应式 IndexedDB |
| 数据校验 | Zod | 待规格阶段锁定 | Schema 优先 |
| UI 组件 | shadcn/ui（Radix UI 底层），经 `shadcn` CLI 生成源码到本地 | 待规格阶段引入（§5.2 公式 = `shadcn init` + 按需 `shadcn add <component>`） | 代码落盘本地，可控；每个组件仅带入其自身依赖，逐件审查 |
| 样式 | Tailwind CSS v4（`@tailwindcss/vite`） | 与 shadcn 同步引入 | shadcn 依赖 Tailwind v4 |
| 图表 | ECharts | 待规格阶段锁定 | 离线渲染、中文友好 |
| CSV 解析 | Papa Parse | 待规格阶段锁定 | 流式、大文件友好 |
| 日期 | date-fns | 待规格阶段锁定 | 纯函数式、tree-shakable |
| i18n | react-i18next | ✅ 已锁定 | 浏览器语言检测 + 动态加载；已锁 `i18next@26.3.4` / `react-i18next@17.0.8`，`packageManager` 锁 `pnpm@11.9.0`，`engines.npm` 锁 `>=11.16.0` |
| l10n | 原生 Intl API | 内置 | 数字/货币/排序零依赖 |
| E2E 测试 | Playwright | 待规格阶段引入 | 覆盖导入与图表关键路径 |

## 3. 目录结构

```
ReadGraph/
├─ docs/                     # 规格、设计、数据模型文档（本目录）
├─ src/
│  ├─ app/                   # 应用入口、Provider、路由树（后续）
│  ├─ components/            # shadcn/ui 落盘组件（shadcn add 生成）+ 本地组件（后续）
│  ├─ features/              # 功能切片：import、library、reading-profile、settings（后续）
│  ├─ routes/                # TanStack Router 文件路由（后续，router-plugin codegen）
│  ├─ db/                    # Dexie schema、Repository（后续）
│  ├─ parsers/               # 各来源 Parser 实现（后续）
│  ├─ lib/                   # 通用纯函数：去重、归一化、日期、ISBN（后续）
│  ├─ types/                 # 跨层共享 TypeScript 类型（后续）
│  ├─ App.tsx                # 根组件（react-ts 模板生成，去范本化）
│  ├─ main.tsx               # Vite 入口（react-ts 模板生成）
│  └─ styles.css             # Tailwind 入口与全局样式（后续）
├─ tests/                    # Vitest 单测与夹具（后续）
├─ e2e/                      # Playwright E2E（后续）
├─ public/                   # 静态资源（本地字体/图标，不联网）
├─ .npmrc                    # pnpm/npm 通用安全加固（已就绪，勿改）
├─ .gitignore                # 含 node_modules / dist / .env
├─ .env.example              # 仅占位，不含真实令牌
├─ .oxlintrc.json            # oxlint 规则（react-ts 模板生成，勿弱化）
├─ index.html
├─ package.json
├─ pnpm-lock.yaml            # 必须提交、CI 用 pnpm install --frozen-lockfile
├─ tsconfig.json / tsconfig.app.json / tsconfig.node.json
├─ vite.config.ts
├─ vitest.config.ts          # 本里程碑新增（模板不含）
└─ README.md
```

## 4. 构建与脚本契约

```bash
# 安装（CI 必须使用 frozen-lockfile 管线）
pnpm install --frozen-lockfile

# 开发服务器
pnpm dev

# 类型检查 + 构建
pnpm build

# 预览生产构建
pnpm preview

# 静态检查（Oxlint，模板自带）
pnpm lint

# 单元测试
pnpm test

# Lockfile 完整性校验
pnpm lockfile-lint

# 安全审计
pnpm audit --audit-level=high
```

> `pnpm` 脚本不得在 CI 中不带 `--frozen-lockfile` 调用 `pnpm install`;CI 管线只允许 `pnpm install --frozen-lockfile`。

## 5. 安全基线（强制）

本仓库根 `.npmrc` 仍是 pnpm 与 npm 共用的配置入口。下表把 [npm-supply-chain-security §2.1](./npm-supply-chain-security.md#21-项目级-npmrc) 的强制项逐一映射到 pnpm 的等价机制，并标注 pnpm 的增益与差异。任何人或 AI 代理**不得**弱化下列任何一条：

| 安全规范项 | npm 机制 | pnpm 等价 / 差异 | 状态 |
|-----------|---------|----------------|------|
| 禁止安装脚本 | `.npmrc: ignore-scripts=true` | pnpm 同样读取 `.npmrc`，对应 `pnpm install --ignore-scripts`（已由 `.npmrc` 默认开启） | ✅ 一致 |
| 精确版本锁定 | `.npmrc: save-exact=true` | pnpm 尊重 `save-exact`，`pnpm add` 写入精确版本号 | ✅ 一致 |
| 仅官方注册表 | `.npmrc: registry=https://registry.npmjs.org/` | pnpm 共用此 registry 配置 | ✅ 一致 |
| 强制 HTTPS | `.npmrc: strict-ssl=true` | pnpm 尊重 `strict-ssl` | ✅ 一致 |
| 安全审计 | `.npmrc: audit=true`/`audit-level=high` | `pnpm audit --audit-level=high`（CI 显式调用） | ✅ 一致 |
| Lockfile 提交与审查 | `package-lock.json` + `npm ci` | `pnpm-lock.yaml` 提交;CI 用 `pnpm install --frozen-lockfile`;`lockfile-lint` 需用 `--path pnpm-lock.yaml --type pnpm` 适配 | ✅ 等价 |
| 新包冷却期 7 天 | `.npmrc: min-release-age=7d` | ✅ **pnpm 11.7+ 已支持** `minimumReleaseAge`（安装时由供应链策略验证器执行，见 `pnpm install` 输出），并会把逾期新包列入 `pnpm-workspace.yaml: minimumReleaseAgeExclude` 以备协调。npm v11.16+ 与 pnpm 11.7+ 行为等价 | ✅ 一致 |
| 禁止幽灵依赖 | 约定 + 人工审查 | ✅ **pnpm 默认严格依赖隔离**，未在 `dependencies` 声明的包无法被 import，天然满足 §5.1#4 | ✅ 增益 |
| 禁止 `--force` / `--legacy-peer-deps` | 规范禁止 | pnpm 对应禁止 `--force` / `--shamefully-hoist`（后者会破坏隔离性，禁止使用） | ✅ 等价 |

### 冷却期补偿控制（pnpm `min-release-age` 已支持，下列为双保险）

pnpm 11.7+ 已通过 `minimumReleaseAge` 与 `pnpm-workspace.yaml` 执行冷却期；下列仍作为双保险，确保跨旧版 pnpm 或在 `minimumReleaseAgeStrict` 未开启时不漏：

1. **PR 审查清单**：新增/升级依赖时，审查者按 [npm-supply-chain-security §4.1](./npm-supply-chain-security.md#41-添加新依赖-安全审查清单) 核验「最新版本发布时间是否超过 7 天」，未满则在 PR 中拒绝;审查时可查 `pnpm view <pkg> time` 或注册表页面。
2. **自动化兜底**：在依赖更新机器人（Renovate / Dependabot）配置 `minimumReleaseAge: 7 days`，使自动 PR 不会在包发布 7 天内提出升级。
3. **保留 `.npmrc: min-release-age=7d`**：pnpm 11.7+ 与 npm v11.16+ 均解析此设置;**不得删除该行**。

以下红线任何一条被弱化即视为安全事件：

- `ignore-scripts=true`
- `save-exact=true`
- `registry=https://registry.npmjs.org/` + `strict-ssl=true`
- `pnpm-lock.yaml` 必须提交并审查 diff
- 新依赖必须按 §4.1 走「新依赖安全审查清单」并在 PR 中归档结论
- 不允许 `^` / `*` 版本范围;不允许 `--force` / `--legacy-peer-deps` / `--shamefully-hoist`

### 5.1 脚手架基底：Vite 官方 `react-ts` 模板

项目基底由 Vite 官方模板生成，确保依赖集最小且经社区核验。已实测 `pnpm create vite . --template react-ts --no-immediate` 的产物，结论如下（截至 2026-06 实测）。

**生成命令**：

```bash
# 在仓库根目录用 pnpm 调用 create-vite，react-ts 模板（React 19 + TS + Vite）
# 用 `.` 表示在当前目录生成;--no-immediate 避免脚手架立即自动安装（要由本仓库的 .npmrc 接管安装）
pnpm create vite . --template react-ts --no-immediate
# 随后按本仓库安全配置安装
pnpm install --ignore-scripts
```

**模板实测产物**（用于让脚手架阶段可复核、可去范本化）：

| 产物 | 说明 | 处置 |
|------|------|------|
| `package.json` | `react`/`react-dom` `^19.2.7`、`@vitejs/plugin-react ^6.0.2`、`typescript ~6.0.2`、`vite ^8.1.0`、`oxlint ^1.x`、`@types/* ^x` | ⚠️ 全为 caret/`~`;**安装前必须全部改为精确版本**（结合 `save-exact=true`，`pnpm add -D` 会自动写精确号） |
| `tsconfig.json` + `tsconfig.app.json` + `tsconfig.node.json` | project references、`moduleResolution: bundler`、`verbatimModuleSyntax`、`moduleDetection: force`、`erasableSyntaxOnly`、`noUnusedLocals/Parameters` | ✅ 直接沿用;按本目录结构补 `src` include 与别名 |
| `vite.config.ts` | 仅 `@vitejs/plugin-react` | ✅ 沿用;后续在此追加 `@tailwindcss/vite` 与 `@tanstack/router-plugin` |
| `index.html` | `lang="en"`、含 `/favicon.svg`、示例标题 | 改 `lang="zh-CN"`、标题改 "ReadGraph"、按需替换 favicon |
| `src/App.tsx` + `src/App.css` + `src/index.css` + `src/assets/*` | Vite 默认欢迎页范本（hero/social 图 + 计数器 CSS） | **全部删除**，替为最小 `App` 壳与本项目样式入口 |
| `public/*` | Vite 默认静态资源（`favicon.svg`、`icons.svg` 等） | 按需保留或替换为本地资产;不联网加载字体/图标 |
| `.oxlintrc.json` | 启用 `react`/`typescript`/`oxc` 插件，`react/rules-of-hooks=error`、`react/only-export-components=warn` | ✅ 沿用，作为 lint 基线，禁止弱化 hooks 规则 |
| `.gitignore` | 含 `node_modules` `dist` `dist-ssr` `*.local` 等 | 与仓库现有 `.gitignore` **合并**（仓库现有缺 `node_modules`/`dist`，本次补齐），不覆盖既有 Python/IDE 规则 |
| `src/main.tsx` | `StrictMode` + `createRoot` + `import './index.css'` | ✅ 沿用，改为导入本项目样式入口 |

**模板不含但本里程碑需补的项**：

1. **Vitest**：模板无测试配置。需 `pnpm add -D vitest`（精确版本，经 §5 冷却期审查后），新增 `vitest.config.ts`，并补脚本 `test`/`test:watch`。
2. **lockfile-lint**：模板无该 devDep。需 `pnpm add -D lockfile-lint`，并在 CI 校验脚本里使用 `--path pnpm-lock.yaml --type pnpm`。
3. **`engines`/`engineStrict`**：模板 `package.json` 无。按 [npm-supply-chain-security §2.2] 补 `node>=20`、`npm>=10`（pnpm 行为不受 `engineStrict` 强制，但供审查与 Renovate 读取）。
4. **`security:check` 脚本**：补一键自检脚本（对照安全规范附录 A）;冷却期在 pnpm 11.7+ 下由安装期策略强制，脚本该项仅作配置存在性核对。

**关于 `react-compiler-ts` 模板**：若后续确定启用 React Compiler（见 design-decisions 技术选型），可改用此模板;本里程碑不启用，以减小首次依赖面。

**模板选择理由**（调研结论）：

- 优先采用 Vite 官方 `react-ts`（最小、Oxlint、无路由/无 UI/无样式），而非社区「一站式」模板（Tailwind+shadcn+auth 等）——后者往往批量带入未审依赖、使用 caret 范围、引入与服务端/部署耦合的脚本，与 [npm-supply-chain-security] 的「逐依赖审查、最小依赖」原则冲突。
- Tailwind/shadcn/TanStack 等按需在既有 Vite 工程上通过官方 CLI/插件增量接入（见 §5.2），每次只引入被使用到的部分，便于逐件审查与精确锁定版本。

### 5.2 增量接入：UI / 路由（待规格阶段执行，本里程碑不执行）

为减少 AI 手写样板，且不偏离安全基线，UI 与路由层采用「先有 Vite 工程，再接官方工具」的公式，替代一体化大模板：

| 层 | 公式 | 引入的依赖（最小集，待锁定） | 安全约束 |
|----|------|--------------------------|---------|
| 样式（Tailwind v4） | `pnpm add -D tailwindcss @tailwindcss/vite` + 在 `vite.config.ts` 加插件 + CSS `@import "tailwindcss";` | `tailwindcss`、`@tailwindcss/vite` | 精确版本;逐件走 §5 冷却期审查;与 shadcn 同批接入 |
| UI 组件（shadcn/ui） | `pnpm dlx shadcn@latest init` 初始化（生成 `components.json`、`lib/utils`、Tailwind 变量），随后 `shadcn add <component>` **按需**逐件把组件源码落到 `src/components/ui/` | 每个 `shadcn add` 仅带入该组件自身依赖（典型：`clsx`、`tailwind-merge`、`class-variance-authority`、`lucide-react`、对应 `@radix-ui/react-*`） | 源码落本地可控;每次 `add` 都是一次「新依赖引入」事件，必须跑 §5 安全审查清单并在 PR 说明中归档;`shadcn` 写入的 caret 范围需即时归零为精确版本，再 `pnpm install --frozen-lockfile` |
| 路由（TanStack Router） | `pnpm add @tanstack/react-router` + `pnpm add -D @tanstack/router-plugin`（Vite 插件，文件路由 + 类型安全 codegen） | `@tanstack/react-router`、`@tanstack/router-plugin` | **仅用路由库 + Vite 插件**;禁用 `@tanstack/react-start` 等带服务端运行时的产物（与纯前端约束冲突，见 §1.2） |

接入顺序建议：先 Tailwind（v4）→ 再 `shadcn init` → 再按页面实际需要 `shadcn add <component>` → 最后接 TanStack Router 插件。任一步执行前先在规格中明确「本步要落到哪些文件、加入哪些依赖」，避免边装边改。

## 6. 待补规格清单（验收门槛）

在进入第一个功能里程碑前，下列章节必须由具体规格填充，再进入「Tests(Red) → Code → Tests(Green)」循环：

1. **数据层规格** — Dexie schema、Repository 接口、迁移策略、索引定义（对照 internal-schema）。
2. **导入管线规格** — Parser 注册表、纯函数 pipeline 签名、去重算法、时间转换契约、错误与警告模型（对照 import-workflow / source.md）。
3. **UI 导航规格** — 已补，见 §8（路由树、各页布局与空状态、主题/i18n 骨架、用户故事、数据契约、测试清单）。
4. **阅读画像与图表规格** — 统计维度、ECharts 配置基线、空数据/大文件退化策略。
5. **设置与系统重置规格** — 偏好持久化、重置的原子性与确认流程、备份导出与重建模式对照。

每个功能阶段开始前，上述对应章节需包含：
- 用户故事与验收用例
- UI 设计说明（布局/交互/状态/响应式）
- 数据契约与边界情况
- 对应的 Vitest/Playwright 测试清单
- 涉及 React 性能的，引用 `build-web-apps:react-best-practices` 规则 id（如本地偏好落 localStorage 用 `client-localstorage-schema`、shadcn 组件按需 import 避免 barrel 用 `bundle-barrel-imports`）。

## 7. 校验命令速查

```bash
# 一键安全配置自检（对照安全规范附录 A）
pnpm security:check
```

预期输出：`ignore-scripts`/`save-exact`/`audit`/`strict-ssl`/`registry` 均为预期值;`min-release-age` 在 pnpm 11.7+ 与 npm v11.16+ 下均生效（见 §5）。

## 8. UI 导航规格

> 本节为 [§6 待补规格清单] 第 3 项「UI 导航规格」的填充结果，遵循 SDD + TDD。落地前先补本节，再进 Tests(Red) → Code → Tests(Green)。

### 8.1 设计方向与气质

- **主壳（全站导航、书库、时间线、导入、设置）= 方向 A「编目终端」**：左侧窄导航 + 主区表格主导，密实、可排序可筛选，像图书馆 OPAC 检索台。
- **阅读画像页（/profile）= 方向 B「阅读图谱」**：图表是主角，全幅图谱语言，ECharts 数据色只在图谱发力。
- **视觉基线**（方向锚定，具体令牌由 `shadcn init` 落 CSS 变量）：
  - 色彩：中性墨黑/纸白奠定底色，**单一克制强调色**（深茶青方向，具体由 shadcn `--primary` 令牌定）；分类号芯片（`Badge`）用强调色或语义色。
  - 暗色模式：暖黑底 + 暖白文字，不取全黑冷黑单色调；见 8.4。
  - 等宽呈现：`metaId`、`barcode`、分类号 `code`、ISBN 一律走等宽字（本地打包字体，见 design-decisions 安全与隐私），像「编目卡」标签条。
  - 分类法芯片：CLC/DDC 分类号是一等视觉元素（本项目核心心智模型：物理副本 × 书目合并 × 多分类法）。
  - 禁单色主导：勿让界面读成单一色族（尤其避开米/沙、纯灰一统）。
- **取向护栏**：A 面密实、可扫读、界面克制工作向；C（阅读手帐）的「温度感」仅作为书目详情的卷卡式细节吸收，不进主架构。

### 8.2 路由树（TanStack Router，文件路由 + 类型安全 codegen）

仅用 `@tanstack/react-router` + `@tanstack/router-plugin`（Vite 插件）。**禁用** `@tanstack/react-start` 等带服务端运行时（见 §1.2、§5.2）。

```
src/routes/
  __root.tsx              AppShell：Sidebar + Outlet + 主题/locale/DB Provider
  index.tsx               Dashboard 概览（/）
  library/
    index.tsx             书库列表（/library）
    $bookId.tsx           书目详情（/library/$bookId）
  timeline.tsx            借阅时间线脊柱（/timeline）
  import.tsx              导入向导（/import）：来源→预览→执行→报告
  profile.tsx             阅读画像（/profile）：图表主导（方向 B）
  settings.tsx            设置（/settings）：主题/locale/时区/系统重置
```

- 文件路由由 `@tanstack/router-plugin` codegen 出 `routeTree.gen.ts`；**禁止手动编辑生成文件**。
- 路由参数静态类型化（`$bookId` 为 `z.string()` 校验的 loader 入参）。
- 布局路由 `__root.tsx` 承载 AppShell 与全局 Provider；按 `bundle-barrel-imports` 规则避免 barrel，组件按需 import。

### 8.3 各功能页布局与空状态

交互通用：表头可排序/筛选，行/详情走 `Sheet`/`Dialog`（移动端 `Drawer`），无破坏性无二次确认不变更。空态统一用 shadcn `Empty` 组件（见 SKILL `composition.md`），不写自定义空态标记。

1. **Dashboard（/）**：概览统计卡片（藏书数 / 借阅周期数 / 在借数 / 最近导入）+ 最近借阅列表 + 快速入口（导入 / 书库）。
   - 空态：`Empty` + 首次导入引导（按钮跳 `/import`）。
2. **书库（/library）**：`Table` 密实列表，列含书名、作者、ISBN13、来源徽标（`Badge`）、分类号芯片、借阅次数；可搜索/筛选/排序。
   - 书目详情（/library/$bookId）：卷卡式（方向 A），`Card` 容器展示书目元数据 + 该 Book 的各 `CatalogRecord`（来源、`metaId`、`barcodes`、`classifications`）+ `BorrowCycle` 时间线小图。
   - 空态：无 Book 时 `Empty` + 导入引导。
3. **时间线（/timeline）**：横向时间轴脊柱，按 `borrowedAt` 排列所有 `BorrowCycle`；借中（`status='borrowed'`）以不同强调态区分。可按来源/状态筛选。
   - 空态：无周期 `Empty`。
4. **导入（/import）**：多步向导（来源选择/创建 → 文件选择与编码检测 → 前 10 条预览与字段映射 → 执行 → 导入报告）。报告显示统计与 `ParseWarning` 列表。
   - 每步可回退；来源选择支持从预置模板（source.md `SOURCE_TEMPLATES`）挑选。
   - 空态：无来源时引导从模板创建。
5. **阅读画像（/profile）**：方向 B，图表主导、全幅。ECharts（thin adapter，见 design-decisions 图表选型）渲染：
   - 分类法分布 treemap（CLC/DDC，取 Source 配置的默认分类体系）。
   - 借阅甘特带（同条码多次借阅 / 同书多次借阅的周期叠放）。
   - 按月/按年借阅量柱图、借阅时长分布。
   - 空态：无数据 `Empty`，图表区隐去占位，给出导入入口。
6. **设置（/settings）**：
   - 偏好：主题（light/dark/auto）、`locale`（zh-CN/en）、`displayTimezone`。
   - 数据：导出备份（全量 ExportData，rawRecords 必导）、系统重置（见 internal-schema 系统重置：原子单事务清空 + 强制备份/二次确认 `AlertDialog`，不可单次撤销）。
   - 来源管理：列出 / 编辑 / 新建 `Source`。

### 8.4 主题与暗色模式骨架

- shadcn CSS 变量 + Tailwind v4（`@theme inline`）；暗色用 class 策略（根 `<html class="dark">`），不取 `prefers-color-scheme` 唯一驱动，`auto` 模式监听系统并应用 class。
- 主题令牌用语义色（`bg-background`/`text-foreground`/`text-muted-foreground` 等），**禁手写 `dark:` 覆盖**（见 shadcn `styling.md`）。
- 偏好落 `localStorage` key `readgraph:preferences`，读写走 schema 校验（引用 `client-localstorage-schema` 规则，Zod 校验 `UserPreferences`）。
- ECharts 主题：thin adapter（`src/lib/echarts-theme.ts`）把 shadcn `--chart-1..5` 等变量映射为 echarts palette + 坐标轴/tooltip 样式，随 `.dark` 切换重建主题。

### 8.5 国际化与本地化骨架（zh-CN / en 双语）

- **落地状态（2026-07-01）**: ✅ 骨架已落地 — `src/i18n/`、`src/lib/locale.ts`、`src/hooks/use-locale.ts` 在用；双语 bundle + 命名空间 `common`/`nav`/`pages`，`fallbackLng: 'zh-CN'`，`<html lang>` 随切换同步。规则权威见 [docs/i18n-conventions.md](i18n-conventions.md)；单元测试覆盖 §8.8 的 locale 校验项（`src/lib/locale.test.ts`、`src/i18n/i18n.test.ts`、`src/hooks/use-locale.test.tsx`）。theme Provider 仍待数据层里程碑。
- 范围：本期仅 `zh-CN` 与 `en`。`zh-TW` **不预留枚举**（见 internal-schema `UserPreferences.locale` 收窄说明），日后加回需补翻译 bundle 并恢复枚举。
- 方案：`react-i18next`，命名空间按路由/功能拆分，浏览器语言检测 + 动态加载（按需 chunk）。
- l10n：数字/货币/排序用原生 `Intl`；日期用 `date-fns` + locale 包；时间显示见 8.6 契约。
- `index.html` `lang` 随当前 locale 切换（默认 `zh-CN`），无网络字体/图标（本地资产，见 design-decisions 安全与隐私）。

### 8.6 数据契约与边界（纯前端、IndexedDB、UTC 存储）

- 全部数据在浏览器（Dexie 封装 IndexedDB，库名 `readgraph`），无网络、无后端、无数据上传（§1 纯前端约束）。
- UI 层经 Repository（Dexie + `dexie-react-hooks` 响应式）读实体；本规格不定义 Repository 接口细节（属「数据层规格」§6 #1），仅约定 UI 侧契约：
  - 时间全部以 **UTC 存储**，UI 显示按 `UserPreferences.displayTimezone` 转；导入详情页可切回 `source.timezone` 比对（design-decisions §2 UTC 原则）。
  - 实体关系按 metadata：`Book ←(bookId)→ CatalogRecord →(N) BorrowCycle`；`Source` 为入口。分类统计优先取 `Source.classificationSystem` 默认体系。
  - 去重结果在导入阶段已落库；UI 不重算去重，只呈现（CGColor 芯片、来源徽标、条码等）。
  - 系统重置为「全有或全无」单事务清空（internal-schema 系统重置），UI 不提供单次导入撤销。
- 边界：
  - 空库首次进入：Dashboard/书库/时间线/画像均 `Empty` + 导入入口。
  - 大文件（≥50MB，import-workflow 通用约束）：预览限前 10 条，导入执行在 Web Worker（design-decisions 并发与性能），UI 显示 `Progress`/`Spinner`，不阻塞导航。
  - 离线可用：所有静态资产本地打包，PWA 预留（v1 不强求）。

### 8.7 用户故事（验收用例节选）

- 作为新用户，首次打开空库 → 在 Dashboard 看到引导，一键进入导入向导，从模板创建「深圳图书馆」来源并完成一次导入，看到 Books/周期 入库。
- 作为用户，在书库按分类号筛选、按借阅次数排序，点开某 Book 看 CatalogRecord 与借阅时间线。
- 作为用户，在时间线按来源筛选，查看当前在借（status='borrowed'）。
- 作为用户，在阅读画像看到分类法 treemap 与借阅甘特带，空数据时见导入入口。
- 作为用户，在设置切暗色、切中英，刷新后偏好保留。
- 作为用户，导出备份后清空系统，确认不可撤销，重置后库为空。

### 8.8 测试清单（Vitest / Playwright）

**Vitest（单元/集成）**
- AppShell 渲染与路由树懒加载（mock routeTree）。
- ✅ locale Provider：读写 `readgraph:preferences`，Zod 同义校验非法值降级（已落地，见 `src/lib/locale.test.ts`、`src/hooks/use-locale.test.tsx`、`src/i18n/i18n.test.ts`）。theme Provider 待数据层里程碑。
- 日期/时区纯函数：UTC ↔ `displayTimezone`、`source.timezone` 转换（对照 design-decisions §2）。
- 分类号芯片渲染：CLC/DDC code 与 category 映射。
-σότεEmpty 状态在各页分支渲染正确。

**Playwright（E2E）**
- 侧栏导航：六页跳转、当前项高亮、移动端折叠展开。
- 暗色切换持久：切换后 reload 仍为暗色。
- locale 切换：中英文本切换且 `html[lang]` 更新。
- 空态 → 导入：空 Dashboard 点导入入口到 `/import`。
- 导入向导关键路径：模板建来源 → 选文件 → 预览 → 执行 → 报告 → 落库 → 书库可见（用脱敏夹具）。
- 阅读画像：ECharts canvas 非空像素（脱敏数据下）。
- 系统重置：导出后确认流程完成，重置后空库。

### 8.9 React 性能规则引用

- `client-localstorage-schema`：`readgraph:preferences` 读写做 Zod schema 校验，避免脏值。
- `bundle-barrel-imports`：shadcn 组件与路由按需 import，避免 barrel 拉宽依赖/体积。
- 大文件导入下放 Web Worker（design-decisions 并发与性能），主线程不阻塞导航。
