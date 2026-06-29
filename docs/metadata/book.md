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

  /** === 标签与元信息 === */
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
| 3 | 自动补全 API | OpenLibrary / 豆瓣 API（补封面、简介等） |


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
