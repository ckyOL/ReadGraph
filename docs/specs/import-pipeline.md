# 导入管线规格

> 本文件从 `docs/app-spec.md` §10 拆出，遵循 SDD + TDD。规格落地于代码前先写本节，再进 Tests(Red) → Code → Tests(Green)。规范化对象（字段含义、`SourceParser`/`ParseResult`/`ParseWarning` 接口）与去重策略以 [import-workflow](../metadata/import-workflow.md)、[source](../metadata/source.md)、[internal-schema 去重策略](../metadata/internal-schema.md) 为主唯一来源；本节只定义「代码落点、纯函数契约、确定性、时区、配对、测试」。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 范围与依赖

**范围**：定义 Parser 注册表、纯函数导入管线（`importPipeline`）、时区转换契约、ISBN 处理、书目/编目去重合并算法、借还配对算法、错误与警告模型、ID 确定性派生，并落地一个真实 Parser（`szlib`，见 [parsers/szlib-parser](../metadata/parsers/szlib-parser.md)）。本里程碑**只交付纯函数与测试**，**不接 UI 向导**（属 [UI 导航规格 §3 导入页](ui-navigation.md#3-各功能页布局与空状态)）、**不写 IndexedDB**（写入是调用方职责，管线只返回 `PipelineResult`）；`importDatabase(replay)` 端到端装配留待 UI 里程碑接本管线，本里程碑由 `importPipeline` 提供纯函数基础。

**依赖**（本里程碑锁定，需过 [npm-supply-chain-security §3](../npm-supply-chain-security.md) 冷却期审查）：

| 包 | 类型 | 版本 | 用途 |
|----|------|------|------|
| `date-fns-tz` | runtime | `3.2.0` | 把「无时区标记的本地时间字符串」按 `source.timezone`（IANA）解释为 UTC `Date`；跨 node/浏览器一致、确定性 |

> 不引入 `date-fns` 主体（本里程碑只用 tz 转换；format/duration 等 UI 显示期再按需引入）。不引入第三方 GBK 解码库：编码检测委托运行时 `TextDecoder`（Chromium 与 Node 22 full-icu 均原生支持 `gbk` label），纯管线层不绑定具体解码实现，见 §7。Papa Parse（CSV）留作后续来源接入，本里程碑 szlib 数据为 JSON。

**代码落点**：

```
src/
├─ lib/
│  ├─ time.ts               # 时区转换纯函数：localToUtc；不含 Date.now()
│  ├─ isbn.ts               # ISBN 清洗、ISBN-10→13 转换、软校验
│  ├─ normalize.ts          # 标题/作者归一化（去标点、全角→半角、转小写；不含繁简转换）
│  ├─ hash.ts               # 确定性 hash（FNV-1a 32bit），纯函数、无依赖
│  └─ *.test.ts
├─ parsers/
│  ├─ types.ts              # SourceParser、ParseResult、ParseWarning 接口（与 entities 对齐）
│  ├─ registry.ts          # Parser 注册表：按 parserId 查找、validate-match
│  ├─ dedupe.ts            # 书目/编目/周期去重合并纯函数（existing 入参化）
│  ├─ pipeline.ts          # importPipeline 纯函数 + PipelineResult + 派生 ID
│  ├─ szlib.ts             # 深圳图书馆 Parser（对照 szlib-parser.md，含选书帮分支）
│  └─ *.test.ts
└─ tests/fixtures/         # 脱敏夹具（szlib 流水 JSON）
```

## 2. Parser 接口与注册表

- `src/parsers/types.ts` 导出 `SourceParser`、`ParseResult`、`ParseWarning`，与 [source](../metadata/source.md) Parser 接口规范、[entities](../../src/types/entities.ts) 完全对齐。`parse(rawData, source)` 在本里程碑**同步**（szlib 数据已在内存为 string）；`rawData` 形参为 `string | ArrayBuffer`。
- `src/parsers/registry.ts`：
  - 维护 `Record<string, SourceParser>`，按 `parser.id === source.parserId` 查找。
  - `getParser(parserId)`：未注册抛 `Error`（不静默回退）。
  - `matchParser(rawData, sources?)`：对已注册 Parser 依次调 `validate(rawData)`，返回首个匹配的 `SourceParser`；用于导入向导「自动检测来源」。`sources` 缺省时遍历全部注册 Parser。
  - ID 即 `source.parserId`（来源唯一标识 + Parser 选择键二合一，见 [source](../metadata/source.md)），故一个 `parserId` 对应一个 Parser。
- 注册表默认注册 `szlibParser`；其它 Parser 按贡献指南增量补。

## 3. 纯函数 pipeline 契约

`importPipeline` 是导入管线的核心纯函数（对照 [import-workflow](../metadata/import-workflow.md) 导入纯度要求）：

```ts
interface ExistingState {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
}

interface ImportMeta {
  id: string           // ImportLog.id
  fileName: string
  fileSize: number
  detectedEncoding: string
  importedAt: Date     // 派生时间锚（重建用），禁止 Date.now()
}

interface PipelineResult {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  importLog: ImportLog
  rawRecords: RawRecord[]          // 回填 parseStatus/parseNote/bookId/borrowCycleId
  warnings: ParseWarning[]
}

function importPipeline(
  rows: RawRecord[],          // 调用方预分配 id/importLogId/sourceId/rowIndex；data 待 parser 解析
  source: Source,
  parser: SourceParser,
  existing: ExistingState,
  meta: ImportMeta,
): PipelineResult
```

- **rawRecords 身份**：调用方在进入管线前已把原始记录落为 `RawRecord`（含稳定 `id`）；管线据此派生跨实体引用。`parser.parse` 的职责为「逐行解析 `rows[i].data` 并回写其 `borrowCycleId/bookId/parseStatus/parseNote`」，避免 parser 重新读文件。
- 确定性：相同 `(rows, source, parser, existing, meta)` 必产出结构等价 `PipelineResult`；不带时钟、不读写存储、不依赖全局可变状态。
- 管线组装 `ImportLog`：`stats` 与 `warnings` 由管线从 parse 结果统计；`parserId = source.parserId`，`importedAt = meta.importedAt`，`sourceId = source.id`。
- **写入不在本层**：管线只返回 `PipelineResult`；落 IndexedDB 由调用方（UI / replay 装配）负责，使「纯函数 = 重建等价」可证。

## 4. ID 确定性派生

为满足「同 rawRecords 重放产出等价派生数据」（internal-schema 重建确定性要求），派生实体 ID 不用 `uuid()` 随机，而由稳定输入派生：

| 实体 | 派生键 | 形式 |
|------|--------|------|
| `CatalogRecord.id` | `sourceId + metaIdKey`（metaIdKey 缺省退化为 `sourceId + barcode`） | `cr-{fnv1a32(hex)}` |
| `Book.id` | 沿用：若 CatalogRecord 已匹配到 existing Book，沿用其 id；新增 Book 取首个命中它的 `CatalogRecord.id`（「一书一编目首记」可复现） | `bk-{fnv1a32(hex)}` |
| `BorrowCycle.id` | `importLogId + rawRecordIds.join(',')`（已排序去重） | `cy-{fnv1a32(hex)}` |

- 派生 hash 走 `src/lib/hash.ts` 的 `stableHash(input: string): string`（FNV-1a 32bit，纯函数、无依赖），输出固定长度十六进制串；避免 `crypto.randomUUID`。
- `createdAt/updatedAt` 一律取 `meta.importedAt`（不取导入时刻墙钟），保证重放一致。
- `existing` 中的实体若与新派生 id 冲突，按去重规则合并（同 id 视为同一实体，字段按 §6 合并；不报 id 冲突）。

## 5. 时区转换契约

`src/lib/time.ts`（纯函数，无 `Date.now()`，不在模块顶层读时区）：

- `localToUtc(localText: string, timezone: string): Date`：把「无时区标记的本地时间字符串」（如 szlib 的 `"YYYYMMDD"` + `"HH:MM:SS"` 组合为 `"YYYY-MM-DDTHH:MM:SS"`）按 `timezone`（IANA）解释为 UTC `Date`。用 `date-fns-tz` 的 `fromZonedTime`/等价能力，确保 node 与浏览器一致。
- 输入格式不合法时**抛 `Error`**；管线把该异常转成 `invalid_date` 警告（见 §8），不中断整批。
- 不在导入层做「UTC → 显示时区」；显示由 UI 层按 `UserPreferences.displayTimezone` / `source.timezone` 转换（见 [ui-navigation §6](ui-navigation.md#6-数据契约与边界)）。
- 不引入 `date-fns` 主体：长期时长统计（duration）等 UI 期再按需引入。

## 6. 去重合并算法

`src/parsers/dedupe.ts`（纯函数，existing 入参化，对照 internal-schema 去重策略 + [szlib-parser §4/§5](../metadata/parsers/szlib-parser.md)）。流程对每条待落 CatalogRecord 候选：

1. **CatalogRecord 级匹配（最优先）**：在 `existing.catalogRecords` 中按 `sourceId + barcode` 或 `sourceId + metaIdKey` 查找。
   - 命中：沿用该 `CatalogRecord.id` 与其 `bookId`；把新 barcode 并入其 `barcodes`（去重）；新分类号并入 `classifications`（去重）。**不改其 `bookId`**（Book 归属稳定）。
2. **Book 级 ISBN 匹配**：未命中编目时，提取该候选 `isbn13`，在 `existing.books` 按 `isbn13` 查找。
   - 命中：新建 CatalogRecord（派生 id）挂到该 Book 下；把 `source.id` 并入 Book 的 `sourceIds`（去重）。
3. **Book 级模糊匹配（兜底，flag review）**：无 ISBN 且无编目命中时，比对 `normalize(title)` + `normalize(authors[0])`。
   - 命中且**双方非占位书名**：建议合并到 existing Book，置 `needsReview = true`（待用户确认），记 `duplicate` 警告。
   - 未命中：新建 Book（派生 id，首记 CatalogRecord 派生）。
4. **选书帮占位分支（覆写上述）**：当记录满足 `title === "福田图书馆读者自选图书"` 且 `ISBN` 为空（精确匹配，见 [szlib-parser §5](../metadata/parsers/szlib-parser.md)）：
   - 按 **barcode** 各建独立 `Book`（`needsReview=true, isbn13=null`），**不做 ISBN/title 合并**；CatalogRecord 仅按 `sourceId + barcode` 去重；不与任何 existing Book 合并（含其他选书帮 Book）。

`normalize`（`src/lib/normalize.ts`）：去空白与标点、全角→半角、转小写；`繁→简` 不在本里程碑（标为可选，留扩展）。

**BorrowCycle 去重**（在借还配对后）：

1. 精确匹配：`sourceId + barcode + borrowedAt` 与 `existing.borrowCycles` 重合 → 跳过，记 `duplicate` 警告，回填 `rawRecord.parseStatus='skipped'`。
2. 时间重叠：同一 `bookId + barcode` 已有周期的时间范围内再次出现借出 → 记 `unpaired_record` 警告，仍建周期（`status='unknown'`）。

合并后的产物：existing + 新增合并去重后的并集，交由调用方写库（替换还是 upsert 由调用方决定，§10 边界）。

## 7. 编码检测契约

- 管线入口前由调用方做 `detectAndDecode(buffer)`（对照 [import-workflow](../metadata/import-workflow.md) 编码检测）：先 `TextDecoder('utf-8', { fatal: true })`，失败再 `TextDecoder('gbk')`；返回 `{ text, detectedEncoding }`。
- 该函数依赖运行时 `TextDecoder`（浏览器/Node 原生），纯管线层只消费 `text`，不绑定解码实现；测试用 Node 22 原生 gbk 校验，不引入第三方库。
- 50MB 上限、Web Worker 执行（见 [ui-navigation §6](ui-navigation.md#6-数据契约与边界)/[§9](ui-navigation.md#9-react-性能规则引用)）属 UI 层约束，本里程碑纯管线不实现。

## 8. 借还配对与错误警告模型

借还配对在 `szlib.ts` 内按 [szlib-parser §3](../metadata/parsers/szlib-parser.md)：按 `barcode` 分组、按时间排序，「读者借出」开周期、「读者还回文献」闭周期；忽略「自助查询」「读者续借」。

`ParseWarning.type` 语义（对照 [source](../metadata/source.md)）：

| type | 触发 | recordRef |
|------|------|-----------|
| `missing_field` | 必填字段缺失（如 barcode 缺） | 行号/原始 id |
| `invalid_date` | 日期字符串无法按 `source.timezone` 解析 | 同上 |
| `unpaired_record` | 只有归还无借出 / 借出时间>归还时间 / 周期时间重叠 | 同上 |
| `duplicate` | BorrowCycle 精确重复 / 模糊匹配建议合并 | 同上 |
| `format_error` | rawData 非 JSON / Parser `validate` 误匹配 | null 或文件级 |

- 警告**不中断**解析：记入 `ParseResult.warnings`，对应 `RawRecord.parseStatus` 置 `warning`/`error`/`skipped`；管线聚合进 `ImportLog.warnings` 与 `stats.warningCount/errorCount`。
- `RawRecord.parseStatus`：`success`（正常落库）、`warning`（有警告但产出实体）、`error`（无法产出实体，致命）、`skipped`（重复跳过）。
- `recordRef` 形如 `row:{rowIndex}` 或 `raw:{rawRecord.id}`，便于报告定位。

## 9. 用户故事与验收用例

- 首次导入一批 szlib 流水（含借/还/续借/查询/两条不同 barcode 的选书帮）→ 产出 Books/CatalogRecords/BorrowCycles，续借与查询被忽略，选书帮各 barcode 独立 Book 且 `needsReview=true`。
- 同一文件再次跑 `importPipeline`（existing=空）→ 与首次结构等价（确定性）。
- 增量导入：existing 取前一批输出 → 新 raw 中同 barcode 同 borrowedAt 的周期被识别为 duplicate 跳过；新 ISBN 命中 existing Book 时挂到该书下。
- 从导出备份重放：按 `importLogId` 分组、清空后逐批重放，每批 existing 取上一批累计输出 → 最终派生数据与快照模式结果等价（重建等价）。
- 非法日期、缺失 barcode、借出>归还：分别产出对应 `ParseWarning.type`，`RawRecord.parseStatus` 正确回填，整批不中断。

## 10. 数据契约与边界

- 输入：`rows` 的 `rawRecord.id/importLogId/sourceId/rowIndex` 由调用方预分配并稳定；`data` 字段保留原始键值（溯源、重解析）。parser 不改 `rows[i].data` 以外的壳字段身份（仅回写解析结果字段）。
- 派生数据确定性：ID/时间全部稳定派生（§4），故 `PipelineResult` 可直接 hash 比对做重建等价测试。
- 与数据层关系：管线不写库、不调 Repository；`existing` 由调用方从 `ReadGraphDB` 读出传入；`RawRecord` 字壳是否先落库由调用方决定（重放装配需先落 rawRecords 再喂管线）。
- 不实现：UI 向导、文件选择/拖拽、Worker 编排、`importDatabase(replay)` 装配（属 [UI 导航规格](ui-navigation.md)）；CSV/XLSX 与其它 Parser（按 §1 后续接入）。
- 边界：Parser `validate` 误匹配（无匹配 Parser）→ 管线入口前 `getParser` 抛 `Error`，由 UI 提示用户手动选 Parser；空 raw → `stats` 全 0、warnings 空。

## 11. 测试清单

测试位于 `src/lib/*.test.ts`、`src/parsers/*.test.ts`，夹具 `src/tests/fixtures/szlib-*.json`（脱敏）。纯函数测试无需 fake-indexeddb（管线不碰存储）。

- **time**：`localToUtc` 把 `"2026-04-11T18:33:50"` + `Asia/Shanghai` 转为 UTC `"2026-04-11T10:33:50Z"`；非法输入抛 `Error`；同输入跨调用返回等价 `Date`。
- **isbn**：清洗去连字符空格；ISBN-10→13 校验位正确；13 位非数字被拒；空/`""` 归一为 `null`。
- **normalize**：全角→半角、去标点转小写一致；空串/纯标点归一等价键。
- **registry**：`getParser('szlib')` 命中、未知 id 抛错；`matchParser` 对合法 szlib JSON 命中、对错配数据不误命中。
- **szlib parser**：脱敏夹具→正确产出 books/catalog/cycles；过滤续借/查询；选书帮按 barcode 独立 Book、`needsReview`、不做合并；callno 提取分类号；时间按 `Asia/Shanghai` 转 UTC。
- **dedupe**：编目级 `sourceId+barcode` 命中沿用；ISBN 命中挂到 existing Book；无 ISBN 模糊命中置 `needsReview` 并记 warning；选书帮分支各 barcode 独立、不合并；BorrowCycle 精确重复跳过且 `parseStatus='skipped'`；时间重叠记 `unpaired_record`。
- **pipeline 确定性**：同输入两次跑结果深等价（ID/时间/计数一致）；不含 `Date.now()` 副作用（派生时间用 `meta.importedAt`）。
- **pipeline 端到端**：一批 szlib raw → 落 `books/catalogRecords/borrowCycles/importLog`，`stats`/`warnings` 正确；增量导入（existing 非空）合并正确。
- **重建等价**：导出→清空→按 importLog 分批重放，最终派生数据与快照模式结果结构等价（用脱敏夹具多批次）。

## 12. React 性能规则引用

- 本里程碑为纯函数与单测，不引入 React 组件；导入执行的 Web Worker 编排与 `Progress`/`Spinner` 属 [UI 导航规格](ui-navigation.md) UI 里程碑（引用 `bundle-barrel-imports`，Worker 内只 import `importPipeline` 不拉 UI 依赖）。
- 管线不读 `localStorage`/不触 React store，避免渲染面耦合；`existing` 显式入参化即「无隐式状态」（[import-workflow](../metadata/import-workflow.md) 纯度要求）。

## 13. 书目标题结构化解析

> szlib 等 ISBD 编目来源的原始 `title` 字段是一条编目串，含正题名、并列题名、责任者声明；`Book` 实体有独立的 `title`/`subtitle`/`authors`/`translators`/`parallelTitles` 字段，本小节定义从原始串到这些字段的确定性解析规则。脱敏夹具 `src/tests/fixtures/szlib-sample.json` 与本小节同步约定；后续 `szlib` Parser（§2）按此调用 `parseTitle`。

**输入形状（ISBD 著录语法，中文语境）**

```
正题名[ = 并列题名][/ 责任者声明[; 其他责任者声明]]
```

- 正题名段与并列题名段以 ` = ` 分隔；并列题名可有多个，以 ` = ` 重复。
- `title` 区与责任者区以 `/`（半角）分隔；**无前导空格**、`/` 后接一个空格。
- 责任者声明间以 `;`（无两侧空格）分隔；同一类型责任者内多人以 `，/,/，` 分隔。
- 个人成分可含：国别前缀 `(日)`/`(美)`、姓名、可选 `等`（et al.）、可选角色词 `著`/`译`/`编`/`主编`/`校`/`绘`。
- **不再按 ` : ` 切分副题名**：深图流通数据中 ` : ` 两侧的语义与丛书分册同构（`合成城市笔记 : 地名故事` vs `合成欲望社会 : "丧失大志时代"的新·国富论`），语法上无法可靠区分；切分会导致系列各册在书库列表显示为同名。故 ` : ` 段整体并入正题名，`Book.subtitle` 由 szlib 恒置 `null`（字段保留给未来来源/手动编辑）。

样本（取自 `szlib-sample.json`）：

```
"合成绘本甲 = Synthetic story/ (日)合成作者著;合成译者译"
"合成编程指南 : 第7版/ (美)合成作者甲著;合成译者甲译"
"合成算法论 = Introduction to algorithms/ 合成作者等著;合成译者译"
"合成深度学/ (美)合成作者等著;合成译者等译"
"合成图解手册/ (日)合成作者乙著;合成译者乙译"
"合成亲密论/ (美)合成作者著;合成译者译"
"合成漫画 : 漫画版/ 合成作者著"
"福田图书馆读者自选图书"          <- 占位，不做结构解析
"无条码测试书/ 无条码作者著"
```

**落点**：`src/lib/title.ts` 暴露纯函数 `parseTitle(rawTitle: string): ParsedTitle`，无外部依赖、不带时钟；对应单测 `src/lib/title.test.ts`，夹具取自 `src/tests/fixtures/szlib-sample.json`。

```ts
interface ParsedTitle {
  title: string            // 正题名（去并列/责任；占位书名时原样）；` : ` 段并入，不切副题名
  parallelTitles: string[] // ` = ` 右侧各段；空数组
  authors: string[]        // 著/编/主编/绘 命中或无角色词默认
  translators: string[]    // 译/校/校译 命中
  isPlaceholder: boolean   // 占位书名（选书帮等）短路标记
}
```

**解析步骤**

1. **占位短路**：若 `rawTitle` 精确等于 [szlib-parser §5](../metadata/parsers/szlib-parser.md) 占位书名清单（当前为 `"福田图书馆读者自选图书"`）或为空串 → `isPlaceholder=true`，其余字段 `title=rawTitle`、`authors=[]`、`translators=[]`、`parallelTitles=[]`，直接返回。
2. **切责任区**：以首个 `/` 分割为「题名区」与「责任区」（缺失 `/` 则责任区空）。题名区暂留原始空格。
3. **题名区拆分**：
   - 以 ` = ` 分段：第一段 → `title`（**整体保留，含 ` : ` 段**，不再切副题名——丛书分册与正题名副题名同构不可辨，切分会使书库列表系列各册同名）；其余段 → `parallelTitles`。
   - 注意：` = ` 必须带两侧空格才作为分隔符；紧贴的半角冒号（如 `J238.2`）天然在 title 内，无切割。
4. **责任区拆分**：以 `;` 切责任声明组。
   - 每组以 `，/,/，` 拆个人；每人末尾匹配角色词 `著`/`译`/`编`/`主编`/`校`/`绘`/`校译`/`编著`。
   - 去国别前缀 `(...)`（仅 `(一两个字)` 紧贴姓名开头时去）。
   - `等` 紧贴姓名末尾、角色词之前 → 暂并入姓名字符串保留（如 `"合成作者等"`），由 `normalize`/`lib/normalize.ts` 在匹配键阶段统一剥离，避免在 `authors` 里拆出半截名。
5. **角色词映射**：
   - `著`/`编`/`主编`/`编著`/`绘` → `authors`（含无角色词的第一组默认归 `authors`）。
   - `译`/`校`/`校译` → `translators`。
   - 一条记录内同一字段重复入参按出现顺序合并、去重（`normalize` 后比对）。

**字段去向**

| `Book` 字段 | 来自 | 说明 |
|---|---|---|
| `title` | `parseTitle.title` | 正题名，含 ` : ` 段（丛书分册不切分）；不等于原始编目串 |
| `subtitle` | —（szlib 恒 `null`） | 不再由 `parseTitle` 产出；字段保留给未来来源/手动编辑 |
| `parallelTitles` | `parseTitle.parallelTitles` | 默认 `[]`，见下 |
| `authors` | `parseTitle.authors` | |
| `translators` | `parseTitle.translators` | |
| 原始 `title` 串 | `RawRecord.data.title` | 溯源/重解析；`Book` 不再存原始编目串 |

**`Book.parallelTitles` 新字段**

- 当前 [book.md](../metadata/book.md) 与 `entities.ts`/`schemas.ts` 已含本字段：`parallelTitles: string[]`（默认 `[]`）。用途：UI 可在详情页展示「并列题名」并作为跨语种书的辅助辨识。
- 加字段属 [数据层规格](data-layer.md) schema 增量，迁移策略：旧导出文件无此字段时被默认 `[]` 兜底（`z.array(z.string()).default([])`），不破坏现有 `ExportData` 兼容；Repository 无需重写索引。
- 字段不参与去重键，不污染 `subjects`（`subjects` 保留给编目主题词）。

**边界与退化**

- 题名区出现转义 `/`（极罕见）：Parser 不支持转义；首个 `/` 为硬分隔，右侧不再视为题名。
- 占位书名被纳入「`isPlaceholder`」后，szlib 选书帮分支（§6 第 4 条）不经 `parseTitle` 的角色拆分，直接独立建 Book；二者可叠加调用次序（先占位短路判定，再走选书帮 barcode 独立分支）。
- 极端情况：责任者区出现 `=`/`:` 误作题名分隔 → 仅切首个 `/`，题名区不再二次切到 `=`/`:` 邻近区段；样本中无此噪声，本里程碑不做容错。
- 题名为半角/全角空格混排时保留原始字符；`normalize` 才做全/半角归一。
- ` : ` 不再切分后，书库列表/搜索/详情/排序均直接以完整题名工作；系列各册（如《合成城市笔记》四册）在列表中显示为各自完整题名，可区分。已导入旧数据需清空重导后生效（`Book.subtitle` 旧值保留，UI 详情页仍按需展示）。
- 选书帮占位 `title` 与 `Book.title` 都是 `"福田图书馆读者自选图书"`；`needsReview=true` 期间由人工补全覆盖。

**测试清单（Vitest，`src/lib/title.test.ts`）**

- 上述 9 个 non-empty `szlib-sample.json` title 各产出预期 `ParsedTitle`（正题名/并列/`authors`/`translators`）；含 ` : ` 的样本（`合成编程指南 : 第7版`、`合成漫画 : 漫画版`）断言完整题名不切分。
- `""` 与 `"福田图书馆读者自选图书"`：短路返回 `isPlaceholder=true`、空数组。
- 丛书分册样本：`合成城市笔记 : 地名故事/ 合成作者丙著` → `title='合成城市笔记 : 地名故事'`、`authors=['合成作者丙']`。
- 角色词覆盖：`著`/`译`/`编`/`绘`/无角色词；多组 `;` 切分；`等` 保留于姓名字符串。
- 确定性：同一输入两次调用深等价。
- 与 `normalize` 互不调用（`title.ts` 无依赖 `normalize.ts`）；匹配去重由 `dedupe.ts` 在归一后做。
