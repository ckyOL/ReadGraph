# Import Format 导入数据格式规范

> AI Agent 指引：本文档定义了系统接受的导入数据格式。每种来源有不同的原始格式，Parser 负责转换为统一的内部格式。

## 通用约束

- 文件编码：UTF-8（必须支持 GBK/GB2312 自动检测和转码，中国图书馆系统常用）
- 文件大小限制：前端处理，建议单文件不超过 50MB
- 支持格式：JSON, CSV（可扩展 XLSX）

---

## 图书馆系统常见导出格式

### 1. 汇文 Libsys 格式

> 国内高校图书馆最常用的管理系统

**典型字段映射：**

```json
[
  {
    "barcode": "0012345678",
    "title": "设计模式 : 可复用面向对象软件的基础",
    "author": "(美) Able... 著",
    "callno": "TP311.5/D3",
    "loanDate": "2024-03-15 10:30:00",
    "returnDate": "2024-04-10 14:20:00",
    "dueDate": "2024-04-15",
    "renewCount": "0",
    "location": "理科馆三楼",
    "type": "借出"
  }
]
```

**字段映射表：**

| 原始字段 | 可能的中文名 | 映射目标 |
|----------|-------------|----------|
| barcode | 条码号, 册条码 | Book.barcodes, BorrowCycle.barcode |
| title | 题名, 书名, 正题名 | Book.title |
| author | 著者, 作者, 责任者 | Book.authors |
| callno | 索书号, 分类号, 索取号 | Book.callNumber, Book.clcCode (提取) |
| isbn | ISBN | Book.isbn13 / Book.isbn10 |
| loanDate | 借出日期, 借阅日期, 借书日期 | BorrowCycle.borrowedAt |
| returnDate | 归还日期, 还书日期 | BorrowCycle.returnedAt |
| dueDate | 应还日期, 到期日期 | BorrowCycle.dueDate |
| renewCount | 续借次数 | BorrowCycle.renewCount |
| type | 操作类型, 流通类型 | 用于判断借/还/续借 |
| location | 馆藏地, 馆藏地点 | (扩展信息) |
| publisher | 出版者, 出版社 | Book.publisher |
| pubdate | 出版日期, 出版年 | Book.publishDate |

### 2. 金盘 GDLIS 格式

> 国内公共图书馆常用

**典型字段映射：**

```json
[
  {
    "册条码号": "SZ00123456",
    "正题名": "百年孤独",
    "责任者": "[哥]加西亚·马尔克斯著 ; 范晔译",
    "ISBN": "978-7-5442-6044-1",
    "分类号": "I775.45",
    "借书日期": "2024/01/20",
    "应还日期": "2024/02/20",
    "还书日期": "2024/02/15",
    "续借次数": "0"
  }
]
```

### 3. Interlib 格式

> 区域公共图书馆联盟常用

```json
[
  {
    "itemBarcode": "TJ20240001",
    "bibTitle": "三体",
    "bibAuthor": "刘慈欣 著",
    "bibISBN": "9787536692930",
    "classNo": "I247.5",
    "loanTime": "2024-05-01 09:15:00",
    "returnTime": "2024-05-20 16:30:00",
    "dueTime": "2024-06-01",
    "loanType": "普通借阅",
    "renewTimes": 0
  }
]
```

### 4. 通用 CSV 格式

支持用户导出的 CSV 文件，通过列名自动匹配：

```csv
条码号,书名,作者,ISBN,分类号,借出日期,归还日期,应还日期
0012345678,设计模式,"Gamma等著",9787111075752,TP311.5,2024-03-15,2024-04-10,2024-04-15
```

**CSV 列名自动匹配规则：**

```typescript
const COLUMN_ALIASES: Record<string, string[]> = {
  barcode: ['条码号', '册条码号', '册条码', 'barcode', 'itemBarcode', 'item_barcode'],
  title: ['题名', '正题名', '书名', 'title', 'bibTitle', 'bib_title'],
  author: ['著者', '责任者', '作者', 'author', 'bibAuthor', 'bib_author'],
  isbn: ['ISBN', 'isbn', 'bibISBN', 'bib_isbn'],
  callNumber: ['索书号', '索取号', '分类号', 'callno', 'classNo', 'call_number'],
  loanDate: ['借出日期', '借阅日期', '借书日期', 'loanDate', 'loanTime', 'loan_date', 'borrow_date'],
  returnDate: ['归还日期', '还书日期', 'returnDate', 'returnTime', 'return_date'],
  dueDate: ['应还日期', '到期日期', 'dueDate', 'dueTime', 'due_date'],
  renewCount: ['续借次数', 'renewCount', 'renewTimes', 'renew_count'],
  publisher: ['出版者', '出版社', 'publisher'],
  publishDate: ['出版日期', '出版年', 'pubdate', 'pub_date', 'publish_date'],
  operationType: ['操作类型', '流通类型', 'type', 'loanType', 'operation_type'],
};
```

---

## 电子阅读平台格式

### 5. 微信读书

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

### 6. Kindle

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
