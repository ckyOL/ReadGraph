# 调试模式落地 — 任务分解（spec M1）

> 来源规格：[debug-mode.md](../specs/debug-mode.md)（已定稿，实现未启动，对应 spec §9 里程碑 M1）。
> 工作流：[SDD + TDD](../ai-agent-workflow-rules.md) — 每任务先写 Red 测试，再实现到 Green。
> 规格权威：spec §2 设计决策（D1–D7）与 §5 数据契约不变；本文件只派任务、登记文件归属与验收，不重写规格。
> 实现细化（decision 优先级、会话态附加字段）在条目内注明并回指 spec 条款；与 spec §8 验收用例冲突时以 §8 为准。

## 代码基线（证据）

| 事实 | 位置 |
|---|---|
| `importPipeline` 现为 5 参；`PipelineResult` 无 `trace` 字段 | `src/parsers/pipeline.ts:60-66,41-48` |
| dedupe 已回传判定原料，trace 收集**无需改 dedupe.ts**：`bookIdByBarcode/bookIds/existingCrIds/reviewFlags/warnings`、周期侧 `skippedFlags` | `src/parsers/dedupe.ts:52-61,297-300` |
| 行级警告回填（`recordRef: row:{N}` → `parseStatus` warning/error，L8）已存在，trace 直接搭车 | `src/parsers/pipeline.ts:431-442` |
| `filterRows` 在 UI 层执行、剔除行不进管线；`executeImport` 覆盖 `stats.filteredRows`（L3） | `src/import/run-import.ts:104-112,126-129` |
| `filterSzlibRows` 返回原数组子集（`Array.filter` 引用保持 → 可反查被剔除行下标） | `src/parsers/szlib.ts:55-58` |
| Worker 返回裸 `PipelineResult`；阈值 `IMPORT_WORKER_THRESHOLD = 50MB` | `src/import/import-worker.ts:18-28`、`src/import/run-import.ts:18` |
| `__AI_DEV_PROXY__` define 先例（vite dev→true、vitest 恒 false、测试 `vi.stubGlobal` 切换）——D3 声明的同模式 | `vite.config.ts:176-181`、`vitest.config.ts:13-15`、`src/ai/ai-client.test.ts:369-384` |
| `main.tsx` 顶部装配区（`installDebugHooks` 落点，自门控不渲染） | `src/main.tsx:1-16` |
| Vitest 全局 environment 为 `node`（`localStorage`/`window` 需 stub 或 per-file jsdom 注解） | `vitest.config.ts:18` |
| `stableHash`（FNV-1a 32bit）已就位，派生 ID 推导串可直接复用口径 | `src/lib/hash.ts:11-25` |

## 范围与边界

- **进入条件**：DBG-0 合入后批次 1 方可开工；DBG-3 依赖批次 1 双任务合入。
- **非目标**（spec §2/§7 已定案，不因实现回潮）：不做应用内调试 UI（D2）；不新增 Object Store、不改 `db.ts`/schema 版本；`ExportData` 不加 trace 字段、`importDatabase` 不感知（重建等价不受影响）；不改任何去重/解析决策逻辑（收集点全部旁路）；零新增 npm 依赖；不触碰 `e2e/`（零 UI 变化，`main.tsx` 钩子安装 dev-only 不渲染）。
- **D5 硬约束**：`traceOptions` 缺省路径零分配——每个收集点先判 `trace == null` 短路；生产构建 `__DEBUG_MODE__` 静态替换 `false`，debug 分支被 minifier 剔除。

## 任务 DAG 与并行批次

```
批次 0（串行）:  DBG-0 契约与门控
批次 1（并行）:  DBG-1 管线 trace 收集  ∥  DBG-2 DevTools 输出通道与全局钩子
批次 2（串行）:  DBG-3 装配层与 Worker 回传（依赖 DBG-1 收集语义 + DBG-2 trace-log 模块）
批次 3（单人）:  收尾 — 集成验收与规格回写
```

- DBG-1 ∥ DBG-2 文件集完全不相交，可独立分支/worktree 并行。
- DBG-3 对 `run-import.ts`/`import-worker.ts`/`import.tsx` 独占；其对 DBG-1 的依赖是**测试语义**（row-filtered 补充、verbose 用例需要真实 trace 产出），对 DBG-2 的依赖是 `logImportTrace` 导入（`import.tsx` 接线）。

### 共享文件簇（串行合入，无同文件并行）

| 文件 | 任务（改动内容） |
|---|---|
| `src/parsers/pipeline.ts` | DBG-0（仅签名：第 6 参 + `PipelineResult.trace?`）、DBG-1（收集点） |
| `src/parsers/trace.ts` | DBG-0（类型契约）、DBG-1（collector 实现） |
| `src/types/debug.d.ts` | DBG-0（新建：常量声明 + `Window.__readgraphDebug` 类型）；DBG-2 仅消费 |
| `src/lib/debug.ts` / `src/lib/debug.test.ts` | DBG-0 独占 |
| `vite.config.ts` / `vitest.config.ts` | DBG-0 独占（define 各 1 行） |
| `src/import/trace-log.ts` / `src/main.tsx` | DBG-2 独占 |
| `src/import/run-import.ts` / `src/import/import-worker.ts` / `src/routes/import.tsx` | DBG-3 独占 |

---

## DBG-0 契约与门控（批次 0，串行，其余任务的公共前置）

- **改动**：
  1. `src/types/debug.d.ts`（新建）：`declare const __DEBUG_MODE__: boolean`（`import type` 引入 `ImportTrace`）+ `ReadgraphDebug` 接口（`lastImport` / `getImportTrace()` / `exportImportTrace()` / `copyImportTrace()`，spec §3.2）+ `interface Window { __readgraphDebug?: ReadgraphDebug }`。
  2. `src/lib/debug.ts`（新建）：`isDebugMode()`（直读 `__DEBUG_MODE__`）、`isDebugVerbose()`（`isDebugMode() && localStorage['readgraph:debug']==='verbose'`，**容错**：localStorage 缺失/损坏（node 测试环境、Safari 隐私模式）回退关）、`writeVerboseFlag(verbose)`（写/清，同样容错）。不并入 `readgraph:preferences`（spec §3.1）。
  3. `vite.config.ts` define 增 `__DEBUG_MODE__: JSON.stringify(mode === 'development')`；`vitest.config.ts` define 增 `__DEBUG_MODE__: JSON.stringify(false)`——与 `__AI_DEV_PROXY__` 并列（D3）。
  4. `src/parsers/trace.ts`（新建，**本任务只落类型**）：`ImportDecision`、`ImportTraceRow`、`ImportTrace`（spec §5.1 原样）。
  5. `src/parsers/pipeline.ts` 仅签名增量：`export interface TraceOptions { verbose?: boolean }`（spec §5.2 归属 pipeline.ts）、`importPipeline` 第 6 可选参、`PipelineResult` 增 `trace?: ImportTrace | null`——本任务恒返回缺省（不收集），现有 pipeline 测试不动。
     - trace.ts 类型内注明判定优先级（占位 > 编目级 > ISBN > 模糊 > new），实现归 DBG-1。
- **测试（Red 先行）**：`src/lib/debug.test.ts`——vitest define 下 `isDebugMode()===false`；`vi.stubGlobal('__DEBUG_MODE__', true)` 切换后为 true（先例 ai-client.test.ts）；verbose 读写一致；`localStorage` 缺失/抛错时 `isDebugVerbose()` 回退 false 不抛。
- **验收**：`pnpm test` 全绿（含既有 651+ 用例不回归）、`pnpm build` 绿。

## DBG-1 管线 trace 收集（批次 1A）

  1. `src/parsers/trace.ts` 落 collector：`initTrace(meta, source, parser)` + 逐行记录助手；`pipeline.ts` 在既有分支上挂收集点（**不改任何决策逻辑**，spec §5.2 表）：
     - 候选装配循环（步骤 4）：`isPlaceholder` → `placeholder-isolated`（**先于**编目级判定——dedupe.ts:124-133 占位候选命中既有编目也置 `existingCrIds[i]`，后查会把重导占位行误判为 merged-catalog）；`existingCrIds[i] !== ''` → `merged-catalog`；`bookIds[i]` 以 `new:` 开头 → `new-book`；非 `new:` 且候选 isbn13 非空 → `merged-book-isbn`；非 `new:` 且 isbn13 空 → `merged-book-fuzzy`。判定为纯函数 `collectCatalogDecision(...)`，置于 trace.ts（dedupe 回传字段足以推导，不回传新增字段）。
     - 周期去重：`skippedFlags[i]` + `cyWarnings` 按候选下标/`recordRef: raw:{id}` 对齐 → `cycle-skipped-duplicate`（含批次内重复 dedupe.ts:415-421 与跨文件闭合 alreadyClosed——后者无 duplicate 警告，reason 注明「并入既有周期（跨文件闭合）」）；`unpaired_record` 警告行 → `cycle-unpaired`；其余接受候选 → `cycle-created`。
     - 警告回填（步骤 7/L8）：`row:{N}` 警告 → 行 `warningType`；`format_error` → `row-error`。
     - 行回填循环：最终 `status`（parseStatus success/skipped/warning/error → imported/skipped/warning/error）与实体 ID（bookId 含 metaid 消歧后的真实 id、borrowCycleId）。
  2. **行 decision 单值优先级**（spec §8 验收用例为准）：`row-filtered`（装配层，DBG-3）> `row-error` > `cycle-skipped-duplicate` > `cycle-unpaired` > 候选分支（placeholder-isolated / merged-catalog / merged-book-isbn / merged-book-fuzzy / new-book）> `cycle-created`。首次导入有效行 = `new-book`（§8 用例 1）、增量重复周期行 = `cycle-skipped-duplicate`（§8 用例 2）。
  3. `entityDelta`：`newBooks` = 本批新建 Book 终态 id；`mergedBooks` = `merged-book-isbn`/`merged-book-fuzzy` 命中的既有 Book id（US2 口径；spec §5.1 行内注释「placeholder 不在此列」按 US2 验收裁定，占位独立书不入列）；`skippedRows` = 跳过行 rowIndex。
  4. **会话态细化**（spec §7 允许会话结构直接演进字段）：verbose 收集时 `ImportTraceRow` 补可选 `idDerivation?: string`（如 `cr-{fnv1a32(sourceId|metaIdKey)}`、`bk-{fnv1a32(sourceId|barcode)}`，用 `stableHash` 口径），仅 verbose 且命中派生 ID 时填写；非 verbose 不分配。
  5. `durationMs` 纯函数内**不赋值**（保持 `null`，装配层填写，spec §5.1/§5.2 确定性）。
- **测试（Red 先行）**：`src/parsers/trace.test.ts`——spec §8 前 7 项决策正确性（首次导入 new-book 与实体 ID 一致；增量重复周期 skipped；增量同 ISBN 不同条码 merged-book-isbn 且 bookId 复用；无 ISBN 同题名作者 merged-book-fuzzy + `warningType='duplicate'`；选书帮占位各 barcode 独立；非法日期/缺字段行 status/error；unpaired_record）＋**确定性**（同输入两次深等价，排除 `durationMs`）＋**默认关闭**（不传第 6 参 `result.trace === null`；`{verbose:false}` 有 trace 且 rows 与 rawRecords 按 rowIndex 对齐）。
- **验收**：`pnpm test` 绿（pipeline/dedupe/run-import 既有用例零回归——重建等价回归由全量 suite 兜底）；代码审查确认 `trace == null` 路径零新增分配。

## DBG-2 DevTools 输出通道与全局钩子（批次 1B）

- **改动**：
  1. `src/import/trace-log.ts`（新建）：`logImportTrace(trace: ImportTrace | null)`——null 安全 no-op；内部 `isDebugMode()` 门控（spec §4.1/§8：false 时零输出）。输出序列按 spec §4.1 五步：`console.groupCollapsed('[readgraph:import] 导入决策 trace', importLogId)` → `console.table(rows, ['rowIndex','barcode','title','decision','reason'])`（列裁剪）→ `console.debug rows` → `console.debug summary + durationMs` → `console.debug warnings`。verbose 级（`isDebugVerbose()`）追加 `entityDelta` 逐条与行 `idDerivation` 推导串。**并更新 `window.__readgraphDebug.lastImport`**（可选链防御，钩子未安装时静默）。
  2. 同文件：`installDebugHooks()`——`isDebugMode()` false 时不挂载；true 时挂 `window.__readgraphDebug = { lastImport: null, getImportTrace, exportImportTrace, copyImportTrace }`。导出 = `JSON.stringify(trace, null, 2)`（Date 走 `toISOString`，同 backup.ts 序列化风格）+ Blob + `a[download]`；复制 = `navigator.clipboard.writeText`。
  3. `src/main.tsx`：导入后顶层调用 `installDebugHooks()`（dev-only，不渲染、不影响 SSR/测试路径）。
- **测试（Red 先行）**：`src/import/trace-log.test.ts`——`/** @vitest-environment jsdom */`（`window`/`self` 可用；或 `vi.stubGlobal`）：`__DEBUG_MODE__=false`（vitest define）时 spy `console.*` 零调用；stubGlobal true 后五步输出与前缀 `[readgraph:import]` 断言；`localStorage` stub verbose 开/关差异；`trace=null` no-op；`exportImportTrace` 触发 `URL.createObjectURL`+download、`copyImportTrace` 写剪贴板（均 stub 断言）；`lastImport` 在 `logImportTrace` 后更新。
- **验收**：`pnpm test` 绿；`pnpm build` 绿。

## DBG-3 装配层与 Worker 回传（批次 2，依赖 DBG-1 + DBG-2 合入）

- **改动**：
  1. `src/import/import-worker.ts`：`ImportWorkerInput` 增可选 `traceOptions?: TraceOptions`；`ImportWorkerApi.run` 返回 `Promise<{ result: PipelineResult; trace: ImportTrace | null }>`（spec §5.4）；run 内透传 traceOptions，并在 `traceOptions` 存在时以 `performance.now()` 差值填 `trace.durationMs`（Worker 内同源可用，跨线程不合并 mark，spec §4.2）。
  2. `src/import/run-import.ts`：
     - `ImportRequest` 增可选 `filteredRowIndexes?: number[]`（1-based，原数组下标，spec §5.3）；
     - `executeImport` 在 `isDebugMode()` 时装配 `traceOptions = { verbose: isDebugVerbose() }`（否则 undefined → 管线零收集）；主线程同步路径用 `performance.now()` 差值填 `durationMs`；`isDebugMode()` 时打 `performance.mark('readgraph:import:start'|'end')` + `measure('readgraph:import')`；
     - 拿到 `PipelineResult` 后，**仅当 trace 收集开启**且传入 `filteredRowIndexes` 时补 `decision='row-filtered'`、`status='filtered-out'`、`rawRecordId=null` 的行（reason 取 parser 过滤语义「自助查询」等；barcode/title 尽力从原始行字段填充，缺失为 null），`rows` 按 rowIndex 升序合并；**不触碰 `stats`**（`totalRawRecords` 语义保持「进入管线的行数」，spec §5.3）；
     - `runInWorker` 解包 `{ result, trace }`，trace 并入返回值；`executeImport` 不覆盖 Worker 已填的 `durationMs`。
  3. `src/routes/import.tsx`：
     - `handleFile` 在 `isDebugMode()` 时由 `JSON.parse` 原数组与 `filterRows` 结果的引用差集计算 `filteredRowIndexes`（`Array.filter` 保引用，基线表已证），传入 `executeImport`；生产路径不计算（零分配，D5）；
     - `startImport` 成功后调用 `logImportTrace(res.trace)`（null 安全；`lastImport` 更新在 trace-log 内，主线程统一打印，spec §4.1/D6）。
- **测试（Red 先行）**：`src/import/run-import.test.ts` 增量（用 `vi.stubGlobal('__DEBUG_MODE__', true)` 开启装配，先例 ai-client.test.ts:371）：`filteredRowIndexes` → 对应行 `row-filtered`/`filtered-out`/rowIndex 正确且 `stats` 不变；不传时无 filtered 行；dev 装配下 `result.trace !== null`。Worker 回传：`/** @vitest-environment jsdom */` 直测 `import-worker` 导出的 `api.run(input)`（jsdom 提供 `self` 使 Comlink `expose` 可导入；或 `vi.mock('comlink')`），断言返回 `{ result, trace }` 且透传 `traceOptions` 后 trace 非空、`durationMs` 为 number。
- **验收**：`pnpm test` 绿（既有 run-import 集成用例零回归）；`pnpm build` 绿。

## 收尾：集成验收与规格回写（批次 3，单人，全任务合入后）

- **门禁**（在合并 main 上跑全量）：`pnpm test` + `pnpm build`（CI 六门禁中 e2e/audit 与本变更无关，不红即可）。
- **产物检查（US4）**：`pnpm build` 后 `grep -c "readgraph:import\|readgraph:debug\|__DEBUG_MODE__" dist/assets/*.js` 须为 0——debug 分支与字符串零残留。
- **手工冒烟（US1–US6）**：`pnpm dev`（遵循 [ai-agent-workflow-rules §4](../ai-agent-workflow-rules.md#4-并行-worktree-端口分配vite--preview) 端口规则，`lsof -iTCP:<port> -sTCP:LISTEN` 确认空闲）：
  1. 导入含重复周期 szlib 夹具 → Console `[readgraph:import]` 分组 + `console.table` 逐行决策；
  2. 增量导入同 ISBN → `merged-book-isbn`、`entityDelta.mergedBooks`、IndexedDB 面板按 id 复核；
  3. 含「自助查询」行 → `row-filtered` 且 `stats.skippedRecords` 不变；
  4. `localStorage.setItem('readgraph:debug','verbose')`（不重启）→ 增量/推导串可见，removeItem 回默认级；
  5. `window.__readgraphDebug.exportImportTrace()` 下载 JSON、`copyImportTrace()` 写剪贴板。
  冒烟样本须脱敏（仓库隐私规则：不提交原始捕获）。
- **进程清理**：冒烟结束关闭 dev server 并确认端口释放（[§3 进程生命周期](../ai-agent-workflow-rules.md#3-进程生命周期管理启动即登记结束即清理)）。
- **规格回写**：spec §9 实现状态改「已落地」；[app-spec §6](../app-spec.md) #8 落地状态同步；本文件各条目补 ✅ 日期（同 quality-hardening I-2 体例）。

## spec §8 测试清单 → 任务映射

| spec §8 条目 | 任务 | 测试文件 |
|---|---|---|
| trace 决策正确性（7 项场景） | DBG-1 | `src/parsers/trace.test.ts` |
| 确定性（排除 durationMs 深等价） | DBG-1 | 同上 |
| 默认关闭（trace===null / verbose:false 对齐） | DBG-1 | 同上 |
| 被过滤行补充（filteredRowIndexes） | DBG-3 | `src/import/run-import.test.ts` |
| Worker 回传 `{result, trace}` | DBG-3 | `src/import/import-worker`（jsdom 直测 api） |
| 重建等价回归（ExportData 无 trace 感知） | DBG-1/DBG-3 全量回归兜底（既有用例不动） | 既有 suite |
| debug.ts 开关门控 | DBG-0 | `src/lib/debug.test.ts` |
| trace-log 门控静默 | DBG-2 | `src/import/trace-log.test.ts` |
