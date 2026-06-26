# ReadGraph 元数据设计文档

> 本文档面向 AI Coding Agent，定义了 ReadGraph 项目的核心数据模型和设计约束。

## 项目概述

ReadGraph 是一个**纯前端**的个人阅读智能档案系统。用户从个人来源（公共图书馆 OPAC 导出、微信读书、Kindle 等）获取借阅/阅读数据（JSON/CSV），导入系统后生成个性化阅读画像与可视化分析。

**关键约束：**
- 纯前端项目，无后端服务
- 所有数据存储在浏览器端（IndexedDB / localStorage）
- 数据来源为用户手动导入的文件（JSON/CSV）
- 支持多来源数据合并与去重

## 数据层次架构

```
┌─────────────────────────────────────────────────┐
│                  导入层 (Import)                  │
│  原始数据 → Source Parser → 标准化数据            │
├─────────────────────────────────────────────────┤
│                  核心层 (Core)                    │
│  Book (书籍) ← BorrowCycle (借阅周期)            │
├─────────────────────────────────────────────────┤
│                  来源层 (Source)                   │
│  LibrarySource (图书馆源) / ReaderSource (阅读器源) │
└─────────────────────────────────────────────────┘
```

## 文档索引

| 文档 | 说明 |
|------|------|
| [book.md](./book.md) | 书籍信息元数据 |
| [borrow-cycle.md](./borrow-cycle.md) | 借阅周期元数据 |
| [source.md](./source.md) | 数据来源（图书馆/阅读器）元数据 |
| [import-format.md](./import-format.md) | 导入数据格式规范 |
| [internal-schema.md](./internal-schema.md) | 内部存储 Schema（标准化后） |
| [design-decisions.md](./design-decisions.md) | 设计决策与约束说明 |

## 数据流

```
用户文件 (JSON/CSV)
    │
    ▼
┌──────────────────┐
│  Source Parser    │ ← 根据 source.type + source.parser 选择
│  (per-source)    │
└──────┬───────────┘
       │ 解析 & 标准化
       ▼
┌──────────────────┐
│  Normalizer      │ ← 时区转换、字段映射、ISBN 校验
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  Deduplicator    │ ← 基于 ISBN / 条码号去重
└──────┬───────────┘
       │
       ▼
┌──────────────────┐
│  IndexedDB       │ ← Book + BorrowCycle + Source
│  (Browser)       │
└──────────────────┘
```
