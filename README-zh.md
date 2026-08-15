<div align="center">

# ReadGraph

**个人阅读智能档案系统 — 把图书馆借阅历史变成你的阅读画像。**

从公共图书馆或电子借阅平台导出借阅/归还数据（JSON/CSV），导入后生成个性化阅读画像与可视化图表。纯前端，数据只存浏览器，可完全离线使用。

![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6)
![Vite](https://img.shields.io/badge/Vite-8-646CFF)
![Tailwind CSS v4](https://img.shields.io/badge/Tailwind%20CSS%20v4-38BDF8)
![ECharts](https://img.shields.io/badge/ECharts-6-AA344D)
![IndexedDB](https://img.shields.io/badge/IndexedDB-Dexie-02569B)
![License](https://img.shields.io/badge/License-MIT-yellow)
![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen)

[English](./README.md) · **简体中文**

</div>

## 功能特性

- **导入与去重** — 单屏导入向导；支持多来源 JSON/CSV（深圳图书馆 OPAC 为首个实现）；编码自动检测；跨文件合并，按 条码 → ISBN → 题名+作者 依次去重。
- **书库与编辑** — 列表筛选、排序、深度分类名徽标；详情页统一编辑对话框；合并 / 拆书；套装卷号处理。
- **OPAC 编目补全** — 从图书馆目录自动补全缺失书目信息（译者、ISBN-10、简介、封面等），应用前提供字段级新旧对照。
- **分类** — 中图分类法（CLC）层级解析与面包屑钻取；分类数据由你提供 JSON 文件，仓库不捆绑任何内容。
- **阅读画像** — 统计与 ECharts 可视化：阅读节奏、时间线、矩形树图、消费金额与价格分布；电子书阅读器等设备借阅单独记录并从统计中排除。
- **设置** — 时区城市选择（tzdb）、中英双语界面、备份导出/恢复、整体重置、调试模式（`?debug=1`）。

## 快速开始

### 环境要求

- Node.js ≥ 20
- pnpm 11

### 安装与开发

```bash
pnpm install --frozen-lockfile   # 必须使用 frozen-lockfile
pnpm dev                         # 启动开发服务器
```

### 构建与测试

```bash
pnpm build                       # 类型检查 + 生产构建
pnpm preview                     # 预览生产构建
pnpm test                        # 单元/集成测试（Vitest）
pnpm test:e2e                    # 端到端测试（Playwright）
pnpm audit --audit-level=high    # 安全审计
```

## 数据来源

- 内置 **深圳图书馆** 导出解析器 — `szlib_scraper/` 提供从图书馆移动端 API 抓取借阅历史的工具。
- 其他来源（图书馆 OPAC、Libby 等）按 `SourceParser` 契约接入，见 [contributing-parser.md](./docs/metadata/parsers/contributing-parser.md)。
- 数据全部由你手动导入自有文件；应用本身不在运行时联网抓取（除你逐本触发的可选 OPAC 补全）。

## 技术栈

| 层 | 选型 |
|----|------|
| 框架 | React 19 + TypeScript（严格模式） |
| 构建 | Vite 8 |
| 路由 | TanStack Router（文件路由，类型安全） |
| 存储 | Dexie.js over IndexedDB + Zod schema |
| UI | Tailwind CSS v4 + shadcn/ui |
| 图表 | ECharts |
| 国际化 | i18next（简体中文 / English） |
| 测试 | Vitest + Playwright |

## 文档

| 文档 | 说明 |
|------|------|
| [docs/app-spec.md](./docs/app-spec.md) | 应用规格骨架与功能规格索引 |
| [docs/specs/](./docs/specs/) | 功能规格：导入管线、OPAC 补全、分类、阅读画像、编辑、设置等 |
| [docs/metadata/](./docs/metadata/) | 数据模型：`Book` / `CatalogRecord` / `BorrowCycle` / `Source`、IndexedDB 内部结构 |
| [docs/design-decisions.md](./docs/design-decisions.md) | 设计决策与约束（时间处理、去重、隐私） |
| [DESIGN.md](./DESIGN.md) | 视觉设计规范（主题、排版、组件） |
| [AGENTS.md](./AGENTS.md) | 仓库约定与命令（含面向 AI Agent 的说明） |
| [CONTRIBUTING-zh.md](./CONTRIBUTING-zh.md) | 贡献指南：工作流、约定、PR 清单（简体中文） |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Contribution guide (English) |
| [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) | 社区行为准则 |

## 隐私与安全

- **纯前端** — 所有数据存于浏览器 IndexedDB，不上传任何服务器。
- **可离线** — 静态部署即可使用，无需网络。
- **供应链加固** — pnpm 11 强制 7 天发布冷却（`minimumReleaseAge`）、锁定 lockfile、强制 HTTPS；见 [docs/npm-supply-chain-security.md](./docs/npm-supply-chain-security.md)。
- **仓库不含真实个人数据** — 读者证号 / IP 一律不得提交，测试夹具均已脱敏。

## 许可证

MIT —— 见 [LICENSE](./LICENSE)。运行时依赖的第三方许可声明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 参与贡献

欢迎一切贡献 —— bug 反馈、功能建议、为你的图书馆新增解析器、文档与翻译。

- 请先阅读 **[CONTRIBUTING-zh.md](./CONTRIBUTING-zh.md)**（[English](./CONTRIBUTING.md)）：涵盖 SDD + TDD 工作流、编码约定、供应链安全规则、隐私要求与 PR 检查清单。
- 所有社区互动遵循 [Code of Conduct](./CODE_OF_CONDUCT.md)（行为准则）。
- 通过 [issue 模板](.github/ISSUE_TEMPLATE/) 提交 bug 报告与功能请求。

尤其欢迎新增解析器（见 [contributing-parser.md](./docs/metadata/parsers/contributing-parser.md)）：把您所在图书馆的导出格式接入 ReadGraph。
