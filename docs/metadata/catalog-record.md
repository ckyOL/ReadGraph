# CatalogRecord 编目记录元数据

> AI Agent 指引：CatalogRecord 代表一本书在特定数据源（如某图书馆）的本地编目或物理映射。这是连接抽象的 `Book` 与具体借阅事件的桥梁。

## Schema 定义

```typescript
interface CatalogRecord {
  /** 系统内部唯一标识，自动生成 (UUID v4) */
  id: string;

  /** 关联的全局抽象书籍 ID (Book.id) */
  bookId: string;

  /** 
   * 数据来源 ID
   * - 例如："szlib" (深圳图书馆), "gzlib" (广州图书馆)
   */
  sourceId: string;

  /** === 编目与馆藏标识 === */

  /**
   * 图书馆系统内部书目 ID（保留来源原始类型）
   * - 深圳图书馆的 metaid 为整数（int），此处保留 number；
   *   部分图书馆系统（如使用字符串主键的 ILS）为字符串，此处保留 string。
   * - 该字段忠实记录来源返回的原始值，仅用于展示与溯源。
   *
   * 注意：不要直接用 `metaId` 建索引或做去重比较。
   * IndexedDB 键按类型严格比较，"123" 与 123 视为不同键，
   * 同一来源若混用 string/number（或跨来源比较）会导致漏判。
   * 索引、复合键与去重统一使用下方归一化的 `metaIdKey`。
   */
  metaId: string | number | null;

  /**
   * 归一化的书目 ID 键（始终为 string，供索引与去重使用）
   * - 由 `metaId` 经 `String(metaId).trim()` 派生，metaId 为 null 时本字段亦为 null。
   * - 复合索引 [sourceId, metaIdKey] 与 CatalogRecord 级去重均以此为准，
   *   确保 int(123) 与 string("123") 在同一来源内可正确匹配。
   */
  metaIdKey: string | null;

  /**
   * 馆藏条码号列表
   * - 用户在该馆借阅过的这本书的具体物理副本条码
   * - 由于一个馆可能有多个复本，这里存储为数组
   */
  barcodes: string[];
  
  /** === 馆内分类 === */

  /**
   * 馆内分类号
   * - 该馆对这本书的特定分类体系和分类号
   */
  classifications: ClassificationEntry[];

  /** === 元信息 === */

  /** 记录创建时间 (UTC) */
  createdAt: Date;

  /** 记录最后更新时间 (UTC) */
  updatedAt: Date;
}

interface ClassificationEntry {
  /**
   * 分类法体系
   * - clc: 中国图书馆分类法 (Chinese Library Classification)
   * - ddc: 杜威十进制分类法 (Dewey Decimal Classification)
   * - lcc: 美国国会图书馆分类法 (Library of Congress Classification)
   * - udc: 国际十进分类法 (Universal Decimal Classification)
   * - other: 其他或馆内自编分类法
   */
  system: 'clc' | 'ddc' | 'lcc' | 'udc' | 'other';
  /** 分类号（如 "TP312"、"005.1"） */
  code: string;
  /** 对应的类别名称（可选，如 "自动化技术、计算机技术"） */
  category?: string;
}
```

## 模型拆分目的

在 ReadGraph 架构中，`Book` 是跨数据源的全局表现体，用于归集相同 ISBN 或书名的记录；而 `CatalogRecord` 用于封存带有强烈本地色彩的数据，如特定图书馆的 `metaId` 和分类习惯，从而避免了多数据源合并时本地编目数据的冲突和互相覆盖。

## 分类号对照表（参考示例）

由于支持多种分类法，系统需维护不同分类法的映射。以下为 CLC（中图分类法）一级类目示例：

| 代码 | 类名 | 英文 |
|------|------|------|
| A | 马克思主义、列宁主义、毛泽东思想、邓小平理论 | Marxism |
| B | 哲学、宗教 | Philosophy & Religion |
| C | 社会科学总论 | Social Sciences |
| D | 政治、法律 | Politics & Law |
| E | 军事 | Military |
| F | 经济 | Economics |
| G | 文化、科学、教育、体育 | Culture & Education |
| H | 语言、文字 | Language |
| I | 文学 | Literature |
| J | 艺术 | Art |
| K | 历史、地理 | History & Geography |
| N | 自然科学总论 | Natural Sciences |
| O | 数理科学和化学 | Math & Chemistry |
| P | 天文学、地球科学 | Astronomy & Earth Science |
| Q | 生物科学 | Biology |
| R | 医药、卫生 | Medicine |
| S | 农业科学 | Agriculture |
| T | 工业技术 | Technology |
| U | 交通运输 | Transportation |
| V | 航空、航天 | Aviation & Aerospace |
| X | 环境科学、安全科学 | Environmental Science |
| Z | 综合性图书 | General |

> 注意：TP（自动化技术、计算机技术）是 T 的子类，在分析中可进一步细分。
