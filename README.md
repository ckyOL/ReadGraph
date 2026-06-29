# ReadGraph 个人阅读智能档案系统

> 本文档面向 AI Coding Agent，定义了 ReadGraph 项目的核心概念、数据模型和设计约束。

## 项目概述

ReadGraph 是一个**纯前端**的个人阅读智能档案系统。用户从个人来源（公共图书馆 OPAC 导出、Libby 等电子借阅平台）获取借阅/归还数据（JSON/CSV），导入系统后生成个性化阅读画像与可视化分析。

**关键约束：**
- 纯前端项目，无后端服务
- 所有数据存储在浏览器端（IndexedDB / localStorage）
- 数据来源为用户手动导入的文件（JSON/CSV）
- 支持多来源数据合并与去重

## 数据层次架构

```
┌─────────────────────────────────────────────────┐
│                  导入层 (Import)                  │
│  原始数据 → Parser → RawRecord + ImportLog       │
│                                                   │
│  元数据解析层 (Parse)                             │
│  RawRecord → 实体提取 → Book + CatalogRecord      │
│                      → BorrowCycle 合成           │
├─────────────────────────────────────────────────┤
│                  核心层 (Core)                    │
│  Book (书目) ← CatalogRecord (编目) ← BorrowCycle │
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

## 文档索引

| 文档 | 说明 |
|------|------|
| [docs/metadata/book.md](./docs/metadata/book.md) | 书籍信息元数据 |
| [docs/metadata/catalog-record.md](./docs/metadata/catalog-record.md) | 编目记录（本地馆藏映射）元数据 |
| [docs/metadata/borrow-cycle.md](./docs/metadata/borrow-cycle.md) | 借阅周期元数据 |
| [docs/metadata/source.md](./docs/metadata/source.md) | 数据来源元数据 |
| [docs/metadata/import-workflow.md](./docs/metadata/import-workflow.md) | 导入流程规范（编码、生命周期） |
| [docs/metadata/internal-schema.md](./docs/metadata/internal-schema.md) | 内部存储 Schema（IndexedDB 结构、索引） |
| [docs/metadata/parsers/szlib-parser.md](./docs/metadata/parsers/szlib-parser.md) | 深圳图书馆 Parser 设计 |
| [docs/metadata/parsers/contributing-parser.md](./docs/metadata/parsers/contributing-parser.md) | 贡献新 Parser 指南 |
| [docs/design-decisions.md](./docs/design-decisions.md) | 设计决策与约束说明 |
| [docs/ai-agent-workflow-rules.md](./docs/ai-agent-workflow-rules.md) | AI Agent SDD + TDD 工作流规则 |

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
┌──────────────────┐
│  IndexedDB       │ ← Book + CatalogRecord + BorrowCycle
│  (Browser)       │   + Source + RawRecord + ImportLog
└──────────────────┘
```

## 文档分类导航

### 数据模型（`docs/metadata/`）
- **核心实体**: [Book](./docs/metadata/book.md), [CatalogRecord](./docs/metadata/catalog-record.md), [BorrowCycle](./docs/metadata/borrow-cycle.md)
- **存储与来源**: [Source](./docs/metadata/source.md), [Internal Schema](./docs/metadata/internal-schema.md)
- **导入流程**: [Import Workflow](./docs/metadata/import-workflow.md)
- **Parser 开发**: [szlib-parser](./docs/metadata/parsers/szlib-parser.md), [Contributing Parser](./docs/metadata/parsers/contributing-parser.md)

### 项目规则（`docs/`）
- [Design Decisions](./docs/design-decisions.md) — 设计原则、技术选型、安全隐私
- [AI Agent Workflow Rules](./docs/ai-agent-workflow-rules.md) — SDD + TDD 开发规范
