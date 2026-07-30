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
- **导入管线必须是纯函数**：同样的 `(rawRecords, sources)` 输入必须产出结构等价的派生数据。这是「清空系统后凭备份 rawRecords 重建」能成立的前提——详见 [import-workflow 导入纯度要求](./metadata/import-workflow.md#导入纯度要求)。
- `ExportData.rawRecords` 为**必导项**（非可选），它是系统重置后唯一的重建输入；导出格式与重建流程见 [internal-schema 数据导出](./metadata/internal-schema.md#数据导出)。

### 4. 物理副本与书目双层去重机制

**决策**: 优先使用 `sourceId` + `barcode` 精确识别物理副本，其次使用 `isbn13` 跨来源合并书目信息。

**原因**:
- **物理副本标识**：条码号是图书馆特定藏书的唯一物理标识。这解决了许多文献无 ISBN（如期刊、CD、图书馆自编文献、内部资料）却有借阅记录导致数据错乱的问题。
- **书目合并**：不同图书馆对同一本书会分别贴不同的条码，但如果是同一版次的出版物，它们共享相同的 ISBN。通过 ISBN 可以将分散的借阅记录统一归集到单一的书籍统计视图中。

**约束**:
- 导入数据时，首先检查系统是否已存在相同的 `sourceId` + `barcode`。若有，则这是重复借阅同一本实体书；若无，再根据 ISBN 进行书目合并，将该条码加入对应 `CatalogRecord.barcodes`（而非 Book，Book 不再直接持有条码信息）。
- 对既无条码也无 ISBN 的记录，降级使用书名和作者进行模糊匹配，并需标记为待确认。

### 5. 兼容国际多重分类法体系（CLC、DDC等）

**决策**: 放弃单一的中图分类法（CLC）字段，改用通用的 `classifications` 数组存储多套分类信息，并在 `Source` 级别配置该图书馆使用的默认分类体系。

**原因**:
- **国际化与多体系**：国外图书馆普遍使用杜威十进制分类法（DDC）或美国国会图书馆分类法（LCC）。
- **复合编目**：同一本书在综合数据库中可能兼具 CLC、DDC 和 UDC 多种分类代码。

**约束**:
- 统计阅读偏好和生成图表时，系统应优先使用导入该书的图书馆所配置的默认分类体系（`classificationSystem`）。
- 电子借阅平台（如 Libby）数据若包含借/还记录，按图书馆来源处理；纯阅读类平台（无借还）不在本系统范围内。
- 系统需内置主流分类法（至少 CLC、DDC）的一级类目名称映射表。

---

## 数据模型关系

```
Agent 实现要点：理解实体关系对正确实现查询和 UI 至关重要

Source (1) ─────────< (N) CatalogRecord ───────< (N) BorrowCycle
                          │                            │
                          │ bookId                     │ catalogRecordId（可推导 bookId/sourceId）
                          │                            │ bookId / sourceId（为查询性能冗余）
Book   (1) ─────────< (N) CatalogRecord                │
Book   (1) ─────────< (N) BorrowCycle (via CatalogRecord)

Source (1) ─────────< (N) ImportLog
                          │
                          │ importLogId
                          │
ImportLog (1) ──────< (N) RawRecord

CatalogRecord.barcodes[]      — 该馆具体物理副本条码
CatalogRecord.sourceId        ───> Source.id
Book.sourceIds[]              ───> Source.id（可由 CatalogRecord 推导，冗余存储便于查询）
BorrowCycle.rawRecordIds[]    ─> RawRecord.id
BorrowCycle.barcode           ─> CatalogRecord.barcodes[]（本次借阅的具体副本）
```

**关键关系说明**:
- 物理副本（条码）归属于 `CatalogRecord`，不再挂在 `Book` 上。
- 一本 Book 可以有多个 CatalogRecord（不同来源/不同馆藏对该书的本地编目）。
- 一个 CatalogRecord 可以有多个 BorrowCycle（同一副本多次借阅）。
- 一本 Book 可以有多个 BorrowCycle（多次借阅，经 CatalogRecord 间接关联）。
- 一个 Source 可以有多个 BorrowCycle（从一个馆借了很多次）。
- 一本 Book 可以关联多个 Source（不同图书馆都有这本书）。
- `BorrowCycle` 同时冗余存 `bookId`、`catalogRecordId`、`sourceId`，其中 `bookId`/`sourceId` 可经 `CatalogRecord` 推导，冗余仅为无 join 的 IndexedDB 查询性能。

---

## 技术选型建议 (AI 时代最新 React 技术栈)

针对 AI 辅助编程以及未来可能的本地 AI 能力集成，选型偏向于**高度类型安全**、**现代化 API**、以及**利于 AI 理解与生成代码**的技术栈。同时严格遵守本系统**纯前端、零依赖后端**的隐私安全核心原则，专注打造极致的本地 SPA 体验。

| 类别 | 推荐 | 备选 | 说明 |
|------|------|------|------|
| 框架 | React 19 + Vite | - | 采用最新 React 19 (并发特性、新 Hooks) 与 Vite，可配合 React Compiler 减少手动优化负担，降低 AI 生成代码的复杂度 |
| 类型验证 | Zod | Valibot | Schema 优先的设计，为 AI 代理提供严格的数据结构上下文，并在客户端保证解析数据的可靠性 |
| 路由 | TanStack Router | React Router v7 | 100% 类型安全的路由系统，确保 AI 生成的页面跳转与参数传递完全静态类型化，杜绝低级拼写错误 |
| 状态管理 | Zustand | Jotai | 极简且灵活的状态管理，AI 极易理解和生成，无需繁琐的 boilerplate 代码 |
| 本地数据库 | Dexie.js | idb | 配合 `dexie-react-hooks` 实现响应式的本地数据流，完美契合零后端与离线可用的约束 |
| UI 组件生态 | shadcn/ui | Radix UI | 基于 Tailwind 的可定制组件库，代码直接落盘于本地项目中，完全由开发者掌控。AI 工具（如 Cursor/v0 等）对其支持极深，生成质量最高 |
| CSS/样式 | Tailwind CSS | CSS Modules | AI 时代首选的原子化 CSS 框架。通过系统级的配置文件来保持设计的一致性，省去为组件单独命名类的麻烦，极大提升 UI 迭代速度 |
| 并发与性能 | Web Worker + Comlink | - | 将大量借阅记录的解析与统计下放至 Worker 线程，维持 AI 时代的丝滑 UI 交互 |
| 本地 AI (未来扩展) | Transformers.js / WebLLM | - | 在浏览器内直接运行轻型模型（如自动分类、本地推荐），确保用户敏感阅读数据**绝对不离开本地设备** |
| 图表 | ECharts | Recharts | 见下方「图表选型」段：离线海量渲染更强、中文生态友好，故保留 |
| 文件解析 | Papa Parse (CSV) | - | 客户端高性能、流式解析库，支持直接处理大型导出文件 |
| 日期与工具 | date-fns | dayjs | 纯函数式 API，利于 Tree-shaking，且 AI 生成调用代码时直观明确 |
| 国际化 (i18n) | react-i18next | Paraglide JS | 行业标准的 UI 多语言方案，AI 对其生态和配置语法烂熟于心，支持浏览器语言检测与动态加载 |
| 本地化 (l10n) | 原生 Intl API | - | 追求零依赖：数字、货币、长短文本排序直接使用浏览器原生的 `Intl` 接口；日期配合 `date-fns` 的 locale 包实现精准格式化 |

---

## 图表选型：ECharts（保留），不用 shadcn Chart / Recharts

**决策**：图表层采用 ECharts，**不采用** shadcn 官方 `Chart` 组件（其内部包的是 Recharts）。

**背景与考量**：

1. **生态对齐**：shadcn 社区广泛使用的 charts 组件即官方 `Chart`，它 wraps Recharts，与 Tailwind v4 设计令牌深度绑定、即插即用。这是本选型的题眼。
2. **供应链面**（本项目第一硬约束）：
   - ECharts 依赖面极小（仅 `zrender` + `tslib`），零 lodash，零 d3 vendor 包。
   - Recharts 3.x 携 `lodash`（全量）、`victory-vendor`（打包整片 d3 生态）、外加 `react-smooth`/`eventemitter3`/`recharts-scale`/`react-is`/`tiny-invariant`/`clsx`。transitive 依赖面越大，审计与 lockfile diff 越重，与 [npm-supply-chain-security] 的「依赖最小化」原则相悖。
   - pnpm 严格隔离虽防幽灵依赖，但无法消除 transitive 依赖面与 audit 负担。
3. **能力贴合规格**（见 [reading-profile 阅读画像与图表规格](./specs/reading-profile.md)、本文件数据模型）：
   - 需要的视觉：分类法 treemap（CLC/DDC 分布）、借阅甘特带（同条码多次借阅的时间线 spine）、海量借阅记录稳定渲染、中文标签友好。
   - ECharts：canvas 渲染、海量数据稳、treemap/heatmap/自定义 series 为强项，中文生态与复杂交互原生友好——与 [app-spec §2](./app-spec.md) 选 ECharts 的理由一致。
   - Recharts：SVG 渲染、大数据量退化、treemap/甘特非强项，偏柱线饼基础图。
4. **shadcn 集成代价**：放弃 `Chart` 即插即用，需自写一层薄适配——把 shadcn CSS 变量（`--background`/`--foreground`/`--chart-1..5` 等）映射成 echarts theme 的 color palette 与坐标轴/tooltip 样式，并随 `dark` class 切主题。该适配代码进 `src/lib/echarts-theme.ts`，本地落盘可控，符合「源码落本地可控」取向，工作量可控。

**约束**：
- 若后续 ECharts 缺少某 shadcn 令牌对应的能力，优先在薄适配层补齐，不为单图种回退到 Recharts。
- ECharts 首次引入时按 [npm-supply-chain-security §3] 走依赖审查、过 `pnpm verify`/`audit`（`^` 范围可，frozen 锁文件兜底）。
- 不使用 Recharts、不安装 shadcn `Chart` 组件。

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
   - 提供「清空系统」功能：一次性清空全部 Object Store，用于彻底重置/重新开始（不支持按单次导入撤销，见 [internal-schema 系统重置](./metadata/internal-schema.md#系统重置)）
   - 大数据量时考虑使用 OPFS (Origin Private File System) 替代 IndexedDB
```

---

## UI 设计方向：A 编目终端（主壳）+ B 阅读图谱（画像页）

**决策**：UI 主壳采用方向 A「编目终端」气质，唯阅读画像页（/profile）采用方向 B「阅读图谱」语言。设计令牌、色表、CJK 排版与完整气质规范见根目录 [DESIGN.md](../DESIGN.md)；UI 路由、布局与交互见 [UI 导航规格](./specs/ui-navigation.md)。

**主壳（A 编目终端）**：左侧窄导航 + 主区表格主导，密实、可排序可筛选，像图书馆 OPAC 检索台。
- 色彩与造型：以「和纸/生成」与「墨/鉄黑」奠定纸墨感，单一克制强调色、完全直角、无阴影平面；具体色值与组件规范见 DESIGN.md。
- 等宽呈现：`metaId`、`barcode`、分类号、ISBN 走等宽字（本地打包字体），像「编目卡」标签条。
- 分类法芯片：CLC/DDC 分类号是一等视觉元素，对应项目核心心智模型（物理副本 × 书目合并 × 多分类法）。
- 禁单色主导：勿让界面读成单一色族（尤其避开米/沙、纯灰一统）。

**阅读画像（B 阅读图谱）**：图表是主角、全幅，把鲜活数据色**只留给图谱**（图表色板见 DESIGN.md §2.5），界面其余保持冷静灰。
- ECharts（thin adapter，见上文「图表选型」）渲染分类法 treemap、借阅甘特带、按月分布柱图、借阅时长分布。
- 唯此页发力，其余页不入此画风。

**取向护栏**：A 主导工程取向（密实、可扫读、克制工作向）；C「阅读手帐」的温度感仅作为书目详情的卷卡式细节吸收，不进主架构，避免偏编辑/插画向及米色单色风险。

---

## 未来扩展方向

以下功能不在初始版本范围内，但数据模型已预留扩展空间：

1. **阅读笔记/批注** — 关联到 Book 或 BorrowCycle
2. **阅读目标** — 年度阅读量目标、分类目标
3. **社交分享** — 生成阅读报告图片（纯前端 Canvas 渲染）
4. **OpenLibrary API 补全** — 通过 ISBN 补充封面、简介等
5. **多用户档案** — 同一浏览器支持多个阅读档案（不同 IndexedDB 数据库名）
