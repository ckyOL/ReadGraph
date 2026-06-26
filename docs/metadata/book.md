# Book 书籍信息元数据

> AI Agent 指引：Book 是核心实体，代表一本具体的出版物。多次借阅同一本书应关联到同一个 Book 记录。

## Schema 定义

```typescript
interface Book {
  /** 系统内部唯一标识，自动生成 (UUID v4) */
  id: string;

  /** === 核心标识符 === */

  /**
   * ISBN-13 格式，纯数字字符串（13位）
   * - 优先使用 ISBN-13；如原始数据为 ISBN-10，转换为 ISBN-13
   * - 可能为空（部分老旧图书无 ISBN）
   * - 校验规则：符合 ISBN-13 校验位算法
   */
  isbn13: string | null;

  /**
   * ISBN-10 格式，保留原始值（10位，末位可能为 X）
   * - 仅当原始数据提供 ISBN-10 时填充
   * - 用于兼容旧系统和反查
   */
  isbn10: string | null;

  /** === 图书馆特有标识符 === */

  /**
   * 馆藏条码号
   * - 同一本书在不同馆可能有不同条码
   * - 格式因馆而异，通常为纯数字
   * - 存储为数组，支持多馆多条码
   */
  barcodes: BarcodeEntry[];

  /** === 书目信息 === */

  /** 书名（取自原始数据，保留原始格式） */
  title: string;

  /** 副标题 */
  subtitle: string | null;

  /** 作者列表 */
  authors: string[];

  /** 译者列表（翻译作品） */
  translators: string[];

  /** 出版社 */
  publisher: string | null;

  /**
   * 出版日期
   * - 格式: "YYYY" | "YYYY-MM" | "YYYY-MM-DD"
   * - 精度因数据来源而异，保留可用精度
   */
  publishDate: string | null;

  /** 版次（如 "第2版"、"3rd edition"） */
  edition: string | null;

  /** 页数 */
  pages: number | null;

  /**
   * 定价（结构化存储）
   * - 从原始字符串解析出数值和货币代码
   * - 便于统计分析和排序
   */
  price: Price | null;

  /** === 分类信息 === */

  /**
   * 图书分类号（支持多种分类法，如 CLC、DDC、LCC 等）
   * - 同一本书在不同图书馆可能有不同的分类体系或不同的分类号
   * - 存储为数组，兼容一书多分类
   */
  classifications: ClassificationEntry[];

  /**
   * 主题词 / 关键词
   * - 来源于图书馆编目数据或用户标签
   */
  subjects: string[];

  /** === 元信息 === */

  /** 封面图片 URL（可选，来自豆瓣/OpenLibrary等） */
  coverUrl: string | null;

  /** 记录创建时间 (UTC) */
  createdAt: Date;

  /** 记录最后更新时间 (UTC) */
  updatedAt: Date;

  /**
   * 数据来源标记
   * - 记录此书籍信息最初从哪个 source 导入
   * - 后续可能被其他 source 的数据补充
   */
  sourceIds: string[];
}

interface BarcodeEntry {
  /** 条码号 */
  barcode: string;
  /** 关联的图书馆 source ID */
  sourceId: string;
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

interface Price {
  /** 金额数值 */
  amount: number;
  /**
   * ISO 4217 货币代码
   * - 示例: "CNY", "USD", "JPY", "EUR"
   * - 从原始字符串推断："¥45.00" → CNY, "$12.99" → USD
   */
  currency: string;
}
```

## 字段优先级

从多个来源导入同一本书时，字段合并优先级：

| 优先级 | 来源 | 说明 |
|--------|------|------|
| 1 | 用户手动编辑 | 用户修正的信息最优先 |
| 2 | 图书馆编目数据 | 专业编目，通常最准确 |
| 3 | 电子阅读平台 | 可能有更好的封面、简介 |
| 4 | 自动补全 API | OpenLibrary / 豆瓣 API |

## ISBN 处理规则

```
Agent 实现要点：
1. ISBN-10 → ISBN-13 转换：
   - 去掉 ISBN-10 的校验位
   - 前缀 "978"
   - 重新计算 ISBN-13 校验位
2. ISBN 清洗：
   - 去除连字符 "-" 和空格
   - 统一为纯数字（ISBN-10 末位 X 保留）
3. 去重键与副本识别：
   - 物理副本标识：使用 `sourceId` + `barcode` 唯一标识一本具体的实体书（避免无 ISBN 的自编文献、期刊或同馆多副本引起错乱）。
   - 书目合并：通过 `isbn13` 将不同馆藏或无条码的阅读记录归集到统一的 `Book` 实体。
   - 兜底策略：无 ISBN 时，退化使用 `title` + `authors[0]` 进行模糊建议合并。
```

## 分类号对照表（示例）

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
