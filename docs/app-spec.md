
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

1. **数据层规格** — ✅ 已补，见 [§9 数据层规格](#9-数据层规格)（Dexie schema、Repository 接口、迁移策略、索引定义，对照 internal-schema）。
2. **导入管线规格** — ✅ 已补，见 [§10 导入管线规格](#10-导入管线规格)（Parser 注册表、纯函数 pipeline、去重算法、时区转换、错误/警告模型、书目标题结构化解析）。
3. **UI 导航规格** — 已补，见 §8（路由树、各页布局与空状态、主题/i18n 骨架、用户故事、数据契约、测试清单）。
4. **阅读画像与图表规格** — ✅ 已补，见 [§11 阅读画像与图表规格](#11-阅读画像与图表规格)（统计维度、纯函数聚合契约、ECharts 薄适配主题、空数据/大文件退化策略、用户故事、测试清单）。
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
## 9. 数据层规格

> 本节为 [§6 待补规格清单] 第 1 项「数据层规格」的填充结果，遵循 SDD + TDD。规格落地于代码前先写本节，再进 Tests(Red) → Code → Tests(Green)。实体字段定义与索引语义以 [internal-schema](./metadata/internal-schema.md) 及各实体元数据文档为唯一来源；本节不重复抄录字段表，只定义「代码落点、接口契约、迁移与测试」。

### 9.1 范围与依赖

**范围**：定义 Dexie 数据库 schema（库名 `readgraph`）、实体 Zod 校验、Repository 接口与实现、版本迁移策略、原子系统重置、整库导出/导入。本里程碑**不实现**导入管线（Parser、去重算法、借还配对——属 §6 #2）、不接 UI Provider（DB Provider 在 UI 里程碑落地，仅消费本层暴露的 db 句柄与 Repository）。

**依赖**（本里程碑锁定的精确版本，已过 [npm-supply-chain-security §4.1] 冷却期审查）：

| 包 | 类型 | 版本 | 用途 |
|----|------|------|------|
| `dexie` | runtime | `4.4.4` | IndexedDB 封装、schema/version、事务 |
| `zod` | runtime | `4.4.3` | 实体 schema 校验、`UserPreferences`、`ExportData` 校验 |
| `fake-indexeddb` | dev | `6.2.5` | Vitest（node 环境）下为 Dexie 提供内存 IndexedDB |

> `dexie-react-hooks` 留待 UI Provider 里程碑引入（`useLiveQuery` 响应式订阅），本层 Repository 不依赖它，避免不必要依赖面。

**代码落点**：

```
src/
├─ types/entities.ts          # 实体 TS 类型（对照 metadata，本层定义并导出）
├─ db/
│  ├─ db.ts                   # Dexie 子类 ReadGraphDB：schema(version 1)、所有 store 与索引
│  ├─ schemas.ts              # 实体 Zod schemas（落库/导出/导入校验）
│  ├─ repositories.ts         # 各实体 Repository 接口 + 实现（薄封装 db.table）
│  ├─ reset.ts                # 原子系统重置（单事务清空全部 store + 可选清 readgraph:* localStorage）
│  ├─ export-import.ts        # ExportData 编解码（Zod 校验、整库快照导出/写回）
│  ├─ uuid.ts                 # UUID v4 工具（导入管线后续按稳定输入派 ID）
│  └─ *.test.ts               # 数据层测试
└─ lib/preferences.ts          # UserPreferences Zod schema + 读写（theme/timezone 补齐，locale 沿用 locale.ts）
```

### 9.2 实体 Zod schema

- `src/db/schemas.ts` 为 internal-schema 的六个实体各导出一个 Zod schema：`bookSchema`、`catalogRecordSchema`、`borrowCycleSchema`、`sourceSchema`、`rawRecordSchema`、`importLogSchema`。
- schema 与 metadata 字段一一对应：必填/可空、数组、`Date`、枚举（`status`/`classificationSystem`/`ParseWarning.type` 等）。
- `bookSchema.isbn13` 允许 `null`；非空时校验 13 位纯数字。ISBN-13 校验位作为**软校验**（warning，不阻断落库），硬校验仅做「13 位数字」格式。
- `catalogRecordSchema.metaId` 为 `string|number|null`，`metaIdKey` 为 `string|null`。
- 时间字段统一存 **`Date` 对象（UTC）**；Zod schema 接受 `Date` 实例或 ISO 8601 字符串，`.transform` 归一为 `Date`。
- 落库（Repository put/create）前必须 `safeParse`，校验失败抛 `ZodError` 且不落库。

### 9.3 Dexie schema 与索引定义（对照 internal-schema）

- `src/db/db.ts`：`class ReadGraphDB extends Dexie`，`constructor` 调 `this.version(1).stores({...})`。库名 `'readgraph'`。
- **主键**：所有 store 用 `'id'`（UUID v4）。
- **索引**严格对照 [internal-schema](./metadata/internal-schema.md) 各 store 索引列表：

  | Store | Dexie 索引字符串 |
  |-------|-----------------|
  | `books` | `'id, &isbn13, title, createdAt, *sourceIds, *tags, needsReview'` |
  | `catalogRecords` | `'id, bookId, sourceId, metaId, metaIdKey, *classCodes, *barcodes, [sourceId+metaIdKey]'` |
  | `borrowCycles` | `'id, bookId, sourceId, borrowedAt, returnedAt, status, [bookId+borrowedAt], [sourceId+borrowedAt]'` |
  | `sources` | `'id, &parserId, type'` |
  | `rawRecords` | `'id, importLogId, sourceId, parseStatus'` |
  | `importLogs` | `'id, sourceId, importedAt'` |

  - `&` = unique；`*` = multiEntry；`[a+b]` = compound。
  - `&isbn13` 把 `null/undefined` 视为不参与 unique（与 IndexedDB sparse 语义一致）。

- 时间存储：Dexie 直接存 `Date` 对象（IndexedDB 原生支持），与 internal-schema「UTC ISO 8601」在导出层互转（§9.7）。

### 9.4 Repository 接口

Repository 是 UI/管线与 Dexie 间的薄契约，**不持状态**，接收一个 `ReadGraphDB` 句柄构造（便于测试注入 fake-indexeddb）。

```ts
interface Repository<T extends { id: string }> {
  get(id: string): Promise<T | undefined>
  getAll(): Promise<T[]>
  put(entity: T): Promise<string>
  bulkPut(entities: T[]): Promise<void>
  delete(id: string): Promise<void>
  count(): Promise<number>
}
```

补充查询接口（按索引，语义对照 internal-schema）：
- `BookRepository`：`findByIsbn13`、`findBySourceId`（multiEntry）、`findNeedsReview`、`searchByTitle`。
- `CatalogRecordRepository`：`findByBookId`、`findBySourceId`、`findByBarcode`（multiEntry）、`findBySourceMetaIdKey`（compound）、`findClassCodes`。
- `BorrowCycleRepository`：`findByBookId`、`findBySourceId`、`findBorrowed`、`timelineByBook`（`[bookId+borrowedAt]`）、`timelineBySource`。
- `SourceRepository`：`findByParserId`（unique）、`findByType`。
- `RawRecordRepository`：`findByImportLog`、`findBySourceId`、`findByStatus`。
- `ImportLogRepository`：`findBySourceId`、`recent(limit)`。

约束：写方法落库前对入参跑对应 Zod `safeParse`，失败抛 `ZodError`，不部分写入；查询返回实体副本；不在本层做去重/合并（属导入管线 §6 #2）；UI 响应式由上层 `dexie-react-hooks` 直接 `useLiveQuery`，本层不内置订阅。

### 9.5 迁移策略

- 版本号从 `1` 起，`this.version(1).stores({...})`。
- 字段/索引演进：**升 version**（`version(2).stores({...})`），在 `.upgrade(...)` 迁移；禁手改旧版 stores 覆盖历史 schema（Dexie 按 version 增量管理）。
- 大重构走「导出 → 系统重置 → 用新 schema 重导」，不在 upgrade 里大改写（与 internal-schema「重置=全有或全无」一致）。
- `localStorage` key `readgraph:db-version` 仅作可观测探针，不驱动迁移。

### 9.6 系统重置（原子事务）

- `resetDatabase(db, { clearPreferences? })`：
  - 在**单个** `db.transaction('rw', <六张表>, async () => {...})` 内 `db.table.clear()` 全部六张表。
  - 任一写失败则事务整体回滚，绝不留半清空中间态。
  - `clearPreferences` 为真时清除 `localStorage` 下所有 `readgraph:*` 键；为否时保留用户偏好——与 internal-schema「可选保留偏好」一致。
  - 本函数**不提供导出**；UI 层在调用前强制导出/二次确认（属设置页规格 §6 #5）。

### 9.7 数据导出与重建

- `exportDatabase(db): Promise<ExportData>`：读全部六张表，组装 `ExportData`（`version='1'`，`exportedAt=new Date()`），所有 `Date` 序列化为 ISO 8601 `Z` 串。**rawRecords 与 sources 为必导项**。
- `exportDataSchema`（Zod）：校验外部 JSON；时间字段反序列化时由 ISO 串转回 `Date`。
- `importDatabase(db, data, { mode })`：`snapshot` 先 `resetDatabase` 再单事务 `bulkPut` 全部实体（逐实体过 Zod safeParse）；`replay` 仅落 `sources + rawRecords`，其余由管线重放（本里程碑实现 `snapshot`，`replay` 留管线里程碑）。
- `data.version` 不匹配时抛 `Error`；rawRecords 缺失时拒绝。

### 9.8 用户偏好（UserPreferences）

- `src/lib/preferences.ts` 导出 `userPreferencesSchema`（Zod）：`{ locale: 'zh-CN'|'en', theme: 'light'|'dark'|'auto', displayTimezone: string }`。
- 读写仍走 `localStorage` key `readgraph:preferences`；theme/timezone 由本里程碑补齐，locale 沿用既有 `locale.ts` 不重写（避免回归既有 i18n 测试）。
- `readPreferences()`：`safeParse` 失败降级到默认 `{ locale: 'zh-CN', theme: 'auto', displayTimezone: 'Asia/Shanghai' }`（与 §8.8「非法值降级」一致）。
- `writePreferences(patch)`：合并写入，整体过 schema 校验。**本里程碑只交付 schema + 读写函数与测试**，不改 `__root.tsx`（主题 Provider 在 UI 里程碑装配）。

### 9.9 用户故事与验收用例

- 构造内存 `ReadGraphDB`（fake-indexeddb 注入），对各 store 做 CRUD，读回结构与写入一致。
- 按 `isbn13` / `[sourceId+metaIdKey]` / 借阅时间线索引查询，命中正确且不漏 null 项。
- `resetDatabase` 六张表单事务清空；制造中途写失败时整体回滚，无部分数据。
- `exportDatabase` 得完整 `ExportData`（含 sources + rawRecords），`importDatabase(snapshot)` 还原后全库与导出前等价。
- 向 `localStorage` 写非法 theme/timezone，`readPreferences` 降级为合法默认且不抛。

### 9.10 数据契约与边界

- **UUID 确定性**：Repository 不保证 ID 生成确定性；导入管线（§6 #2）负责由 `rawRecord.id + importLogId` 派生实体 ID 以满足「重建等价」。本层只提供 `uuid()` 工具，不绑定派生策略。
- **Date/UTC**：Dexie 内存 `Date` 对象（UTC 语义由 Parser 在导入阶段保证）；UI 显示层负责转 `displayTimezone`，本层不转时区。
- **fake-indexeddb 差异**：复合索引、multiEntry、IDBKeyRange 须在测试验证，生产以 Chromium IndexedDB 为准；测试断言语义不断言实现细节。
- **不实现**：去重合并、借还配对、Parser、纯函数 pipeline（属 §6 #2）；主题 Provider 装配与页内 `Empty`（属 UI 里程碑）；ECharts（§6 #4）。

### 9.11 测试清单（Vitest）

测试位于 `src/db/*.test.ts`、`src/lib/preferences.test.ts`。统一在 `beforeEach` 用 `fake-indexeddb` 注入 `globalThis.indexedDB` 与 `IDBKeyRange` 后 `new ReadGraphDB()`，`afterEach` 关库。

- **schema 校验**：各 entitySchema 把合法/非法样本分别 accept/reject；`isbn13` 格式、`Date` 与 ISO 互转、枚举越界被拒。
- **DB schema**：六张表存在；索引名称与 internal-schema 一一对照（`db.tables` + `table.schema.indexes` 断言）。
- **Repository CRUD**：各 Repository `put/get/getAll/bulkPut/delete/count` 行为；Zod 校验失败抛错且不落库。
- **Repository 索引查询**：`findByIsbn13`、`findByBarcode`（multiEntry）、`findBySourceMetaIdKey`（compound）、`timelineByBook`（compound 范围）、`findBorrowed` 命中正确；多 source 同 metaIdKey 不串。
- **系统重置**：六张表单事务清空；制造 `bulkPut` 中途抛错验证回滚，所有表保持一致（无半清空）。
- **导出/导入**：`exportDatabase` 含全部表；`importDatabase(snapshot)` 还原后全库等价；`version` 不匹配抛错；rawRecords 缺失拒绝。
- **偏好**：`readPreferences` 缺省/非法降级默认；写非法 theme/timezone 降级；合并写入保留兄弟字段。

### 9.12 React 性能规则引用

- `client-localstorage-schema`：`readgraph:preferences` 读写走 `userPreferencesSchema` 校验（§9.8），避免脏值。
- Repository 写路径 Zod 校验避免脏数据落库（SDD 强约束）；UI 响应式由 `dexie-react-hooks` `useLiveQuery` 直连 Dexie（引用 `bundle-barrel-imports`，避免 barrel 拉 UI 体积），本层不内置订阅以减少重复渲染面。
 - Repository 写路径 Zod 校验避免脏数据落库（SDD 强约束）；UI 响应式由 `dexie-react-hooks` `useLiveQuery` 直连 Dexie（引用 `bundle-barrel-imports`，避免 barrel 拉 UI 体积），本层不内置订阅以减少重复渲染面。

## 10. 导入管线规格

> 本节为 [§6 待补规格清单] 第 2 项「导入管线规格」的填充结果，遵循 SDD + TDD。规格落地于代码前先写本节，再进 Tests(Red) → Code → Tests(Green)。规范化对象（字段含义、`SourceParser`/`ParseResult`/`ParseWarning` 接口）与去重策略以 [import-workflow](./metadata/import-workflow.md)、[source](./metadata/source.md)、[internal-schema 去重策略](./metadata/internal-schema.md#去重策略)、各实体元数据为唯一来源；本节只定义「代码落点、纯函数契约、确定性、时区、配对、测试」。

### 10.1 范围与依赖

**范围**：定义 Parser 注册表、纯函数导入管线（`importPipeline`）、时区转换契约、ISBN 处理、书目/编目去重合并算法、借还配对算法、错误与警告模型、ID 确定性派生，并落地一个真实 Parser（`szlib`，见 [parsers/szlib-parser](./metadata/parsers/szlib-parser.md)）。本里程碑**只交付纯函数与测试**，**不接 UI 向导**（属 §8 导入页，UI 里程碑装配）、**不写 IndexedDB**（写入是调用方职责，管线只返回 `PipelineResult`）；`importDatabase(replay)` 端到端装配（§9.7 replay）留待 UI 里程碑接本管线，本里程碑由 `importPipeline` 提供纯函数基础。

**依赖**（本里程碑锁定的精确版本，需过 [npm-supply-chain-security §4.1] 冷却期审查）：

| 包 | 类型 | 版本 | 用途 |
|----|------|------|------|
| `date-fns-tz` | runtime | `3.2.0` | 把「无时区标记的本地时间字符串」按 `source.timezone`（IANA）解释为 UTC `Date`；跨 node/浏览器一致、确定性 |

> 不引入 `date-fns` 主体（本里程碑只用 tz 转换；format/duration 等 UI 显示期再按需引入）。不引入第三方 GBK 解码库：编码检测委托运行时 `TextDecoder`（Chromium 与 Node 22 full-icu 均原生支持 `gbk` label），纯管线层不绑定具体解码实现，见 §10.7。Papa Parse（CSV）留作后续来源接入，本里程碑 szlib 数据为 JSON。

**代码落点**：

```
src/
├─ lib/
│  ├─ time.ts               # 时区转换纯函数：localToUtc；不含 Date.now()
│  ├─ isbn.ts               # ISBN 清洗、ISBN-10→13 转换、软校验
│  ├─ normalize.ts          # 标题/作者归一化（去标点、全角→半角、转小写；不含繁简转换）
│  ├─ hash.ts               # 确定性 hash（FNV-1a 32bit），纯函数、无依赖
│  └─ *.test.ts
├─ parsers/
│  ├─ types.ts              # SourceParser、ParseResult、ParseWarning 接口（与 entities 对齐）
│  ├─ registry.ts          # Parser 注册表：按 parserId 查找、validate-match
│  ├─ dedupe.ts            # 书目/编目/周期去重合并纯函数（existing 入参化）
│  ├─ pipeline.ts          # importPipeline 纯函数 + PipelineResult + 派生 ID
│  ├─ szlib.ts             # 深圳图书馆 Parser（对照 szlib-parser.md，含选书帮分支）
│  └─ *.test.ts
└─ tests/fixtures/         # 脱敏夹具（szlib 流水 JSON）
```

### 10.2 Parser 接口与注册表

- `src/parsers/types.ts` 导出 `SourceParser`、`ParseResult`、`ParseWarning`，与 [source](./metadata/source.md) Parser 接口规范、[entities](types/entities.ts) 完全对齐。`parse(rawData, source)` 在本里程碑**同步**（szlib 数据已在内存为 string）；`rawData` 形参为 `string | ArrayBuffer`。
- `src/parsers/registry.ts`：
  - 维护 `Record<string, SourceParser>`，按 `parser.id === source.parserId` 查找。
  - `getParser(parserId)`：未注册抛 `Error`（不静默回退）。
  - `matchParser(rawData, sources?)`：对已注册 Parser 依次调 `validate(rawData)`，返回首个匹配的 `SourceParser`；用于导入向导「自动检测来源」。`sources` 缺省时遍历全部注册 Parser。
  - ID 即 `source.parserId`（来源唯一标识 + Parser 选择键二合一，见 source.md），故一个 `parserId` 对应一个 Parser。
- 注册表默认注册 `szlibParser`；其它 Parser 按贡献指南增量补。

### 10.3 纯函数 pipeline 契约

`importPipeline` 是导入管线的核心纯函数（对照 import-workflow 导入纯度要求）：

```ts
interface ExistingState {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
}

interface ImportMeta {
  id: string           // ImportLog.id
  fileName: string
  fileSize: number
  detectedEncoding: string
  importedAt: Date     // 派生时间锚（重建用），禁止 Date.now()
}

interface PipelineResult {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  importLog: ImportLog
  rawRecords: RawRecord[]          // 回填 parseStatus/parseNote/bookId/borrowCycleId
  warnings: ParseWarning[]
}

function importPipeline(
  rows: RawRecord[],          // 调用方预分配 id/importLogId/sourceId/rowIndex；data 待 parser 解析
  source: Source,
  parser: SourceParser,
  existing: ExistingState,
  meta: ImportMeta,
): PipelineResult
```

- **rawRecords 身份**：调用方在进入管线前已把原始记录落为 `RawRecord`（含稳定 `id`）；管线据此派生跨实体引用。`parser.parse` 的职责为「逐行解析 `rows[i].data` 并回写其 `borrowCycleId/bookId/parseStatus/parseNote`」，避免 parser 重新读文件。
- 确定性：相同 `(rows, source, parser, existing, meta)` 必产出结构等价 `PipelineResult`；不带时钟、不读写存储、不依赖全局可变状态。
- 管线组装 `ImportLog`：`stats` 与 `warnings` 由管线从 parse 结果统计；`parserId = source.parserId`，`importedAt = meta.importedAt`，`sourceId = source.id`。
- **写入不在本层**：管线只返回 `PipelineResult`；落 IndexedDB 由调用方（UI / replay 装配）负责，使「纯函数 = 重建等价」可证。

### 10.4 ID 确定性派生

为满足「同 rawRecords 重放产出等价派生数据」（internal-schema 重建确定性要求），派生实体 ID 不用 `uuid()` 随机，而由稳定输入派生：

| 实体 | 派生键 | 形式 |
|------|--------|------|
| `CatalogRecord.id` | `sourceId + metaIdKey`（metaIdKey 缺省退化为 `sourceId + barcode`） | `cr-{fnv1a32(hex)}` |
| `Book.id` | 沿用：若 CatalogRecord 已匹配到 existing Book，沿用其 id；新增 Book 取首个命中它的 `CatalogRecord.id`（「一书一编目首记」可复现） | `bk-{fnv1a32(hex)}` |
| `BorrowCycle.id` | `importLogId + rawRecordIds.join(',')`（已排序去重） | `cy-{fnv1a32(hex)}` |

- 派生 hash 走 `src/lib/hash.ts` 的 `stableHash(input: string): string`（FNV-1a 32bit，纯函数、无依赖），输出固定长度十六进制串；避免 `crypto.randomUUID`。
- `createdAt/updatedAt` 一律取 `meta.importedAt`（不取导入时刻墙钟），保证重放一致。
- `existing` 中的实体若与新派生 id 冲突，按去重规则合并（同 id 视为同一实体，字段按 §10.6 合并；不报 id 冲突）。

### 10.5 时区转换契约

`src/lib/time.ts`（纯函数，无 `Date.now()`，不在模块顶层读时区）：

- `localToUtc(localText: string, timezone: string): Date`：把「无时区标记的本地时间字符串」（如 szlib 的 `"YYYYMMDD"` + `"HH:MM:SS"` 组合为 `"YYYY-MM-DDTHH:MM:SS"`）按 `timezone`（IANA）解释为 UTC `Date`。用 `date-fns-tz` 的 `fromZonedTime`/等价能力，确保 node 与浏览器一致。
- 输入格式不合法时**抛 `Error`**；管线把该异常转成 `invalid_date` 警告（见 §10.8），不中断整批。
- 不在导入层做「UTC → 显示时区」；显示由 UI 层按 `UserPreferences.displayTimezone` / `source.timezone` 转换（见 §8.6）。
- 不引入 `date-fns` 主体：长期时长统计（duration）等 UI 期再按需引入。

### 10.6 去重合并算法

`src/parsers/dedupe.ts`（纯函数，existing 入参化，对照 internal-schema 去重策略 + szlib-parser §4/§5）。流程对每条待落 CatalogRecord 候选：

1. **CatalogRecord 级匹配（最优先）**：在 `existing.catalogRecords` 中按 `sourceId + barcode` 或 `sourceId + metaIdKey` 查找。
   - 命中：沿用该 `CatalogRecord.id` 与其 `bookId`；把新 barcode 并入其 `barcodes`（去重）；新分类号并入 `classifications`（去重）。**不改其 `bookId`**（Book 归属稳定）。
2. **Book 级 ISBN 匹配**：未命中编目时，提取该候选 `isbn13`，在 `existing.books` 按 `isbn13` 查找。
   - 命中：新建 CatalogRecord（派生 id）挂到该 Book 下；把 `source.id` 并入 Book 的 `sourceIds`（去重）。
3. **Book 级模糊匹配（兜底，flag review）**：无 ISBN 且无编目命中时，比对 `normalize(title)` + `normalize(authors[0])`。
   - 命中且**双方非占位书名**：建议合并到 existing Book，置 `needsReview = true`（待用户确认），记 `duplicate` 警告。
   - 未命中：新建 Book（派生 id，首记 CatalogRecord 派生）。
4. **选书帮占位分支（覆写上述）**：当记录满足 `title === "福田图书馆读者自选图书"` 且 `ISBN` 为空（精确匹配，见 szlib-parser §5）：
   - 按 **barcode** 各建独立 `Book`（`needsReview=true, isbn13=null`），**不做 ISBN/title 合并**；CatalogRecord 仅按 `sourceId + barcode` 去重；不与任何 existing Book 合并（含其他选书帮 Book）。

`normalize`（`src/lib/normalize.ts`）：去空白与标点、全角→半角、转小写；`繁→简` 不在本里程碑（标为可选，留扩展）。

**BorrowCycle 去重**（在借还配对后）：

1. 精确匹配：`sourceId + barcode + borrowedAt` 与 `existing.borrowCycles` 重合 → 跳过，记 `duplicate` 警告，回填 `rawRecord.parseStatus='skipped'`。
2. 时间重叠：同一 `bookId + barcode` 已有周期的时间范围内再次出现借出 → 记 `unpaired_record` 警告，仍建周期（`status='unknown'`）。

合并后的产物：existing + 新增合并去重后的并集，交由调用方写库（替换还是 upsert 由调用方决定，§10.10 边界）。

### 10.7 编码检测契约

- 管线入口前由调用方做 `detectAndDecode(buffer)`（对照 import-workflow 编码检测）：先 `TextDecoder('utf-8', { fatal: true })`，失败再 `TextDecoder('gbk')`；返回 `{ text, detectedEncoding }`。
- 该函数依赖运行时 `TextDecoder`（浏览器/Node 原生），纯管线层只消费 `text`，不绑定解码实现；测试用 Node 22 原生 gbk 校验，不引入第三方库。
- 50MB 上限、Web Worker 执行（见 §8.6/§8.9）属 UI 层约束，本里程碑纯管线不实现。

### 10.8 借还配对与错误/警告模型

借还配对在 `szlib.ts` 内按 szlib-parser §3：按 `barcode` 分组、按时间排序，「读者借出」开周期、「读者还回文献」闭周期；忽略「自助查询」「读者续借」。

`ParseWarning.type` 语义（对照 source.md）：

| type | 触发 | recordRef |
|------|------|-----------|
| `missing_field` | 必填字段缺失（如 barcode 缺） | 行号/原始 id |
| `invalid_date` | 日期字符串无法按 `source.timezone` 解析 | 同上 |
| `unpaired_record` | 只有归还无借出 / 借出时间>归还时间 / 周期时间重叠 | 同上 |
| `duplicate` | BorrowCycle 精确重复 / 模糊匹配建议合并 | 同上 |
| `format_error` | rawData 非 JSON / Parser `validate` 误匹配 | null 或文件级 |

- 警告**不中断**解析：记入 `ParseResult.warnings`，对应 `RawRecord.parseStatus` 置 `warning`/`error`/`skipped`；管线聚合进 `ImportLog.warnings` 与 `stats.warningCount/errorCount`。
- `RawRecord.parseStatus`：`success`（正常落库）、`warning`（有警告但产出实体）、`error`（无法产出实体，致命）、`skipped`（重复跳过）。
- `recordRef` 形如 `row:{rowIndex}` 或 `raw:{rawRecord.id}`，便于报告定位。

### 10.9 用户故事与验收用例

- 首次导入一批 szlib 流水（含借/还/续借/查询/两条不同 barcode 的选书帮）→ 产出 Books/CatalogRecords/BorrowCycles，续借与查询被忽略，选书帮各 barcode 独立 Book 且 `needsReview=true`。
- 同一文件再次跑 `importPipeline`（existing=空）→ 与首次结构等价（确定性）。
- 增量导入：existing 取前一批输出 → 新 raw 中同 barcode 同 borrowedAt 的周期被识别为 duplicate 跳过；新 ISBN 命中 existing Book 时挂到该书下。
- 从导出备份重放：按 `importLogId` 分组、清空后逐批重放，每批 existing 取上一批累计输出 → 最终派生数据与快照模式结果等价（重建等价）。
- 非法日期、缺失 barcode、借出>归还：分别产出对应 `ParseWarning.type`，`RawRecord.parseStatus` 正确回填，整批不中断。

### 10.10 数据契约与边界

- 输入：`rows` 的 `rawRecord.id/importLogId/sourceId/rowIndex` 由调用方预分配并稳定；`data` 字段保留原始键值（溯源、重解析）。parser 不改 `rows[i].data` 以外的壳字段身份（仅回写解析结果字段）。
- 派生数据确定性：ID/时间全部稳定派生（§10.4），故 `PipelineResult` 可直接 hash 比对做重建等价测试。
- 与数据层关系：管线不写库、不调 Repository；`existing` 由调用方从 `ReadGraphDB` 读出传入；`RawRecord` 字壳是否先落库由调用方决定（重放装配需先落 rawRecords 再喂管线）。
- 不实现：UI 向导、文件选择/拖拽、Worker 编排、`importDatabase(replay)` 装配（属 §8 导入页）；CSV/XLSX 与其它 Parser（按 §10.1 后续接入）。
- 边界：Parser `validate` 误匹配（无匹配 Parser）→ 管线入口前 `getParser` 抛 `Error`，由 UI 提示用户手动选 Parser；空 raw → `stats` 全 0、warnings 空。

### 10.11 测试清单（Vitest）

测试位于 `src/lib/*.test.ts`、`src/parsers/*.test.ts`，夹具 `src/tests/fixtures/szlib-*.json`（脱敏）。纯函数测试无需 fake-indexeddb（管线不碰存储）。

- **time**：`localToUtc` 把 `"2026-04-11T18:33:50"` + `Asia/Shanghai` 转为 UTC `"2026-04-11T10:33:50Z"`；非法输入抛 `Error`；同输入跨调用返回等价 `Date`。
- **isbn**：清洗去连字符空格；ISBN-10→13 校验位正确；13 位非数字被拒；空/`""` 归一为 `null`。
- **normalize**：全角→半角、去标点转小写一致；空串/纯标点归一等价键。
- **registry**：`getParser('szlib')` 命中、未知 id 抛错；`matchParser` 对合法 szlib JSON 命中、对错配数据不误命中。
- **szlib parser**：脱敏夹具→正确产出 books/catalog/cycles；过滤续借/查询；选书帮按 barcode 独立 Book、`needsReview`、不做合并；callno 提取分类号；时间按 `Asia/Shanghai` 转 UTC。
- **dedupe**：编目级 `sourceId+barcode` 命中沿用；ISBN 命中挂到 existing Book；无 ISBN 模糊命中置 `needsReview` 并记 warning；选书帮分支各 barcode 独立、不合并；BorrowCycle 精确重复跳过且 `parseStatus='skipped'`；时间重叠记 `unpaired_record`。
- **pipeline 确定性**：同输入两次跑结果深等价（ID/时间/计数一致）；不含 `Date.now()` 副作用（派生时间用 `meta.importedAt`）。
- **pipeline 端到端**：一批 szlib raw → 落 `books/catalogRecords/borrowCycles/importLog`，`stats`/`warnings` 正确；增量导入（existing 非空）合并正确。
- **重建等价**：导出→清空→按 importLog 分批重放，最终派生数据与快照模式结果结构等价（用脱敏夹具多批次）。

### 10.12 React 性能规则引用

- 本里程碑为纯函数与单测，不引入 React 组件；导入执行的 Web Worker 编排与 `Progress`/`Spinner` 属 §8 导入页 UI 里程碑（引用 `bundle-barrel-imports`，Worker 内只 import `importPipeline` 不拉 UI 依赖）。
- 管线不读 `localStorage`/不触 React store，避免渲染面耦合；`existing` 显式入参化即「无隐式状态」（import-workflow 纯度要求）。
 
### 10.13 书目标题结构化解析
 
> szlib 等 ISBD 编目来源的原始 `title` 字段是一条编目串，含正题名、副标题、并列题名、责任者声明；`Book` 实体有独立的 `title`/`subtitle`/`authors`/`translators`/`parallelTitles` 字段，本小节定义从原始串到这些字段的确定性解析规则。脱敏夹具 [sample.json](../../sample.json)（根目录）与本小节同步约定；后续 `szlib` Parser（§10.2）按此调用 `parseTitle`。
 
**输入形状（ISBD 著录语法，中文语境）**
 
```
正题名[ : 副标题][ = 并列题名][/ 责任者声明[; 其他责任者声明]]
```
 
- `title` 与 `subtitle` 间以 ` : `（全角/半角空格 + 半角冒号 + 空格）分隔。
- 正题名段与并列题名段以 ` = ` 分隔；并列题名可有多个，以 ` = ` 重复。
- `title` 区与责任者区以 `/`（半角）分隔；**无前导空格**、`/` 后接一个空格。
- 责任者声明间以 `;`（无两侧空格）分隔；同一类型责任者内多人以 `，/,/，` 分隔。
- 个人成分可含：国别前缀 `(日)`/`(美)`、姓名、可选 `等`（et al.）、可选角色词 `著`/`译`/`编`/`主编`/`校`/`绘`。
 
样本（取自 `sample.json`）：
 
```
"再见绘梨 = Sayonara eri/ (日)藤本树著;吴曦译"
"JavaScript权威指南 : 第7版/ (美)David Flanagan著;淘宝前端团队译"
"算法导论 = Introduction to algorithms/ Thomas H. Cormen等著;柴树雨译"
"深度学习/ (美)Ian Goodfellow等著;赵申剑等译"
"图解HTTP/ (日)上野宣著;于佼译"
"亲密关系/ (美)罗兰·米勒著;王伟平译"
"异常漫画 : 漫画版/ 小明著"
"福田图书馆读者自选图书"          <- 占位，不做结构解析
"无条码测试书/ 无条码作者著"
```
 
**落点**：`src/lib/title.ts` 暴露纯函数 `parseTitle(rawTitle: string): ParsedTitle`，无外部依赖、不带时钟；对应单测 `src/lib/title.test.ts`，夹具取自 `src/tests/fixtures/szlib-sample.json`。
 
```ts
interface ParsedTitle {
  title: string            // 正题名（去副/并列/责任）；占位书名时原样
  subtitle: string | null  // ` : ` 右侧拼回原分隔符，无则 null
  parallelTitles: string[] // ` = ` 右侧各段；空数组
  authors: string[]        // 著/编/主编/绘 命中或无角色词默认
  translators: string[]    // 译/校/校译 命中
  isPlaceholder: boolean   // 占位书名（选书帮等）短路标记
}
```
 
**解析步骤**
 
1. **占位短路**：若 `rawTitle` 精确等于 `szlib-parser §5` 占位书名清单（当前为 `"福田图书馆读者自选图书"`）或为空串 → `isPlaceholder=true`，其余字段 `title=rawTitle`、`authors=[]`、`translators=[]`、`subtitle=null`、`parallelTitles=[]`，直接返回。
2. **切责任区**：以首个 `/` 分割为「题名区」与「责任区」（缺失 `/` 则责任区空）。题名区暂留原始空格。
3. **题名区拆分**：
   - 以 ` = ` 分段：第一段为「正题名+副标题」，其余为 `parallelTitles`。
   - 正题名段再以 ` : ` 切：第一段 → `title`；剩余段以 ` : ` 拼回 → `subtitle`，仅一段或无 ` : ` → `subtitle=null`。
   - 注意：` : ` 与 ` = ` 必须带两侧空格才作为分隔符；紧贴的半角冒号（如 `J238.2`）不误切。
4. **责任区拆分**：以 `;` 切责任声明组。
   - 每组以 `，/,/，` 拆个人；每人末尾匹配角色词 `著`/`译`/`编`/`主编`/`校`/`绘`/`校译`/`编著`。
   - 去国别前缀 `(...)`（仅 `(一两个字)` 紧贴姓名开头时去）。
   - `等` 紧贴姓名末尾、角色词之前 → 暂并入姓名字符串保留（如 `"Thomas H. Cormen等"`），由 `normalize`/`lib/normalize.ts` 在匹配键阶段统一剥离，避免在 `authors` 里拆出半截名。
5. **角色词映射**：
   - `著`/`编`/`主编`/`编著`/`绘` → `authors`（含无角色词的第一组默认归 `authors`）。
   - `译`/`校`/`校译` → `translators`。
   - 一条记录内同一字段重复入参按出现顺序合并、去重（`normalize` 后比对）。
 
**字段去向**
 
| `Book` 字段 | 来自 | 说明 |
---|---|---|
| `title` | `parseTitle.title` | 正题名；不等于原始编目串 |
| `subtitle` | `parseTitle.subtitle` | 无则 `null`，非 `null` 时以 ` : ` 拼 `title` 可还原原题名段 |
| `parallelTitles` | `parseTitle.parallelTitles` | 新增字段，默认 `[]`，见下 |
| `authors` | `parseTitle.authors` | |
| `translators` | `parseTitle.translators` | |
| 原始 `title` 串 | `RawRecord.data.title` | 溯源/重解析；`Book` 不再存原始编目串 |
 
- szlib-parser §2.A 当前称「`title` 原样保留」需补正为「结构化解析后写入 `Book.title = 正题名`，原始串由 `RawRecord.data.title` 保留」；`authors` 改为「由 `parseTitle` 派生」。
 
**`Book.parallelTitles` 新字段**
 
- 当前 `book.md` 与 `entities.ts`/`schemas.ts` 未含本字段；本里程碑新增 `parallelTitles: string[]`（默认 `[]`）。用途：UI 可在详情页展示「并列题名」并作为跨语种书的辅助辨识。
- 加字段属 §9 schema 增量，迁移策略：旧导出文件无此字段时被默认 `[]` 兜底（`z.array(z.string()).default([])`），不破坏现有 `ExportData` 兼容；Repository 无需重写索引。
- 字段不参与去重键，不污染 `subjects`（`subjects` 保留给编目主题词）。
 
**边界与退化**
 
- 题名区出现转义 `/`（极罕见）：Parser 不支持转义；首个 `/` 为硬分隔，右侧不再视为题名。
- 占位书名被纳入「`isPlaceholder`」后，szlib 选书帮分支（§10.6 第 4 条）不经 `parseTitle` 的角色拆分，直接独立建 Book；二者可叠加调用次序（先占位短路判定，再走选书帮 barcode 独立分支）。
- 极端情况：责任者区出现 `=`/`:` 误作题名分隔 → 仅切首个 `/`，题名区不再二次切到 `=`/`:` 邻近区段；样本中无此噪声，本里程碑不做容错。
- 题名为半角/全角空格混排时保留原始字符；`normalize` 才做全/半角归一。
- 选书帮占位 `title` 与 `Book.title` 都是 `"福田图书馆读者自选图书"`；`needsReview=true` 期间由人工补全覆盖。
 
**测试清单（Vitest，`src/lib/title.test.ts`）**
 
- 上述 9 个 non-empty `sample.json` title 各产出预期 `ParsedTitle`（正题名/副标题/并列/`authors`/`translators`）。
- `""` 与 `"福田图书馆读者自选图书"`：短路返回 `isPlaceholder=true`、空数组。
- 角色词覆盖：`著`/`译`/`编`/`绘`/无角色词；多组 `;` 切分；`等` 保留于姓名字符串。
- 确定性：同一输入两次调用深等价。
- 与 `normalize` 互不调用（`title.ts` 无依赖 `normalize.ts`）；匹配去重由 `dedupe.ts` 在归一后做。
## 11. 阅读画像与图表规格

> 本节为 [§6 待补规格清单] 第 4 项「阅读画像与图表规格」的填充结果，遵循 SDD + TDD。落地本节规格后再进 Tests(Red) → Code → Tests(Green)。实体字段、分类体系与索引语义以 [internal-schema](./metadata/internal-schema.md) 及 [book](./metadata/book.md)/[catalog-record](./metadata/catalog-record.md)/[borrow-cycle](./metadata/borrow-cycle.md)/[source](./metadata/source.md) 为唯一来源；本节不重复抄录字段表，只定义「代码落点、聚合契约、图表配置、退化策略与测试」。

### 11.1 范围与依赖

**范围**：定义阅读画像页（`/profile`，方向 B「阅读图谱」）的统计维度、纯函数聚合契约、ECharts 薄适配主题、空数据与大文件退化策略。本里程碑**不实现**导入管线增量（属 §10）、不新增 Object Store/索引（属 §9）、不改 Repository 接口（仅消费现有读取方法 + `useLiveQuery`）。统计与图表**只读**：不写库、不触发迁移、不修改实体。

**依赖**（本里程碑拟新增，精确版本与冷却期审查在引入时按 [npm-supply-chain-security §4.1] 落地，下表版本为锁定候选；最终 pin 以 PR 中的 `pnpm verify`/`audit`/`security:check` 通过为准）：

| 包 | 类型 | 版本候选 | 用途 |
|----|------|---------|------|
| `echarts` | runtime | `5.6.0` | canvas 渲染、treemap/自定义 series/柱图；依赖面仅 `zrender`+`tslib`（见 design-decisions 图表选型） |
| `date-fns` | runtime | `4.1.0` | 月份/年份桶的 locale 友好格式化与区间生成（按需引入子模块；时间转换仍走已落地的 `date-fns-tz`） |

> `date-fns` 为可选：月份桶与 duration 直方图可用 `Date` 的 UTC getter + `Intl` 完成，若实现期评估后无 locale 格式化刚需则不引入，以缩小依赖面。是否引入在 Tests(Red) 阶段最终裁定。

**代码落点**：

```
src/
├─ lib/
│  ├─ echarts-theme.ts        # 薄适配：shadcn CSS 变量 → echarts theme（palette/坐标轴/tooltip），随 .dark 重建
│  ├─ profile-stats.ts         # 纯函数聚合：实体数组 → 各图表 dataset（无 Date.now()/无 DOM/无存储读）
│  └─ profile-stats.test.ts    # 聚合纯函数单测
├─ profile/
│  ├─ stats-worker.ts          # Comlink 包装：大数据集下放 Worker 跑 profile-stats（≥阈值启用）
│  ├─ use-profile-stats.ts     # Hook：useLiveQuery 取实体 → memo 派生 dataset（小数据同步/大数据走 Worker）
│  └─ charts/                  # 各图组件（按需 import，避免 barrel）
│     ├─ ClassificationTreemap.tsx
│     ├─ BorrowGantt.tsx
│     ├─ BorrowVolumeBar.tsx
│     └─ DurationDistribution.tsx
└─ routes/
   └─ profile.tsx             # 阅读画像页（改造现有占位页为图表主导布局）
```

### 11.2 统计维度与聚合契约

所有聚合为**纯函数**：入参为实体数组（`Book[]`/`CatalogRecord[]`/`BorrowCycle[]`/`Source[]`）+ 选项（分类体系、时间范围、displayTimezone），出参为结构化 dataset；不带时钟、不读写 IndexedDB、不触 DOM、不依赖全局可变状态。同一入参产出深等价输出（对照 §10.3 纯函数 pipeline 契约）。时间聚合一律基于 **UTC**（`getUTCFullYear`/`getUTCMonth`），保证 displayTimezone 改变只影响标签呈现、不改变桶归属。

**`src/lib/profile-stats.ts` 契约**：

```ts
type ClassificationSystem = 'clc' | 'ddc' | 'lcc' | 'udc' | 'other'

interface ProfileStatsInput {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  sources: Source[]
}

interface ProfileStatsOptions {
  /** 分类体系，缺省取各 Source 的 LibraryInfo.classificationSystem 多数票；仍空取 'clc' */
  classificationSystem: ClassificationSystem | null
  /** 时间范围（UTC），null 表示不限；用于按月/按年/甘特的区间裁剪 */
  range: { from: Date | null; to: Date | null } | null
  /** displayTimezone（IANA），仅影响轴标签呈现，不影响桶归属 */
  displayTimezone: string
}

interface ProfileStatsResult {
  summary: { totalBooks: number; totalCycles: number; inBorrow: number; avgDurationDays: number | null; medianDurationDays: number | null }
  classification: { name: string; code: string; category: string | null; value: number }[]   // treemap
  borrowVolume: { bucket: string; count: number }[]                                          // 按月（或按年，按数据跨度自动切粒度）
  durationDistribution: { range: string; count: number }[]                                     // 借阅时长直方图
  gantt: { laneKey: string; label: string; intervals: { start: string; end: string | null; status: BorrowCycle['status'] }[] }[]
}

function computeProfileStats(input: ProfileStatsInput, opts: ProfileStatsOptions): ProfileStatsResult
```

**各维度语义**：

1. **分类法分布 treemap**（`classification`）
   - 体系取 `opts.classificationSystem`；缺省度量为各 `Source.library.classificationSystem` 的多数票（无则 `'clc'`）。
   - 每个 `Book` 计一次，避免多 `CatalogRecord` 多副本重复计数。Book 的分类号取其 `CatalogRecord.classifications` 中**首选匹配体系**的条目；命中多条取首条；无匹配则归入 `未分类`（`code: '__unclassified__'`）。
   - CLC 归并到一级类目（取 `code` 首字母 A–Z，`category` 取 [catalog-record 分类号对照表]）；DDC 归并到一级（`code` 首位 0–9 + 主类名）；子类细分留作交互下钻（本里程碑不要求）。
   - treemap `value` = 归并后桶内 Book 数；`name` = 类目名（中/英随 locale）。

2. **借阅甘特带**（`gantt`）
   - lane = `bookId + barcode`（无 barcode 退化 `bookId + '__noBarcode__'`）；同 lane 的 `BorrowCycle` 按 `borrowedAt` 升序叠放为区间 `[borrowedAt, returnedAt]`。
   - `status='borrowed'` 的 `returnedAt=null`，区间呈现「在借」强调态；纯函数**不读 `Date.now()`**，`end` 在 dataset 层留 `null`，由图表组件在渲染时用 `useDeferredValue` 的 now 锚补齐仅作视觉，不回写聚合结果。
   - 大数据退化见 §11.5。

3. **借阅量柱图**（`borrowVolume`）
   - 按 `BorrowCycle.borrowedAt` 的 UTC 年月桶；数据跨度 ≤ 2 年用月粒度，> 2 年用年粒度（纯函数判定，与 displayTimezone 无关）。
   - `range` 非空时裁剪仅落入区间（左闭右开，UTC）的周期。

4. **借阅时长分布**（`durationDistribution`）
   - 仅 `status='returned'` 且 `returnedAt != null` 的周期计入。`duration = ceil((returnedAt - borrowedAt) / 86_400_000)`（对照 [borrow-cycle 派生计算]）。
   - 固定分桶：`0–7`/`8–14`/`15–30`/`31–60`/`>60`（天）；`status='borrowed'`/`unknown` 不计入，不进 `summary.avgDuration`。
   - `summary.avgDurationDays` 与 `medianDurationDays` 仅基于已归还周期；样本为 0 时记 `null`，UI 表达为 `—`。

### 11.3 ECharts 主题与薄适配层

`src/lib/echarts-theme.ts`（对照 design-decisions「图表选型」薄适配约束）：

 - 读 shadcn CSS 变量（`--background`/`--foreground`/`--muted-foreground`/`--chart-1..5` 等）组装 echarts theme 对象：palette 取 `--chart-1..5`（扩展按需循环）；坐标轴线/文字用 `--border`/`--muted-foreground`；tooltip 背景用 `--popover`/`--popover-foreground`。
 - 不在模块顶层读 DOM 变量；提供 `buildTheme(isDark: boolean, cssVars: Record<string,string>): EChartsTheme`，由消费方在 `.dark` class 切换时重建并 `setOption` 重应用。
 - 主题随暗色切换：`use-profile-stats` 监听根 `.dark`（沿用 §8.4 theme Provider 信号），变化时重建 theme 并更新各图实例；旧实例 `dispose` 防泄漏。
 - 数据色（蓝宝石/青绿方向）**只在本页发力**，其余界面保持冷静灰（design-decisions 阅读图谱方向 B）。
 - import 策略：`echarts` 核按需引入 `echarts/core` + 注册的图种（`TreemapChart`/`BarChart`/`CustomChart`）+ `CanvasRenderer`，不走 `echarts` barrel；shadcn 组件按需 import（`bundle-barrel-imports`）。ECharts 初始化组件用 `lazy()`/动态 import 在 `/profile` 激活时加载（`bundle-dynamic-imports`、`bundle-conditional`）。

### 11.4 UI 设计说明（布局/交互/状态/响应式）

**布局**（单页全幅，方向 B 图谱语言）：
 - 顶部一行概览统计卡片（藏书数 / 借阅周期数 / 在借数 / 平均借阅时长），等宽数字 + 标签；卡片窄、克制，不抢图谱视觉。
 - 卡片下方为图表区，竖向堆叠的「图谱块」：分类法 treemap（大块，高度 ≥ 320px）→ 借阅甘特带（高度按 lane 数自适应，≥ 280px）→ 借阅量柱图 + 时长分布（两列，移动端折叠为单列）。
 - 图表是主角、全幅；无外层装饰卡片包裹图谱块（§8.3 禁卡片套卡片），仅以 `border-t` 分隔。

**交互**：
 - 顶部工具条：分类体系切换（`SegmentedControl`：CLC/DDC/LCC/UDC，仅列数据中实际出现的体系）、时间范围（`Select`：全部 / 近 1 年 / 近 3 年 / 自定义区间）、displayTimezone 跟随设置（不在本页改，只显示当前值）。
 - 切换交互走 `useTransition` 标注非紧迫更新，期间图表区显示 `Skeleton`（不阻断概览卡片与导航，`rerender-transitions`/`rendering-usetransition-loading`）。
 - treemap 块下钻（点一级类目展开子类）为可选增强；本里程碑要求一级呈现可交互高亮与 tooltip，子类下钻标 TODO。
 - 无破坏性操作：本页只读，不做任何写库或重置入口。

**状态**：
 - 空态：无任何 Book/BorrowCycle 时，整页用 shadcn `Empty` + 导入入口（按钮跳 `/import`），图表区隐去占位（`rendering-conditional-render` 用三元，非 `&&`）。
 - 部分（仅有书无周期 / 仅有周期无书）相应图表块各自 `Empty` 变体，不整页空白。
 - 加载态：`useLiveQuery` 未就绪时 `Skeleton`；大数据 Worker 计算时 `Progress`。
 - 错误态：聚合抛错（数据异常的周期）被边界捕获，对应图谱块降级为 `Empty` + 错误文案（不崩溃整页）。

**响应式**：移动端单列堆叠，图表最小高度不塌缩；甘特带在窄屏启用横向滚动（`overflow-x-auto`）而非压缩 lane。所有可见文本经 `react-i18next` `t()`，namespace `pages`（`profile.*`），禁止硬编码中英文字面量（[i18n-conventions]）。

### 11.5 数据契约与边界（纯前端、UTC、空数据/大文件退化）

 - **纯前端/只读**：所有数据来自 IndexedDB（Dexie + `useLiveQuery`），无网络、无后端、无数据上传（§1/§8.6）。聚合为纯函数，结果不落库、不缓存到 localStorage。
 - **UTC 与 displayTimezone**：桶归属基于 UTC getter（`getUTCFullYear`/`getUTCMonth`），`displayTimezone` 仅用于轴标签（柱图 x 轴月份按 `Intl.DateTimeFormat` 用该时区呈现）。甘特区间的「在借」端点视觉锚由组件层以 `useDeferredValue` 的 now 补齐，**不改聚合产物**，保证可复现（对照 §10.3 确定性）。
 - **空数据**：`computeProfileStats` 对空入参返回结构完整但全零的 `ProfileStatsResult`（`classification=[]`/`gantt=[]`/...，`summary.*` 为 0 或 `null`），UI 映射为整页 `Empty`；聚合函数不抛空异常。
 - **大文件退化**（阈值对齐 §8.6 ≥50MB 导入约束的下游表现）：
   - `BorrowCycle` 数量 ≥ `GANTT_THRESHOLD`（候选 2000 条 lane / 5000 区间）时甘特带启用**视口下采样**：按当前甘特 x 域采样区间，域外折叠为「疏密指示条」；不一次性渲染全部矩形（canvas 压力）。
   - 聚合耗时阈值（候选 > 50ms）触发 Worker：`use-profile-stats` 小数据同步 `useMemo` 计算，大数据走 `stats-worker.ts`（Comlink，对照 design-decisions 并发与性能）。
   - treemap/柱图数据量为聚合后桶数（远小于原始记录），不单独退化；分类体系切换与时间范围变化用 `useDeferredValue` 延迟重算，输入与导航保持响应（`rerender-use-deferred-value`）。
   - 退化策略只降视觉保真，**不改统计正确性**：被下采样的区间仍计入 `borrowVolume`/`durationDistribution`/`summary`，仅甘特矩形数受视口约束。
 - **边界**：分类号缺失、`borrowedAt > returnedAt`（数据异常）等已在导入阶段落警告（§10.8）；聚合层对异常周期跳过计入 duration 桶但仍计入 `borrowVolume` 与甘特（带 `status` 标记），不二次告警、不丢区间。

### 11.6 用户故事与验收用例

 1. 作为新用户，空库打开 `/profile` → 看到 `Empty` + 导入入口，不出现空坐标轴或报错。
 2. 作为用户，导入脱敏数据后进入 `/profile` → 概览卡片数字正确（藏书数=Book 数、周期数=BorrowCycle 数、在借数=`status='borrowed'` 数、平均时长=已归还周期均值）。
 3. 作为用户，切换分类体系（CLC↔DDC）→ treemap 重建且类目名随 locale 变化；切换时间范围「近 1 年」→ 借阅量柱图与甘特仅显示区间内周期。
 4. 作为用户，切暗色 → 图表配色随 `.dark` 切换，无白底刺眼；刷新后偏好与主题保留（§8.4/§8.5 已落地）。
 5. 作为用户，切中英 → 概览卡片标签、treemap 类目名、坐标轴月份名、tooltip 均切换语言。
 6. 作为用户，大库（≥ GANTT_THRESHOLD）打开 `/profile` → 甘特带视口下采样，滚动顺畅、概览卡片与其他图表仍秒开；聚合结果数值与全量一致。
 7. 作为用户，存在 `borrowedAt > returnedAt` 异常数据 → 该周期在甘特标记异常态，不进入时长直方图，整页不崩溃。

### 11.7 测试清单（Vitest / Playwright）

**Vitest（单元/集成，`src/lib/profile-stats.test.ts` 等）**
 - `computeProfileStats` 空入参返回全零结构，不抛异常。
 - 分类体系缺省度量：多 Source 不同体系时取多数票；全空回退 `'clc'`。
 - CLC/DDC 一级归并正确（取首字母/首位 + 类名映射）；无分类号归入 `__unclassified__`。
 - Book 计一次：多 CatalogRecord 同 ISBN 不同分类号时 treemap 按首选体系条目计一次，不翻倍。
 - 时间桶：月/年粒度切换阈值（≤2 年月、>2 年年）正确；`range` 左闭右开裁剪生效；桶归属与 displayTimezone 无关（同输入不同 tz 桶相同）。
 - duration：`status='returned'` 计入，`borrowed/unknown` 不计；分桶边界（7/14/30/60 天）正确；空样本 `avg/median` 为 `null`。
 - 甘特：lane=`bookId+barcode`；无 barcode 退化；区间升序；`borrowed` 返回 `end=null`。
 - 纯函数性：同输入两次调用深等价；无 `Date.now()`（代码审计/依赖检查）。

**Playwright（E2E）**
 - `/profile` 空态：显示 `Empty` + 导入入口按钮，点击跳 `/import`。
 - 脱敏数据下 ECharts canvas 非空像素（treemap/柱图/甘特分别校验）。
 - 分类体系 `SegmentedControl` 切换后 canvas 重绘、类目 tooltip 文本随 locale 切换。
 - 暗色切换 → 图表配色变化（canvas 像素采样差异），reload 仍为暗色。
 - 大库夹具下甘特视口下采样：滚动流畅，不一次性渲染超量矩形（性能基线，可选）。

### 11.8 React 性能规则引用

 - `bundle-barrel-imports`：`echarts` 按 `echarts/core` + 按图种引入，shadcn 组件按需 import，避免 barrel 拉宽依赖。
 - `bundle-dynamic-imports` / `bundle-conditional`：ECharts 初始化与各图组件在 `/profile` 激活时动态加载。
 - `bundle-preload`：侧栏悬停 `/profile` 时预加载图表 chunk（可选增强）。
 - `rerender-lazy-state-init` / `rerender-derived-state-no-effect`：dataset 在 render 期由 `useMemo` 从 `useLiveQuery` 实体派生，不写 effect 同步 state。
 - `rerender-memo`：各图组件 `memo` 化，仅以自身 dataset 为依赖；概览卡片独立 memo，不被图表重算波及。
 - `rerender-transitions` / `rendering-usetransition-loading`：分类体系/时间范围切换用 `useTransition`，图表区配合 `Skeleton`。
 - `rerender-use-deferred-value`：大数据/范围变化用 `useDeferredValue` 延迟聚合重算，保输入响应。
 - `js-combine-iterations` / `js-index-maps` / `js-set-map-lookups`：聚合单遍建 `Map`（catalog→classification、bookId→book），避免重复线性查找。
 - `js-min-max-loop`：duration 分桶用一遍扫描，`avg`/`median` 用单遍求和与选择，不 `sort`。
 - `client-localstorage-schema`：本页只读 `readgraph:preferences`（displayTimezone），不写入；读侧仍受 §8.4 的 Zod 校验保护。
 - `rendering-conditional-render`：空态/部分空态图表块用三元表达式，不用 `&&` 渲染。
