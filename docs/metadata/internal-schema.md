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
 *   - classCodes (multiEntry) — 提取所有的分类号(如"TP312")供分类统计
 *   - title (non-unique) — 按书名搜索
 *   - createdAt (non-unique) — 按导入时间排序
 *   - sourceIds (multiEntry) — 按来源查询
 */
const booksStore = {
  keyPath: 'id',
  indexes: [
    { name: 'isbn13', keyPath: 'isbn13', options: { unique: true, multiEntry: false } },
    // 为了支持 IndexedDB 索引，可在写入前从 classifications 提取出 code 数组存入 classCodes
    { name: 'classCodes', keyPath: 'classCodes', options: { unique: false, multiEntry: true } },
    { name: 'title', keyPath: 'title', options: { unique: false } },
    { name: 'createdAt', keyPath: 'createdAt', options: { unique: false } },
    { name: 'sourceIds', keyPath: 'sourceIds', options: { unique: false, multiEntry: true } },
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
 *   - slug (unique) — 按标识符查找
 *   - type (non-unique) — 按类型筛选
 */
const sourcesStore = {
  keyPath: 'id',
  indexes: [
    { name: 'slug', keyPath: 'slug', options: { unique: true } },
    { name: 'type', keyPath: 'type', options: { unique: false } },
  ],
};
```

## Object Store: rawRecords

> 保留原始导入数据，用于溯源、重新解析和调试
> **操作约束**：原始数据不可篡改（不允许编辑），但允许用户删除（例如撤销导入）。

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

## Object Store: importLogs

> 记录每次导入操作的元数据

```typescript
interface ImportLog {
  /** 导入批次 ID (UUID) */
  id: string;

  /** 关联的 Source ID */
  sourceId: string;

  /** 导入时间 (ISO 8601 UTC) */
  importedAt: string;

  /** 原始文件名 */
  fileName: string;

  /** 原始文件大小 (bytes) */
  fileSize: number;

  /** 检测到的文件编码 */
  detectedEncoding: string;

  /** 使用的 Parser ID */
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
1. 物理副本匹配（最优先）: `sourceId` + `barcode` 相同 → 识别为已被导入过的特定物理副本，直接关联到对应的 Book（解决无 ISBN 的期刊、自编文献问题）。
2. 书目精确匹配: `isbn13` 相同 → 不同物理副本或不同数据源的同一本书籍，归并合并到同一个 Book。
3. 模糊匹配: 既无相同条码，也无（或缺失）ISBN，则比较 `normalize(title)` + `normalize(authors[0])` → 建议合并（需用户手动确认）。

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
  /** 显示语言 */
  locale: 'zh-CN' | 'zh-TW' | 'en';
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
 * 用于备份和在不同浏览器间迁移
 */
interface ExportData {
  /** 导出格式版本 */
  version: string;
  
  /** 导出时间 */
  exportedAt: string;
  
  /** 各 store 的完整数据 */
  books: Book[];
  borrowCycles: BorrowCycle[];
  sources: Source[];
  importLogs: ImportLog[];
  
  /** 
   * 为了能够长久保留并在未来变动后重新生成，需要包含 rawRecords。
   * 可以考虑在导出时提供“是否包含原始数据（体积较大）”的选项。
   */
  rawRecords?: RawRecord[];
}
```
