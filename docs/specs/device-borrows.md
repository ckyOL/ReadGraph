# 设备借阅（电子书阅读器等）区分与统计排除规格

> 本文件定义「非书设备借阅」（电子书阅读器等）的识别、存储标记与统计排除方案。
> 从 `docs/app-spec.md` §10.2（szlib parser）与 §11（阅读画像）拆出，遵循 SDD + TDD。
> 实体字段语义以 [book.md](../metadata/book.md) 与 [internal-schema](../metadata/internal-schema.md) 为唯一来源；本节只定义代码落点与契约增量。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 背景与需求

深圳图书馆提供电子书阅读器等**设备外借**服务。设备以普通编目形式进入 OPAC（如 `metaid=5952182`），因此其借还记录与图书借阅**同构**地出现在「我的图书馆」流通记录里（`optype` 同为「读者借出」/「读者还回文献」），当前 szlib parser 会照常将其解析为 Book + CatalogRecord + BorrowCycle：

- 时间线（`/timeline`）与书库（`/library`）如实展示 —— **保留**，这是设备借阅历史，用户要求「借阅记录也按编目写进历史」。
- 阅读画像（`/profile`）统计把设备当成一本书计入藏书数、周期数、分类分布、借阅量、时长、甘特 —— **需排除**，设备不是阅读行为。

**目标**：

1. 导入时识别设备借阅行，为其 Book 打上可区分的材料类型标记。
2. 阅读画像统计（`computeProfileStats` 全部维度）不纳入设备。
3. 历史/书库展示不受影响（设备记录仍可见、可溯源）。
4. 存量已导入的设备记录经启动回填补标，无需用户重导。

**非目标**：不做设备在 UI 的徽标/过滤（可选增强，见 §9）；不改变导入日志统计语义（如实反映文件内容，见 §7）。

## 2. 检测（Detection）

**信号**：szlib 流通记录行字段 `cirtype === '电子设备外借'`（精确字符串匹配）。

依据：

- `cirtype` 是深图「我的图书馆」API 的显式**流通类型**字段（如「中文图书外借」「期刊」「大学城中文图书」），由馆方系统按借出物品种类标记，是权威信号。
- 脱敏夹具 `src/tests/fixtures/szlib-202604.json` 含真实结构的设备行（借/还各一）：`cirtype="电子设备外借"`、`metaid=5952182`、`ISBN=""`、`callno="TP368.3/168"` —— 与用户报告一致。
- 不采用题名关键词/索书号前缀/callno 启发式：设备题名无稳定命名规范，`TP368.3` 等分类号也可能命中真实图书；单一显式字段最稳。
- 不采用 metaid 白名单：新设备会获得新 metaid，白名单不可维护。

**实现**：szlib parser 内导出判定函数，与 `filterSzlibRows` 同模式（parse 与 UI 预览共用同一标准）：

```ts
// src/parsers/szlib.ts
/** 非书设备流通类型（szlib §10.2、device-borrows §2）。精确匹配，参照占位题名检测约定。 */
const DEVICE_CIRTYPES = new Set(['电子设备外借'])

export function isDeviceCirtype(cirtype: string | undefined): boolean {
  return cirtype != null && DEVICE_CIRTYPES.has(cirtype)
}
```

- 设备行属于合法 optype 行（「读者借出」/「读者还回文献」），**不**从预览/rawRecords 剔除 —— 与「自助查询」「读者续借」的过滤语义不同；设备是真实借阅历史，只是材料类型不同。
- 行级判定后，该行产出的 `bookPartial` 携带 `materialType: 'device'`（§3）。同设备多次借阅（同 barcode/metaIdKey）合并到同一设备 Book，标记随编目级匹配沿用（§5）。
- 未来若深图新增设备流通类型（如「耳机外借」），仅扩展 `DEVICE_CIRTYPES` 集合，一处生效。

## 3. 存储（Schema）：`Book.materialType`

**新增字段**：

```ts
// src/types/entities.ts
/** 材料类型：设备（电子书阅读器等非书实物）vs 图书。 */
export type MaterialType = 'book' | 'device'

// Book 新增：
materialType: MaterialType   // 默认 'book'
```

**放 Book 层而非 CatalogRecord/BorrowCycle 的理由**：

1. 统计入口对齐：`summary.totalBooks` 与分类法 treemap 按 `Book` 迭代计次（[reading-profile §2](./reading-profile.md)），Book 层一次标记即可全维度排除。
2. 设备无 ISBN、题名/责任者与图书不冲突（§5 另有守卫），一个设备 Book 的所有编目记录与周期都是设备，不存在「一书混装」场景；若未来出现同 Book 混装不同材料类型的来源，再提升到 CatalogRecord 级（§9 开放项）。
3. BorrowCycle 经 `bookId` 反查 Book 即可判定，无需在周期上冗余。

**字段语义**（写入 [book.md](../metadata/book.md)）：

- `'book'`：图书（默认）。所有现有数据与手动录入数据。
- `'device'`：非书实物设备（电子书阅读器等），由 parser 依据来源流通类型标记。**编目事实，UI 只读**（同 `subjects` 受控字段，不提供用户编辑入口；误标场景见 §6 重导修复）。

**Schema 兼容**（[schemas.ts](../../src/db/schemas.ts)）：

```ts
const materialTypeEnum = z.enum(['book', 'device'] as const satisfies readonly MaterialType[])
// bookSchema 新增（旧导出缺字段时默认 'book' 兜底，无迁移脚本——同 parallelTitles/volume 模式）：
materialType: materialTypeEnum.default('book'),
```

## 4. 统计排除（Stats）

`src/lib/profile-stats.ts` 的 `computeProfileStats` 是纯函数聚合的唯一入口（同步 `useMemo` 与 Worker 共用，见 [reading-profile §1](./reading-profile.md)），排除逻辑**在该函数内部**完成，同步/Worker 两条路径自动覆盖。

**实现**：函数开头构建设备 Book id 集合，逐维度排除：

```ts
const deviceBookIds = new Set(
  books.filter((b) => b.materialType === 'device').map((b) => b.id),
)
const isDeviceCycle = (c: BorrowCycle) => deviceBookIds.has(c.bookId)
```

| 维度 | 排除方式 |
|------|---------|
| `summary.totalBooks` | 仅计非设备 Book |
| `summary.totalCycles` / `summary.inBorrow` | 跳过 `isDeviceCycle(c)` 的周期 |
| `summary.avgDurationDays` / `medianDurationDays` | durations 样本排除设备周期 |
| `classification`（treemap） | 设备 Book 不进任何桶（含 `__unclassified__`） |
| `borrowVolume` | 跳过设备周期 |
| `durationDistribution` | 跳过设备周期 |
| `gantt` | 跳过设备周期（lane 不含设备） |

**契约不变**：入参/出参结构、UTC 桶语义、纯函数性均不变；`ProfileStatsResult` 无需新增字段。设备数量为零时结果与现状逐字节等价（空集合过滤无副作用），存量回归安全。

**边界**：`inBorrow` 语义 = 「在借的图书数」，设备在借不计入；设备归还周期也不计入时长统计。

## 5. 去重与合并边界（dedupe）

设备 Book 无 ISBN，仅可能经**题名+责任者兜底**路径与图书合并（[dedupe.ts](../../src/parsers/dedupe.ts) 规则 3 及批内规则 3）。真实设备题名基本无责任者（`authors=[]`，兜底键要求两者非空），碰撞概率极低，但为原则正确性加守卫——**材料类型不同的候选与既有 Book 不得自动合并**（参照选书帮「不与其他 Book 合并」的隔离原则）：

- 规则 3（title+author 兜底）：命中目标 Book 但 `cand.materialType !== target.materialType` → 跳过合并，按独立 Book 处理。
- 批内规则 3：同键复用前先校验材料类型一致，不一致不复用。
- 编目级匹配（`sourceId+barcode` / `sourceId+metaIdKey`）**不受影响**：同一设备多次借阅（跨文件/跨批次）照常合并为同一设备 Book，`materialType` 沿用既有编目所属 Book。
- 设备 Book 之间（同 `materialType='device'`）仍可按 title+author 兜底合并（同型号设备多次借阅归并），不额外隔离。

## 6. 存量回填（Backfill）

已导入库中设备记录无 `materialType`（或为默认 `'book'`），需一次性补标。沿用现有启动回填模式（[backfill-borrow-status.ts](../../src/db/backfill-borrow-status.ts)、[backfill-class-codes.ts](../../src/db/backfill-class-codes.ts)）：

**新文件 `src/db/backfill-device-kind.ts`**：

```ts
/**
 * 存量回填：rawRecords 保留原始行（含 cirtype），凡
 * data.cirtype === '电子设备外借' 且 bookId 非空的原始记录 → 其 Book 置 materialType='device'。
 * 幂等：重复调用无副作用；无候选返回 0。
 */
export async function backfillDeviceKind(db: ReadGraphDB): Promise<number>
```

- 数据来源：`RawRecord.data` 原样保留 szlib 原始行（含 `cirtype`），`RawRecord.bookId` 由导入装配层回填（设备行是 parser 消费的有效行，必落库）。无需重放 parse。
- 注册：[main.tsx](../../src/main.tsx) 的 `Promise.all([...])` 追加 `backfillDeviceKind(db).catch(() => {})`（与现有两个回填并列，位于 `maybeSeedFromE2E` 之后）。
- 判定常量与 §2 共用 `isDeviceCirtype`（单一事实来源）。
- 误标修复路径：重导该 Source 文件（导入纯度保证同一 rawRecords 重放产出同一 `materialType`），或未来用户手动编辑入口（§9 开放项）。

## 7. 导入/导出与重建兼容

- **导入统计如实**：`ImportLogStats`（`parsedBooks`/`newBooks` 等）与导入预览**保留设备条目**——导入日志反映文件内容事实，阅读画像统计才反映阅读行为，两套语义不混。
- **导出兼容**：`bookSchema.materialType` 带 `.default('book')`，旧备份无该字段可正常加载；新导出携带字段。
- **重建纯度**：parse 为纯函数，`rawRecords` 重放必然重新产出 `materialType='device'`，「清空系统 → 凭备份 rawRecords 重建」后统计排除语义一致（[import-workflow 导入纯度](../metadata/import-workflow.md)）。

## 8. 影响面（代码落点）

| 文件 | 变更 |
|------|------|
| `src/types/entities.ts` | 新增 `MaterialType` 类型 + `Book.materialType` |
| `src/db/schemas.ts` | `bookSchema.materialType`（default 'book'） |
| `src/parsers/szlib.ts` | `DEVICE_CIRTYPES` + `isDeviceCirtype()`；设备行 `bookPartial.materialType='device'` |
| `src/parsers/dedupe.ts` | 规则 3/批内规则 3 材料类型一致性守卫 |
| `src/lib/profile-stats.ts` | 设备集合过滤（§4 全维度） |
| `src/db/backfill-device-kind.ts` | 新增启动回填 |
| `src/main.tsx` | 注册回填 |
| `src/db/test-helpers.ts` / `src/db/e2e-seed.ts` | Book 构造补 `materialType`（实体类型必填） |
| 文档 | [book.md](../metadata/book.md)（字段语义）、[szlib-parser.md](../metadata/parsers/szlib-parser.md)（§2 检测）、[reading-profile.md](./reading-profile.md)（§2 排除契约）、app-spec.md §10.2/§11 索引 |

## 9. 开放项（可选增强，不在本次范围）

1. **UI 区分**：书库列表/时间线为设备记录加「设备」徽标与类型过滤（复用 [book-editing §5](./book-editing.md) 的类型筛选模式）；需新增 i18n 键。本次不做（用户要求仅统计排除 + 类型区分存储）。
2. **材料类型扩展**：期刊等其它 `cirtype`（如「期刊」）是否纳入材料类型体系（`'periodical'`？）——本次仅设备；`materialType` 枚举与 `DEVICE_CIRTYPES` 集合天然可扩展。期刊仍计入阅读统计（阅读材料），与设备语义不同。
3. **手动编辑**：是否允许用户在书库详情页修改 `materialType`（如误标修复）——倾向不允许（编目事实），保留「重导修复」路径即可。

## 10. 测试清单（TDD：先红后绿）

**Vitest**：

- `src/parsers/szlib.test.ts`：
  - 设备行（`cirtype='电子设备外借'`）→ 产出 `Book.materialType='device'`，借还配对照常合成周期；
  - 非设备行 `materialType='book'`（或缺省）；`isDeviceCirtype` 边界（undefined/空串/其它值）。
  - `filterRows` 保留设备行（预览所见即导入所得：设备行应出现在预览，而非被剔除）。
- `src/parsers/dedupe.test.ts`：
  - 设备候选（title+author 兜底路径）不并入既有图书 Book；
  - 同设备跨文件（同 barcode/metaIdKey）仍合并为同一设备 Book；
  - 设备与设备之间照常兜底合并。
- `src/lib/profile-stats.test.ts`：
  - 设备 Book/周期从 `summary.*`、`classification`、`borrowVolume`、`durationDistribution`、`gantt` 全部排除；
  - 无设备数据时结果与现状等价（回归护栏）；
  - 设备在借不计入 `inBorrow`；设备归还不计入时长。
- `src/db/schemas.test.ts`：`materialType` 缺省 'book'；旧导出（无字段）可加载。
- `src/db/backfill-device-kind.test.ts`：rawRecords 含 `cirtype='电子设备外借'` → 对应 Book 置标；幂等（二次调用返回 0）；无候选返回 0。
- `src/import/run-import.test.ts`：导入含设备行的文件 → 实体带 `materialType='device'`、rawRecords 保留原行。

**E2E（Playwright，可选）**：导入含设备行的脱敏夹具后 `/profile` 概览卡片与各图不含设备记录；`/timeline` 仍显示设备借还。
