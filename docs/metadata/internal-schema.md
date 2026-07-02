# Internal Schema 内部存储 Schema

> AI Agent 指引：本文档定义了数据在 IndexedDB 中的存储结构和索引策略。所有数据以标准化格式存储，与原始导入格式无关。

## 存储方案

使用 IndexedDB 作为主要存储（大容量结构化数据），localStorage 用于小型配置。

```
Agent 实现要点：
- 推荐使用 idb (https://github.com/jakearchibald/idb) 或 Dexie.js 封装 IndexedDB
- 数据库名: "readgraph"
- 版本管理: 使用 IndexedDB 的版本升级机制
```

## 数据库结构

```typescript
interface ReadGraphDB {
  /** 数据库版本号 */
  version: number;

  /** Object Stores 定义 */
  stores: {
    books: Book;
    catalogRecords: CatalogRecord;
    borrowCycles: BorrowCycle;
    sources: Source;
    rawRecords: RawRecord;
    importLogs: ImportLog;
  };
}
```

## Object Store: books

> 生成的数据：允许用户进行编辑（如修改元数据、合并记录）和删除。

```typescript
/**
 * 主键: id (UUID)
 * 索引:
 *   - isbn13 (unique, sparse) — 按 ISBN 查找和去重
 *   - title (non-unique) — 按书名搜索
 *   - createdAt (non-unique) — 按导入时间排序
 *   - sourceIds (multiEntry) — 按来源查询
 *   - tags (multiEntry) — 按用户个人标签筛选/聚合（不含编目 subjects）
 *   - needsReview (non-unique) — 按待审阅状态筛选（选书帮等占位书目）
 */
const booksStore = {
  keyPath: 'id',
  indexes: [
    { name: 'isbn13', keyPath: 'isbn13', options: { unique: true, multiEntry: false } },
    { name: 'title', keyPath: 'title', options: { unique: false } },
    { name: 'createdAt', keyPath: 'createdAt', options: { unique: false } },
    { name: 'sourceIds', keyPath: 'sourceIds', options: { unique: false, multiEntry: true } },
    { name: 'tags', keyPath: 'tags', options: { unique: false, multiEntry: true } },
    { name: 'needsReview', keyPath: 'needsReview', options: { unique: false } },
  ],
};
```

## Object Store: catalogRecords

> 生成的数据：保存各来源库的本地编目信息（如 metaId、barcodes、classifications 等）。允许用户修改分类和匹配关系。

```typescript
/**
 * 主键: id (UUID)
 * 索引:
 *   - bookId (non-unique) — 查询对应书目的所有编目记录
 *   - sourceId (non-unique) — 按来源筛选编目
 *   - metaId (non-unique) — 按来源原始 ID 检索（保留原始类型，仅展示/溯源）
 *   - metaIdKey (non-unique, sparse) — 归一化为 string 的 ID 键，供索引与去重
 *   - classCodes (multiEntry) — 提取 classifications 中的 code，供分类统计
 *   - barcodes (multiEntry) — 按条码查找具体副本
 *   - [sourceId, metaIdKey] (compound) — 特定来源的编目唯一定位（类型稳定的去重键）
 */
const catalogRecordsStore = {
  keyPath: 'id',
  indexes: [
    { name: 'bookId', keyPath: 'bookId', options: { unique: false } },
    { name: 'sourceId', keyPath: 'sourceId', options: { unique: false } },
    { name: 'metaId', keyPath: 'metaId', options: { unique: false } },
    { name: 'metaIdKey', keyPath: 'metaIdKey', options: { unique: false } },
    { name: 'classCodes', keyPath: 'classCodes', options: { unique: false, multiEntry: true } },
    { name: 'barcodes', keyPath: 'barcodes', options: { unique: false, multiEntry: true } },
    { name: 'sourceId_metaIdKey', keyPath: ['sourceId', 'metaIdKey'], options: { unique: false } },
  ],
};
```

## Object Store: borrowCycles

> 生成的数据：允许用户进行编辑（如修改借还时间、状态）和删除。

```typescript
/**
 * 主键: id (UUID)
 * 索引:
 *   - bookId (non-unique) — 查询某本书的所有借阅周期
 *   - sourceId (non-unique) — 查询某来源的所有借阅
 *   - borrowedAt (non-unique) — 按借阅时间排序/范围查询
 *   - returnedAt (non-unique, sparse) — 按归还时间查询
 *   - status (non-unique) — 按状态筛选
 *   - [bookId, borrowedAt] (compound) — 某本书的借阅时间线
 *   - [sourceId, borrowedAt] (compound) — 某来源的借阅时间线
 */
const borrowCyclesStore = {
  keyPath: 'id',
  indexes: [
    { name: 'bookId', keyPath: 'bookId', options: { unique: false } },
    { name: 'sourceId', keyPath: 'sourceId', options: { unique: false } },
    { name: 'borrowedAt', keyPath: 'borrowedAt', options: { unique: false } },
    { name: 'returnedAt', keyPath: 'returnedAt', options: { unique: false } },
    { name: 'status', keyPath: 'status', options: { unique: false } },
    { name: 'bookId_borrowedAt', keyPath: ['bookId', 'borrowedAt'], options: { unique: false } },
    { name: 'sourceId_borrowedAt', keyPath: ['sourceId', 'borrowedAt'], options: { unique: false } },
  ],
};
```

## Object Store: sources

```typescript
/**
 * 主键: id (UUID)
 * 索引:
 *   - parserId (unique) — 按标识符查找
 *   - type (non-unique) — 按类型筛选
 */
const sourcesStore = {
  keyPath: 'id',
  indexes: [
    { name: 'parserId', keyPath: 'parserId', options: { unique: true } },
    { name: 'type', keyPath: 'type', options: { unique: false } },
  ],
};
```

## Object Store: rawRecords

> 保留原始导入数据，用于溯源、重新解析、调试，以及系统重置后从备份重建
> **操作约束**：原始数据不可篡改（不允许编辑）。
> **删除语义**：本系统**不支持按导入批次撤销/回滚单次导入**。rawRecords 的删除只随「清空系统」整体发生（见下方[系统重置](#系统重置)）。

```typescript
interface RawRecord {
  /** 内部 ID (UUID) */
  id: string;

  /** 关联的导入批次 ID */
  importLogId: string;

  /** 关联的 Source ID */
  sourceId: string;

  /** 原始记录数据（保留原始字段名和值） */
  data: Record<string, unknown>;

  /** 在原始文件中的行号/索引 */
  rowIndex: number;

  /** 解析后关联的 BorrowCycle ID（如果成功解析） */
  borrowCycleId: string | null;

  /** 解析后关联的 Book ID（如果成功解析） */
  bookId: string | null;

  /** 解析状态 */
  parseStatus: 'success' | 'warning' | 'error' | 'skipped';

  /** 解析备注 */
  parseNote: string | null;
}

/**
 * 主键: id
 * 索引:
 *   - importLogId (non-unique)
 *   - sourceId (non-unique)
 *   - parseStatus (non-unique)
 */
```

## 系统重置

> Agent 实现要点：本系统不做「按 ImportLog 撤销单次导入」的级联删除。唯一的批量删除操作是**清空整个系统、恢复到初始空库状态**，用户借此重新开始使用。

### 重置范围

清空操作**一次性清空全部 Object Store**，无差别、无筛选：

| Store | 处理 |
|-------|------|
| `books` | 清空 |
| `catalogRecords` | 清空 |
| `borrowCycles` | 清空 |
| `sources` | 清空（含预置模板若已落库，需在重置后重新写入） |
| `rawRecords` | 清空 |
| `importLogs` | 清空 |
| `localStorage`（`readgraph:*`） | 可选一并清除，或保留用户偏好（locale/theme/时区） |

### 为什么不做单次撤销

- 借还配对与去重合并发生在导入阶段，多次导入之间的数据相互交织（同 ISBN 跨馆合并、同条码多次借阅），**不存在干净的「某次导入产出的数据子集」可独立删除**。
- 强行按 ImportLog 回滚会破坏已合并的 Book / CatalogRecord，留下断裂的 `bookId` / `catalogRecordId` 引用，比不回滚更危险。
- 因此把删除操作收敛为「全有或全无」：要么保留全部数据，要么清空重来。

### 实现约束

- 清空操作必须**原子**：在单个 IndexedDB transaction 内清空所有 store，失败则整体回滚，避免出现半清空的中间态。
- 清空前应**强制导出备份**（或至少给出不可撤销的二次确认），因为该操作不可恢复。
- `Source.lastImportAt` / `Source.totalImportedRecords` 等聚合计数无需维护「删除后重算」逻辑——系统重置后 Source 一并被清空，计数自然归零。
- 重置后若重新导入，`createdAt` 时间戳以新导入时刻为准，旧时间线不再保留。

## Object Store: importLogs

> 记录每次导入操作的元数据

```typescript
interface ImportLog {
  /** 导入批次 ID (UUID) */
  id: string;

  /** 关联的 Source ID */
  sourceId: string;

  /** 导入时间 (UTC) */
  importedAt: Date;

  /** 原始文件名 */
  fileName: string;

  /** 原始文件大小 (bytes) */
  fileSize: number;

  /** 检测到的文件编码 */
  detectedEncoding: string;

  /** 使用的 Parser 标识（= 导入时 Source.parserId 的快照，便于 Source 被删后仍可溯源/重解析） */
  parserId: string;

  /** 导入统计 */
  stats: {
    totalRawRecords: number;
    newBooks: number;
    updatedBooks: number;
    newBorrowCycles: number;
    skippedRecords: number;
    warningCount: number;
    errorCount: number;
  };

  /** 导入过程中的警告列表 */
  warnings: ParseWarning[];
}
```

## 去重策略

```
Agent 实现要点：

Book 去重与归并（合并规则）:
1. CatalogRecord 级匹配（最优先）:
   - 先通过 `sourceId` + `barcode` 或 `sourceId` + `metaIdKey` 匹配是否已有相同的本地编目记录（`metaIdKey` 为 `metaId` 归一化后的 string，避免 int/string 类型不一致导致漏判）。如果找到，说明是同一个馆的同一编目记录，直接沿用。
2. Book 级精确匹配:
   - 提取出 `isbn13`，在全局 `books` 中匹配。若找到相同 ISBN，则自动将新生成的 `CatalogRecord` 挂载到该 `Book` 下。
3. Book 级模糊匹配 (兜底):
   - 既无相同条码/metaIdKey，且无有效 ISBN，则比较 `normalize(title)` + `normalize(authors[0])` → 建议合并（需用户手动确认）。

BorrowCycle 去重:
1. 精确匹配: sourceId + barcode + borrowedAt → 重复导入，跳过
2. 时间重叠: 同一 bookId 在已有周期时间范围内再次出现借出 → 警告

normalize 函数:
- 去除空格、标点
- 全角 → 半角
- 繁体 → 简体（可选）
- 转小写
```

## localStorage 存储项

```typescript
/** 用户偏好设置 */
interface UserPreferences {
  /**
   * 显示语言
   * - 期仅交付 zh-CN 与 en；日后如需繁体中文可在此联合类型补回 'zh-TW'，
   *   但当前不预留该枚举值，避免 UI 出现未翻译的占位。
   */
  locale: 'zh-CN' | 'en';
  /** 主题 */
  theme: 'light' | 'dark' | 'auto';
  /** 默认时区显示 */
  displayTimezone: string;
}

// key: "readgraph:preferences"
// value: JSON.stringify(UserPreferences)

// key: "readgraph:db-version"
// value: 数据库版本号字符串
```

## 数据导出

```typescript
/**
 * Agent 实现要点：支持导出完整数据为 JSON
 * 用于备份、跨浏览器迁移，以及「清空系统」前的安全备份。
 *
 * 重要：rawRecords 是必导项，不可设为可选项。系统重置后唯一的恢复途径
 * 就是凭 rawRecords + sources 重新跑一遍纯函数式的导入管线，重建全部
 * 派生数据（books / catalogRecords / borrowCycles / importLogs）。
 */
interface ExportData {
  /** 导出格式版本 */
  version: string;

  /** 导出时间 (UTC) */
  exportedAt: Date;

  /**
   * 源数据层（重建的输入，必导）
   * - sources：Parser 配置与时区，导入管线的必要入参
   * - rawRecords：原始记录，导入纯函数的唯一数据输入
   */
  sources: Source[];
  rawRecords: RawRecord[];

  /**
   * 派生数据层（导入管线的输出快照，便于直接恢复而无需重跑管线）
   * - 与源数据层一起导出，恢复时可直接写入，也可选择丢弃后由 rawRecords 重建
   */
  books: Book[];
  catalogRecords: CatalogRecord[];
  borrowCycles: BorrowCycle[];
  importLogs: ImportLog[];
}
```

## 从导出数据重建

> Agent 实现要点：由于系统重置是「全有或全无」、且 rawRecords 是必导项，
> 导入管线必须能凭一份 `ExportData` 中的 `rawRecords` + `sources` **完整重建**派生数据。

### 重建模式

恢复一份导出备份时，系统支持两种模式：

1. **直接恢复（快照模式）**：把 `books` / `catalogRecords` / `borrowCycles` / `importLogs` 原样写回 IndexedDB。适合「同一版本、无需重算」的迁移场景。
2. **从 rawRecords 重建（重放模式）**：丢弃导出中的派生数据，按 `sources` 配置把每批 `rawRecords`（按 `importLogId` 分组）重新喂给对应 Parser，重跑整个导入管线，得到全新的派生数据。适合版本升级、Parser 逻辑更新后想用旧原始数据重新生成结果的场景。

### 重建的确定性要求

因为重建就是「把同样的 rawRecords 再导入一次」，导入管线**必须是纯函数**：

- 同样的 `(rawRecords, sources)` 输入，无论何时重放，必须产出结构等价的 `books` / `catalogRecords` / `borrowCycles`。
- 详见 [import-workflow 导入纯度要求](./import-workflow.md#导入纯度要求)。
- 实现需注意：UUID 等非确定性 ID 若影响跨实体引用一致性，应在重建时由 `rawRecord.id` + `importLogId` 等稳定输入派生，或保留导出快照中的 ID 映射，避免每次重建产生全新互不相交的 ID。
