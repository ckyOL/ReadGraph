# 编目条码归属馆解析（Branch Library from Barcode Prefix）规格

> 本文件定义**来源无关**的「编目条码前 6 位 → 归属馆（分馆）」解析契约与 UI 展示方案：
> 图书馆编目条码常以固定位数的馆代码前缀开头（如 szlib 的 `04400514707325` 前 6 位 `044005` = 市馆），
> 可据此判定物理副本的归属馆。各来源（parser）可注册自己的前缀规则；**szlib 为首个参考实现**，
> 其规则权威文档在 [szlib-parser §6](../metadata/parsers/szlib-parser.md#6-条码前缀--归属馆barcode-prefix--branch-library)。
> 遵循 SDD + TDD：先规格、再测试（Red）、后实现（Green）。
> 纯函数落点 `src/lib/branch-prefix.ts`；UI 组件落点 `src/components/branch-badge.tsx`。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 背景与需求

书目详情页编目卡（`CatalogRecordCard`）与借阅时间线（`BorrowCycleRow`）展示物理副本条码时，
用户无法直接看出该副本归属哪家馆（市馆/各区馆/大学城，其他图书馆来源同理）。
编目条码的**前 6 位**（馆代码前缀）可 1:1 映射到归属馆。

**目标**：

1. 提供纯函数：`条码 + 来源(parserId) → 归属馆名`（未知来源/未命中 → `null`）。
2. 条码展示处（编目卡、时间线）条码后追加一个「归属馆」小框组件。
3. 未注册规则的来源 / 未知前缀 / 长度不足 / 手输条码 **不渲染**小框——无噪音降级。

**非目标**：不落库（归属馆是条码的派生展示，非实体字段）；不做编辑入口（编目事实，只读派生）；
不做馆级筛选/统计（无需求）；不 i18n 翻译馆名（领域数据，同 [classification.ts](../../src/lib/classification.ts) CLC/DDC 表约定）；
导入预览表不加归属馆徽标（预览保持原样，落点见 §4）。

## 2. 来源规则注册表（扩展点）

归属馆规则按来源注册：**parserId → 前缀表**（`BranchPrefixMap = Readonly<Record<string, string>>`）。
查表按条码所属来源的 `parserId` 路由——不同图书馆的条码体系不同，前缀规则不能跨来源混用。

| 来源（parserId） | 前缀表 | 规则权威文档 |
|------------------|--------|-------------|
| `szlib`（深圳图书馆，参考实现） | `src/lib/branch-prefix.ts` `SZ_BRANCH_PREFIXES`（11 条，含 `F44010` 大学城） | [szlib-parser §6](../metadata/parsers/szlib-parser.md#6-条码前缀--归属馆barcode-prefix--branch-library) |

**新增来源的扩展步骤**（日后拓展）：

1. 在对应 parser 文档定义本来源的条码前缀规则（模板见 szlib-parser §6）。
2. 在 `src/lib/branch-prefix.ts` 注册表 `BRANCH_PREFIX_TABLES` 登记该 parserId 的前缀表。
3. UI 自动生效（组件按 `Source.parserId` 路由），无需改动组件/契约。

## 3. 纯函数契约（`src/lib/branch-prefix.ts`）

```ts
export type BranchPrefixMap = Readonly<Record<string, string>>
export const BRANCH_PREFIX_TABLES: Readonly<Record<string, BranchPrefixMap>>  // 注册表：parserId → 前缀表
export const SZ_BRANCH_PREFIXES: BranchPrefixMap                             // szlib 参考实现（szlib-parser §6）
export function branchOfBarcode(
  barcode: string | null | undefined,
  parserId: string | null | undefined,
): string | null
```

以 szlib 为参考实现的输入输出：

| 输入 | 输出 | 说明 |
|------|------|------|
| `('04400514707325', 'szlib')` | `'市馆'` | 常规 szlib 条码（前 6 位命中） |
| `('F440101234567', 'szlib')` | `'大学城'` | 字母前缀命中 |
| `('f440101234567', 'szlib')` | `'大学城'` | 前缀大小写归一 |
| `('044005', 'szlib')` | `'市馆'` | 恰好 6 位也命中 |
| `('04400514707325', 'no-such-parser')` | `null` | 未知来源（parserId 未注册），不解析 |
| `('04400514707325', null)` | `null` | 来源缺失 |
| `('', 'szlib')` / `(null, 'szlib')` | `null` | 空值 |
| `('04400', 'szlib')`（< 6 位） | `null` | 长度不足，不截取误判 |
| `('BC001', 'szlib')` | `null` | 非该来源条码/未知前缀 |
| `('044005x', 'szlib')` 之类未知 6 位前缀 | `null` | 未知前缀 |

- 纯函数、无外部依赖、不抛错（未知 → `null`，调用方按「无归属馆」处理）。

## 4. UI 设计说明（BranchBadge）

**组件**：`src/components/branch-badge.tsx`，props `{ barcode: string | null | undefined, parserId?: string | null }`。
命中 → 渲染小框；未知来源/未命中 → 返回 `null`（不占位）。

- 视觉：`Badge variant="outline"` + `rounded-none`——与编目卡卷号徽标同构
  （DESIGN.md 纸墨语言：完全直角、无阴影、克制 outline）。
- 字号：沿用 Badge 默认 `text-xs`；置于等宽条码之后，与条码 `font-mono` 解耦（框内为领域中文名）。
- 对齐：编目卡行内 `flex items-center gap-2`（条码 span 保持 `font-mono`）；
  时间线行 `flex flex-wrap items-center gap-3` 既有容器直接追加。
- parserId 来源：编目卡经 `source.parserId`（来源缺失 → 不渲染）；时间线经 `BorrowCyclesList`
  由 `sources` 建 `sourceId → parserId` 映射下传（来源被删等无法映射 → 不渲染）。
- 语义：只读派生展示，无点击、无 tooltip、无 aria 扩展（纯文本徽标）。

**落点**：

| 位置 | 文件 | 形式 |
|------|------|------|
| 书目详情编目卡 | `src/components/catalog-record.tsx` | 每条 `barcodes[]` 行内、条码后 |
| 书目详情借阅时间线 | `src/components/borrow-cycle-row.tsx` | `c.barcode` 非空时、条码后 |

## 5. 边界情况

- **未注册来源**（Libby 等、未知 parserId）：不解析 → 无框，行为与现状等价。
- **来源缺失**（旧数据/来源被删，parserId 无法映射）：无框。
- **旧数据/手输条码**：任意未知前缀 → 无框。
- **大小写**：仅对前缀做 `toUpperCase()` 归一，键表保持大写（`F44010`）。
- **性能**：查表为 O(1) 字典访问；编目卡/时间线行数有限，无 memo 需求（纯函数成本可忽略）。

## 6. 测试清单（Vitest）

| 覆盖 | 文件 |
|------|------|
| 注册表按 parserId 组织、szlib 表全量 11 条前缀命中 + 归属馆名断言 | `src/lib/branch-prefix.test.ts` |
| 空值/长度不足/未知前缀/未知来源（parserId 未注册）→ `null` | 同上 |
| 恰好 6 位命中、字母前缀大小写归一 | 同上 |
| BranchBadge：命中渲染框内馆名、未命中/未知来源渲染 `null` | `src/components/branch-badge.test.tsx` |
| BorrowCycleRow：szlib 条码后出现归属馆框；未知条码/parserId 缺失无框（沿用 SSR 静态标记断言模式） | `src/components/borrow-cycle-row.test.tsx` |
| CatalogRecordCard：barcodes 行内条码后渲染归属馆框；来源缺失无框 | `src/components/catalog-record.test.tsx` |
| BorrowCyclesList：sources → sourceId → parserId 映射下传 | `src/components/borrow-cycles-list.test.tsx` |
