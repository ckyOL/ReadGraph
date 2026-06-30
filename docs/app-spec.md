# ReadGraph 应用规格说明书骨架 (App Spec)

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
| i18n | react-i18next | 待规格阶段锁定 | 浏览器语言检测 + 动态加载 |
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
| 新包冷却期 7 天 | `.npmrc: min-release-age=7d` | ⚠️ **pnpm 不支持此设置**（npm v11.16+ 专属）;需补偿控制，见下方「冷却期补偿」 | ⚠️ 见下 |
| 禁止幽灵依赖 | 约定 + 人工审查 | ✅ **pnpm 默认严格依赖隔离**，未在 `dependencies` 声明的包无法被 import，天然满足 §5.1#4 | ✅ 增益 |
| 禁止 `--force` / `--legacy-peer-deps` | 规范禁止 | pnpm 对应禁止 `--force` / `--shamefully-hoist`（后者会破坏隔离性，禁止使用） | ✅ 等价 |

### 冷却期补偿控制（pnpm `min-release-age` 缺失）

由于 pnpm 不解析 `min-release-age`，冷却期由下列组合控制兜底，**均需在 PR 审查中被发现**：

1. **PR 审查清单**：新增/升级依赖时，审查者按 [npm-supply-chain-security §4.1](./npm-supply-chain-security.md#41-添加新依赖-安全审查清单) 核验「最新版本发布时间是否超过 7 天」，未满则在 PR 中拒绝;审查时可查 `pnpm view <pkg> time` 或注册表页面。
2. **自动化兜底**：在依赖更新机器人（Renovate / Dependabot）配置 `minimumReleaseAge: 7 days`，使自动 PR 不会在包发布 7 天内提出升级。
3. **保留 `.npmrc: min-release-age=7d`**：对 pnpm 是 no-op，但保留以兼容 npm 回退场景且不弱化既有规范;**不得删除该行**。

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
4. **`security:check` 脚本**：补一键自检脚本（对照安全规范附录 A），`min-release-age` 在 pnpm 下为 no-op，脚本仅告警不阻断。

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
3. **UI 导航规格** — TanStack Router 路由树、各功能页布局与空状态设计、主题与国际化骨架。
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

预期输出：`ignore-scripts`/`save-exact`/`audit`/`strict-ssl` 均为 true，registry 指向 npm 官方。（`min-release-age` 在 pnpm 下为 no-op，冷却期由 §5 补偿控制兜底，自检脚本对此项仅做告警不阻断。）
