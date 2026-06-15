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

### 4. 物理副本与书目双层去重机制

**决策**: 优先使用 `sourceId` + `barcode` 精确识别物理副本，其次使用 `isbn13` 跨来源合并书目信息。

**原因**:
- **物理副本标识**：条码号是图书馆特定藏书的唯一物理标识。这解决了许多文献无 ISBN（如期刊、CD、图书馆自编文献、内部资料）却有借阅记录导致数据错乱的问题。
- **书目合并**：不同图书馆对同一本书会分别贴不同的条码，但如果是同一版次的出版物，它们共享相同的 ISBN。通过 ISBN 可以将分散的借阅记录统一归集到单一的书籍统计视图中。

**约束**:
- 导入数据时，首先检查系统是否已存在相同的 `sourceId` + `barcode`。若有，则这是重复借阅同一本实体书；若无，再根据 ISBN 进行书目合并，将该条码加入 Book 的馆藏列表。
- 对既无条码也无 ISBN 的记录，降级使用书名和作者进行模糊匹配，并需标记为待确认。

### 5. 兼容国际多重分类法体系（CLC、DDC等）

**决策**: 放弃单一的中图分类法（CLC）字段，改用通用的 `classifications` 数组存储多套分类信息，并在 `Source` 级别配置该图书馆使用的默认分类体系。

**原因**:
- **国际化与多体系**：国外图书馆普遍使用杜威十进制分类法（DDC）或美国国会图书馆分类法（LCC）。
- **复合编目**：同一本书在综合数据库中可能兼具 CLC、DDC 和 UDC 多种分类代码。

**约束**:
- 统计阅读偏好和生成图表时，系统应优先使用导入该书的图书馆所配置的默认分类体系（`classificationSystem`）。
- 电子阅读平台（如微信读书、Kindle）通常没有标准分类号，可保留为 "other" 体系或通过后期 API 反查补全。
- 系统需内置主流分类法（至少 CLC、DDC）的一级类目名称映射表。

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
