# BorrowCycle 借阅周期元数据

> AI Agent 指引：BorrowCycle 是从原始借/还记录合成的核心实体。原始数据中借和还通常是独立的行记录，需要 Parser 配对合成为一个完整的借阅周期。

## Schema 定义

```typescript
interface BorrowCycle {
  /** 系统内部唯一标识 (UUID v4) */
  id: string;

  /** 关联的 Book ID */
  bookId: string;

  /** 关联的 Source ID（从哪个图书馆/平台借出） */
  sourceId: string;

  /** === 时间信息 === */

  /**
   * 借出时间 (ISO 8601 UTC)
   * - 从原始数据的本地时间转换为 UTC
   * - 转换时使用 source.timezone
   * - 格式: "2024-03-15T02:30:00Z"
   */
  borrowedAt: string;

  /**
   * 归还时间 (ISO 8601 UTC)
   * - null 表示当前仍在借阅中
   * - 从原始数据的本地时间转换为 UTC
   */
  returnedAt: string | null;

  /**
   * 应还日期 (ISO 8601 UTC)
   * - 可选，部分系统提供
   * - 用于分析是否存在超期行为
   */
  dueDate: string | null;

  /** === 派生字段（由系统计算，不存储） === */
  // duration: number;        // 借阅天数 = returnedAt - borrowedAt
  // isOverdue: boolean;      // 是否超期 = returnedAt > dueDate
  // overdueDays: number;     // 超期天数

  /** === 续借信息 === */

  /**
   * 续借次数
   * - 0 表示未续借
   * - 部分系统提供此字段
   */
  renewCount: number;

  /** 续借记录（可选，部分系统提供详细续借时间） */
  renewals: RenewalRecord[];

  /** === 状态 === */

  /**
   * 借阅周期状态
   * - borrowed: 当前借阅中（未归还）
   * - returned: 已归还
   * - unknown: 无法确定（数据不完整）
   */
  status: 'borrowed' | 'returned' | 'unknown';

  /** === 来源追踪 === */

  /**
   * 关联的原始记录 ID 列表
   * - 一个 BorrowCycle 由一条借出记录 + 一条归还记录合成
   * - 保留原始 ID 用于溯源和调试
   */
  rawRecordIds: string[];

  /** 馆藏条码号（本次借阅的具体副本） */
  barcode: string | null;

  /** 记录创建时间 (ISO 8601 UTC) */
  createdAt: string;

  /** 记录最后更新时间 (ISO 8601 UTC) */
  updatedAt: string;
}

interface RenewalRecord {
  /** 续借操作时间 (ISO 8601 UTC) */
  renewedAt: string;
  /** 新的应还日期 (ISO 8601 UTC) */
  newDueDate: string | null;
}
```

## 借还配对算法

> Agent 实现要点：这是 Parser 的核心逻辑

### 原始数据形态

图书馆系统的借阅历史通常以**流水记录**形式导出，每条记录是一个独立操作：

```json
// 典型的原始记录（借出）
{
  "操作类型": "借书",
  "条码号": "0012345678",
  "书名": "设计模式",
  "操作日期": "2024-03-15 10:30:00",
  "应还日期": "2024-04-15"
}

// 典型的原始记录（归还）
{
  "操作类型": "还书",
  "条码号": "0012345678",
  "书名": "设计模式",
  "操作日期": "2024-04-10 14:20:00"
}
```

### 配对策略

```
1. 按条码号分组所有记录
2. 在同一条码号的记录中，按时间排序
3. 配对规则：
   a. 找到一条"借书"记录 → 开始一个 BorrowCycle
   b. 在后续记录中找到同一条码号的"还书"记录 → 配对完成
   c. 中间的"续借"记录 → 添加到 renewals 数组
   d. 如果找不到配对的"还书" → status = 'borrowed'（当前在借）
4. 同一条码号可能有多个借阅周期（借了还了又借）
```

### 边界情况

| 情况 | 处理方式 |
|------|----------|
| 只有借出，无归还 | `status = 'borrowed'`，`returnedAt = null` |
| 只有归还，无借出 | `status = 'unknown'`，`borrowedAt` 设为归还时间，添加警告 |
| 借出时间 > 归还时间 | 数据异常，添加警告标记 |
| 同一条码连续两次借出 | 视为两个独立周期，第一个 `status = 'unknown'` |
| 续借操作 | 不产生新 BorrowCycle，更新已有周期的 `renewals` 和 `dueDate` |

## 派生计算（前端实时计算）

```typescript
/** Agent 实现要点：这些字段不存储，由 getter/computed 提供 */

function getDuration(cycle: BorrowCycle): number | null {
  if (!cycle.returnedAt) return null;
  const borrow = new Date(cycle.borrowedAt);
  const ret = new Date(cycle.returnedAt);
  return Math.ceil((ret.getTime() - borrow.getTime()) / (1000 * 60 * 60 * 24));
}

function isOverdue(cycle: BorrowCycle): boolean | null {
  if (!cycle.dueDate || !cycle.returnedAt) return null;
  return new Date(cycle.returnedAt) > new Date(cycle.dueDate);
}

function getOverdueDays(cycle: BorrowCycle): number | null {
  if (!isOverdue(cycle)) return null;
  const due = new Date(cycle.dueDate!);
  const ret = new Date(cycle.returnedAt!);
  return Math.ceil((ret.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
}
```
