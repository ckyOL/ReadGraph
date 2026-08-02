# Import Workflow 导入流程规范

> AI Agent 指引：本文档定义了系统接受外部数据导入的通用约束、整体生命周期以及编码处理规范。

## 通用约束

- 文件编码：UTF-8（必须支持 GBK/GB2312 自动检测和转码，中国图书馆系统常用）
- 文件大小限制：前端处理，建议单文件不超过 50MB
- 支持格式：JSON, CSV（可扩展 XLSX）

## 导入流程规范

```text
Agent 实现要点：

1. 文件选择
   - 用户选择文件或拖拽上传
   - 前端检测文件编码（使用 TextDecoder 尝试 UTF-8，失败后尝试 GBK）
   - 自动检测文件格式（JSON/CSV）

2. 来源选择
   - 用户选择或创建 Source
   - 系统使用 parser.validate() 自动推荐匹配的 Parser

3. 预览与确认
   - 解析前 10 条记录展示预览
   - 预览行先经 `SourceParser.filterRows` 行级预过滤，剔除「自助查询」「读者续借」等无用条目——预览所见即导入所得
   - **过滤在导入装配层同样生效**：`executeImport` 在预分配 `RawRecord` 壳之前调用同一 `filterRows`，无用条目不落 `rawRecords`、不计入 `ImportLog.stats.totalRawRecords`
   - 显示字段映射结果
   - 显示检测到的警告

4. 导入执行
   - 全量解析原始数据
   - 借还配对
   - 去重合并（基于 ISBN 或 条码号+来源）
   - 写入 IndexedDB

5. 导入报告
   - 新增书籍数
   - 新增借阅周期数
   - 跳过的记录数
   - 警告列表
```

## 编码检测

```typescript
/**
 * Agent 实现要点：中国图书馆系统导出的文件经常使用 GBK 编码
 * 需要自动检测并转换
 */
async function detectAndDecode(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  
  // 1. 尝试 UTF-8
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(buffer);
  } catch {
    // 2. Fallback 到 GBK
    const decoder = new TextDecoder('gbk');
    return decoder.decode(buffer);
  }
}
```

## 导入纯度要求

> Agent 实现要点：导入管线必须是**纯函数**。这是「清空系统 → 从备份 rawRecords 重建」能成立的数学前提。

### 纯函数契约

把整条导入管线视为一个函数：

```typescript
/**
 * 导入管线 = 纯函数
 * @param rawRecords - 原始记录（来自导出备份或用户刚上传的文件）
 * @param sources    - 来源配置（含 parserId、timezone 等）
 * @returns 派生数据：books / catalogRecords / borrowCycles / importLogs
 */
function importPipeline(
  rawRecords: RawRecord[],
  sources: Source[]
): { books: Book[]; catalogRecords: CatalogRecord[]; borrowCycles: BorrowCycle[]; importLogs: ImportLog[] }
```

它必须满足：

1. **确定性**：相同输入必产出结构等价的输出。同一份 `rawRecords` + `sources`，今天跑和半年后跑，得到的书目集合、借阅周期配对、分类归属一致。
2. **无副作用**：导入逻辑本身不读写 IndexedDB、不碰时钟、不依赖网络。它只做「输入 → 输出」的映射；写入存储是管线之外、调用方的事。
3. **无隐式状态**：不依赖「上次导入了什么」「当前库里有什么」。去重合并所需的已有库状态，必须作为显式入参传入（见下）。

### 去重合并的入参化

去重/合并并非无状态——它需要知道「当前库里已有的 books/catalogRecords」。处理方式：

- **首次导入**：已有库状态为空，传入 `existing = { books: [], catalogRecords: [], borrowCycles: [] }`。
- **增量导入**：调用方从 IndexedDB 读出当前数据，作为 `existing` 显式传入。
- **从备份重建**：先清空库，再按 `importLogId` 顺序对每批 rawRecords 重放，每批的 `existing` 取上一批的输出累计结果。

这样管线本身始终是纯函数，「是否合并、合并到哪个 Book」完全由显式入参决定，而非隐式读取存储。

### ID 的确定性

- `RawRecord.id`、`ImportLog.id` 来自导出备份，重建时直接沿用，**不重新生成**。
- `Book.id` / `CatalogRecord.id` / `BorrowCycle.id` 若在原始导入时由 UUID 随机生成，重建时会得到全新 ID，导致跨实体引用断裂。两种解法：
  - **派生 ID**：由稳定输入哈希派生，如 `CatalogRecord.id = hash(sourceId + metaId)`、`BorrowCycle.id = hash(importLogId + rawRecordIds.join(','))`，保证重放幂等。
  - **保留 ID 映射**：导出快照里的派生数据已带 ID，重建时若选择「快照模式」直接沿用；若选「重放模式」则要求 Parser 用上述派生算法复现相同 ID。
- `createdAt` / `updatedAt` 这类时间戳若取「导入时刻」会破坏确定性，重建时应改用 `ImportLog.importedAt` 作为派生时间，而非 `Date.now()`。

### 禁止事项

- ❌ 在 Parser 内部调用 `new Date()` 取当前时间作为 `borrowedAt`/`returnedAt`——必须从原始字段解析。
- ❌ 在 Parser 内部生成 `crypto.randomUUID()` 作为实体主键后又不做跨引用对齐——见上「ID 的确定性」。
- ❌ 让 Parser 直接 `db.books.put(...)`——写入是调用方职责，Parser 只返回 `ParseResult`。
- ❌ 让去重逻辑偷偷读 IndexedDB——已有状态必须显式入参。
