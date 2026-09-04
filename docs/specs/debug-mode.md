# 调试模式（Debug Mode）规格

> 本文件从 `docs/app-spec.md` §6 功能规格索引拆出，遵循 SDD + TDD。规格落地于代码前先写本节，再进 Tests(Red) → Code → Tests(Green)。
> 目标：为开发者提供**导入管线的逐行决策明细**（新增/跳过/合并/警告），主通道复用浏览器 Web 开发者工具（DevTools），默认零用户可见性。
> 依赖的规范化对象（`ImportLog`/`ParseWarning`/`RawRecord.parseStatus`、`importPipeline` 纯函数契约、去重决策）以 [import-pipeline](./import-pipeline.md)、[import-workflow](../metadata/import-workflow.md)、[entities](../../src/types/entities.ts) 为主唯一来源；本节只定义「调试开关、DevTools 通道、决策 Trace 数据契约、报告区增量、测试」。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 背景与问题

当前导入报告（`src/routes/import.tsx` 右侧栏）只呈现三块聚合统计（`newBooks` / `newBorrowCycles` / `skippedRecords`）与 `warnings` 列表。开发者排查导入问题时缺少：

- **逐行决策**：某一行最终是「新建 Book」「合并进既有 Book」「跳过」，分别命中哪条去重分支（编目级 `sourceId+barcode`、ISBN 合并、模糊匹配、选书帮占位隔离、周期精确重复）；
- **跳过明细**：`skippedRecords` 只有计数，不知道**哪些行**被跳过、**为什么**（`filterRows` 预剔除 vs 周期重复 vs 解析错误）；
- **实体溯源**：一行产出/关联了哪些实体（`bookId` / `catalogRecordId` / `borrowCycleId`），ID 如何派生；
- **过程观察**：一次导入耗时、parser 与 dedupe 各自产出的警告分布。

这些信息目前全部存在于管线内部（`dedupe.ts` 的 `bookIdByBarcode`/`skippedFlags`/warnings、`pipeline.ts` 的候选装配），但没有出口，调试只能靠断点或临时改代码打 log。

## 2. 设计决策

| # | 决策 | 结论 | 理由 |
|---|------|------|------|
| D1 | 主通道是否复用浏览器 DevTools | **是**：Console 结构化日志 + `console.table` + `performance` + 全局钩子 + 原生 IndexedDB 面板 | 纯前端无后端可挂日志服务；DevTools 原生支持对象树展开、前缀过滤、断点、控制台导出；零 UI 成本；数据不出浏览器，符合隐私基线（design-decisions §安全与隐私）。**不**引第三方日志库（npm-supply-chain-security 依赖最小化） |
| D2 | 辅助通道 | 导入报告侧栏在 debug 模式下出现「调试详情」折叠区：逐行决策表 + 复制 Trace JSON | Worker 内日志顺序需回传统一打印；折叠区给不熟悉 Console 的协作者一个低门槛视图。**不**做独立「开发者后台页」 |
| D3 | 开启方式 | 两级开关：`?debug=1`（会话级，URL 优先）+ `localStorage['readgraph:debug']='1'`（持久）；独立 key，**不**并入 `readgraph:preferences` | 开发者开关非用户偏好，语义独立；URL 参数无需写存储即可用，适合一次性会话 |
| D4 | 决策数据形态 | 管线新增可选产出 `ImportTrace`（纯函数、确定性），**不进** `ExportData`、**不落库** | 保持「管线纯函数 + 重建等价」契约不受 trace 影响（import-workflow 导入纯度要求）；trace 是调试观察物，随会话消亡 |
| D5 | 收集开销 | `importPipeline` 新增可选参数控制收集，默认关闭 → **零分配** | 生产路径不承担 trace 的内存/CPU 成本；打开仅 debug 会话 |
| D6 | Worker 路径 | `runInWorker` 返回 `{ result, trace }`，主线程统一打印 | Comlink 结构化克隆支持普通对象；统一打印保证 console 分组顺序（开发者在主线程 Console 即可看全） |
| D7 | 隐私边界 | trace 仅含派生字段与决策原因，**不含** `RawRecord.data` 全文；导出 JSON 由开发者显式触发 | 借阅数据敏感；trace 不放大暴露面 |

## 3. 调试开关（`src/lib/debug.ts`）

### 3.1 模块契约

```ts
// 读开关：URL > localStorage > 默认关
function isDebugMode(): boolean
function isDebugVerbose(): boolean      // 控制 console.debug 详情量（URL 'debug=verbose' 或 storage 'verbose'）
function readDebugFlag(): DebugFlag     // { mode: boolean; verbose: boolean }
function writeDebugFlag(flag: Partial<DebugFlag>): void   // 仅写 localStorage
function clearDebugFlag(): void
```

- URL 形态：`?debug=1`、`?debug=verbose`。从 `window.location.search` 读取（不经路由状态，保持零依赖、任意页面可开）。
- localStorage 形态：`readgraph:debug` = `'1'` 或 `'{"verbose":true}'`（容错解析，损坏回退关）。
- 优先级：URL 显式出现即覆盖 storage；URL 无参数时读 storage；两者皆无 → 关。
- 不随 `readgraph:preferences` 导出/重建（见 D3），`clearDebugFlag` 供「设置 → 重置」之外的开发者手动清理（Console 执行即可）。
- 生产构建**不剔除**该模块：本应用纯前端、无遥测，debug 通道不改变业务输出，保留便于静态部署后现场排查。

### 3.2 全局钩子（安装于 `main.tsx`）

`installDebugHooks()` 在 `isDebugMode()` 时挂载：

```ts
window.__readgraphDebug = {
  lastImport: ImportTrace | null,          // 最近一次导入的 trace（会话内）
  getImportTrace(): ImportTrace | null,
  exportImportTrace(): void,               // 触发 JSON 文件下载（Blob + a[download]）
  copyImportTrace(): Promise<void>,        // clipboard.writeText
}
```

非 debug 模式不挂载；`__readgraphDebug` 类型声明放 `src/types/debug.d.ts`。

## 4. DevTools 通道设计（主通道）

### 4.1 Console 结构化日志

所有日志统一前缀 **`[readgraph:import]`**，开发者可在 Console 过滤框输入前缀或右键「Hide messages like this」反向管理。日志仅由 `logImportTrace(trace)`（`src/import/trace-log.ts`）产出，仅在 `isDebugMode()` 时调用：

1. `console.groupCollapsed('[readgraph:import] 导入决策 trace', trace.importLogId)` — 整组可折叠；
2. `console.table(rows, ['rowIndex','barcode','title','decision','reason'])` — 逐行决策速览表（列裁剪，避免 DevTools 表过宽）；
3. `console.debug('[readgraph:import] rows', trace.rows)` — 完整对象（含实体 ID），Console 中可展开、可右键 copy；
4. `console.debug('[readgraph:import] summary', trace.stats)` + `console.timeLog`/`trace.durationMs` — 汇总与耗时；
5. `console.debug('[readgraph:import] warnings', trace.importLog.warnings)` — 警告明细（与 `recordRef` 一一对应）。

verbose 级（`isDebugVerbose()`）额外打印：实体增量逐条（`entityDelta` 展开）、每行关联的派生 ID 推导过程字符串（如 `cr-{fnv1a32(sourceId|metaIdKey)}`）。

### 4.2 performance 计时

- 主线程 `performance.mark('readgraph:import:start'|'readgraph:import:end')` + `performance.measure('readgraph:import', …)`；
- Worker 路径以 `performance.now()` 差值计入 `trace.durationMs`（Worker 内 `performance.now()` 同源可用；跨线程不合并 mark，只回传数值）。
- 开发者可在 Performance 面板查看「导入总耗时」，配合 Memory 面板观察大文件导入内存曲线。

### 4.3 原生 IndexedDB 面板

trace 不落库（D4），但持久数据仍可在 DevTools → Application → IndexedDB 直接查：

- `rawRecords`：按 `importLogId` 过滤某批，看 `parseStatus` / `parseNote` / `bookId` / `borrowCycleId` 回填结果；
- `importLogs`：批次 `stats` / `warnings`；
- 与 Console trace 的 `rowIndex` 对照即可完成「行 → 实体」闭环。文档指引写清表名与索引（`importLogId` 已建索引，见 `db.ts` stores）。

### 4.4 断点辅助

不做 `debugger` 语句注入（会无差别中断执行）。指引开发者：

- 断点打在 `src/parsers/dedupe.ts`（编目/书目去重分支）或 `pipeline.ts`（周期去重/回填段），配合 Console trace 的 `rowIndex` 反查目标行；
- Console 中可直接调用 `window.__readgraphDebug.lastImport` 观察最近一次导入，无需重跑。

## 5. 导入决策 Trace 数据契约（`src/parsers/trace.ts`）

### 5.1 类型

```ts
type ImportDecision =
  | 'new-book'              // 新建 Book + CatalogRecord（含无条码/无 ISBN 兜底）
  | 'merged-catalog'        // 编目级命中：sourceId+barcode / metaIdKey，沿用既有 CatalogRecord
  | 'merged-book-isbn'      // 无编目命中，ISBN 命中既有 Book，新编目挂入
  | 'merged-book-fuzzy'     // 无 ISBN 无编目，normalize(title)+authors 模糊命中 → needsReview
  | 'placeholder-isolated'  // 选书帮占位：按 barcode 独立 Book，不做合并
  | 'cycle-created'         // 新建借阅周期（status=borrowed/returned/unknown）
  | 'cycle-skipped-duplicate' // 周期精确重复（sourceId+barcode+borrowedAt）→ parseStatus='skipped'
  | 'cycle-unpaired'        // 借还不成对/时间重叠 → 记 unpaired_record 警告
  | 'row-error'             // format_error 等致命解析错误，行未产出实体
  | 'row-filtered'          // 被 parser.filterRows 预剔除（装配层补充，见 §5.3）

interface ImportTraceRow {
  rowIndex: number          // 与 RawRecord.rowIndex 一致（1-based）
  rawRecordId: string | null
  status: 'imported' | 'skipped' | 'warning' | 'error' | 'filtered-out'
  decision: ImportDecision
  reason: string            // 人读决策原因（与 warning.message 同风格）
  barcode: string | null
  title: string | null
  bookId: string | null
  catalogRecordId: string | null
  borrowCycleId: string | null
  warningType: ParseWarningType | null   // 关联警告类型，用于报告区联动
}

interface ImportTrace {
  importLogId: string
  sourceId: string
  parserId: string
  importedAt: Date
  fileName: string
  fileSize: number
  detectedEncoding: string
  stats: ImportLogStats
  rows: ImportTraceRow[]
  entityDelta: {
    newBooks: string[]            // 新建 Book id
    mergedBooks: string[]         // 被并入的既有 Book id（isbn/fuzzy/placeholder 不在此列）
    newCatalogRecords: string[]
    newBorrowCycles: string[]
    skippedRows: number[]
  }
  durationMs: number | null       // 主线程/Worker 计时；纯函数测试环境为 null
}
```

### 5.2 管线集成（纯函数、可选）

```ts
// pipeline.ts 签名增量：第 6 参，默认 undefined → 零收集、trace 为 null
export interface TraceOptions { verbose?: boolean }

export function importPipeline(
  rows: RawRecord[],
  source: Source,
  parser: SourceParser,
  existing: ExistingState,
  meta: ImportMeta,
  traceOptions?: TraceOptions,
): PipelineResult {
  // …
  trace: ImportTrace | null      // PipelineResult 新增可选字段（undefined 缺省）
}
```

收集点（全部在既有分支上记录，**不改任何决策逻辑**）：

| 收集点 | 产出 decision | 依据 |
|--------|--------------|------|
| 候选装配循环（pipeline.ts 步骤 4） | `new-book` / `merged-catalog` / `merged-book-isbn` / `merged-book-fuzzy` / `placeholder-isolated` | `bookIdByBarcode` 前缀 `new:` 判定新建 vs 命中既有；`isPlaceholder` 判定占位 |
| 周期去重（dedupe.ts `dedupeBorrowCycles`） | `cycle-created` / `cycle-skipped-duplicate` / `cycle-unpaired` | `skippedFlags` 与 `cyWarnings` 按候选下标对齐；`unpaired_record` 警告行记 `cycle-unpaired` |
| parse 警告回填（pipeline.ts 步骤 1/7） | `row-error` / 行级 `warningType` | `parseRes.warnings` 的 `recordRef`（`row:{rowIndex}` / `raw:{id}`）反查行 |
| 行回填循环（pipeline.ts 步骤 7） | 行最终 `status`/实体 ID | 回填后的 `r.bookId`/`r.borrowCycleId`/`r.parseStatus` |

**确定性**：trace 全部由 `(rows, source, parser, existing, meta)` 派生，无时钟（`durationMs` 在纯函数内不赋值，由装配层填写）——两次同输入必产出深等价 trace，可作重建等价断言的一部分。

### 5.3 被过滤行的装配层补充

`parser.filterRows` 在 UI 层（`handleFile`）执行，剔除行**不进管线**（`buildRawRecords` 只见过滤后行）。为让「跳过明细」完整：

- `ImportRequest` 增加可选 `filteredRowIndexes?: number[]`（UI 在 `JSON.parse` 后按原数组 1-based 索引记录被剔除行）；
- `executeImport` 在拿到 `PipelineResult` 后，把被剔除行补为 `decision='row-filtered'`、`status='filtered-out'`、`reason` 取 parser 的过滤语义（如「自助查询」「读者续借」）的行，`rows` 按 `rowIndex` 升序合并；
- 补充仅发生在 trace 收集开启时（`traceOptions` 传入），不影响 `stats`（`totalRawRecords` 语义保持「进入管线的行数」，与现行为一致，见 pipeline.ts 步骤 8）。

### 5.4 Worker 路径

```ts
// import-worker.ts
export interface ImportWorkerApi {
  run(input: ImportWorkerInput & { traceOptions?: TraceOptions }):
    Promise<{ result: PipelineResult; trace: ImportTrace | null }>
}
// run-import.ts runInWorker 解包后把 trace 并入 executeImport 返回值；主线程统一打印
```

## 6. 报告区「调试详情」折叠面板（辅助通道）

### 6.1 UI 设计说明

- **触发**：`isDebugMode() === true` 且本次 `result` 存在时，报告侧栏统计卡下方渲染折叠区（`<Collapsible>`，shadcn 组件；默认收起）。
- **结构**：
  1. 头部：「调试详情」+ 复制 Trace JSON 按钮（`copyImportTrace`/内联 `navigator.clipboard` 副本，失败提示）；
  2. 逐行决策表（紧凑表，等宽列）：`rowIndex`（等宽 mono）→ 状态徽章（imported/skipped/warning/error/filtered-out 四色）→ `decision`（i18n 标签）→ `reason` → `bookId/catalogRecordId/borrowCycleId`（等宽、截断 + title 提示全文）；
  3. 表行点击高亮：若行带 `warningType`，滚动联动到下方警告列表对应条目（`recordRef` 匹配）。
- **状态**：`result` 置空（换来源/重选文件）时折叠区消失；`running` 时保持上一结果但禁用复制按钮。
- **样式**：沿用主壳「编目终端」语言——直角、边框、等宽；不加图表色板（debug 面板不属于阅读图谱页）。
- **i18n**：全部文案走 `t('pages:import.debug.*')`（`import.debug.heading` / `import.debug.copy` / `import.debug.copied` / `import.debug.empty` / decision 标签 `import.debug.decision.*` / 状态徽章复用 `import.warning.*` 风格）；**JSX 中不得出现字面量字符串**（i18n-conventions）。
- 该面板**不做**分页/虚拟滚动（报告是会话态小数据）；行数超 500 时表头提示「仅显示前 500 行，完整数据见 Console trace」（`console.table` 原生支持全量）。

### 6.2 数据契约与边界

- 数据源仅 `PipelineResult.trace`（内存态），**不读库**；
- 导出 JSON = `JSON.stringify(trace, null, 2)`，Date 经 `toISOString` 序列化（复用 `backup.ts` 的序列化风格）；
- 面板与 `logImportTrace` 使用同一份 trace，保证 Console 与 UI 一致。

## 7. 用户故事与验收用例

- **US1（逐行明细）**：开发者 `?debug=1` 导入含重复周期的文件 → Console 出现 `[readgraph:import]` 分组，`console.table` 显示每行 `rowIndex/barcode/title/decision/reason`；重复行 `decision='cycle-skipped-duplicate'`、`status='skipped'`；报告侧栏折叠区同内容可见。
- **US2（合并溯源）**：增量导入同 ISBN 文件 → 新批次行 `decision='merged-book-isbn'`，`bookId` 与既有 Book 相同；`entityDelta.mergedBooks` 列出该书 id；DevTools IndexedDB 面板可按 id 复核。
- **US3（被过滤行可见）**：导入含「自助查询」行的 szlib 文件 → trace 含 `decision='row-filtered'`、`status='filtered-out'` 的行；`stats.skippedRecords` 不变（不把过滤行计入管线统计）。
- **US4（默认零开销）**：无 `?debug` 参数、无 storage 标志时导入 → `result.trace === null`，Console 无 `[readgraph:import]` 输出，管线行为与改动前逐字节等价（重建等价测试仍绿）。
- **US5（持久开关）**：Console 执行 `localStorage.setItem('readgraph:debug','1')` 后刷新 → 无需 URL 参数即进入 debug 模式；`clearDebugFlag()` 可关闭。
- **US6（导出）**：debug 会话内 `window.__readgraphDebug.exportImportTrace()` → 下载含完整 trace 的 JSON 文件，可发回仓库附于 bug 报告（脱敏样本政策同 parser 贡献指南）。

## 8. 数据契约与边界

- **不进 ExportData**：`ExportData` 的 Zod schema（`src/db/export-import.ts`）**不新增** `trace` 字段；`importDatabase` 重放装配不消费 trace——保证「清空重建等价」不受调试通道影响（internal-schema 重建要求）。
- **不落库**：不新增 Object Store、不改 `db.ts` stores/版本号。
- **不改决策逻辑**：trace 收集点全部是「旁路记录」，`bookIdByBarcode`/`skippedFlags`/warnings 计算路径不变；`TraceOptions` 缺省时无任何 trace 分支执行（函数体短路，零分配）。
- **隐私**：trace 仅派生字段（§5.1），不含 `RawRecord.data` 全文、不含条码以外的行原始字段；导出由开发者显式触发（US6）；无任何网络发送（design-decisions 安全基线）。
- **性能**：trace 开启时行级对象为 O(n) 常量分配（每行一个 `ImportTraceRow`），50MB 上限文件（IMPORT_MAX_FILE_SIZE）下量级可控；console 输出由 DevTools 自身截断策略兜底。
- **版本边界**：`ImportTrace` 是会话态结构，不承诺跨版本向后兼容（不同于 ExportData）；版本演进直接改字段，不迁移。

## 9. 测试清单（Vitest，TDD）

位于 `src/parsers/trace.test.ts`、`src/lib/debug.test.ts`、`src/import/run-import.test.ts` 增量；夹具复用 `src/tests/fixtures/`。

- **trace 决策正确性**（szlib 夹具，纯函数层）：
  - 首次导入：有效行 `decision='new-book'`、`status='imported'`，`bookId/catalogRecordId/borrowCycleId` 与 `PipelineResult` 实体一致；
  - 增量同文件：重复周期行 `decision='cycle-skipped-duplicate'`、`status='skipped'`、`stats.skippedRecords` 计数一致；
  - 增量同 ISBN 不同条码：`decision='merged-book-isbn'`，`bookId` 复用既有；
  - 无 ISBN 同题名作者：`decision='merged-book-fuzzy'`，关联行 `warningType='duplicate'`；
  - 选书帮占位：`decision='placeholder-isolated'`，各 barcode 独立 `bookId`；
  - 非法日期/缺失字段行：`decision` 落 `row-error` 或行级 `warningType` 对应，`status='warning'|'error'`；
  - `unpaired_record`：`decision='cycle-unpaired'`。
- **确定性**：同输入两次 `importPipeline`（开 trace）→ `trace` 深等价（排除 `durationMs`）。
- **默认关闭**：不传 `traceOptions` → `result.trace === null`；传 `{ verbose: false }` → 有 trace 且 `rows` 与 `rawRecords` 按 `rowIndex` 对齐。
- **被过滤行补充**：`executeImport` 传 `filteredRowIndexes` → 对应行 `decision='row-filtered'`、`status='filtered-out'`、`rowIndex` 正确、`stats` 不变化。
- **Worker 回传**：`runInWorker` 返回值含 `{ result, trace }`（mock Comlink 或真实 Worker 测试）。
- **重建等价回归**：现有多批次重放测试保持绿（ExportData 无 trace 字段，`importDatabase` 不感知）。
- **debug.ts**：URL `?debug=1` / `?debug=verbose` 优先级高于 storage；storage 损坏回退关；`writeDebugFlag`/`clearDebugFlag` 读写一致。
- **trace-log**：`isDebugMode()=false` 时 `logImportTrace` 不输出（spy `console.*`）。

## 10. 里程碑拆分

| 里程碑 | 内容 | 验收 |
|--------|------|------|
| M1 纯函数 + 通道 | `debug.ts`、`parsers/trace.ts`、pipeline 第 6 参、worker 回传、`trace-log.ts`、`main.tsx` 钩子 | §9 测试全绿；`pnpm build` 通过；`?debug=1` 手工导入可见 Console 分组 |
| M2 报告区面板 | 折叠区 + 决策表 + 复制按钮 + i18n 文案 + 行↔警告联动 | US1/US6 手工验收；无 debug 标志时零 UI 变化 |

> 实现状态：M1/M2 均未启动（规格已定稿，待排期）。
