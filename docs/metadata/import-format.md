# Import Format 导入数据格式规范

> AI Agent 指引：本文档定义了系统接受的导入数据格式。每种来源有不同的原始格式，Parser 负责转换为统一的内部格式。

## 通用约束

- 文件编码：UTF-8（必须支持 GBK/GB2312 自动检测和转码，中国图书馆系统常用）
- 文件大小限制：前端处理，建议单文件不超过 50MB
- 支持格式：JSON, CSV（可扩展 XLSX）

---

## 图书馆系统常见获取格式

### 1. 纯流通流水日志格式（如深圳图书馆）

> 直接从后端接口（如我的图书馆 API）截获的原始交易流水。
> **特征**：完全缺少作者、ISBN、出版社等书目字段，仅包含操作动作、条码号和书名。

**典型格式（JSON）：**

```json
{
  "record": [
    {
      "Sequence": 61,
      "date": "20260411",
      "time": "18:33:50",
      "optype": "读者还回文献",
      "cirtype": "大学城中文图书",
      "title": "软件工程3.0 = Software engineering 3.0",
      "barcode": "F4401002064220",
      "callno": "TP311.5/1040"
    },
    {
      "Sequence": 63,
      "date": "20260411",
      "time": "16:25:29",
      "optype": "读者借出",
      "cirtype": "电子设备外借",
      "title": "宝安区图书馆电子阅读器",
      "barcode": "04400790006607",
      "callno": "TP368.3/168"
    }
  ]
}
```

**处理约束：**
- **必须**使用 `optype` 判断借还是还，并过滤无效操作（如“自助查询”、“读者续借”）。
- **完全依赖** `sourceId` + `barcode` 作为物理副本识别的唯一锚点，缺失 ISBN 会导致此记录无法自动与电子平台导入的数据精确合并。

## 电子阅读平台格式

### 2. 微信读书

> 数据获取方式：通过浏览器扩展或 API 抓取

```json
{
  "books": [
    {
      "bookId": "CB_ABC123",
      "title": "人类简史",
      "author": "[以]尤瓦尔·赫拉利",
      "cover": "https://cdn.weread.qq.com/...",
      "isbn": "9787508660752",
      "category": "社科",
      "readingTime": 36000,
      "finishReading": 1,
      "lastReadTime": 1710489600,
      "startReadTime": 1709280000,
      "progress": 100,
      "noteCount": 15
    }
  ]
}
```

**字段映射：**

| 原始字段 | 映射目标 | 转换说明 |
|----------|----------|----------|
| bookId | rawRecordIds | 微信读书内部 ID |
| title | Book.title | 直接映射 |
| author | Book.authors | 需要解析多作者（";" 分隔） |
| isbn | Book.isbn13 | 清洗后映射 |
| cover | Book.coverUrl | 直接映射 |
| readingTime | (扩展) | 阅读时长（秒），可映射为阅读周期 |
| startReadTime | BorrowCycle.borrowedAt | Unix 时间戳 → ISO 8601 UTC |
| lastReadTime | BorrowCycle.returnedAt | 最后阅读时间作为"归还"时间 |
| progress | (扩展) | 阅读进度百分比 |

### 3. Kindle

> 数据获取方式：Amazon 账户数据导出

```json
[
  {
    "asin": "B00ABCDEF1",
    "title": "Thinking, Fast and Slow",
    "authors": ["Daniel Kahneman"],
    "purchaseDate": "2023-06-15T00:00:00Z",
    "lastOpenedDate": "2024-01-20T14:30:00Z"
  }
]
```

---

## 导入流程规范

```
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
