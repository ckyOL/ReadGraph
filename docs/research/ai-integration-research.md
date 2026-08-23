# AI 画像分析与点评 —— 技术调研（修订版）

> **状态**：调研文档（非规格）。规格已按 SDD 落地为 [specs/ai-features.md](../specs/ai-features.md)（Phase 1 契约：脱敏管道 / 设置页 AI 区 / 阅读画像分析），实现按 Tests(Red) → Code → Tests(Green) 推进。
> **分工**：本文档为决策溯源（为何云端/为何脱敏/为何否决浏览器推理）；落地细节以 [specs/ai-features.md](../specs/ai-features.md) 为权威、执行清单见 [tasks/ai-features-batch.md](../tasks/ai-features-batch.md)——本文档 §5–§8 的草案内容与规格重复属「草案→规格」演进，不另行同步。
> **日期**：2026-08-22（修订：2026-08-23）
> **关联**：[design-decisions](./design-decisions.md)（纯前端/隐私原则）、[reading-profile](./specs/reading-profile.md)（画像聚合契约）、[settings](./specs/settings.md)（偏好落点）、[npm-supply-chain-security](./npm-supply-chain-security.md)（依赖审查）
> **修订要点**：① 新增类似项目调研（§2）与隐私保护技术调研（§3）；② 架构路线改为**云端高智能 + 脱敏为主力**，本地服务降为可选；③ 删除浏览器内推理路线（WebLLM/Transformers.js——局限大，不采用）；④ 删除模型选型（端点与模型是用户自己的事，项目不做选型建议）。⑤ 点评语义修正：**审美情趣点评并入画像分析**（`insight[]` 的 `kind='taste'` 条目），删除详情页单本点评，Phase 1 落点为阅读画像分析（§6.1/§8）。⑥ 补 UI 设计决策：不新开 AI 页面、非 LLM 会话样式、消费端锚定数据语境（§6.3）。

## 1. 背景与目标

需求：给本地阅读档案接入 LLM 能力，核心用例为**阅读画像分析**：

- **画像分析**：把 `/profile` 的统计聚合转译为自然语言洞察与叙事（阅读偏好解读、趋势、年度总结），并综合借阅书目等信息点评阅读审美/品味倾向。

关键决策（本次修订确立）：

1. **云端高智能为主力**：使用者机器性能差异大，无法一概而论——有人机器普通只跑得动小模型，有人机器好能跑大模型。本地推理能力与机器绑定，体验参差；且无论机器强弱，本地可用模型的智能上限普遍低于云端前沿模型，点评/叙事恰恰是品味与语感的场景，模型差距直接体现为文案质量差距；本地推理还占用内存影响日常使用。**云端方案与机器性能解耦，人人可用、体验一致，故为统一主力**；本地自部署作为"绝对隐私"场景的可选后端（架构上零成本保留，见 §4），跑什么模型由用户按自己机器决定。
2. **隐私靠脱敏技术保护，而非放弃智能**：采用 industry-standard 的 **anonymize-before-send（发送前脱敏）** 模式——只发送完成任务所需的最小字段，直接标识符与行为细节一律不发送。本项目数据 100% 结构化（cardno/条码/借还日期是独立字段），**字段级过滤即完整脱敏，无需 NER 模型**（详见 §3、§5）。
3. **端点与模型是用户自己的事**：项目不做模型选型建议；用户自行配置云端（BYOK）/自托管网关/本地服务端点。
4. 继承约束：纯前端、UI 文案 i18n 双语、统计数值只由本地纯函数聚合产出（LLM 只做语言转译）、依赖最小化 + 供应链审查。

## 2. 类似项目调研（谁做过、如何设计）

结论先行：**没有现成的"个人借阅档案 + LLM 画像/点评"完整实现**——这是差异化功能。最接近的架构参照是 Readwise Ghostreader；开源阅读生态（Literal / Openreads / BiblioReads / KOReader）均无 AI 层。

### 2.1 直接参照：Readwise Reader / Ghostreader（个人内容 + 云端 AI）

Readwise 是"个人内容（文档/高亮/笔记）+ 云端 AI 助手"的最成熟产品化先例，其 Ghostreader 设计要点：

- **上下文最小化**：AI 调用是 **highlight（段落）级**而非整文档级——只把用户选中的相关片段发给 LLM，而非全部个人内容。这是隐私设计的核心模式。
- **默认 prompt + 用户可自定义**：内置 summarize / explain / define 等模板，用户可编辑任意 prompt。
- **输出引用定位（citation）**：生成结果锚定原文引用，可追溯。
- **MCP server**：暴露个人高亮库给外部 AI 应用（可选集成面）。

> 对应到本项目：上下文最小化 = 只发聚合统计 + 全量书目题名/作者/分类/出版/借阅次数（§5 字段白名单）；可自定义 prompt = 画像/点评 prompt 用户可调；引用定位 = 事实洞察锚定聚合维度（点击跳图表 tab）、审美点评锚定画像整体。

### 2.2 阅读生态现状（均无 AI 层）

| 项目 | 定位 | AI 功能 | 设计启示 |
|------|------|--------|---------|
| **Literal**（开源 Goodreads 替代） | 书评/书单/社交 | **明确无 AI 层**（官方评测确认） | 隐私优先定位与 AI 层不冲突 |
| **Openreads**（开源 Flutter） | 隐私导向阅读追踪 | 无 AI | 移动端统计画像形态参照 |
| **BiblioReads** | 隐私优先 Goodreads 前端 | 无 AI | 隐私优先的 UI 参照 |
| **KOReader** | 电子书阅读器 | 无 AI（仅本地统计插件：阅读历史概览） | "画像"的纯本地统计形态已有，AI 转译是空白 |
| **StoryGraph** | 阅读追踪 + 推荐 | ML 推荐（基于阅读历史，非 LLM 生成） | 推荐信号 = 阅读历史特征，本项目同源 |
| **图书馆界 GenAI 实践** | 资源建设 | AI 生成元数据/推荐（基于阅读历史） | 用例同源：阅读历史 → 生成式文案 |

### 2.3 设计启示汇总

1. **无竞品 = 无现成 prompt/管道可抄**：需自行设计 prompt 模板与字段契约，但可借鉴 Ghostreader 的"上下文最小化 + 可自定义 prompt + 引用定位"三件套。
2. **隐私与 AI 层不冲突**：开源阅读工具普遍"隐私优先且无 AI"，恰好证明"本地档案 + 云端 AI + 脱敏"是未被主流占据的结合点。
3. **阅读历史是推荐/画像的既有信号源**：StoryGraph 已证明其价值，LLM 转译是顺理成章的增强而非另起炉灶。

## 3. 隐私保护技术调研（脱敏矩阵）

### 3.1 行业标准模式：anonymize-before-send

"发送前脱敏"是 LLM 管道的既定实践（sanitize before you send）：**检测 PII → 脱敏/替换 → 再发送**，可完全在自有基础设施完成，不依赖厂商承诺。工具生态：Microsoft Presidio（开源 NER 检测 + 匿名化）、Philter、Prediction Guard 等——但均为 Python 服务端组件。

**本项目的关键优势**：数据不是自由文本而是**结构化实体**（`Source`/`Book`/`CatalogRecord`/`BorrowCycle`，字段 Schema 由 Zod 强制），敏感项（`cardno`、`barcode`、借还日期、rawRecords）是**独立字段**——脱敏 = 装配 payload 时按白名单字段提取 + 黑名单断言，**无需 NER/正则猜测**，比通用工具更可靠且零依赖。纯前端 PII 脱敏（浏览器内检测）也有成熟先例（Cloak、PrivacyScrubber 等 100% 本地执行），证明方向可行，但我们不需要它们的检测能力。

### 3.2 技术矩阵（适用性评估）

| 技术 | 原理 | 对本项目适用性 | 结论 |
|------|------|---------------|------|
| **数据最小化** | 只发送完成任务所需的最小字段 | **核心适用** | 主力手段 |
| **字段级脱敏（redaction）** | 敏感字段不进入 payload | **核心适用**（结构化数据天然支持） | 主力手段 |
| **聚合匿名** | 只发聚合统计，不发单条记录（k-anonymity 思想） | **适用**（画像场景） | 主力手段 |
| 零保留/不训练 API | 厂商承诺不留存不训练（OpenAI/Anthropic 等） | 可选 | 依赖厂商承诺，作为补充选项 |
| 差分隐私（DP） | 对输出加噪声保统计隐私 | **不适用** | 噪声破坏文案质量；LLM 生成非统计发布场景 |
| 联邦学习 | 分布训练不集中数据 | **不适用** | 浏览器端无法微调大模型；无训练需求 |
| 同态加密 / TEE | 密文计算 / 可信硬件 | **不适用** | 性能代价大、工程复杂，个人场景无必要 |
| 自托管网关（LiteLLM 等） | 本地代理中转云端，加日志审计 | 可选（进阶） | 用户自行部署；架构上兼容（同一 OpenAI 契约） |

### 3.3 诚实的隐私边界

脱敏保护的是**直接标识符与行为细节**（卡号、条码、借还时点、频率、馆名、原始记录）；**不保护阅读兴趣本身**——审美点评与画像洞察必然发送书名/作者（全量题名+作者，§5.2 白名单），品味判断与洞察的趣味性都依赖题名。这是功能语义决定的，无法"脱敏"。因此：

- 隐私承诺的准确表述：**"只发送完成任务所需的最少字段；直接标识符与借阅行为细节永不发送；发送内容用户可见可审"**——而非"数据完全不出设备"。
- 真正的边界由用户知情选择划定：AI 默认关闭，用户显式启用并确认发送内容后才生效。

## 4. 架构路线对比

| 维度 | A. 云端 API + 脱敏（**主力**） | B. 本地 LLM 服务（可选） |
|------|------------------------------|------------------------|
| 智能水平 | 高（100B+ 级，文案质量佳，人人一致） | 视机器而定（普通机器仅小模型，强机器可跑大模型，体验参差） |
| 数据去向 | 用户指定云端端点（BYOK） | 不出设备 |
| 隐私保障 | 脱敏管道（§5）+ 零保留选项 | 天然隔离 |
| 机器开销 | 零（不占内存/算力） | 数 GB 内存 + 推理占用 |
| 成本 | 个人用量极低（DeepSeek 等按 token 计费可忽略） | 免费 |
| 断网可用 | 不可用（AI 功能降级，核心功能不受影响） | 可用 |
| 接入成本 | 无依赖（自写 fetch 封装 + 脱敏纯函数） | 无依赖（同一 OpenAI 契约） |
| 定位 | **默认** | "绝对隐私"场景的可选后端，同一契约零成本共存 |

**已删除的路线**：浏览器内推理（WebLLM / Transformers.js）——首次下载 3–5GB 权重、运行时内存占用大、速度低、模型面限于小参数，且与"高智能"目标矛盾；design-decisions 技术选型表的"本地 AI 预留位"建议后续同步修订（本调研不代改）。

## 5. 脱敏管道设计（核心）

### 5.1 管道流程

```
用户触发 AI 功能（默认关闭，需显式启用）
  → ① 场景 Schema（Zod）声明所需字段（白名单）
  → ② 数据装配器：从 IndexedDB 只提取白名单字段
  → ③ 敏感字段断言：黑名单字段（cardno/barcode/rawRecords/借还日期/馆名…）绝不出现在 payload（测试强制）
  → ④ 发送预览：UI 展示将发送的 payload JSON（What you see is what is sent）
  → ⑤ POST 用户配置端点（OpenAI 兼容 /v1/chat/completions，流式 + Abort）
  → ⑥ 响应 Zod 校验 → 渲染（标注"AI 生成，基于本地数据"）
  → ⑦ 云端原文不持久化；本地缓存（可选）仅存生成结果并标注
```

### 5.2 场景字段白名单（契约草案）

| 场景 | 发送字段（白名单） | 永不发送（黑名单） |
|------|-------------------|-------------------|
| 阅读画像洞察 | 聚合统计（分类分布/借阅量/时长均值/年度指标，来自 `profile-stats` 输出）+ 全量题名+作者（超阈值采样降级，见 [ai-features §3.2](./specs/ai-features.md#32-画像场景白名单契约草案phase-1-唯一场景)） | 同上 + 单条借阅记录、时间戳明细 |
| 年度总结叙事 | `year-review` 切片指标 + 全量书目题名+作者（年度切片，规模更小） | 同上 |
| 未来扩展（笔记/批注） | 用户所选文本（需规则脱敏：邮箱/电话/卡号正则替换） | 其余一切 |

> 画像场景的聚合统计本身就是匿名化（k-anonymity 思想）：单桶无法反推单本借阅行为。装配器直接消费 `profile-stats`/`year-review` 的纯函数输出（design-decisions §6 一致性：统计永远由本地聚合产生，LLM 只做转译）。
> **审美点评与洞察共用同一白名单**（聚合统计 + 全量题名/作者）——点评基于画像级数据，不额外发送单本书目元数据。

### 5.3 测试要点

- 装配器纯函数单测：给定实体数组 → payload 仅含白名单字段；黑名单字段**穷举断言**（构造含 cardno/barcode/日期的数据，断言 payload 序列化文本中不出现）。
- 预览渲染：payload JSON 展示与实际上送一致（同一装配函数产物）。

## 6. 用例设计

### 6.1 阅读画像分析（洞察 + 审美点评）

- **阅读画像洞察**（`/profile`）：聚合数据 → 2–4 条洞察（分类偏好、借阅节奏、时长习惯、复借最多），输出 JSON（`insight[]`），Zod 校验；prompt 只给数值、模型只转译，杜绝幻觉数字。
- **审美情趣点评**：作为画像分析的组成部分，`insight[]` 条目带 `kind`（`'fact'` 事实洞察 / `'taste'` 审美点评）——`kind='taste'` 条目即审美点评：综合借阅书目等信息（聚合统计 + 全量书目题名/作者，§5.2 白名单）生成阅读品味/审美倾向的整体评价（中英随 locale），正文为一段评价性文字，无维度关联。与事实条目**同次生成、同一 Zod schema 强校验**。
- **输入独立性**：生成输入只消费本地聚合与书目（`profile-stats` 输出 + 全量书目题名/作者），**不消费前一次 AI 输出**——防幻觉传播，守住「AI 只转译本地数据」（design-decisions §6）。
- **不做列表级批量**：画像分析是单次生成，不做单本批量点评（对齐"编目补全不做批量" design-decisions §6；原详情页单本点评入口删除）。
- 幻觉控制：prompt 限定「仅可引用发送书单内的书目，不虚构书名/作者/情节」；Zod 校验输出结构；可重新生成。**诚实边界**：`kind='taste'` 自由文本的引用真实性不可强校验（区别于事实条目的数字强校验），规格中明示。
- 原则：AI 输出一次性生成、**不落库为实体**；可缓存（按 year/range/locale）到 localStorage，设置页可清除。

### 6.2 年度总结叙事

- **年度总结叙事**（`/profile/$year`）：年度切片指标 → 叙事段落（"今年借阅 23 本、最爱文学类、复借最多的是《X》…"）。
- 原则：同 §6.1（一次性生成、不落库、可缓存）。

### 6.3 UI 设计决策

- **不新开 AI 页面**：消费端锚定数据语境（上下文最小化 + 引用定位的 UI 落地）；AI 未启用（默认关闭）时 UI 无 AI 痕迹——区块条件渲染可实现，独立页面做不到（未启用时整页空壳）。
- **不做 LLM 会话样式**：用例均为**单次生成**（无多轮/无追问）；输出是结构化 JSON 与段落而非对话气泡；会话界面与「即发即弃」隐私承诺（§5.1 ⑦）及直角克制视觉基线（ui-navigation §1）冲突。**流式 ≠ 会话**：流式只做「卡片渐进填充 / 段落逐句呈现」。
- **消费端落点**：画像分析（洞察 + 审美点评）→ `/profile`「AI 解读」区；年度叙事 → 年度视图（Phase 2）；配置 → `/settings` AI 区（§7）；发送预览 → 各生成入口首次触发（§5.1 ④）。
- **`/profile`「AI 解读」区形态**：价值卡行之下、图表 Tabs 之上，呈现画像分析的完整结果——事实洞察渲染为 2–4 张窄卡（标题+正文+关联维度 chip，点击激活对应图表 tab = 引用定位）；审美点评渲染为一段评价文字（全宽，流式逐句，Phase 2）。与价值卡行同构、不卡片套卡片、不抢图表全幅；整体可重新生成。
- **口径**：画像分析固定全量口径（与概览卡一致），不与 range 联动——避免 range 切换反复调用 API；如需联动，缓存键含 range。

## 7. 架构建议（落点草案）

```
src/ai/
├─ ai-provider.ts        # 接口：chat(messages, {schema?, stream?, signal?}) → 文本/JSON/流
├─ ai-client.ts          # OpenAI 兼容 fetch 薄封装：SSE 解析、Abort、timeout、schema→response_format（纯函数可单测）
├─ sanitize.ts           # 脱敏管道：场景 Schema → 白名单装配 + 黑名单断言（纯函数）
├─ prompts/
│  ├─ profile-insights.ts # 画像分析 prompt + Zod schema（insight[]，含 fact/taste 条目）
│  └─ year-narrative.ts   # 年度总结叙事 prompt + Zod schema（Phase 2）
└─ use-ai.ts             # Hook：编排、loading/error/重试、流式拼接、缓存
```

- **零新增运行时依赖**（Phase 1）：fetch 封装 + 脱敏纯函数；云端/本地服务/自托管网关同为 OpenAI 兼容契约，`baseUrl` + `apiKey` 配置即切换。
- **设置页 AI 区**（`/settings` 扩展，默认关闭）：
  - 端点 URL（默认空）+ API Key（可选）；模型名**用户自填**（项目不做选型建议）。
  - 连接测试按钮（`GET /v1/models`，带 Authorization）。
  - 隐私说明：发送内容/目的/不发送字段/即发即弃；发送预览开关。
  - 持久化：扩展 `userPreferencesSchema`（`ai.enabled`/`ai.baseUrl`/`ai.apiKey`/`ai.model`）；**Key 独立存储、不随备份导出**；重置可选清除。
- **CSP**（`connect-src`）：需放宽。当前 `'self' + OPAC 域名` → 增加 `https:`（用户 BYOK 任意云端端点，CSP 构建期静态化无法按用户配置动态放行）。取舍记录：放宽面为任意 https 端点，但数据只在用户显式启用 AI 并触发功能时发送；本地回环（`http://127.0.0.1:*`）供本地服务路径。vite.config.ts 注释记录。
- **零保留选项**：设置页可选声明"优先选用提供零保留/不训练承诺的厂商"提示；项目自身不存储请求日志。
- **i18n 与流程**：UI 文案全走 `t()` 双语；AI 生成内容语言随 locale 由 prompt 控制；落地前按 SDD 补 `docs/specs/ai-features.md`；TDD 覆盖脱敏断言、SSE 解析（mock fetch）、端点校验；E2E 用 Playwright route mock 端点验证 UI 流。

## 8. 推荐路线图

| 阶段 | 内容 | 验收 |
|------|------|------|
| **Phase 1**（最小闭环） | 脱敏管道 + 设置页 AI 区（开关/端点/Key/模型/连接测试/发送预览）+ 阅读画像分析（洞察 + 审美点评，非流式、JSON schema、Zod、缓存） | 配置任意 OpenAI 兼容云端端点（BYOK），/profile 生成画像分析（fact 洞察卡 + taste 审美点评）；发送预览与实际 payload 一致；洞察数字与本地聚合一致；点评引用的书目全部来自发送书单；黑名单字段断言单测绿；AI 未启用时 UI 无 AI 痕迹 |
| **Phase 2**（画像叙事） | 年度总结叙事；流式输出、Abort、按 year/range 缓存 | 叙事数字与年度切片一致；脱敏断言覆盖画像场景 |
| **Phase 3**（可选） | 本地服务后端（Ollama/LM Studio，同一契约）作为"绝对隐私"选项 | 本地端点配置后同流程可用；未启动时明确错误提示 |

> Phase 1 取画像分析而非年度叙事：画像分析输出为结构化 JSON（`insight[]`，含事实洞察与审美点评条目）可强校验结构、UI 形态简单（卡片 + 点评段），契约最紧；年度叙事为自由文本流式，Phase 2 成熟。

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 云端信任边界（书名/兴趣必发） | 诚实承诺表述（§3.3）；发送预览；默认关闭；零保留厂商选项 |
| API Key 泄露（localStorage 明文） | 独立存储、不随备份导出、设置页提示；个人本地工具可接受 |
| CSP 放宽至任意 https | 仅 AI 启用路径发数据；记录取舍；保守用户可自托管 header 收紧 |
| 模型幻觉/质量波动 | prompt 限定信息来源；JSON schema + Zod；AI 生成标注；可重新生成；temperature 低。审美点评为自由文本，引用真实性不可强校验 → prompt 限定仅引用发送书单内书目（不虚构书名/作者），标注 AI 生成 + 可重新生成 |
| 本地服务（可选路径）未启动 | 连接测试 + 明确错误；功能级降级 |
| 断网时 AI 不可用 | AI 功能降级/禁用，核心功能不受影响；本地缓存可读 |
| 依赖供应链 | Phase 1 零新增依赖；后续引入包时过 `npm-supply-chain-security` + `pnpm verify`/`audit` |
| 与"不做批量"决策漂移 | 入口收敛单本/单页，不做列表级批量 |

## 10. 结论

1. **无现成实现，可差异化**：开源阅读生态（Literal/Openreads/BiblioReads/KOReader）均无 AI 层；最近参照是 Readwise Ghostreader 的"上下文最小化 + 可自定义 prompt + 引用定位"模式。
2. **云端高智能 + 脱敏是正解**：用户机器性能各异，本地推理能力参差、智能上限普遍低于云端前沿模型，无法作为统一主力；云端方案与机器性能解耦。anonymize-before-send 是行业标准模式，且本项目结构化数据使**字段级过滤即完整脱敏**（零依赖、比 NER 工具更可靠）。
3. **隐私边界诚实化**：脱敏保护直接标识符与行为细节；阅读兴趣（书名）因功能语义必然发送——由用户知情选择划定边界，而非承诺虚假的"完全不出设备"。
4. **UI 形态收敛**：消费端锚定数据语境——画像分析（洞察 + 审美点评）落在 `/profile`「AI 解读」区、年度叙事在年度视图、配置在 `/settings`；不新开 AI 页面、不做会话样式；AI 默认关闭时全站无 AI 痕迹（§6.3）。
5. **建议下一步**：按 SDD 补 `docs/specs/ai-features.md` 规格章节，从 Phase 1（脱敏管道 + 画像分析）落地；同步修订 design-decisions 技术选型表的本地 AI 预留位。

## 参考来源

（核实日期：2026-08-22）

**类似项目**：
- Readwise Ghostreader（个人内容 + 云端 AI、highlight 级上下文、可自定义 prompt、MCP）— https://docs.readwise.io/reader/guides/ghostreader/overview 、https://docs.readwise.io/reader/docs/faqs/ghostreader
- Literal（开源 Goodreads 替代，明确无 AI 层）— https://bookwiseapp.com/blog/literal-app-review-the-minimalist-social-book-tracker
- Openreads（开源隐私导向阅读追踪）— https://github.com/mateusz-bak/openreads
- BiblioReads（隐私优先 Goodreads 前端）— https://github.com/nesaku/BiblioReads
- KOReader 阅读历史统计插件 — https://omer-faruq.github.io/appstore.koplugin/
- StoryGraph（ML 推荐基于阅读历史）— https://apps.apple.com/au/app/storygraph-reading-tracker/id1570489264

**隐私技术**：
- anonymize-before-send 模式（sanitize before you send）— https://cborg.lbl.gov/security_pii/ 、https://www.red-gate.com/simple-talk/data-security-privacy-compliance/how-to-anonymize-pii-in-llm-pipelines-5-key-techniques-explained/
- Microsoft Presidio（开源 PII 检测/匿名化）— https://blog.xeynergy.com/redacting-pii-before-it-hits-the-llm-0fe9507f05e0
- 纯前端 PII 脱敏先例（浏览器内 100% 本地执行）— https://dev.to/prajyu/pii-redaction-built-entirely-in-the-browser-1i4d
- LLM 隐私体系框架（联邦/差分隐私/零保留定位）— https://www.mdpi.com/1999-4893/19/6/500
- 数据最小化与目的限制（GDPR 原则）— https://dualitytech.com/blog/llm-data-privacy/

**运行时（可选本地路径）**：
- Ollama API/FAQ（CORS 默认回环、`OLLAMA_ORIGINS`）— https://docs.ollama.com/faq
- LM Studio Developer Docs — https://lmstudio.ai/docs/developer
