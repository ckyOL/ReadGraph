# 为 ReadGraph 贡献

感谢你花时间参与贡献。ReadGraph 是一个纯前端个人阅读档案系统：导入图书馆或电子书平台的借阅/归还数据，生成带图表的阅读画像——所有数据只保存在你的浏览器里。

本指南说明如何报告问题、请求功能与提交变更。它是每份贡献的契约：先规格、先测试、先隐私。

## 目录

- [行为准则](#行为准则)
- [快速开始](#快速开始)
- [如何贡献](#如何贡献)
  - [报告 Bug](#报告-bug)
  - [请求功能](#请求功能)
  - [贡献 Parser](#贡献-parser)
  - [文档与翻译](#文档与翻译)
- [开发工作流：SDD + TDD](#开发工作流sdd--tdd)
- [编码约定](#编码约定)
- [测试与验证](#测试与验证)
- [依赖与供应链安全](#依赖与供应链安全)
- [隐私与数据处理](#隐私与数据处理)
- [提交信息约定](#提交信息约定)
- [Pull Request 检查清单](#pull-request-检查清单)
- [评审流程](#评审流程)
- [许可证](#许可证)

## 行为准则

保持尊重、建设性与包容。参与本项目即表示你同意遵守我们的[行为准则](./CODE_OF_CONDUCT.md)。对不可接受行为的举报请联系维护者（通过 GitHub 通知或私信），详见行为准则。

## 快速开始

### 环境要求

- Node.js ≥ 20（`engines.node` 强制校验）
- pnpm 11 —— 仓库锁定 `packageManager: pnpm@11.9.0`，不得使用其他包管理器安装

### 安装与开发

```bash
pnpm install --frozen-lockfile   # 必须使用 frozen-lockfile
pnpm dev                         # Vite 开发服务器 → http://localhost:5173
```

> 禁止运行普通 `pnpm install`、`pnpm install --force` 或 `--shamefully-hoist` —— 见[依赖与供应链安全](#依赖与供应链安全)。

### 常用脚本

| 命令 | 用途 |
|------|------|
| `pnpm dev` | 开发服务器（Vite） |
| `pnpm build` | 类型检查 + 生产构建 |
| `pnpm preview` | 预览生产构建 |
| `pnpm test` | 单元 / 集成测试（Vitest） |
| `pnpm test:e2e` | 端到端测试（Playwright） |
| `pnpm lint` | 代码检查（oxlint） |
| `pnpm verify` | frozen 安装 + 供应链复校验 |
| `pnpm audit --audit-level=high` | 安全审计 |
| `pnpm generate:notices` | 重新生成 `THIRD_PARTY_NOTICES.md` |
| `pnpm generate:cities` | 重新生成 tzdb 城市列表 |
| `pnpm check:classification-data` | 校验分类 JSON |

爬虫工具（Python ≥ 3.10，uv）：`cd szlib_scraper && uv sync && uv run szlib_scraper.py`。

### 仓库结构

```
src/            应用代码：parsers/、db/、lib/、routes/、components/
docs/           规格与约定 —— 变更行为前务必阅读
  specs/          功能规格（导入管线、OPAC 补全、……）
  metadata/       数据模型与 parser 指南
e2e/            Playwright 端到端测试
tests/          Vitest 单元 / 集成测试
szlib_scraper/  深圳图书馆借阅历史 Python 爬虫
scripts/        代码生成与校验脚本
```

## 如何贡献

### 报告 Bug

使用 [bug 报告模板](./.github/ISSUE_TEMPLATE/bug_report.md) 提交 issue。一份好的报告包含：

1. 复现步骤（导入的文件形态、执行的操作）。
2. 期望行为与实际行为。
3. 环境：浏览器及版本、操作系统、应用版本/提交号。
4. 数据来源（导出数据来自哪个图书馆 / 平台）。

**隐私优先：** 切勿附带含读者证号、IP 或真实姓名的原始导出、截图或日志。先脱敏——见[隐私与数据处理](#隐私与数据处理)。

### 请求功能

ReadGraph 采用**规格驱动（SDD）**：没有经协商一致的规格，功能不会开工。请求功能时：

1. 描述你想解决的问题，而非仅仅一个期望的 UI。
2. 概述期望行为；涉及 UI 时附上布局 / 交互说明。
3. 如相关，引用 [docs/specs/](./docs/specs/) 中的既有规格。

维护者会在 issue 中帮你完善规格，然后才写代码。见[开发工作流](#开发工作流sdd--tdd)。

### 贡献 Parser

新图书馆 / 平台解析器是最有价值的贡献——项目目标是支持全球各地图书馆。请遵循专门指南：[docs/metadata/parsers/contributing-parser.md](./docs/metadata/parsers/contributing-parser.md)。

要点速览：

- **只用真实抓包数据** —— 不要凭空想象或依赖官方"理想报表"；通过浏览器 Network 面板抓取真实 API 响应。
- 纯前端实现 `SourceParser` 契约 —— 不得使用 Node.js 专属 API（`fs` 等）。
- 通过 `source.timezone` 将本地时间转换为 UTC ISO 8601。
- 注册 parser 并补充来源模板，方便普通用户一键使用。
- 附带**脱敏后**的样例数据作为单元测试夹具。

### 文档与翻译

- 行为变更必须同步更新 `docs/specs/` 中相关规格。
- 面向用户的功能变更必须同时更新 [README.md](./README.md) 与 [README-zh.md](./README-zh.md)。
- 文档遵循既有约定；不允许在既有约定旁另起一套。

## 开发工作流：SDD + TDD

每份代码变更都走这个循环：

1. **规格** —— 先协商一致规格（`docs/specs/` 文档或详细的 issue），前端工作须含 UI 设计说明。先读既有设计意图：`docs/design-decisions.md`、`docs/app-spec.md`。
2. **测试（红）** —— 先写失败测试：单元/集成用 Vitest，端到端/UI 用 Playwright。验证测试在现有代码下确实失败，证明其具备拦截回归的能力。
3. **代码（绿）** —— 实现让测试通过的最小改动。
4. **重构** —— 在绿灯套件保护下清理代码（DRY、命名、性能）；不得破坏既有测试。

该工作流（含进程/端口卫生规则）详见 [docs/ai-agent-workflow-rules.md](./docs/ai-agent-workflow-rules.md)。

## 编码约定

- **技术栈：** TypeScript（严格模式）、React 19、Tailwind CSS v4 + shadcn/ui、Dexie over IndexedDB、Zod schema。
- **国际化：** 所有 UI 文案必须走 `react-i18next` 的 `t()` —— JSX 中不得出现字符串字面量。
- **时间：** 统一使用 UTC ISO 8601；parser 通过 `source.timezone` 转换本地时间。
- **去重：** 物理副本按 `sourceId + barcode`；书目合并按 `isbn13`，回退到题名+作者（标记待审）。
- **Parser：** 在 `src/parsers/` 下实现 `SourceParser`，仅浏览器端运行。
- **模式：** 复用既有约定；动手前先浅层探索（`read` / `grep` / `glob`）。

## 测试与验证

提交 PR 前：

1. `pnpm build` —— 类型检查 + 生产构建必须通过。
2. `pnpm test` —— 完整 Vitest 套件必须通过；新行为需要自己的测试。
3. `pnpm test:e2e` —— 运行受影响的 e2e 用例（Playwright 会自行构建/预览）。
4. `pnpm lint` —— oxlint 无告警。

进程卫生（来自 [docs/ai-agent-workflow-rules.md](./docs/ai-agent-workflow-rules.md)）：

- 结束后必须关闭自己启动的所有进程（`pnpm dev`、Playwright 服务器、headless Chrome）；用 `lsof -iTCP:<port> -sTCP:LISTEN` 确认端口已释放。
- 并行 worktree 必须显式指定唯一端口（`pnpm dev --port 5174`，……）——不得依赖 Vite 自动递增或静默复用被占端口。

## 依赖与供应链安全

项目用 pnpm 11 加固供应链。不可谈判的规则：

- 只允许 `pnpm install --frozen-lockfile`；必须提交 `pnpm-lock.yaml`。
- `minimumReleaseAge: 10080`（7 天发布冷却）对所有依赖生效——发布不足 7 天的新包会被拒绝。
- **不得**弱化 `.npmrc`（`registry`、`strict-ssl`）或 `pnpm-workspace.yaml`（`minimumReleaseAge`、`allowBuilds`、`blockExoticSubdeps`）；禁止 `--force` 与 `--shamefully-hoist`；禁止 git URL / 直链 tarball 依赖。

任何新依赖必须完成 [docs/npm-supply-chain-security.md](./docs/npm-supply-chain-security.md) 中的审查清单并在 PR 中记录结论：必要性、包名拼写（防 typosquatting）、维护者健康度、下载量、依赖树（`pnpm why`）、构建脚本、行为分析（socket.dev）、许可证、发布时间。Lockfile diff 属安全敏感变更，须人工审查。

## 隐私与数据处理

本项目对个人数据零容忍：

- **严禁提交** 读者证号（`cardno`）、IP 地址或真实姓名 —— 夹具、样本、截图、原始导出（`bugfile/`、Libby JSON）一律不得包含。
- 真实抓取的夹具 / 样本**必须脱敏**：清除 `cardno` / IP，并虚构化题名、作者与馆名 —— 同时保留 parser 需要解析的结构特征（副题名、并列题名、卷号、作者分隔符）。
- 拿不准就删掉。

## 提交信息约定

- Conventional Commits，简短带 scope，主题与正文用英文。
- 示例：`feat(import): support Libby JSON export`、`fix(db): dedupe borrow cycles by barcode`、`refactor(metadata): add metaIdKey`。
- 每个 commit / PR 只做一件逻辑变更。

## Pull Request 检查清单

- [ ] 行为变更引用了对应规格（`docs/specs/` 或关联 issue）。
- [ ] 测试先行编写且现已通过；新契约有测试覆盖。
- [ ] 本地 `pnpm build`、`pnpm test`、`pnpm lint` 通过；受影响的 e2e 用例通过。
- [ ] 无新依赖 —— 或有新依赖且全部通过供应链审查清单，结论已记录。
- [ ] Lockfile diff 已审查；无弱化安全设置。
- [ ] 未提交个人数据；夹具已脱敏。
- [ ] 文档已更新：相关规格、README 和/或 README-zh；运行时依赖变更时用 `pnpm generate:notices` 重新生成 `THIRD_PARTY_NOTICES.md`。
- [ ] PR 描述说明变更内容；parser 相关改动说明数据流。

## 评审流程

- 维护者评审每份 PR；请做好被提问与被要求修改的准备。
- 回应全部反馈；分支保持与 `main` 同步。
- Parser PR 必须包含：图书馆 / 平台名称、复现数据抓取的简要指引、脱敏样例（用作单元测试）。

## 许可证

提交贡献即表示你同意你的贡献以与项目相同的 [MIT License](./LICENSE) 授权。
