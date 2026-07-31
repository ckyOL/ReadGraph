# Source 数据来源元数据

> AI Agent 指引：Source 定义了数据的来源信息，每个来源对应一个特定的 Parser。这是数据导入管线的核心配置。

## Schema 定义

```typescript
interface Source {
  /** 系统内部唯一标识 (UUID v4) */
  id: string;

  /** === 来源基本信息 === */

  /**
   * 来源类型
   * - library: 公共/高校图书馆（含 Libby 等电子借阅平台，只要有借/还记录即归入此类）
   * - manual: 用户手动录入
   */
  type: 'library' | 'manual';

  /**
   * 来源名称（用户可见的显示名称）
   * - 示例: "北京大学图书馆", "深圳图书馆"
   */
  name: string;

  /** === Parser 配置 === */

  /**
   * Parser 标识符（来源唯一标识 + Parser 选择键，二合一）
   * - 全局唯一（见 internal-schema 的 parserId unique 索引）
   * - 格式: kebab-case
   * - 个人单用户场景：每个图书馆体系一人一证，一个来源即对应一个 Parser，
   *   故用单一字段 parserId 同时作为来源唯一标识和 Parser 选择键，
   *   导入时按 source.parserId 在 Parser 注册表中查找匹配的解析器
   *   （要求 parser.id === source.parserId）。
   * - 数据由对应来源的抓取工具（Scraper）从图书馆接口抓取并产出 JSON，
   *   parserId 与具体来源的 API/抓取产物形态绑定，而非与底层 ILS 厂商绑定。
   * - 示例: "pku-lib", "szlib"
   */
  parserId: string;

  /**
   * Parser 版本
   * - 同一来源 API 不同版本可能导出格式不同
   * - 示例: "v3", "v4", "2024"
   */
  parserVersion: string | null;

  /** === 时区配置 === */

  /**
   * 数据来源的时区
   * - IANA 时区标识符
   * - 用于将原始数据中的本地时间转换为 UTC
   * - 示例: "Asia/Shanghai", "Asia/Taipei", "America/New_York"
   *
   * 重要：大部分中国图书馆系统导出的时间是 CST (UTC+8)，
   * 但不带时区信息。此字段确保转换正确性。
   */
  timezone: string;

  /** === 图书馆特有信息 === */
  library: LibraryInfo | null;

  /** === 管理信息 === */

  /** 用户备注 */
  notes: string | null;

  /** 创建时间 (UTC) */
  createdAt: Date;

  /** 最后导入时间 (UTC) */
  lastImportAt: Date | null;

  /** 累计导入记录数 */
  totalImportedRecords: number;
}

/**
 * 图书馆特有信息
 */
interface LibraryInfo {
  /**
   * 图书馆类型
   * - public: 公共图书馆
   * - academic: 高校图书馆
   * - special: 专业图书馆
   */
  libraryType: 'public' | 'academic' | 'special';

  /** 所在城市 */
  city: string | null;

  /** 所在省份 */
  province: string | null;

  /** 图书馆官网 URL */
  website: string | null;

  /** OPAC 地址 */
  opacUrl: string | null;

  /**
   * 图书馆默认使用的分类法体系
   * - 用于导入数据时默认填充 Book 的 classifications[].system
   * - clc: 中国图书馆分类法, ddc: 杜威十进制, lcc: 国会图书馆, udc: 国际十进
   */
  classificationSystem: 'clc' | 'ddc' | 'lcc' | 'udc' | 'other' | null;
}
```

## 预置来源注册表

> Agent 实现要点：系统应预置以下常见来源模板，用户选择后自动填充配置。

```typescript
/**
 * 来源模板注册表
 * - 用户创建新来源时可以从模板中选择
 * - 模板提供默认的 timezone、library 等配置（parserId 即来源标识）
 */
const SOURCE_TEMPLATES: Partial<Source>[] = [
  // === 图书馆 ===
  {
    type: 'library',
    name: '深圳图书馆',
    parserId: 'szlib',
    timezone: 'Asia/Shanghai',
    library: {
      libraryType: 'public',
      city: '深圳市',
      province: '广东省',
      website: 'https://www.szlib.org.cn',
      opacUrl: null,
      classificationSystem: 'clc',
    },
  },
];
```

## Parser 接口规范

> Agent 实现要点：每个 Parser 必须实现以下接口

```typescript
/**
 * Parser 接口
 * - 每种数据来源需要实现一个 Parser
 * - Parser 负责将原始数据转换为标准化的内部格式
 */
interface SourceParser {
  /** Parser 唯一标识符，必须等于其所解析来源的 Source.parserId */
  id: string;

  /** Parser 显示名称 */
  name: string;

  /** 支持的文件格式 */
  supportedFormats: ('json' | 'csv' | 'xlsx')[];

  /**
   * 解析原始数据
   * @param rawData - 原始文件内容（字符串或 ArrayBuffer）
   * @param source - 关联的 Source 配置
   * @returns 解析结果，包含标准化的 Book、CatalogRecord 和 BorrowCycle
   */
  parse(rawData: string | ArrayBuffer, source: Source): ParseResult;

  /**
   * 验证原始数据格式是否匹配此 Parser
   * - 用于自动检测数据来源
   * @returns true 如果数据格式匹配
   */
  validate(rawData: string | ArrayBuffer): boolean;
}

interface ParseResult {
  /** 解析出的书籍信息 */
  books: Partial<Book>[];

  /**
   * 解析出的本地编目记录（连接 Book 与借阅事件的桥梁实体）
   * - 必须返回：BorrowCycle.catalogRecordId 需要指向它
   * - 每条 CatalogRecord 应携带 sourceId、metaId、classifications、barcodes 等本地编目数据
   */
  catalogRecords: Partial<CatalogRecord>[];

  /** 解析出的借阅周期 */
  borrowCycles: Partial<BorrowCycle>[];

  /** 解析过程中的警告（非致命问题） */
  warnings: ParseWarning[];

  /** 解析统计 */
  stats: {
    totalRawRecords: number;
    parsedBooks: number;
    parsedCatalogRecords: number;
    parsedCycles: number;
    skippedRecords: number;
  };
}

interface ParseWarning {
  /** 警告类型 */
  type: 'missing_field' | 'invalid_date' | 'unpaired_record' | 'duplicate' | 'format_error';
  /** 警告消息 */
  message: string;
  /** 关联的原始记录行号或 ID */
  recordRef: string | null;
}
```

## 时区处理规则

```
Agent 实现要点：

1. 原始数据时间 → UTC 转换流程:
   a. 读取原始数据中的日期时间字符串
   b. 假定该时间为 source.timezone 指定的本地时间
   c. 使用 Intl.DateTimeFormat 或 temporal API 转换为 UTC
   d. 存储为 ISO 8601 格式 (以 "Z" 结尾)

2. 显示时间 → 用户本地时间:
   a. 从存储中读取 UTC 时间
   b. 转换为用户浏览器的本地时间显示
   c. 或转换回 source.timezone 显示（在导入详情页面）

3. 常见陷阱:
   - 中国图书馆数据几乎都是 UTC+8，但不带时区标记
   - 注意夏令时（中国大陆不实行，但台湾地区历史上有）
```
