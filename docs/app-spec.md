# ReadGraph 应用规格

> 本文档是 ReadGraph 的「活规格」骨架，遵循 SDD + TDD 工作流（见 [ai-agent-workflow-rules](./ai-agent-workflow-rules.md)）。任何功能落地前，先补齐对应规格章节；未经规格覆盖的业务实现代码不予合入。
> 功能规格已拆分至 [docs/specs/](./specs/) 目录，见下方索引。

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

| 模块 | 状态 | 规格 |
|------|------|------|
| 项目骨架（可构建、可导入、可跑通） | ✅ 已落地 | 仅工程骨架与空应用入口 |
| 数据层（Dexie + Zod schema） | ✅ 已补规格 | [specs/data-layer.md](./specs/data-layer.md) |
| 导入管线（Parser + 纯函数 pipeline） | ✅ 已补规格 | [specs/import-pipeline.md](./specs/import-pipeline.md) |
| UI 导航规格 | ✅ 已补规格 | [specs/ui-navigation.md](./specs/ui-navigation.md) |
| 阅读画像与图表 | ✅ 已补规格 | [specs/reading-profile.md](./specs/reading-profile.md) |
| 设置与系统重置 | ✅ 已补规格 | [specs/settings.md](./specs/settings.md) |

### 1.2 非目标

- 不做后端服务、用户登录、云同步（纯前端/i18n 离线）
- 不做按 ImportLog 撤销单次导入（仅支持整体重置）
- 不在 v1 集成本地 AI（预留扩展位，见 design-decisions 未来扩展）
- 不引入 TanStack Start / Remix / Next.js 等带服务端运行时的「全栈框架」——与纯前端约束冲突（见 §5.2）

## 2. 技术栈与版本基线

> 严格遵循 [npm-supply-chain-security](./npm-supply-chain-security.md)：依赖最小化、新增走 §3「新依赖安全审查清单」+ 7 天冷却（`minimumReleaseAge`）;版本范围 `^` 可用（由 `pnpm-lock.yaml` frozen 提交 + 冷却兜底）。本表版本在 §5 三表中锁定或标注「安装时核验」。

| 类别 | 选型 | 来源 / 引入节点 | 备注 |
|------|------|----------------|------|
| 构建与脚手架基底 | Vite + React 19 + TypeScript | Vite 官方 `react-ts` 模板生成（§5.1） | 模板默认 React 19 + TS + Vite 8 |
| 包管理器 | pnpm | 本里程碑锁定（§5） | 严格依赖隔离，杜绝幽灵依赖 |
| 静态检查（Lint） | Oxlint | `react-ts` 模板自带 `.oxlintrc.json` | 单包零依赖，替代 ESLint，减少依赖面 |
| 单元测试 | Vitest | **模板不含，本里程碑单独 `pnpm add -D`**（§5.1） | 与 Vite 原生集成 |
| 类型检查 | TypeScript | 模板自带 tsc project refs 配置 | `pnpm build` 含 `tsc -b` |
| Lockfile 校验 | `pnpm verify`（frozen 安装内建供应链复校验） | 本里程碑引入（§5 见)） |
| 路由 | TanStack Router + `@tanstack/router-plugin`（Vite 插件，文件路由 + 类型安全 codegen） | 待规格阶段引入（§5.2） | 仅用路由库 + Vite 插件，**不用** TanStack Start 服务端运行时 |
| 状态管理 | Zustand | 待规格阶段锁定 | 最小 boilerplate |
| 本地数据库 | Dexie.js + dexie-react-hooks | 待规格阶段锁定 | 响应式 IndexedDB |
| 数据校验 | Zod | 待规格阶段锁定 | Schema 优先 |
| UI 组件 | shadcn/ui（Radix UI 底层），经 `shadcn` CLI 生成源码到本地 | 待规格阶段引入（§5.2） | 代码落盘本地，可控；每个组件仅带入其自身依赖，逐件审查 |
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
│  ├─ app-spec.md            # 本文件：项目规格索引
│  ├─ specs/                 # 功能规格（SDD 权威）
│  │  ├─ ui-navigation.md    # UI 导航规格
│  │  ├─ data-layer.md       # 数据层规格
│  │  ├─ import-pipeline.md  # 导入管线规格
│  │  ├─ reading-profile.md  # 阅读画像与图表规格
│  │  └─ settings.md         # 设置与系统重置规格
│  ├─ tasks/                 # 里程碑任务分解
│  ├─ metadata/              # 实体 schema、parser 设计
│  ├─ design-decisions.md
│  ├─ npm-supply-chain-security.md
│  ├─ i18n-conventions.md
│  └─ ai-agent-workflow-rules.md
├─ src/                      # 前端源码
│  ├─ app/                   # 应用入口、Provider、路由树（后续）
│  ├─ components/            # shadcn/ui 落盘组件 + 本地组件
│  ├─ features/              # 功能切片：import、library、reading-profile、settings（后续）
│  ├─ routes/                # TanStack Router 文件路由（codegen）
│  ├─ db/                    # Dexie schema、Repository
│  ├─ parsers/               # 各来源 Parser 实现
│  ├─ lib/                   # 通用纯函数：去重、归一化、日期、ISBN
│  ├─ types/                 # 跨层共享 TypeScript 类型
│  ├─ App.tsx                # 根组件
│  ├─ main.tsx               # Vite 入口
│  └─ styles.css             # Tailwind 入口与全局样式
├─ tests/                    # Vitest 单测与夹具（后续）
├─ e2e/                      # Playwright E2E（后续）
├─ public/                   # 静态资源（本地字体/图标，不联网）
├─ .npmrc                    # pnpm/npm 通用安全加固（已就绪，勿改）
├─ .gitignore                # 含 node_modules / dist / .env
├─ .env.example              # 仅占位，不含真实令牌
├─ .oxlintrc.json            # oxlint 规则（模板生成，勿弱化）
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
pnpm install --frozen-lockfile   # 安装（CI 必须使用 frozen-lockfile）
pnpm dev                          # 开发服务器
pnpm build                        # 类型检查 + 生产构建
pnpm preview                      # 预览生产构建
pnpm lint                          # 静态检查（Oxlint）
pnpm test                          # 单元测试（Vitest）
pnpm verify                        # 安装(frozen) + 供应链策略复校验
pnpm audit --audit-level=high     # 安全审计
```

> `pnpm` 脚本不得在 CI 中不带 `--frozen-lockfile` 调用 `pnpm install`；CI 管线只允许 `pnpm install --frozen-lockfile`。

## 5. 安全基线

本仓库供应链安全由 **pnpm 11 原生执行**，配置入口是 `pnpm-workspace.yaml`（策略）+ `.npmrc`（仅注册表/认证）。详见 [npm-supply-chain-security §2-3](./npm-supply-chain-security.md)。

> [!CAUTION]
> 自 pnpm 11 起，pnpm **只从 `.npmrc` 读注册表与认证**；`ignore-scripts`/`save-exact`/`min-release-age`/`audit` 等**不再被 pnpm 读取**。安全策略写在 `.npmrc` 是「自检通过、实际失效」的假合规。下列条目均以 pnpm 11 真实生效来源为准。

| 安全规范项 | pnpm 11 生效来源 | 状态 |
|-----------|----------------|------|
| 禁止依赖安装脚本 | pnpm v10+ 默认禁用，`allowBuilds` 白名单逐包放行；`strictDepBuilds` 默认 `true` | ✅ 默认开启 |
| 版本锁定 | `pnpm-lock.yaml` frozen 提交 + `minimumReleaseAge: 10080`；`^` 范围可用（CI frozen 安装走锁文件精确版） | ✅ |
| 仅官方注册表 | `.npmrc: registry=https://registry.npmjs.org/`（pnpm 仍读此类设置） | ✅ |
| 强制 HTTPS | `.npmrc: strict-ssl=true`；pnpm 11 `strictSsl` 默认即 `true` | ✅ |
| 安全审计 | `pnpm audit --audit-level=high`（命令，非配置；`pnpm audit` script 已配） | ✅ |
| Lockfile 提交与冻结 | `pnpm-lock.yaml` 提交并审 diff；CI `pnpm install --frozen-lockfile --ignore-scripts` 内置整树供应链复校验 | ✅ |
| 新包冷却期 7 天 | `pnpm-workspace.yaml: minimumReleaseAge: 10080`（分钟，对所有依赖含传递生效；显式配置后 `minimumReleaseAgeStrict` 默认 `true`） | ✅ 真正强制（旧 `.npmrc: min-release-age=7d` 在 pnpm 11 下不被读取，已移除） |
| 阻断异源传递依赖 | pnpm `blockExoticSubdeps` 默认 `true`（拦截 git URL / 直链 tarball） | ✅ 默认开启 |
| 禁止幽灵依赖 | pnpm 默认严格依赖隔离，未声明包无法 import | ✅ 增益 |
| 禁止 `--force` / `--shamefully-hoist` | 规范禁止（npm 对应禁 `--force` / `--legacy-peer-deps`） | ✅ |

### 冷却期补偿控制

`pnpm-workspace.yaml: minimumReleaseAge: 10080` 已在安装时对**所有 lock 条目**强制 7 天冷却（CI `pnpm install --frozen-lockfile` 会复校验）。下列作为流程双保险：

1. **PR 审查清单**：新增/升级依赖时，审查者按 [npm-supply-chain-security §5.1](./npm-supply-chain-security.md#51-添加新依赖-安全审查清单) 核验「目标版本发布 ≥ 7 天」，未满在 PR 中拒绝；可 `pnpm view <pkg> time` 查发布时间。
2. **自动化兜底**：在依赖更新机器人（Renovate / Dependabot）配置 `minimumReleaseAge: 7 days`，使自动 PR 不在发布 7 天内提升级。

以下红线任何一条被弱化即视为安全事件：

- `pnpm-workspace.yaml: minimumReleaseAge: 10080`
- `.npmrc: registry=https://registry.npmjs.org/` + `strict-ssl=true`
- `pnpm-lock.yaml` 必须提交并审查 diff
- 新依赖必须按 [§5.1 审查清单](./npm-supply-chain-security.md#51-添加新依赖-安全审查清单) 在 PR 中归档结论
- 不允许 `^` / `~` / `*` 版本范围；不允许 `--force` / `--shamefully-hoist`
- 不得设 `dangerouslyAllowAllBuilds: true`，不得关闭 `blockExoticSubdeps`/`strictDepBuilds`

### 5.1 脚手架基底：Vite 官方 `react-ts` 模板

项目基底由 Vite 官方模板生成，确保依赖集最小且经社区核验。已实测 `pnpm create vite . --template react-ts --no-immediate` 的产物，结论如下（截至 2026-06 实测）。

**生成命令**：

```bash
pnpm create vite . --template react-ts --no-immediate
pnpm install --ignore-scripts
```

**模板实测产物**（用于让脚手架阶段可复核、可去范本化）：

| 产物 | 说明 | 处置 |
|------|------|------|
| `package.json` | `react`/`react-dom` `^19.2.7`、`@vitejs/plugin-react ^6.0.2`、`typescript ~6.0.2`、`vite ^8.1.0`、`oxlint ^1.x`、`@types/* ^x` | caret/`~` 可保留（pnpm 11 frozen 锁文件兜底）；按需调整版本 |
| `tsconfig.json` + `tsconfig.app.json` + `tsconfig.node.json` | project references、`moduleResolution: bundler`、`verbatimModuleSyntax`、`moduleDetection: force`、`erasableSyntaxOnly`、`noUnusedLocals/Parameters` | ✅ 直接沿用;按本目录结构补 `src` include 与别名 |
| `vite.config.ts` | 仅 `@vitejs/plugin-react` | ✅ 沿用;后续在此追加 `@tailwindcss/vite` 与 `@tanstack/router-plugin` |
| `index.html` | `lang="en"`、含 `/favicon.svg`、示例标题 | 改 `lang="zh-CN"`、标题改 "ReadGraph"、按需替换 favicon |
| `src/App.tsx` + `src/App.css` + `src/index.css` + `src/assets/*` | Vite 默认欢迎页范本 | **全部删除**，替为最小 `App` 壳与本项目样式入口 |
| `public/*` | Vite 默认静态资源 | 按需保留或替换为本地资产;不联网加载字体/图标 |
| `.oxlintrc.json` | 启用 `react`/`typescript`/`oxc` 插件，`react/rules-of-hooks=error`、`react/only-export-components=warn` | ✅ 沿用，禁止弱化 hooks 规则 |
| `.gitignore` | 含 `node_modules` `dist` `dist-ssr` `*.local` 等 | 与仓库现有 `.gitignore` 合并，不覆盖既有 Python/IDE 规则 |
| `src/main.tsx` | `StrictMode` + `createRoot` + `import './index.css'` | ✅ 沿用，改为导入本项目样式入口 |

**模板不含但本里程碑需补的项**：

1. **Vitest**：模板无测试配置。需 `pnpm add -D vitest`（经 §5 冷却期审查后），新增 `vitest.config.ts`，并补脚本 `test`/`test:watch`。
2. **lockfile 校验**：用 `pnpm verify`（frozen 安装内建供应链复校验），无需外部 `lockfile-lint`。
3. **`engines`**：模板 `package.json` 无。按 [npm-supply-chain-security §6] 补 `node>=20`（pnpm 无需 `npm` 引擎）。

### 5.2 增量接入：UI 与路由

为减少 AI 手写样板，且不偏离安全基线，UI 与路由层采用「先有 Vite 工程，再接官方工具」的公式，替代一体化大模板：

| 层 | 公式 | 引入的依赖（最小集，待锁定） | 安全约束 |
|----|------|--------------------------|---------|
| 样式（Tailwind v4） | `pnpm add -D tailwindcss @tailwindcss/vite` + 在 `vite.config.ts` 加插件 + CSS `@import "tailwindcss";` | `tailwindcss`、`@tailwindcss/vite` | 逐件走 §5 冷却期审查;与 shadcn 同批接入 |
| UI 组件（shadcn/ui） | `pnpm dlx shadcn@latest init` 初始化，随后 `shadcn add <component>` **按需**逐件把组件源码落到 `src/components/ui/` | 每组件自身依赖（`clsx`、`tailwind-merge`、`class-variance-authority`、`lucide-react`、对应 `@radix-ui/react-*`） | 源码落本地可控;每次 `add` 都是一次新依赖引入事件，须跑 §5 安全审查清单（`^` 范围可保留，frozen 锁文件兜底） |
| 路由（TanStack Router） | `pnpm add @tanstack/react-router` + `pnpm add -D @tanstack/router-plugin` | `@tanstack/react-router`、`@tanstack/router-plugin` | **仅用路由库 + Vite 插件**;禁用 `@tanstack/react-start` 等带服务端运行时 |

接入顺序建议：先 Tailwind（v4）→ 再 `shadcn init` → 再按页面实际需要 `shadcn add <component>` → 最后接 TanStack Router 插件。任一步执行前先在规格中明确「本步要落到哪些文件、加入哪些依赖」，避免边装边改。

## 6. 功能规格索引

在进入第一个功能里程碑前，下列规格必须由具体章节填充，再进入「Tests(Red) → Code → Tests(Green)」循环：

| # | 规格 | 状态 | 文件 | 落地状态 |
|---|------|------|------|---------|
| 1 | 数据层规格 | ✅ 已补 | [specs/data-layer.md](./specs/data-layer.md) | Dexie schema、Repository 接口、迁移策略、索引定义 — 已 TDD 落地 |
| 2 | 导入管线规格 | ✅ 已补 | [specs/import-pipeline.md](./specs/import-pipeline.md) | Parser 注册表、纯函数 pipeline、去重算法、时区转换、错误/警告模型、书目标题结构化解析 — 已 TDD 落地 |
| 3 | UI 导航规格 | ✅ 已补 | [specs/ui-navigation.md](./specs/ui-navigation.md) | 路由树、各页布局与空状态、主题/i18n 骨架、用户故事、数据契约、测试清单、React 性能规则引用 — i18n 骨架已落地，UI 装配归入统一 UI 里程碑 |
| 4 | 阅读画像与图表规格 | ✅ 已补 | [specs/reading-profile.md](./specs/reading-profile.md) | 统计维度、纯函数聚合契约、ECharts 薄适配主题、空数据/大文件退化策略、用户故事、测试清单 — §2 聚合与 §3 buildTheme 已 TDD 落地（20 suites/196 tests 绿）；UI 组件归入统一 UI 里程碑 |
| 5 | 设置与系统重置规格 | ✅ 已补 | [specs/settings.md](./specs/settings.md) | 偏好持久化、重置的原子性与确认流程、备份导出与重建模式对照；备份序列化纯函数 `src/db/backup.ts` 已 TDD 落地 — UI 装配归入统一 UI 里程碑 |

> UI 统一里程碑任务见 [tasks/ui-unified-batch.md](./tasks/ui-unified-batch.md)。

每个功能阶段开始前，对应规格文件需包含：

- 用户故事与验收用例
- UI 设计说明（布局/交互/状态/响应式）
- 数据契约与边界情况
- 对应的 Vitest/Playwright 测试清单
- 涉及 React 性能的，引用 `build-web-apps:react-best-practices` 规则 id（如本地偏好落 localStorage 用 `client-localstorage-schema`、shadcn 组件按需 import 避免 barrel 用 `bundle-barrel-imports`）。

## 7. 校验命令速查

```bash
pnpm verify                      # 安装(frozen) + 整树供应链策略复校验
pnpm audit --audit-level=high    # 已知漏洞审计
pnpm build                       # 类型检查 + 生产构建
pnpm test                        # 单元测试
```

> `pnpm verify` 在 frozen 安装时会对每条 `pnpm-lock.yaml` 条目重跑 `minimumReleaseAge` 策略；安全基线见 §5。
