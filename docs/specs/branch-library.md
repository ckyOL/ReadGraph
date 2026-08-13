# 深图编目条码归属馆解析（Branch Library from Barcode Prefix）规格

> 本文件定义「深图编目条码」前 6 位 → 归属馆（分馆）的解析契约与 UI 展示方案。
> 深图（szlib）物理副本条码形如 `04400514707325`（13–14 位），前 6 位为馆代码前缀，
> 可据此判定该副本的归属馆；`F44010…` 为大学城（前 6 位含字母 `F`）。
> 遵循 SDD + TDD：先规格、再测试（Red）、后实现（Green）。
> 纯函数落点 `src/lib/szlib-branch.ts`；UI 组件落点 `src/components/branch-badge.tsx`。
> **深图规则（前 6 位映射表与解析语义）的权威文档在 [szlib-parser §6](../metadata/parsers/szlib-parser.md#6-条码前缀--归属馆barcode-prefix--branch-library)，
> 本规格不重复维护映射表，只定义使用该规则的 UI 与契约。**
> 返回 [app-spec.md](../app-spec.md)。

## 1. 背景与需求

书目详情页编目卡（`CatalogRecordCard`）与借阅时间线（`BorrowCycleRow`）展示物理副本条码时，
用户无法直接看出该副本归属哪家馆（市馆/各区馆/大学城）。深图编目条码的**前 6 位**为馆代码前缀，
可 1:1 映射到归属馆。

**目标**：

1. 提供纯函数：条码 → 归属馆名（未命中 → `null`）。
2. 条码展示处（编目卡、时间线）条码后追加一个「归属馆」小框组件。
3. 非深图条码（Libby、手输、长度不足、未知前缀）**不渲染**小框——无噪音降级。

**非目标**：不落库（归属馆是条码的派生展示，非实体字段）；不做编辑入口（编目事实，只读派生）；
不做馆级筛选/统计（无需求）；不 i18n 翻译馆名（领域数据，同 [classification.ts](../../src/lib/classification.ts) CLC/DDC 表约定）；
导入预览表不加归属馆徽标（预览保持原样，落点见 §4）。

## 2. 映射表（深图规则）

前 6 位 → 归属馆的映射表与解析语义是 **szlib 数据格式规则**，权威文档在
[szlib-parser §6 条码前缀 → 归属馆](../metadata/parsers/szlib-parser.md#6-条码前缀--归属馆barcode-prefix--branch-library)（11 条前缀，含 `F44010` 大学城），
代码唯一实现 `src/lib/szlib-branch.ts`（`SZ_BRANCH_PREFIXES`）。本规格直接消费该规则，不另行维护副本。

## 3. 纯函数契约（`src/lib/szlib-branch.ts`）

```ts
export const SZ_BRANCH_PREFIXES: Readonly<Record<string, string>>  // §2 映射表（唯一来源）
export function branchOfBarcode(barcode: string | null | undefined): string | null
```

| 输入 | 输出 | 说明 |
|------|------|------|
| `'04400514707325'` | `'市馆'` | 常规深图条码（前 6 位命中） |
| `'F440101234567'` | `'大学城'` | 字母前缀命中 |
| `'f440101234567'` | `'大学城'` | 前缀大小写归一 |
| `'044005'` | `'市馆'` | 恰好 6 位也命中 |
| `''` / `null` / `undefined` | `null` | 空值 |
| `'04400'`（< 6 位） | `null` | 长度不足，不截取误判 |
| `'BC001'` / `'9787111…'` | `null` | 非深图条码/未知前缀 |
| `'044005x'` 之类任意未知 6 位前缀 | `null` | 未知前缀 |

- 纯函数、无外部依赖、不抛错（未知 → `null`，调用方按「无归属馆」处理）。

## 4. UI 设计说明（BranchBadge）

**组件**：`src/components/branch-badge.tsx`，props `{ barcode: string | null | undefined }`。
命中 → 渲染小框；未命中 → 返回 `null`（不占位）。

- 视觉：`Badge variant="outline"` + `rounded-none`——与编目卡卷号徽标同构
  （DESIGN.md 纸墨语言：完全直角、无阴影、克制 outline）。
- 字号：沿用 Badge 默认 `text-xs`；置于等宽条码之后，与条码 `font-mono` 解耦（框内为领域中文名）。
- 对齐：编目卡行内 `flex items-center gap-2`（条码 span 保持 `font-mono`）；
  时间线行 `flex flex-wrap items-center gap-3` 既有容器直接追加。
- 语义：只读派生展示，无点击、无 tooltip、无 aria 扩展（纯文本徽标）。

**落点**：

| 位置 | 文件 | 形式 |
|------|------|------|
| 书目详情编目卡 | `src/components/catalog-record.tsx` | 每条 `barcodes[]` 行内、条码后 |
| 书目详情借阅时间线 | `src/components/borrow-cycle-row.tsx` | `c.barcode` 非空时、条码后 |

## 5. 边界情况

- **非 szlib 来源**（Libby 等）：条码前缀不命中 → 无框，行为与现状等价。
- **旧数据/手输条码**：任意未知前缀 → 无框。
- **大小写**：仅对前缀做 `toUpperCase()` 归一，键表保持大写（`F44010`）。
- **性能**：查表为 O(1) 字典访问；编目卡/时间线行数有限，无 memo 需求（纯函数成本可忽略）。

## 6. 测试清单（Vitest）

| 覆盖 | 文件 |
|------|------|
| 映射表全量 11 条前缀命中 + 归属馆名断言 | `src/lib/szlib-branch.test.ts` |
| 空值/长度不足/未知前缀/非深图条码 → `null` | 同上 |
| 恰好 6 位命中、字母前缀大小写归一 | 同上 |
| BranchBadge：命中渲染框内馆名、未命中渲染 `null` | `src/components/branch-badge.test.tsx` |
| BorrowCycleRow：szlib 条码后出现归属馆框；未知条码无框（沿用 SSR 静态标记断言模式） | `src/components/borrow-cycle-row.test.tsx` |
| CatalogRecordCard：barcodes 行内条码后渲染归属馆框 | `src/components/catalog-record.test.tsx`（新增） |
