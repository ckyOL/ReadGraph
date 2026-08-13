# ReadGraph 个人阅读智能档案系统

> 本文档面向 AI Coding Agent，定义了 ReadGraph 项目的核心概念、数据模型和设计约束。
>
> AI Agent 仓库操作速查见 [AGENTS.md](AGENTS.md)。本文档为核心概念与数据模型的权威源；功能规格以 [docs/app-spec.md](docs/app-spec.md) §6 索引为准；脚本契约与安全基线以 [docs/app-spec.md](docs/app-spec.md) 与 [docs/npm-supply-chain-security.md](docs/npm-supply-chain-security.md) 为准。

## 项目概述

ReadGraph 是一个**纯前端**的个人阅读智能档案系统。用户从个人来源（公共图书馆 OPAC 导出、Libby 等电子借阅平台）获取借阅/归还数据（JSON/CSV），导入系统后生成个性化阅读画像与可视化分析。无后端、无联网数据上传，可静态部署与离线使用。

**当前功能面（2026-08）：**

- **导入**：单屏导入向导；多来源 Parser（szlib 为首个实现）；编码检测、无用行过滤、警告分组报告；跨文件合并与去重（保留既有周期/编目）。
- **书库**：列表筛选/排序、深度分类名徽标、占位与套装徽标；详情页统一编辑 Dialog（Book 全字段 + 编目卷号/条码/分类，保存即解除待审）、合并/拆书。
- **补全**：OPAC 编目补全（szlib Provider，详情页逐本工作流 + 翻页，字段级新旧对照与恢复，`CatalogRecord.opacEnrichment` 审计）。
- **分类**：中图分类法（CLC）路径解析与树形钻取；分类数据由用户提供 JSON 外部加载，不含捆绑内容。
- **画像**：阅读画像统计与 ECharts 图表（含金额/价格分布）；非书设备借阅单独识别并从统计中排除。
- **设置**：tzdb 时区城市下拉、zh-CN/en 双语、备份导出/恢复、整体重置、调试模式（`?debug=1`）。

**关键约束：**

- 纯前端项目，无后端服务；所有数据存储在浏览器端（IndexedDB / localStorage）
- 数据来源为用户手动导入的文件（JSON/CSV）
- 支持多来源数据合并与去重（物理副本按 `sourceId + barcode`，书目按 `isbn13`，兜底 title+author，置标待审）
- 时间统一为 UTC ISO 8601；解析时经 `source.timezone` 转本地
- UI 文案一律经 react-i18next `t()` 本地化（zh-CN / en），杜绝 JSX 字面量

## 数据层次架构

```
┌─────────────────────────────────────────────────┐
│                  导入层 (Import)                  │
│  原始文件 → Parser → RawRecord + ImportLog        │
│                                                   │
│  元数据解析层 (Parse)                             │
│  RawRecord → 实体提取 → Book + CatalogRecord      │
│                      → BorrowCycle 合成           │
├─────────────────────────────────────────────────┤
│                  补全层 (Enrich)                  │
│  OPAC Provider → OpacDetail → 字段级建议/应用     │
│  (CatalogRecord.opacEnrichment 审计)             │
├─────────────────────────────────────────────────┤
│                  核心层 (Core)                    │
│  Book (书目) ← CatalogRecord (编目) ← BorrowCycle │
│  分类解析 (CLC 路径/树) 作用于 classifications    │
├─────────────────────────────────────────────────┤
│                  来源层 (Source)                  │
│  Library (含电子借阅平台) / Manual                │
└─────────────────────────────────────────────────┘
```

## 实体关系

```
Source (1) ─────────< (N) ImportLog
                              │
ImportLog (1) ──────< (N) RawRecord
                              │
Source (1) ─────────< (N) CatalogRecord
                              │
CatalogRecord (1) ──< (N) BorrowCycle
                              │
Book    (1) ─────────< (N) CatalogRecord
Book    (1) ─────────< (N) BorrowCycle (via CatalogRecord)
```

**实体字段要点**（权威定义见各元数据文档与 `src/db/schemas.ts`）：

| 实体 | 要点字段 |
|------|---------|
| Book | `isbn13`/`isbn10`、`title`+`subtitle`+`parallelTitles`、`authors`/`translators`、`publisher`/`publishDate`/`price`、`coverUrl`/`description`、`needsReview`、`materialType`（`'book'`/`'device'`）、`sourceIds` |
| CatalogRecord | `metaId`/`metaIdKey`（索引与去重键）、`barcodes`、`classifications`（分类法+分类号）、`opacEnrichment`（providerId/status/fetchedAt/sourceUrl）、`volume`（套装卷号）；归属馆 `owningBranch` 为**派生值**，由 `src/lib/branch-prefix.ts` 注册表按 parserId 解析，非存储字段 |
| BorrowCycle | `borrowedAt`/`returnedAt`/`status`（borrowed/returned/unknown）、`borrowLocation`/`returnLocation`、`barcode`、`rawRecordIds`（溯源） |
| Source | `type`（`'library'`/`'manual'`）、`parserId`、`timezone`、`library`（馆类型/城市/OPAC URL/分类法） |
| ImportLog / RawRecord | 导入溯源：文件、编码、parser、逐行解析状态与警告 |

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/app-spec.md](./docs/app-spec.md) | 应用规格骨架；§6 功能规格索引、§3 目录结构、§4 脚本契约、§5 安全基线 |
| [docs/design-decisions.md](./docs/design-decisions.md) | 设计决策与约束（时间、去重、隐私） |
| [docs/ai-agent-workflow-rules.md](./docs/ai-agent-workflow-rules.md) | AI Agent SDD + TDD 工作流规则 |
| [docs/i18n-conventions.md](./docs/i18n-conventions.md) | i18n 本地化约定 |
| [docs/npm-supply-chain-security.md](./docs/npm-supply-chain-security.md) | 供应链安全基线（pnpm 11 策略） |
| [DESIGN.md](./DESIGN.md) | 视觉设计：主题、配色、排版、组件样式 |
| [docs/metadata/book.md](./docs/metadata/book.md) | 书籍信息元数据 |
| [docs/metadata/catalog-record.md](./docs/metadata/catalog-record.md) | 编目记录（本地馆藏映射）元数据 |
| [docs/metadata/borrow-cycle.md](./docs/metadata/borrow-cycle.md) | 借阅周期元数据 |
| [docs/metadata/source.md](./docs/metadata/source.md) | 数据来源元数据 |
| [docs/metadata/import-workflow.md](./docs/metadata/import-workflow.md) | 导入流程规范（编码、生命周期） |
| [docs/metadata/internal-schema.md](./docs/metadata/internal-schema.md) | 内部存储 Schema（IndexedDB 结构、索引） |
| [docs/metadata/parsers/szlib-parser.md](./docs/metadata/parsers/szlib-parser.md) | 深圳图书馆 Parser 设计（含条码→归属馆规则） |
| [docs/metadata/parsers/contributing-parser.md](./docs/metadata/parsers/contributing-parser.md) | 贡献新 Parser 指南 |
| [docs/tasks/ui-unified-batch.md](./docs/tasks/ui-unified-batch.md) | UI 统一里程碑任务分解 |

### 功能规格（[docs/specs/](./docs/specs/)）

各功能落地前先补规格，见 app-spec §6 索引；SDD + TDD 要求见 ai-agent-workflow-rules。

| 规格 | 说明 |
|------|------|
| [import-pipeline.md](./docs/specs/import-pipeline.md) | 导入管线：Parser 注册表、纯函数 pipeline、去重、时区、警告模型 |
| [data-layer.md](./docs/specs/data-layer.md) | 数据层：Dexie schema、Repository、迁移策略、索引 |
| [ui-navigation.md](./docs/specs/ui-navigation.md) | UI 导航：路由树、页面布局与空状态 |
| [book-editing.md](./docs/specs/book-editing.md) | 统一编辑：详情页 Dialog、合并/拆书、卷号语义、待审类型 |
| [opac-enrichment.md](./docs/specs/opac-enrichment.md) | OPAC 补全：Provider 架构、字段映射、两阶段执行 |
| [classification-hierarchy.md](./docs/specs/classification-hierarchy.md) | CLC 分类：层次/路径解析、外部数据契约 |
| [reading-profile.md](./docs/specs/reading-profile.md) | 阅读画像：聚合契约、图表主题、价值统计 |
| [device-borrows.md](./docs/specs/device-borrows.md) | 设备借阅区分与统计排除 |
| [branch-library.md](./docs/specs/branch-library.md) | 条码前缀 → 归属馆解析 |
| [debug-mode.md](./docs/specs/debug-mode.md) | 调试模式与导入决策 Trace |
| [settings.md](./docs/specs/settings.md) | 设置：偏好持久化、备份导出、整体重置 |

## 数据流

```
用户文件 (JSON/CSV)
    │
    ▼
┌──────────────────┐
│  Source Parser   │ ← 根据 Source.parserId 匹配
│  (per-source)    │
└──────┬───────────┘
       │ 解析 & 标准化
       ▼
┌──────────────────┐
│  Normalizer      │ ← 时区转换 (UTC)、字段映射、ISBN 清洗
└──────┬───────────┘
       │
       ▼
┌──────────────────────────────┐
│  Entity Extractor            │ ← 提取 Book + CatalogRecord
│  + BorrowCycle Synthesizer   │ ← 借还配对 → BorrowCycle
└──────────┬───────────────────┘
           │
           ▼
┌──────────────────┐
│  Deduplicator    │ ← 优先 sourceId+barcode，次之 ISBN，兜底 title+authors
└──────┬───────────┘
       │
       ▼
┌──────────────────────────────┐
│  OPAC Enrichment (可选)       │ ← Provider 抓取 → 字段级建议/应用
│  CLC Classification          │ ← 用户 JSON 数据 → 分类路径/树钻取
└──────┬───────────────────────┘
       │
       ▼
┌──────────────────┐
│  IndexedDB       │ ← Book + CatalogRecord + BorrowCycle
│  (Browser)       │   + Source + RawRecord + ImportLog
└──────────────────┘
```
