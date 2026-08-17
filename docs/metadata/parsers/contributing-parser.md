# 为 ReadGraph 贡献新 Parser 接口指南

> ReadGraph 致力于成为一个支持全球各地图书馆（含 Libby 等电子借阅平台）的个人借阅数据归集中心。由于各地图书馆系统的 Web API 接口千差万别，我们非常欢迎开源社区的开发者为自己使用的图书馆贡献专属的 Parser（解析器）。

## 贡献前须知

1. **真实数据驱动**：不要凭借想象或官方的“理想报表”编写 Parser。请务必基于你通过浏览器抓包（Network 面板）实际拦截到的、或导出的真实数据进行开发。
2. **纯前端运行**：Parser 必须能够在浏览器端运行，不能使用 Node.js 专属的模块（如 `fs`）。
3. **隐私脱敏**：在提交 PR 附带的测试数据（Mock Data）时，请务必脱敏你的读者证号、借书卡号、真实姓名、IP 地址等隐私信息。

## 开发步骤

### 1. 抓取真实数据样本
登录你的目标图书馆（如 OPAC 系统或“我的图书馆”），通过浏览器开发者工具获取“借阅历史”、“流通日志”等接口返回的 JSON。将其脱敏后保存为样例文件。

### 2. 实现 `SourceParser` 接口
在 `src/parsers/` 目录下创建一个新的 TypeScript 文件（如 `your-lib-parser.ts`），实现系统定义的 `SourceParser` 接口：

```typescript
import { SourceParser, ParseResult, Source } from './types';

export const YourLibParser: SourceParser = {
  id: 'your-lib', // 必须等于对应来源的 Source.parserId
  name: '某某图书馆 API 解析器',

  validate(rawData: string | ArrayBuffer): boolean {
    // 快速探测逻辑：判断用户上传的这份数据是否属于当前 Parser 能处理的格式
    // 例如：判断 JSON 中是否包含某个特定的特征字段
    return true;
  },

  parse(rawData: string | ArrayBuffer | unknown[], source: Source): ParseResult {
    // 核心解析逻辑
    // 1. 将原始数据转换为内部的 Book、CatalogRecord 和 BorrowCycle 实体
    // 2. 使用 source.timezone 将本地时间转换为 UTC
    // 3. 将单条的“借”、“还”流水记录合成为一个完整的借阅周期 (BorrowCycle)
    // 4. 按下方「瞬态字段契约」为 borrowCycle 标注 _rowIndexes、为
    //    book/catalogRecord 标注 _bookKey
    // 5. 返回标准化的 ParseResult
    // 注：rawData 为 unknown[] 时是导入管线直接传入的逐行 data（跳过 JSON
    // 两遍全量处理），此时按行序解析，与 filterRows 保持一致的有效行集合。
  },

  filterRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
    // 行级预过滤：剔除无效/无用记录（如「自助查询」「读者续借」），供导入
    // 预览使用。必须与 parse 内部的有效行集合一致——「预览所见即导入所得」。
    return rows;
  }
};
```

### 2.1 瞬态字段契约（`_rowIndexes` / `_bookKey`）

`ParseResult` 中候选实体上的以下字段是**不入库的瞬态字段**：parser 经
`as Record<string, unknown>` 附加，pipeline 依赖它们完成装配对齐；缺失时导入
继续，但 pipeline 会发出 `missing_field` 警告并降级（周期原始行关联、书目对齐
静默失效——这正是「按指南写的 parser 产出静默错误数据」的根源，务必照此设置）：

| 字段 | 标注对象 | 语义 | 消费方（pipeline） |
|---|---|---|---|
| `_rowIndexes: number[]` | `borrowCycles[]` 每个 partial | 该周期消费的原始行文件行号（1-based，与 `RawRecord.rowIndex` 一致） | 按行号装配 `rawRecordIds`，并按行 metaid 消歧 |
| `_bookKey: string` | `books[]` / `catalogRecords[]` 每个 partial | 批次内去重后的书目键（`isbn:` / `noisbn:` / `ph:` 前缀） | `findBookForCatalog` 定位对应 Book 候选 |

示例（在 `parse` 内设置）：

```typescript
// 周期：记录其消费的原始行号（1-based 文件行序）
(cyclePartial as Record<string, unknown>)._rowIndexes = [12, 15];
// 书目与编目：使用同一去重键，pipeline 据此对齐
(bookPartial as Record<string, unknown>)._bookKey = key;
(crPartial as Record<string, unknown>)._bookKey = key;
```

`_bookKey` 的取值规则（isbn13 优先；无 ISBN 用 `noisbn:题名|著者`；占位书名用
`ph:条码`）请参照 `src/parsers/szlib.ts` 的装配实现。

### 3. 注意时区和时间转换
图书馆数据往往只有本地时间（如 `2024-03-15 10:30:00`）。在解析时，必须读取入参 `source.timezone`（如 `Asia/Shanghai`），并使用标准库（如 `date-fns-tz` 或 `Intl`）将其转换为 UTC 的 ISO 8601 字符串。

### 4. 解决物理副本与书目合并
*   如果数据中**没有 ISBN**：完全依赖 `barcode`（条码号）来追踪物理副本。不要强行根据书名进行自动合并。
*   如果数据中**有 ISBN**：提取并清洗出 `isbn13`，系统后续会使用它跨来源自动合并书目。

### 5. 注册你的 Parser
在 `src/parsers/registry.ts` 中注册你的 Parser：import 后在默认全局注册表登记
（照抄 `szlibParser` 的注册方式：`defaultRegistry.register(YourLibParser)`）；
测试环境可用 `createRegistry()` 创建隔离注册表，互不影响。
并在 `docs/metadata/source.md` 的 `SOURCE_TEMPLATES` 中补充该图书馆的预置模板，方便普通用户一键使用。

### 6. 提交 PR (Pull Request)
在 PR 描述中请说明：
1. 目标图书馆/平台的名称和官网。
2. 数据获取的简要指引（方便其他读者复现，例如“在官网登录后，点击借阅历史，拦截 /api/history 接口的 Response”）。
3. 附带你脱敏后的样例 JSON/文本，作为项目的单元测试用例。

期待你的代码并入主分支，让 ReadGraph 的生态更加繁荣！
