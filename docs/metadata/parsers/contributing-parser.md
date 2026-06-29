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
import { SourceParser, ParseResult, Source } from '../types';

export const YourLibParser: SourceParser = {
  id: 'your-lib', // 必须等于对应来源的 Source.parserId
  name: '某某图书馆 API 解析器',
  supportedFormats: ['json'], // 标明支持传入的数据格式
  
  validate(rawData: string | ArrayBuffer): boolean {
    // 快速探测逻辑：判断用户上传的这份数据是否属于当前 Parser 能处理的格式
    // 例如：判断 JSON 中是否包含某个特定的特征字段
  },

  parse(rawData: string | ArrayBuffer, source: Source): ParseResult {
    // 核心解析逻辑
    // 1. 将原始数据转换为内部的 Book、CatalogRecord 和 BorrowCycle 实体
    // 2. 使用 source.timezone 将本地时间转换为 UTC
    // 3. 将单条的“借”、“还”流水记录合成为一个完整的借阅周期 (BorrowCycle)
    // 4. 返回标准化的 ParseResult
  }
};
```

### 3. 注意时区和时间转换
图书馆数据往往只有本地时间（如 `2024-03-15 10:30:00`）。在解析时，必须读取入参 `source.timezone`（如 `Asia/Shanghai`），并使用标准库（如 `date-fns-tz` 或 `Intl`）将其转换为 UTC 的 ISO 8601 字符串。

### 4. 解决物理副本与书目合并
*   如果数据中**没有 ISBN**：完全依赖 `barcode`（条码号）来追踪物理副本。不要强行根据书名进行自动合并。
*   如果数据中**有 ISBN**：提取并清洗出 `isbn13`，系统后续会使用它跨来源自动合并书目。

### 5. 注册你的 Parser
在相关的注册表（如 `src/parsers/index.ts`）中导出你的 Parser。并在 `docs/metadata/source.md` 的 `SOURCE_TEMPLATES` 中补充该图书馆的预置模板，方便普通用户一键使用。

### 6. 提交 PR (Pull Request)
在 PR 描述中请说明：
1. 目标图书馆/平台的名称和官网。
2. 数据获取的简要指引（方便其他读者复现，例如“在官网登录后，点击借阅历史，拦截 /api/history 接口的 Response”）。
3. 附带你脱敏后的样例 JSON/文本，作为项目的单元测试用例。

期待你的代码并入主分支，让 ReadGraph 的生态更加繁荣！
