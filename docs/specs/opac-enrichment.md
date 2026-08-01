# OPAC 编目补全规格（深圳图书馆 API 补充功能）

> 本文件从 `docs/app-spec.md` §6 登记，遵循 SDD + TDD。实体字段语义以 [book](../metadata/book.md)、[catalog-record](../metadata/catalog-record.md)、[internal-schema](../metadata/internal-schema.md) 为唯一来源；导入管线/去重/书目标题解析见 [import-pipeline](import-pipeline.md)；本节定义「OPAC 数据源契约、字段映射、合并优先级、执行模型、CORS 部署与降级、测试清单」。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 背景与动机

szlib 流通记录 JSON 只携带 `metaid`/`metatable` 与部分书目字段：`ISBN` 可能缺失，且**缺少作者、出版社、出版年、价格、关键词、封面**（[szlib-parser](../metadata/parsers/szlib-parser.md) 原始数据特征分析）。同一书目在深圳图书馆 OPAC 编目主表（`bibliosm`）有权威的完整编目。利用流通记录携带的 `metaid` 反查 OPAC，可补全缺失字段，完善 `Book` 与 `CatalogRecord`。

## 2. 数据源契约（已实测验证，2026-08-01）

### 2.1 详情页 URL（用户可访问、可外链）

```
https://www.szlib.org.cn/opac/searchDetail?tablename=bibliosm&recordid={metaid}
```

- `tablename=bibliosm`：编目主表，与流通记录 `metatable` 字段对应。
- 该页是 Vue SPA：直接 `fetch` 得到的原始 HTML 只是应用壳（无书目数据），页面由 JS 调用下方 JSON 接口渲染。**程序化补全不抓 HTML**，只走 §2.2 接口；此 URL 用于「在 OPAC 查看详情」外链与溯源。

### 2.2 JSON 数据接口（程序化补全使用）

```
GET https://www.szlib.org.cn/api/opacservice/getBookDetail?metaTable=bibliosm&metaId={metaid}&client_id=t1
```

- `metaTable`：取流通记录 `metatable` 字段，缺省回退 `bibliosm`。
- `client_id=t1`：站点固定参数，作为常量保留。
- 响应 `Content-Type: text/plain;charset=UTF-8`，体为 JSON 文本 → 解析先取 `text()` 再 `JSON.parse`（不依赖响应头）。

### 2.3 响应字段（实测样本，metaid=6092919 →《合成绘本甲》）

| 字段 | 样本值 | 说明 |
|------|--------|------|
| `title` | `合成绘本甲=Synthetic story` | 编目正题名（ISBD 串，含并列题名；`=` 两侧无空格）|
| `author` | `(日)合成作者著 　合成译者译` | 责任者声明（组间分隔符为「空格+全角空格」，非 `;`）|
| `publish` | `北京:合成出版社,2023` | 出版地:出版社,出版年 |
| `publishyear` | `北京:合成出版社,2023` | 与 `publish` 重复（上游缺陷），忽略 |
| `callno` | `""` | 本接口常空；真实索书号在馆藏列表（`CanLoanBook[].callno`）|
| `series` | `""` | 丛书名；`Book` 无对应字段，忽略 |
| `page` | `198页` | 页数文本 |
| `price` | `CNY35.00` | 定价（货币代码 + 金额）|
| `subject` | `漫画-连环画-日本-现代` | 关键词，`-` 分隔 |
| `classno` | `J238.2(313)` | CLC 分类号（含地区复分后缀 `(313)`）|
| `abstract` / `abstracts` | `""` / `""` | 内容简介（多数为空；`abstracts` 可能为数组，防御处理）|
| `isPreloan` | `false` | 预借标记，不落库 |
| `isbn` | `978-7-5217-4823-9` | ISBN（带连字符，需清洗）|
| `img` | `https://www.bookcovers.cn/index.php?client=szlib&isbn=978-7-5217-4823-9/cover` | 封面 URL（bookcovers.cn 图床，可按 ISBN 直出）|
| `districtList` | `[...]` | 各区馆藏分布（动态库存，v1 不落库）|
| `CanLoanBook` / `OnlyReadBook` / `BorrowedBook` | `[...]` | 可外借/仅阅览/已借出馆藏列表（含 barcode/callno/status，动态，v1 不落库）|

### 2.4 无效 metaid 行为（实测）

- metaid 不存在（如 `99999999`）→ **HTTP 200 + 全空负载**：`title`/`isbn`/`publish` 等全为 `""`，`districtList: []`。
- 「未找到」判定**不能看 HTTP 状态码**，看负载：`title === "" && isbn === "" && districtList.length === 0` → `not_found`。

### 2.5 CORS 事实（决定部署形态，实测）

- 响应头**没有** `Access-Control-Allow-Origin`（curl 带 `Origin` 头实测确认），且 `X-Frame-Options: DENY`。
- 跨源页面 `fetch`：请求可发出，但响应体被浏览器 CORS 拦截，**无法读取**。
- 封面图像（`bookcovers.cn`）不受 CORS 读取限制，可直接 `<img>` 展示。
- 部署策略见 §7。

## 3. 范围与依赖

**范围**：定义 OPAC 补全的纯函数解析/映射契约（`parseOpacDetail` / `mapOpacDetail`）、薄传输层与批处理编排契约、字段合并规则（只填空）、schema 增量（`CatalogRecord.opacEnrichment`）、UI 触发与降级。本里程碑**只交付纯函数与单测**；网络执行（`opac-client` / `enrich-service`）与 UI 归统一 UI 里程碑（[tasks/ui-unified-batch](../tasks/ui-unified-batch.md)），本节先锁契约。

**依赖**：**不新增运行时依赖**（原生 `fetch` + `AbortController`），无新包 → 不走 [npm-supply-chain-security](../npm-supply-chain-security.md) 审查门。

**代码落点**（规划）：

```
src/
├─ lib/
│  ├─ opac-detail.ts        # parseOpacDetail(text): OpacDetail — JSON 解析 + 空负载判定（纯函数）
│  ├─ opac-mapping.ts       # mapOpacDetail(detail, existing): { bookPatch, catalogPatch, warnings }（纯函数）
│  ├─ opac-detail.test.ts / opac-mapping.test.ts
├─ enrich/
│  ├─ opac-client.ts        # fetchOpacDetail(metaid, metatable?, opts) 薄传输层（超时/中止，唯一接触网络处）
│  ├─ enrich-service.ts     # enrichCatalogRecords(...) 批处理编排（并发上限、幂等跳过、状态回写）
│  └─ enrich-service.test.ts
```

## 4. 纯函数契约

### 4.1 `parseOpacDetail(text: string): OpacDetailResult`

```ts
type OpacDetailResult =
  | { ok: true; detail: OpacDetail }
  | { ok: false; reason: 'parse_error' | 'not_found' }
```

- `JSON.parse` 失败 → `{ ok: false, reason: 'parse_error' }`（不抛异常）。
- 空负载判定（§2.4）→ `{ ok: false, reason: 'not_found' }`。
- 成功 → 结构化 `OpacDetail`（字段表见 §2.3），数值/数组防御转换：`page → number | null`、`price → { amount, currency } | null`、`subject → string[]`。
- 纯函数、无时钟、无 I/O。

### 4.2 `mapOpacDetail(detail, existing): { bookPatch, catalogPatch, warnings }`

`existing` = 当前 `Book` + `CatalogRecord`。合并规则为**只填空**（fill-if-empty，v1 不做字段级溯源，见 §4.3）：

| 落点 | 解析与填充规则 |
|------|---------------|
| `Book.title` / `subtitle` / `parallelTitles` | `title` 串归一化 `\s*=\s*` → `" = "` 后走 [import-pipeline §13 parseTitle](import-pipeline.md#13-书目标题结构化解析)；仅当现 `title` 为空或占位时写入 |
| `Book.authors` / `translators` | `author` 串归一化 `　`/` 　` → `;` 后走 parseTitle 责任区解析；仅当 `authors` 为空 |
| `Book.isbn13` / `isbn10` | 过 [lib/isbn 清洗](import-pipeline.md)（去连字符）；仅当 `isbn13` 为空；与现有值冲突**不覆盖**并记 warning |
| `Book.publisher` / `publishDate` | `publish` 首个 `:` 后按 `[,，]` 拆；末段为 4 位数字年份 → `publishDate`，其余 → `publisher`；仅填空 |
| `Book.pages` | `page` 首个整数序列；仅填空 |
| `Book.price` | 货币前缀（`¥` → CNY，否则大写字母串）+ 金额；无前缀默认 CNY；仅填空 |
| `Book.subjects` | `subject` 按 `-` 拆分、trim、去空；仅填空 |
| `Book.description` | `abstract`/`abstracts` 拼串（数组按 `\n` join）；仅填空 |
| `Book.coverUrl` | `img`；仅填空 |
| `CatalogRecord.classifications` | `classno` 去 `(...)` 后缀 → `code`，`system: 'clc'`；按 `code + system` 去重并入 |

- `warnings`：isbn 冲突、publish/page/price 不可解析等（复用 [ParseWarning 语义](import-pipeline.md#8-借还配对与错误警告模型)，type 取 `format_error`）。
- 占位书名（`isPlaceholder`，选书帮）**不参与自动补全**（§6.1）。

### 4.3 为什么「只填空」而不是按优先级覆盖

`Book` 字段目前没有字段级编辑溯源（区分「用户手改」与「导入值」），盲目覆盖会破坏 [book.md 字段优先级](../metadata/book.md)：用户手动编辑 > 图书馆编目 > 自动补全 API。v1 用「只填空 + 冲突保留现有」近似满足该优先级（不覆盖即不降级用户数据），代价是**不修正导入时的错误值**；字段级溯源（`sourceField` 标记）列为后续扩展，届时可升级为按优先级覆盖。

## 5. Schema 增量

`CatalogRecord.opacEnrichment`（新可选字段，幂等/审计用）：

```ts
opacEnrichment: {
  status: 'fetched' | 'not_found' | 'failed'
  fetchedAt: Date | null
  sourceUrl: string | null   // §2.1 详情页 URL
} | null
```

- 默认 `null`；Zod `z.object({...}).nullable().default(null)` → 旧导出兼容，无迁移脚本（[data-layer §5](data-layer.md#5-迁移策略)）。
- 幂等依据：`status === 'fetched'` 的 CatalogRecord 不再抓取（§6）。

## 6. 执行模型

- **不进入 importPipeline**：管线是确定性纯函数（[import-pipeline §3](import-pipeline.md#3-纯函数-pipeline-契约)），网络补全非确定性，二者必须隔离。补全是导入后的**独立异步步骤**或用户按需触发。
- **候选集**：`CatalogRecord` 满足 `metaIdKey` 非空、`metaId !== 0`、`opacEnrichment.status !== 'fetched'`，且其 `Book` 非占位。
- **批量**：并发上限 4、单请求超时 10s、失败指数退避重试（最多 2 次）；`not_found`/`failed` 回写状态，**不触碰实体**。
- **写回**：Book 字段只落 `mapOpacDetail` 产物；CatalogRecord 追加 classifications 并写 `opacEnrichment`。
- **重建/重放语义**：replay 重建（[settings §4](settings.md#4-重建模式对照)）后 `opacEnrichment` 归 `null`（重导后需重新触发补全）；snapshot 恢复保留已补全字段与状态。

### 6.1 选书帮（占位）记录

- 占位 Book（`needsReview=true` 且占位书名）**排除出自动补全候选集**：其 `metaid` 在所有 barcode 间相同（[szlib-parser §5](../metadata/parsers/szlib-parser.md)），抓取结果不指向真实书目，会污染多个 Book。
- 补全入口对这些记录置灰并提示「占位书目，请在待审阅中手动补全」；「在 OPAC 查看」外链同样不提供。

## 7. 部署与降级（CORS）

| 运行形态 | 可行性 | 说明 |
|---------|--------|------|
| `pnpm dev`（Vite 开发） | ✅ 可用 | `vite.config.ts` 配 `server.proxy`：`/api/opacservice` → `https://www.szlib.org.cn`，同源消除 CORS |
| 同源反向代理部署 | ✅ 可用 | 用户自建 nginx/Caddy 反代 `/api/opacservice`（超出纯前端范围，文档指引即可）|
| 静态托管直连接口 | ❌ 不可读 | 无 `Access-Control-Allow-Origin` 头，浏览器拦截响应体（§2.5）|
| 降级外链（始终可用） | ✅ | 书目详情提供「在深圳图书馆 OPAC 查看」新标签外链（§2.1 URL）|
| 封面图 | ✅ 不受限 | `bookcovers.cn` 图片可直接 `<img>` 展示（无需 CORS）|

- 传输层接口隔离（`opac-client.ts` 唯一接触网络），同源代理 / 直连切换不动映射层；CORS 环境下 `fetchOpacDetail` 捕获 `TypeError` → 记 `failed` 并提示降级。

## 8. 隐私与安全

- 仅向深图官方接口发送 `metaId` + `metaTable` + 固定 `client_id`（公开书目标识），**不发送**借阅记录、barcode、个人偏好或本地库内容。
- 不持久化接口原始响应（只存映射后的实体字段与补全状态）。
- 补全为用户显式触发（导入完成后按钮 / 详情页按钮），不做静默后台洪水请求（并发上限 §6）。

## 9. UI 设计说明（统一 UI 里程碑）

- **书目详情页**：含有效 `metaId` 的 CatalogRecord 显示「从深圳图书馆 OPAC 补全」按钮；loading → 成功 / 未找到 / 失败 toast；成功后字段即时更新。
- **导入完成页**：批量入口「从深圳图书馆 OPAC 补全 (N)」+ 进度条；占位记录计数单独说明（§6.1）。
- **常驻外链**：详情页提供「在深圳图书馆 OPAC 查看」新标签链接（降级与溯源）。
- 文案走 `t()`（[i18n-conventions](../i18n-conventions.md)），namespace `enrich.*`。

## 10. 用户故事与验收用例

1. 导入 szlib 流水（含缺 ISBN/缺作者记录）→ 点批量补全 → Book 补上 title/authors/publisher/pages/price/subjects/coverUrl，CatalogRecord 补上 classifications 与 `opacEnrichment.status='fetched'`、`sourceUrl` 正确。
2. 已补全记录再次触发 → 跳过（幂等，不重复请求）。
3. metaid 无效（§2.4）→ `status='not_found'`，实体零改动，UI 提示「馆内未找到该编目」。
4. 占位（选书帮）记录 → 不在候选集；UI 置灰并说明。
5. 现有字段非空（如导入自带 ISBN）→ 不被覆盖；OPAC ISBN 冲突保留现有并记 warning。
6. CORS 拦截环境 → 补全失败提示 + 外链降级可用；`pnpm dev` 代理环境补全成功。

## 11. 测试清单（Vitest，mock fetch，夹具脱敏自 §2.3 实测样本）

**`src/lib/opac-detail.test.ts`**
- 实测样本 JSON → 结构化正确（title/author/publish/page/price/subject/classno/isbn/img）。
- 空负载（title/isbn 空 + `districtList: []`）→ `{ ok: false, reason: 'not_found' }`。
- 非法 JSON → `{ ok: false, reason: 'parse_error' }`，不抛。
- 防御转换：`page: "198页" → 198`、`"2册(198页)" → 2`、无数字 → null；`price: "CNY35.00" → {35, CNY}`、`"¥45.00" → {45, CNY}`、`"35.00" → {35, CNY}`；`subject` 拆分/去空。
- 确定性：同输入两次调用深等价。

**`src/lib/opac-mapping.test.ts`**
- 全空 Book → 全字段按 §4.2 填充；`title`/`author` 分隔符归一化后 parseTitle 产出与 [import-pipeline §13](import-pipeline.md#13-书目标题结构化解析) 样本一致（`合成绘本甲=Synthetic story` → title/parallelTitles；`(日)合成作者著 　合成译者译` → authors/translators）。
- 字段非空 → 零覆盖；isbn 冲突 → warning + 保留现有。
- `classno` 去 `(...)` 后缀；按 code+system 去重并入（重复补全不产生重复分类）。
- `publish` 解析：`北京:合成出版社,2023` → publisher 合成出版社、publishDate 2023；不可解析 → warning。
- 占位 Book 不入候选（与 §6.1 组合测试）。

**`src/enrich/enrich-service.test.ts`（UI 里程碑补）**
- 候选集过滤（metaId 空/0/已 fetched/占位排除）；并发上限生效；超时/网络错误 → `failed` 回写且实体不变；重试退避；幂等跳过。

## 12. React 性能规则引用

- 批量补全在 Web Worker 或分片执行，避免主线程阻塞（对照 [ui-navigation §9](ui-navigation.md#9-react-性能规则引用) 与 [design-decisions 并发与性能](../design-decisions.md)）。
- `bundle-barrel-imports`：详情页组件按需 import，避免 barrel 拉体积。
- 进度用受控整数状态（N/M），不逐条触发 setState。
