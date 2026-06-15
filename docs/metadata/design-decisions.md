# Design Decisions 设计决策与约束

> AI Agent 指引：本文档记录了关键设计决策和约束条件。在实现过程中遇到选择时，参考此文档。

## 核心设计原则

### 1. 纯前端，零依赖后端

**决策**: 所有数据处理和存储完全在浏览器端完成。

**原因**:
- 隐私优先：用户的阅读记录是敏感个人数据
- 零部署成本：可作为静态站点部署（GitHub Pages, Vercel 等）
- 离线可用：所有功能不依赖网络

**约束**:
- 不可使用需要后端的功能（如 OAuth、服务端 API 调用）
- 数据量受浏览器 IndexedDB 配额限制（通常 > 1GB，足够）
- 计算密集型任务需注意 UI 阻塞（使用 Web Worker）

### 2. UTC 内部存储，本地时间显示

**决策**: 所有时间在存储层统一为 UTC，仅在 UI 层转换为本地时间。

**原因**:
- 用户可能从不同时区的图书馆导入数据
- 统一为 UTC 避免时间比较错误
- 适配国际化场景

**约束**:
- Parser 必须使用 Source.timezone 将原始时间转换为 UTC
- UI 层必须将 UTC 转换为用户本地时间显示
- 导出数据保持 UTC 格式

### 3. 借还配对在导入时完成

**决策**: 借还记录的配对（合成 BorrowCycle）在 Parser 解析阶段完成，而非存储原始借/还记录后再配对。

**原因**:
- 配对逻辑与数据来源格式强相关
- 一次性完成避免后续重复计算
- 保留原始记录在 rawRecords store 中，可随时重新解析

**约束**:
- 每个 Parser 必须实现自己的配对逻辑
- 配对结果不完整时（如只有借出记录），仍创建 BorrowCycle 记录（status='borrowed'）
- 保留 rawRecordIds 用于溯源

### 4. ISBN-13 作为书籍主要去重键

**决策**: 使用 ISBN-13 作为跨来源书籍去重的主要标识符。

**原因**:
- ISBN 是全球唯一的图书标识符
- 不同图书馆对同一本书的编目可能有差异（书名格式、作者名等）
- ISBN-13 是当前标准，ISBN-10 可单向转换为 ISBN-13

**约束**:
- 部分老旧图书或内部资料无 ISBN，需降级为模糊匹配
- ISBN 校验失败时记录警告但不阻止导入
- 同一 ISBN 的不同版次/印次视为同一本书

### 5. 分类号作为阅读偏好分析的核心维度

**决策**: 使用中图分类号（CLC）作为阅读偏好分析的主要维度。

**原因**:
- 国内图书馆普遍使用 CLC 分类
- 层次化结构适合多粒度分析（大类 → 小类）
- 数据在图书馆系统中天然存在

**约束**:
- 电子阅读平台通常没有 CLC 分类号，需要通过 ISBN 反查或用户手动标注
- CLC 一级分类足以满足大部分可视化需求
- 需维护 CLC 代码 → 中文名称的映射表

---

## 数据模型关系

```
Agent 实现要点：理解实体关系对正确实现查询和 UI 至关重要

Source (1) ─────────< (N) BorrowCycle
                          │
                          │ bookId
                          │
Book   (1) ─────────< (N) BorrowCycle

Source (1) ─────────< (N) ImportLog
                          │
                          │ importLogId
                          │
ImportLog (1) ──────< (N) RawRecord

Book.barcodes[].sourceId ───> Source.id
Book.sourceIds[] ───────────> Source.id
BorrowCycle.rawRecordIds[] ─> RawRecord.id
```

**关键关系说明**:
- 一本 Book 可以有多个 BorrowCycle（多次借阅）
- 一个 Source 可以有多个 BorrowCycle（从一个馆借了很多次）
- 一本 Book 可以关联多个 Source（不同图书馆都有这本书）
- BorrowCycle 同时关联 Book 和 Source

---

## 技术选型建议

| 类别 | 推荐 | 备选 | 说明 |
|------|------|------|------|
| 框架 | React + Vite | Vue + Vite | 生态成熟，组件丰富 |
| 状态管理 | Zustand | Jotai | 轻量，适合中等复杂度 |
| IndexedDB 封装 | Dexie.js | idb | Dexie 的查询 API 更友好 |
| 图表 | ECharts | Recharts | ECharts 对中文支持好 |
| CSS | CSS Modules | Vanilla CSS | 避免样式冲突 |
| 文件解析 | Papa Parse (CSV) | - | 成熟的 CSV 解析库 |
| 编码检测 | TextDecoder API | iconv-lite | 浏览器原生支持 GBK |
| 日期处理 | date-fns | dayjs | 按需引入，体积小 |
| UUID | crypto.randomUUID() | uuid | 现代浏览器原生支持 |
| 路由 | React Router v7 | TanStack Router | 社区成熟 |

---

## 安全与隐私

```
Agent 实现要点：

1. 数据完全本地：
   - 不向任何服务器发送用户数据
   - 不使用第三方分析工具（Google Analytics 等）
   - 不加载需要网络的字体/图标（打包到本地）

2. 数据脱敏：
   - 导出功能应提供脱敏选项
   - 不存储用户在图书馆系统的密码/凭证
   - 条码号可选择是否在 UI 中显示

3. 浏览器存储安全：
   - IndexedDB 数据仅本域可访问
   - 提供清除所有数据的功能
   - 大数据量时考虑使用 OPFS (Origin Private File System) 替代 IndexedDB
```

---

## 未来扩展方向

以下功能不在初始版本范围内，但数据模型已预留扩展空间：

1. **阅读笔记/批注** — 关联到 Book 或 BorrowCycle
2. **阅读目标** — 年度阅读量目标、分类目标
3. **社交分享** — 生成阅读报告图片（纯前端 Canvas 渲染）
4. **豆瓣/OpenLibrary API 补全** — 通过 ISBN 补充封面、简介等
5. **阅读进度追踪** — 对电子书的阅读进度细粒度记录
6. **多用户档案** — 同一浏览器支持多个阅读档案（不同 IndexedDB 数据库名）
