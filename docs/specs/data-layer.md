# 数据层规格

> 本文件从 `docs/app-spec.md` §9 拆出，遵循 SDD + TDD。规格落地于代码前先写本节，再进 Tests(Red) → Code → Tests(Green)。
> 实体字段定义与索引语义以 [internal-schema](../metadata/internal-schema.md) 及各实体元数据文档为唯一来源；本节不重复抄录字段表，只定义「代码落点、接口契约、迁移与测试」。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 范围与依赖

**范围**：定义 Dexie 数据库 schema（库名 `readgraph`）、实体 Zod 校验、Repository 接口与实现、版本迁移策略、原子系统重置、整库导出/导入。本里程碑**不实现**导入管线（Parser、去重算法、借还配对属 [导入管线规格](import-pipeline.md)）、不接 UI Provider（DB Provider 在 UI 里程碑落地，仅消费本层暴露的 db 句柄与 Repository）。

**依赖**（本里程碑锁定，已过 [npm-supply-chain-security §3](../npm-supply-chain-security.md) 冷却期审查）：

| 包 | 类型 | 版本 | 用途 |
|----|------|------|------|
| `dexie` | runtime | `4.4.4` | IndexedDB 封装、schema/version、事务 |
| `zod` | runtime | `4.4.3` | 实体 schema 校验、`UserPreferences`、`ExportData` 校验 |
| `fake-indexeddb` | dev | `6.2.5` | Vitest（node 环境）下为 Dexie 提供内存 IndexedDB |

> `dexie-react-hooks` 留待 UI Provider 里程碑引入（`useLiveQuery` 响应式订阅），本层 Repository 不依赖它，避免不必要依赖面。

**代码落点**：

```
src/
├─ types/entities.ts          # 实体 TS 类型（对照 metadata，本层定义并导出）
├─ db/
│  ├─ db.ts                   # Dexie 子类 ReadGraphDB：schema(version 1)、所有 store 与索引
│  ├─ schemas.ts              # 实体 Zod schemas（落库/导出/导入校验）
│  ├─ repositories.ts         # 各实体 Repository 接口 + 实现（薄封装 db.table）
│  ├─ reset.ts                # 原子系统重置（单事务清空全部 store + 可选清 readgraph:* localStorage）
│  ├─ export-import.ts        # ExportData 编解码（Zod 校验、整库快照导出/写回）
│  ├─ uuid.ts                 # UUID v4 工具（导入管线后续按稳定输入派 ID）
│  └─ *.test.ts               # 数据层测试
└─ lib/preferences.ts          # UserPreferences Zod schema + 读写（theme/timezone 补齐，locale 沿用 locale.ts）
```

## 2. 实体 Zod schema

- `src/db/schemas.ts` 为 internal-schema 的六个实体各导出一个 Zod schema：`bookSchema`、`catalogRecordSchema`、`borrowCycleSchema`、`sourceSchema`、`rawRecordSchema`、`importLogSchema`。
- schema 与 metadata 字段一一对应：必填/可空、数组、`Date`、枚举（`status`/`classificationSystem`/`ParseWarning.type` 等）。
- `bookSchema.isbn13` 允许 `null`；非空时校验 13 位纯数字。ISBN-13 校验位作为**软校验**（warning，不阻断落库），硬校验仅做「13 位数字」格式。
- `catalogRecordSchema.metaId` 为 `string|number|null`，`metaIdKey` 为 `string|null`。
- 时间字段统一存 **`Date` 对象（UTC）**；Zod schema 接受 `Date` 实例或 ISO 8601 字符串，`.transform` 归一为 `Date`。
- 落库（Repository put/create）前必须 `safeParse`，校验失败抛 `ZodError` 且不落库。

## 3. Dexie schema 与索引定义

- `src/db/db.ts`：`class ReadGraphDB extends Dexie`，`constructor` 调 `this.version(1).stores({...})`。库名 `'readgraph'`。
- **主键**：所有 store 用 `'id'`（UUID v4）。
- **索引**严格对照 [internal-schema](../metadata/internal-schema.md) 各 store 索引列表：

  | Store | Dexie 索引字符串 |
  |-------|-----------------|
  | `books` | `'id, &isbn13, title, createdAt, *sourceIds, *tags, needsReview'` |
  | `catalogRecords` | `'id, bookId, sourceId, metaId, metaIdKey, *classCodes, *barcodes, [sourceId+metaIdKey]'` |
  | `borrowCycles` | `'id, bookId, sourceId, borrowedAt, returnedAt, status, [bookId+borrowedAt], [sourceId+borrowedAt]'` |
  | `sources` | `'id, &parserId, type'` |
  | `rawRecords` | `'id, importLogId, sourceId, parseStatus'` |
  | `importLogs` | `'id, sourceId, importedAt'` |

  - `&` = unique；`*` = multiEntry；`[a+b]` = compound。
  - `&isbn13` 把 `null/undefined` 视为不参与 unique（与 IndexedDB sparse 语义一致）。

- 时间存储：Dexie 直接存 `Date` 对象（IndexedDB 原生支持），与 internal-schema「UTC ISO 8601」在导出层互转（§7）。

## 4. Repository 接口

Repository 是 UI/管线与 Dexie 间的薄契约，**不持状态**，接收一个 `ReadGraphDB` 句柄构造（便于测试注入 fake-indexeddb）。

```ts
interface Repository<T extends { id: string }> {
  get(id: string): Promise<T | undefined>
  getAll(): Promise<T[]>
  put(entity: T): Promise<string>
  bulkPut(entities: T[]): Promise<void>
  delete(id: string): Promise<void>
  count(): Promise<number>
}
```

补充查询接口（按索引，语义对照 internal-schema）：
- `BookRepository`：`findByIsbn13`、`findBySourceId`（multiEntry）、`findNeedsReview`、`searchByTitle`。
- `CatalogRecordRepository`：`findByBookId`、`findBySourceId`、`findByBarcode`（multiEntry）、`findBySourceMetaIdKey`（compound）、`findClassCodes`。
- `BorrowCycleRepository`：`findByBookId`、`findBySourceId`、`findBorrowed`、`timelineByBook`（`[bookId+borrowedAt]`）、`timelineBySource`。
- `SourceRepository`：`findByParserId`（unique）、`findByType`。
- `RawRecordRepository`：`findByImportLog`、`findBySourceId`、`findByStatus`。
- `ImportLogRepository`：`findBySourceId`、`recent(limit)`。

约束：写方法落库前对入参跑对应 Zod `safeParse`，失败抛 `ZodError`，不部分写入；查询返回实体副本；不在本层做去重/合并（属 [导入管线规格](import-pipeline.md)）；UI 响应式由上层 `dexie-react-hooks` 直接 `useLiveQuery`，本层不内置订阅。

## 5. 迁移策略

- 版本号从 `1` 起，`this.version(1).stores({...})`。
- 字段/索引演进：**升 version**（`version(2).stores({...})`），在 `.upgrade(...)` 迁移；禁手改旧版 stores 覆盖历史 schema（Dexie 按 version 增量管理）。
- 大重构走「导出 → 系统重置 → 用新 schema 重导」，不在 upgrade 里大改写（与 internal-schema「重置=全有或全无」一致）。
- `localStorage` key `readgraph:db-version` 仅作可观测探针，不驱动迁移。

## 6. 系统重置

- `resetDatabase(db, { clearPreferences? })`：
  - 在**单个** `db.transaction('rw', <六张表>, async () => {...})` 内 `db.table.clear()` 全部六张表。
  - 任一写失败则事务整体回滚，绝不留半清空中间态。
  - `clearPreferences` 为真时清除 `localStorage` 下所有 `readgraph:*` 键；为否时保留用户偏好——与 internal-schema「可选保留偏好」一致。
  - 本函数**不提供导出**；UI 层在调用前强制导出/二次确认（属 [设置与系统重置规格](settings.md)）。

## 7. 数据导出与重建

- `exportDatabase(db): Promise<ExportData>`：读全部六张表，组装 `ExportData`（`version='1'`，`exportedAt=new Date()`），所有 `Date` 序列化为 ISO 8601 `Z` 串。**rawRecords 与 sources 为必导项**。
- `exportDataSchema`（Zod）：校验外部 JSON；时间字段反序列化时由 ISO 串转回 `Date`。
- `importDatabase(db, data, { mode })`：`snapshot` 先 `resetDatabase` 再单事务 `bulkPut` 全部实体（逐实体过 Zod safeParse）；`replay` 仅落 `sources + rawRecords`，其余由管线重放（本里程碑实现 `snapshot`，`replay` 留管线里程碑）。
- `data.version` 不匹配时抛 `Error`；rawRecords 缺失时拒绝。

## 8. 用户偏好

- `src/lib/preferences.ts` 导出 `userPreferencesSchema`（Zod）：`{ locale: 'zh-CN'|'en', theme: 'light'|'dark'|'auto', displayTimezone: string, ai: { enabled, baseUrl, model, sendPreview }, annualGoals: Record<number, number> }`。
- 读写仍走 `localStorage` key `readgraph:preferences`；theme/timezone 由本里程碑补齐，locale 沿用既有 `locale.ts` 不重写（避免回归既有 i18n 测试）；`ai` 扩展契约见 [ai-features §5.1](./ai-features.md#51-偏好持久化扩展-data-layer-§8)。
- `readPreferences()`：`safeParse` 失败降级到默认 `{ locale: 'zh-CN', theme: 'auto', displayTimezone: 'Asia/Shanghai', ai: DEFAULT, annualGoals: {} }`（与 [ui-navigation §8](ui-navigation.md#8-测试清单)「非法值降级」一致）。
- `writePreferences(patch)`：合并写入，整体过 schema 校验。**本里程碑只交付 schema + 读写函数与测试**，不改 `__root.tsx`（主题 Provider 在 UI 里程碑装配）。
- **年度目标（`annualGoals`，Phase 2 年度视图，2026-08-26 定稿）**：
  - 形态：`Record<number, number>` **按年记录**（键 = 4 位整数年 `[1000, 9999]`，值 = 目标本数整数 `[1, 999]`）——年度视图按年组织，历年目标各自可读；缺失/非对象 → `{}`（无目标）。
  - 降级：**逐条目过滤**（对齐 `ai` 字段级降级模式，不整体打翻）——键非 4 位整数年、值非整数或越界（<1 或 >999，含 0/负数）的条目丢弃，合法条目保留；整条偏好 safeParse 失败仍整体降级默认。
  - 语义：目标进度 = `computeYearSlice(..., year).bookCount` vs `annualGoals[year]`（[reading-profile §2.7](./reading-profile.md#2-统计维度与聚合契约)）；**目标值不进 AI payload**（[ai-features §9.1](./ai-features.md#91-phase-2年度总结叙事--流式) 白名单边界——非聚合统计、非书目字段）。
  - 清除：0 值不被 schema 接受（`min(1)`），**清除 = 删除该年条目**（键不存在即无目标）。
  - 设置入口：设置页偏好区「年度目标」控件——当前年数字步进器（`−`/`+`，1–999；未设置显示占位；减至 0 删除该年条目即清除），变更即时写 `writePreferences({ annualGoals })`（对齐主题/locale 即时生效模式）；年度视图目标卡只读展示、无编辑入口。
  - 系统重置：`clearPreferences=true` 清 `readgraph:*`（`annualGoals` 随偏好一并清除）；`false` 保留（对齐既有语义，`reset.ts` 无需改动）。

## 9. 用户故事与验收用例

- 构造内存 `ReadGraphDB`（fake-indexeddb 注入），对各 store 做 CRUD，读回结构与写入一致。
- 按 `isbn13` / `[sourceId+metaIdKey]` / 借阅时间线索引查询，命中正确且不漏 null 项。
- `resetDatabase` 六张表单事务清空；制造中途写失败时整体回滚，无部分数据。
- `exportDatabase` 得完整 `ExportData`（含 sources + rawRecords），`importDatabase(snapshot)` 还原后全库与导出前等价。
- 向 `localStorage` 写非法 theme/timezone，`readPreferences` 降级为合法默认且不抛。

## 10. 数据契约与边界

- **UUID 确定性**：Repository 不保证 ID 生成确定性；导入管线负责由 `rawRecord.id + importLogId` 派生实体 ID 以满足「重建等价」。本层只提供 `uuid()` 工具，不绑定派生策略。
- **Date/UTC**：Dexie 内存 `Date` 对象（UTC 语义由 Parser 在导入阶段保证）；UI 显示层负责转 `displayTimezone`，本层不转时区。
- **fake-indexeddb 差异**：复合索引、multiEntry、IDBKeyRange 须在测试验证，生产以 Chromium IndexedDB 为准；测试断言语义不断言实现细节。
- **不实现**：去重合并、借还配对、Parser、纯函数 pipeline（属 [导入管线规格](import-pipeline.md)）；主题 Provider 装配与页内 `Empty`（属 [UI 导航规格](ui-navigation.md)）；ECharts（属 [阅读画像与图表规格](reading-profile.md)）。

## 11. 测试清单

测试位于 `src/db/*.test.ts`、`src/lib/preferences.test.ts`。统一在 `beforeEach` 用 `fake-indexeddb` 注入 `globalThis.indexedDB` 与 `IDBKeyRange` 后 `new ReadGraphDB()`，`afterEach` 关库。

- **schema 校验**：各 entitySchema 把合法/非法样本分别 accept/reject；`isbn13` 格式、`Date` 与 ISO 互转、枚举越界被拒。
- **DB schema**：六张表存在；索引名称与 internal-schema 一一对照（`db.tables` + `table.schema.indexes` 断言）。
- **Repository CRUD**：各 Repository `put/get/getAll/bulkPut/delete/count` 行为；Zod 校验失败抛错且不落库。
- **Repository 索引查询**：`findByIsbn13`、`findByBarcode`（multiEntry）、`findBySourceMetaIdKey`（compound）、`timelineByBook`（compound 范围）、`findBorrowed` 命中正确；多 source 同 metaIdKey 不串。
- **系统重置**：六张表单事务清空；制造 `bulkPut` 中途抛错验证回滚，所有表保持一致（无半清空）。
- **导出/导入**：`exportDatabase` 含全部表；`importDatabase(snapshot)` 还原后全库等价；`version` 不匹配抛错；rawRecords 缺失拒绝。
- **年度目标（§8 增量，Y-2 阶段）**：`annualGoals` 合法读写回环（多历年互不串、按年各自可读）；缺失/非对象 → `{}`；逐条目过滤——键非 4 位整数年（含字符串键 "2026" 经 coerce 通过、3 位/5 位/负数键丢弃）、值非整数/0/负数/越界（>999）条目丢弃、合法条目保留；`writePreferences` 写 `annualGoals` 后 `readPreferences` 回环等价；系统重置 `clearPreferences=true` 清除（含偏好整体），`false` 保留。

## 12. React 性能规则引用

- `client-localstorage-schema`：`readgraph:preferences` 读写走 `userPreferencesSchema` 校验（§8），避免脏值。
- Repository 写路径 Zod 校验避免脏数据落库（SDD 强约束）；UI 响应式由 `dexie-react-hooks` `useLiveQuery` 直连 Dexie（引用 `bundle-barrel-imports`，避免 barrel 拉 UI 体积），本层不内置订阅以减少重复渲染面。
