# Shenzhen Library (深圳图书馆) Parser 设计

> AI Agent 指引：针对深圳图书馆“我的图书馆”查询接口返回的纯流通记录 JSON 数据的解析器设计。

## 原始数据特征分析

文件示例：`record.json`
- **纯交易日志**：包含每一步的流通操作，而非书目合并后的报表。
- **书目字段更新**：新 API 返回了 `ISBN` 和系统内部书目 ID (`metaid`, `metatable`)，**但需要注意部分记录的 `ISBN` 依然可能为空**。同时依然缺乏 `作者`、`出版社` 和 `出版年`等详细元数据。
- **时间字段分离**：日期 `date`（"YYYYMMDD"）和时间 `time`（"HH:MM:SS"）分离，且均未标明时区（默认 `Asia/Shanghai`）。
- **增加流通与地点信息**：包含 `cirtype`（流通类型如“中文图书外借”）和 `addr`（操作发生地点或设备，如“深图北馆一楼自助机”）。
- **操作类型（optype）繁杂**：包含“读者借出”、“读者还回文献”、“自助查询”、“读者续借”等。

## 解析规则设计

### 1. 记录过滤
- **忽略** `optype` 为以下值的记录，不参与借阅周期的合成：
  - `"自助查询"`：与借阅状态无关的机器操作。
  - `"读者续借"`：根据设计决策，不影响整体借还周期（若未来需统计续借次数，可再次引入）。

### 2. 实体提取 (Entity Extraction)
对于每一条有效流通记录（借或还），系统将提取出两个层级的实体：

**A. 全局书目实体 (Book)**
- `id`: 生成新 UUID（或者通过匹配已有 ISBN 沿用旧 ID）。
- `isbn13`: 取自 `ISBN` 字段（需注意处理为空的情况，仅当存在且合法时提取）。
- `title`、`subtitle`、`parallelTitles`、`authors`、`translators`：由 `src/lib/title.ts` 的 `parseTitle(rawTitle)` 结构化解析派生，具体规则见 [import-pipeline §13 书目标题结构化解析](../../docs/specs/import-pipeline.md#13-书目标题结构化解析)。
  - `Book.title` 存正题名（去副标题/并列/责任者标记），**不再原样保留原始编目串**；原始串由 `RawRecord.data.title` 留存以便溯源与重解析。
  - `subtitle` 取 ` : ` 右侧拼回的副标题，无则 `null`；`parallelTitles` 取 ` = ` 右侧各段，无则 `[]`。
  - `authors` 取责任者区角色词为 `著`/`编`/`主编`/`编著`/`绘` 的个人（含无角色词的第一组默认），`translators` 取 `译`/`校`/`校译` 的个人；`等` 暂并入姓名字符串保留，由归一化阶段统一剥离。
  - 占位书名（`isPlaceholder=true`，如选书帮 `"福田图书馆读者自选图书"`、空串）短路返回 `authors=[]`、`translators=[]`，保留 `title=rawTitle` 原样。

**B. 本地编目记录 (CatalogRecord)**
- `id`: 生成新 UUID。
- `bookId`: 关联到上方提取的 `Book.id`。
- `sourceId`: 当前解析的数据源 ID（如 `"szlib"`）。
- `metaId`: 记录原始数据中的 `metaid` 供追溯使用。
- `classifications`: 
  - 从 `callno` 中提取分类号：取 `/` 前的部分作为 `code`（如 "TP311.5/1040" → "TP311.5"）。
  - `system` 设为 `'clc'`（国内公共图书馆默认使用中图法）。
- `barcodes`: `[ 原始记录的barcode ]`。

### 3. 借还周期合成 (BorrowCycle Synthesis)
使用 `barcode` 分组所有有效操作，按时间顺序（从早到晚）排序。

1. 时间转换：
   将 `date` ("20260411") 和 `time` ("18:33:50") 组合为 "2026-04-11T18:33:50"。
   由于时区为 `Asia/Shanghai`，需补齐时区偏移量 ("+08:00") 并转为 UTC (ISO 8601)。
2. 配对算法：
   - 遍历某条码号下的操作流。
   - 遇到 `"读者借出"`：开启一个全新的借阅周期。
     - 记录 `catalogRecordId` 指向提取出的 `CatalogRecord`。
     - 记录 `borrowLocation` 为当前记录的 `addr`。
   - 遇到 `"读者还回文献"`：
     - 若当前已有开启的周期，将其作为归还时间，闭合该周期。同时提取 `returnLocation` 为当前记录的 `addr`。
     - 若无开启的周期（即“只有还没有借”，可能因为借出记录在导出的时间范围外），则创建一个状态为 `unknown` 的半闭合周期，并记录 `catalogRecordId`，以及 `returnLocation` 为当前记录的 `addr`。

### 4. 数据去重与合并
由于深图新 API **提供了 ISBN 和系统内部 metaid**，解析器在去重与合并方面更为可靠：
1. **CatalogRecord 级匹配 (最优先)**：首先依赖 `sourceId` + `barcode` 或 `sourceId` + `metaIdKey` 定位已存在的本地编目记录 `CatalogRecord`（`metaIdKey` 为 `metaid` 归一化后的 string，避免 int/string 类型不一致导致漏判）。如果找到，说明是同一个馆的同一次或不同复本，直接沿用。
2. **Book 级基于 ISBN 的书目合并**：如果这是一个新的编目，优先使用提取出的合法 `ISBN` 在全局书库中查找匹配。若找到相同 ISBN 的 `Book`，则自动将新生成的 `CatalogRecord` 挂载到该 `Book` 之下。
3. **回退机制 (无 ISBN 处理)**：对于 `ISBN` 为空或无效的记录（如部分老旧书目），若也无法通过 `metaid` 找到已有 `CatalogRecord`，系统只能退回到依赖 `title` 的模糊匹配，视为新书导入，后续由 UI 提供“按书名建议合并”的功能，由用户人工确认。


### 5. 福田图书馆「选书帮」特殊处理

#### 背景

福田图书馆与深圳书城之间有一个"选书帮"合作服务：
读者在深圳书城中心城挑选新书，由图书馆买单后通过福田图书馆系统办理借阅。这些记录会出现在深圳图书馆的返回数据中，但**原始记录严重缺乏书目辨识信息**：

| 字段 | 取值 | 问题 |
|------|------|------|
| `title` | `"福田图书馆读者自选图书"` | 所有选书帮记录共享同一个占位书名 |
| `ISBN` | `""` (空字符串) | 无 ISBN |
| `callno` | 如 `"TP311.138/397"` | 所有选书帮记录共享同一索书号，无法用于区分或回溯 |
| `barcode` | 如 `"04400820112345"` | **唯一的区分标识** |

由此可见：**不同 barcode 对应的是完全不同的物理书**，但由于 title/ISBN均无辨识力，按常规去重逻辑会将它们聚类为一本书，导致：
- 多个不同书目被错误合并到同一个 `Book`
- `BorrowCycle` 看似是一本书反复借还，实际是不同书的借阅记录

#### 检测规则

当一条流通记录同时满足以下条件时，判定为"选书帮占位记录"：

1. `title` 等于 `"福田图书馆读者自选图书"`
2. `ISBN` 为空字符串或空值

> 实现注意：检测逻辑应使用精确字符串匹配（而非 includes/contains），
> 避免未来深圳图书馆本身的书目碰巧叫类似名字时被误判。

#### 解析行为变更

当一笔记录被识别为选书帮占位记录时，以下规则会**覆写**第 2 节的常规实体提取逻辑：

**A. Book 实体创建（覆写 §2.A）**

- 为**每一个唯一的 barcode** 创建独立的 `Book`，不按 title 合并。
- 每个这样的 Book 设置：
  - `title`: `"福田图书馆读者自选图书"`（保留原始值）
  - `isbn13`: `null`
  - `authors`: `[]`
  - `needsReview`: `true`
- 不同 barcode 之间**不做 Book 级合并**（既不按 ISBN 也不按 title fallback 合并），
  直到用户在 UI 中手动补全书目信息后解除 `needsReview` 标记。

**B. CatalogRecord 创建（常规，按 §2.B）**

- 每条 barcode 照常创建 `CatalogRecord`，关联到上方对应 barcode
  的独立 `Book`。
- `classifications` 仍可从 `callno` 提取（所有选书帮记录共享同一索书号，
  分类结果重复属正常现象）。

**C. BorrowCycle 合成（不变，按 §3）**

- 借还配对不因选书帮而改变：同 barcode 下"读者借出"和"读者还回文献"
  照常配对合成 `BorrowCycle`。

**D. 去重与合并（覆写 §4）**

- `CatalogRecord` 级匹配：仅按 `sourceId + barcode` 去重。注意：选书帮记录的 `metaid` 在所有 barcode 间相同，`sourceId + metaIdKey` 在此场景下无法区分不同编目，不适用。
- `Book` 级基于 ISBN 的合并：对选书帮记录**不适用**（无 ISBN）。
- `Book` 级基于 title 的模糊合并：对选书帮记录**不适用**，各 barcode 保持独立 Book。已有选书帮 Book 若 `needsReview` 为`true`，不应与其他 Book（含其他选书帮 Book）合并。

#### 导入后 UX 流程

导入完成后，系统应在 UI 中引导用户处理 `needsReview: true` 的 Book：

1. **审阅入口**：书库列表/仪表盘上显示"待补全书目 (N)"提示入口。
2. **逐本补全**：用户点击进入补全表单——当前显示的信息仅有 title（"福田图书馆读者自选图书"）、barcode、索书号、借阅时间。用户手动填入真实书名、作者、ISBN，或通过封面识别。
3. **手动合并**：如果用户发现某个选书帮 barcode 实际对应库中已有的一本书，可通过 UI 将两个 Book 合并（保留较早的 Book id 或由用户选择）。
4. **解除标记**：用户提交补全或合并后，`needsReview` 设为 `false`；此后该书参与正常的 ISBN/title 去重流程。

#### 设计决策理由

- **为什么按 barcode 分 Book 而非创建一个全局"选书帮"Book？**
  因为每个 barcode 是一本不同的实体书，在 `needsReview` 阶段让它们各自独立，比事后拆分一个聚合错误的 Book 容易得多。
