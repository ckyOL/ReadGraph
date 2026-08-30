# AI 功能规格（阅读画像分析）

> 本文件由 [research/ai-integration-research.md](../research/ai-integration-research.md)（技术调研）衍生，遵循 SDD + TDD。调研确立的架构路线：**云端高智能 + 发送前脱敏（anonymize-before-send）为主力**，本地服务为可选后端（同一 OpenAI 兼容契约）；浏览器内推理（WebLLM / Transformers.js）已否决、模型选型不做建议（端点与模型是用户自己的事）。本规格只定义 **Phase 1** 落地契约（脱敏管道 + 设置页 AI 区 + 阅读画像分析）；Phase 2（年度叙事）、Phase 3（本地后端）边界见 §9。
> 关联：[design-decisions](../design-decisions.md)（纯前端/隐私原则）、[reading-profile](./reading-profile.md)（画像聚合契约）、[settings](./settings.md)（设置页落点）、[data-layer](./data-layer.md#8-用户偏好)（偏好持久化）、[npm-supply-chain-security](../npm-supply-chain-security.md)（依赖审查）。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 范围与依赖

**范围**：定义 AI 功能的默认关闭开关、脱敏管道（场景白名单装配 + 黑名单断言）、OpenAI 兼容端点薄客户端（fetch + SSE 解析 + Abort + 端点校验）、阅读画像分析（Markdown 文本洞察：2–4 小节 + 一句话总结，流式逐字渲染）、发送预览、结果缓存、设置页 AI 区。

**不实现**（本规格明确排除）：

- 年度总结叙事（Phase 2，§9.1）、本地服务后端（Phase 3，§9.2）
- 多轮对话 / 会话 UI（调研 §6.3 否决：用例均为单次生成，「即发即弃」与隐私承诺一致）
- 浏览器内推理（WebLLM / Transformers.js——调研 §4 删除该路线）
- 模型选型建议、默认端点、榜单（项目不提供）
- 单本/列表级批量点评（对齐 design-decisions §6「不做批量」；详情页单本点评入口已删除）

**依赖**（Phase 1）：`fetch` 薄封装 + 脱敏纯函数 + 既有 `zod`（场景 schema）。Markdown 渲染（§4.1）新增 `react-markdown` + `remark-gfm`，供应链审查结论归档见 [npm-supply-chain-security §3](../npm-supply-chain-security.md)；后续若再引入任何包，须先过同一清单审查 + `pnpm verify`/`audit`。

**代码落点**（调研 §7 草案）：

```
src/
├─ ai/
│  ├─ ai-provider.ts          # 接口：chat(messages, { schema?, stream?, signal? }) → 文本/JSON/流
│  ├─ ai-client.ts            # OpenAI 兼容 fetch 薄封装：SSE 解析、Abort、timeout、schema→response_format（纯函数可单测）
│  ├─ sanitize.ts             # 脱敏管道：场景 Schema → 白名单装配 + 黑名单断言（纯函数）
│  ├─ prompts/
│  │  ├─ profile-insights.ts  # 画像分析 prompt + 弱校验（markdown 文本：非空 + 长度上限）
│  │  └─ year-narrative.ts    # 年度总结叙事 prompt + 弱校验（Phase 2，仅落位）
│  └─ use-ai.ts               # Hook：编排、loading/error/重试、流式拼接、缓存
└─ lib/ai-cache.ts            # 生成结果缓存（localStorage，按场景+键+locale）
```

## 2. 全局契约与隐私承诺

1. **默认关闭**：`ai.enabled=false`；未启用时全站无 AI 痕迹（无入口、无文案、无区块）——区块条件渲染实现（调研 §6.3）。
2. **显式触发**：启用后仍只在用户点击生成时发数据，无后台/页面加载期调用。
3. **隐私承诺表述**（发送预览弹窗展示，i18n key `profile.ai.privacyNotice`；设置页不再重复展示，§4.2 控件行）：「只发送完成任务所需的最少字段；直接标识符（cardno/条码/馆名）与借阅行为细节（借还时点/频率/单条记录）永不发送；发送内容发送前可见可审」。
4. **诚实边界**：书名/作者/聚合统计必然发送（功能语义决定，无法脱敏）——承诺「最少字段」而非「完全不出设备」。
5. **不持久化原文**：云端原文不落本地；本地缓存仅存生成结果，标注「AI 生成，基于本地数据」。
6. **统计一致性**：发送的数值全部来自本地纯函数聚合（`computeProfileStats` 输出），LLM 只做语言转译，杜绝幻觉数字（design-decisions §6）。
7. **输入独立性**：生成输入只消费本地聚合 + 书目（脱敏书目字段（§3.2 每书字段集），全量），**不消费前一次 AI 输出**——防幻觉传播。

## 3. 脱敏管道（src/ai/sanitize.ts）

### 3.1 管道流程（调研 §5.1）

```
用户触发生成（默认关闭，显式启用）
  → ① 场景 Schema（Zod）声明所需字段（白名单）
  → ② 数据装配器：从 IndexedDB 只提取白名单字段
  → ③ 敏感字段断言：黑名单字段绝不出现在 payload（测试强制）
  → ④ 发送预览：UI 展示将发送的 payload JSON（与实际上送同一装配函数产物）
  → ⑤ POST 用户配置端点（OpenAI 兼容 /v1/chat/completions；stream:true + SSE，画像场景先行落地）（markdown 文本流，无 response_format）
  → ⑥ 响应 Zod 校验 → 渲染（标注「AI 生成，基于本地数据」）
  → ⑦ 云端原文不持久化；本地缓存仅存生成结果并标注
```

### 3.2 画像场景白名单（契约草案，Phase 1 唯一场景）

| 发送字段（白名单） | 永不发送（黑名单） |
|-------------------|-------------------|
| `summary.*`（藏书数/周期数/在借数/时长均值/中位数/借阅天数） | `cardno`、`barcode`、`metaId`/`metaIdKey`（馆内记录标识） |
| `classification`（Top 类目：name/code/category/value，取 `classificationSystem` 有效类目） | `borrowCycles` 单条记录（含 `borrowedAt`/`returnedAt` 时点） |
| `borrowVolume`（按月/年桶计数）、`durationDistribution`（时长桶计数） | `gantt` 区间明细、`calendar.days` 逐日明细（含借还时点） |
| `calendar.borrowDays`（聚合天数） | `rawRecords`、馆名/`Source` 名称、IP/读者证件类字段 |
| 全量书目：题名 + 副标题 + 作者 + 出版年份 + 出版社 + 单书分类（首选体系 code+类名）+ 编目主题词 `subjects` + 借阅次数（每书聚合 count）（超阈值降级见下） | 单条借阅记录、时间戳明细、`isbn13`/`isbn10`、`Book.price`/`pages`/`edition`、`tags`（用户个人标签）、`coverUrl`、`description`、`translators`、`parallelTitles` |

- 装配器直接消费 `computeProfileStats`（[reading-profile §2](./reading-profile.md#2-统计维度与聚合契约)）输出与 `Book` 题名/作者字段——统计永远由本地聚合产生，LLM 只做转译。
- **每书字段集**（题名/副标题/作者/出版年份/出版社/单书分类/主题词/借阅次数）与聚合统计同属白名单：分类取自 `CatalogRecord.classifications` 首选体系（与画像 treemap 同口径），借阅次数为本地聚合值（非单条记录）——**不发 `tags`（用户个人标签，泄露主观判断）、不发 `isbn13/10`（唯一标识符可跨库追踪）**；`price`/`pages`/`edition`/`translators`/`parallelTitles`/`coverUrl`/`description` 与品味判断无关或边际，Phase 1 不发。
- **全量书目而非 Top N**：品味点评需覆盖书目多样性——Top N 只暴露复借最多的高频书，系统性忽视「每本只借一次」的冷门分类/体裁，审美判断失真。全量量级可接受（个人档案典型数百本，每书条目约 100–200 字符，全量 10–400KB，云端上下文轻松容纳）；且书名/作者本就必然发送（调研 [../research/ai-integration-research.md](../research/ai-integration-research.md) §3.3 诚实边界），全量与 Top N 属同一字段类别，不新增隐私暴露面。**字段级最小化仍成立**：每书只发品味判断所需字段（§3.2 字段集），不发 ISBN/价格/条码/借还日期/个人标签。
- **极端档案防护**：书目数 ≤ `BOOKLIST_FULL_LIMIT`（默认 3000 本）直接全发；超过则降级为**按分类分层采样**（每分类按借阅次数取代表书目，总采样上限 500 本，保证分类多样性），发送预览标注「已采样（N/M 本）」。
- 聚合统计本身即匿名化（k-anonymity 思想）：桶计数无法反推单本借阅行为；**不发送 gantt / calendar 逐日明细**。
- **模型知识边界（诚实承诺）**：BYOK chat/completions 端点**无联网搜索**——模型基于训练记忆 + 发送字段生成。知名书点评可靠；冷门书（地方出版物/自编文献/小众翻译）训练数据稀疏，点评可能泛泛而谈。prompt 限定「仅可引用发送书单内的书目，不虚构书名/作者/情节」只能约束引用范围，**不能保证冷门书内容判断正确**——taste 条目标注「AI 生成，供参考」，用户可重新生成（调研 §9 模型幻觉风险缓解）。
- 审美点评（`kind='taste'`）与事实洞察共用同一白名单，不额外发送单本书目元数据（调研 §5.2）。

### 3.3 黑名单断言（测试强制）

- 装配产物 `serializePayload()` 纯函数：给定实体数组 → 仅含白名单字段。
- 黑名单**穷举断言**：构造含 cardno/barcode/借还日期/馆名/rawRecords 的数据，断言 payload 序列化文本中不出现任何黑名单值（逐个值断言，非抽样）。
- 发送预览与实际上送使用**同一装配函数产物**（防「预览一套、上送一套」漂移）。

## 4. 用例与 UI 设计说明

### 4.1 阅读画像分析（/profile「AI 解读」区，Phase 1）

- **落点**：价值卡行之下、图表 Tabs 之上，与价值卡行同构（窄卡、不卡片套卡片、不抢图表全幅）；整体可重新生成；标题行「重新生成」旁「清除 AI 缓存」按钮（仅已有结果时显示；结果缓存就地管理，自设置页移入，§4.2/§5.3）。
- **输出契约**（`src/ai/prompts/profile-insights.ts`，2026-08-25 由 JSON 条目切换）：**Markdown 纯文本**（2–4 个 `##` 小节 + 结尾「## 一句话总结」，关键数字 `**加粗**`）；弱校验 `validateProfileInsightsMarkdown`：非空 + 长度上限（`PROFILE_MARKDOWN_MAX_LENGTH`），空/超长抛 ZodError → validation 错误分级。
- **渲染**：`ReactMarkdown` + `remark-gfm` 单块排版（样式 `.ai-markdown`，`index.css`），块尾标注「AI 生成，基于本地数据」；**维度 chip → 图表 tab 引用定位交互已移除**（自由文本无可靠结构解析路径，验收故事 #4 修订）。
- **口径**：固定全量口径（与概览卡一致），**不与 range 联动**——避免 range 切换反复调用 API；缓存键含 range 以预留联动（§5.3）。
- **幻觉控制**：prompt 限定「仅可引用发送书单内的书目，不虚构书名/作者/情节」；数字只转译不生成；temperature 低；自由文本的引用真实性**不可强校验**——规格明示诚实边界。
- **端点容错**（2026-08-25）：SSE 解析为**行独立事件**宽松语义——每行 `data:` 独立成事件（空行/字段行/注释/下一个 data 行均结束当前事件，兼容单换行分隔端点），裸 JSON 行（无 `data:` 前缀）容错为事件值，`choices[0].message.content` 兼容（整体 JSON 被分块传输的端点）；规范多行 data 拼接语义不做支持（OpenAI 兼容端点均为单行 data 事件）。骨架屏仅存于 TTFB/首 token 窗口，窗口内显示「生成中」文案。
- **thinking 模型（qwen3-reasoning / deepseek-r1 等）**：`delta.reasoning_content` 思考过程经独立通道（`ChatStreamDelta.kind='reasoning'`）渐进渲染为灰色思考块（`profile-ai-reasoning`，**默认折叠**，点标题展开后内容随流式增长），仅展示不参与定稿/缓存；思考期间字节不断流，空闲超时不会误杀长思考。
- **流式交互（2026-08-26，借鉴 AI 界共识模式）**：
  - **停止生成**：流式中占位条内嵌「停止生成」按钮（`profile-ai-stop`）——AbortController 中止请求；**主动停止静默处理**：保留已生成的部分内容（提升为结果展示，不写缓存、不置 error、不 toast），可重新生成。
  - **打字光标**：流式内容尾部静态 `▍` 指示（`profile-ai-caret`，无闪烁动效——对齐 DESIGN §4.5 无动效约束），定稿后消失。
  - **复制结果**：定稿后标题行「复制」按钮（`profile-ai-copy`）——`navigator.clipboard.writeText` + 已复制 toast。
- 不做列表级批量（对齐 design-decisions §6）。
- 不做列表级批量（对齐 design-decisions §6）。
- 不做列表级批量（对齐 design-decisions §6）。

### 4.2 设置页 AI 区（/settings，Phase 1）

- 布局：设置页偏好区/数据区之间新增 AI 区，`border-t` 分隔，不嵌套卡片（对齐 [settings §7](./settings.md#7-ui-设计说明)）。
- 控件：启用开关（默认关）→ 启用后展开：端点 URL（默认空，**「测试并获取模型」按钮内联于端点输入行**——连通性验证 + 抓取模型列表，中英文案 `settings.ai.test`）、API Key（可选、`Password` 输入）、模型名（**连接测试后从端点 `/v1/models` 列表选择**，模型为空时自动选中列表首项；端点未提供列表时回退手输）、「发送预览」开关（默认开）；「清除 AI 缓存」移入 `/profile` AI 解读区（§4.1），设置页不设隐私承诺段落——完整文案在发送预览弹窗展示（§2.3）。
- **连接测试**：`GET {baseUrl}/v1/models`（带 `Authorization: Bearer <key>`，无 key 时也允许测试以支持本地无鉴权端点）；2xx 返回模型 ID 列表（`data[].id`，兼容顶层 `[{id}]`，去重）供模型下拉；列表为空（响应结构不兼容）→ toast 提示可手输；失败 toast 明确错误（网络/鉴权/非 OpenAI 兼容端点）。
- 端点变更（URL 输入变化）→ 已抓取模型列表失效清空、**已保存模型名（`ai.model`）一并清除**，需重新测试连接获取。
- 模型列表**跨会话持久化**：测试连接抓取的模型 ID 列表存独立 `localStorage` key（`readgraph:ai-model-list`，见 §5.1），下次进入设置页仍可用；**端点变更即清除**（与上条一致，旧端点列表不污染新端点）。
- 未配置端点/未启用时，`/profile` AI 解读区不渲染（§2.1）。
- 本地服务路径（Phase 3）同属本区：端点填 `http://127.0.0.1:*`，连接测试即验证。

### 4.3 发送预览

- 各生成入口**首次触发**时展示：将发送的 payload JSON（`<pre>` 等宽可折叠）+ 「仅发送以上内容」确认/取消；与实际上送同一装配函数产物（§3.3）。
- 设置页「发送预览」开关关闭后，后续生成不再弹预览（一次性确认，不重复打扰）。

## 5. 数据契约与边界

### 5.1 偏好持久化（扩展 data-layer §8）

- `userPreferencesSchema` 扩展 `ai: { enabled: boolean; baseUrl: string; model: string }`（默认 `{ enabled: false, baseUrl: '', model: '' }`，校验非空字符串；非法值降级默认，对齐 [data-layer §8](./data-layer.md#8-用户偏好)）。
- **模型列表独立存储**（同类）：存独立 `localStorage` key `readgraph:ai-model-list`（`string[]`），不进 `userPreferencesSchema`、不随备份导出；测试连接成功后写入，端点 URL 变更即清除，系统重置 `clearPreferences=true` 时一并清除。
- 系统重置 `clearPreferences=true` 时一并清除 AI 配置与 Key；`/settings` 另提供单独清除。
- 系统重置 `clearPreferences=true` 时一并清除 AI 配置与 Key；`/settings` 另提供单独清除。

### 5.2 CSP 放宽（vite.config.ts 注释记录）

- `connect-src` 由 `'self' + OPAC 域名` 增加 `https:`（用户 BYOK 任意云端端点，构建期静态化无法按用户配置动态放行）+ `http://127.0.0.1:*`（本地服务路径）。
- 取舍记录：放宽面为任意 https 端点，但数据只在用户**显式启用 AI 并触发功能**时发送；保守用户可自托管 header 收紧。注释落 `vite.config.ts`。

### 5.3 结果缓存（src/lib/ai-cache.ts）

- 缓存键：`ai:{scene}:{locale}:{key}`（画像场景 key 含 range 以预留联动；Phase 1 全量口径固定键）。缓存内容：生成结果（markdown 文本字符串）+ 生成时间戳。**2026-08-25 格式切换**：缓存键 bump 为 `all-v2`（旧 JSON 条目缓存自动失效，重新生成即可）。
- 生命周期：localStorage，/profile AI 解读区「清除 AI 缓存」可清（§4.1）；**不随备份导出**。
- 命中缓存直接渲染（仍标注「AI 生成」）；断网时缓存可读（AI 功能降级提示，核心功能不受影响）。

### 5.4 端点契约与降级

- 端点：用户配置的 OpenAI 兼容 `{baseUrl}/v1/chat/completions`；`baseUrl` 去尾斜杠；**已含 `/v1` 后缀（如 placeholder `https://api.example.com/v1`）自动识别、不重复拼接**（网关前缀路径如 `/proxy/v1` 同样保留前缀且不叠加）；不支持空端点调用（连接测试除外）。
- 错误分级：未启用/未配置（入口不渲染）、网络失败/超时（`AbortController` 超时 + 可重试：**chat 60s `CHAT_TIMEOUT_MS`（TTFB 与「无字节空闲」双窗口：收到响应字节即重置，thinking 模型长思考不断流不误杀）、连接测试 15s `DEFAULT_TIMEOUT_MS`**——云端 LLM 生成耗时远超连接测试，15s 易误伤）、HTTP 非 2xx（含 401/429）、响应 Zod 校验失败——UI 均 toast 明确文案（**/profile 错误 toast 附诊断 message**：401/429/HTTP 状态/CORS 区分；超时 AbortError 给「请求超时」文案，避免固定 network 文案把鉴权失败误报成跨域），不写库、不缓存失败结果。**fetch `TypeError`（端点不可达 / 跨域 CORS 拦截）归一为 `AiNetworkError`，与超时 `AbortError` 区分**；连接测试 toast 对 CORS 给出可操作指引（云端端点需支持 CORS、本地服务放行来源、或自托管反代）。
- 断网：AI 区块降级/禁用提示，页面其余功能不受影响（对齐「纯前端离线可用」主原则）。
- **CORS 与代理**：`pnpm dev` 下 AI 请求经 Vite 同源代理（`vite.config.ts` `aiDevProxyPlugin`，路径 `/__ai-proxy/<encodeURIComponent(完整 URL)>`）转发任意 https / http 回环端点，同源消除 CORS（前端 `buildRequestUrl` 挂代理路径，构建期 `__AI_DEV_PROXY__` 开关仅 dev 开启）；**生产构建 / preview / E2E 直连**——云端端点需支持 CORS，否则沿用 `AiNetworkError` 指引（换端点或自托管反代）。代理仅放行 https 与 http 回环地址（拒绝任意 http 内网目标）；上游失败中断连接 → 浏览器 fetch `TypeError` → 前端归一 `AiNetworkError`（与直连语义一致）。E2E 有意以跨源 mock 验证真实 CORS 预检流程，不受 dev 代理影响。

## 6. 用户故事与验收用例（Phase 1）

1. 作为新用户，未启用 AI → `/profile` 无任何 AI 痕迹（无「AI 解读」区、无入口文案），`/settings` 仅有默认关闭的 AI 区开关。
2. 作为用户，在 `/settings` 填入任意 OpenAI 兼容端点（BYOK）与模型名、保存 → 点「测试连接」→ 端点可达时成功、不可达/鉴权失败时明确错误 toast；刷新后配置保留。
3. 作为用户，首次在 `/profile` 触发「AI 解读」→ 弹出发送预览，展示将发送的 payload；确认后生成 Markdown 洞察（2–4 小节 + 一句话总结），数字与本地概览卡一致；响应标注「AI 生成」。
4. 作为用户，点「重新生成」→ 再次走发送预览（或按预览开关直接生成）并覆盖结果（维度 chip 引用定位已随 Markdown 切换移除，见 §4.1）。
5. 作为用户，生成成功后切换中英 locale → 缓存按 locale 隔离，各自生成对应语言内容（prompt 控制）；再次进入同 locale → 命中缓存秒开（可重新生成覆盖）。
6. 作为用户，断网/端点不可用触发生成 → 明确错误提示，不写库、不缓存失败；已有缓存结果仍可读。
7. 作为用户，在 `/settings` 清除 AI 缓存 → 再进入 `/profile` 需重新生成。

**Phase 1 验收**（调研 §8）：配置任意 OpenAI 兼容云端端点（BYOK）→ `/profile` 生成画像分析（fact 洞察卡 + taste 审美点评）；发送预览与实际 payload 一致；洞察数字与本地聚合一致；点评引用的书目全部来自发送书单；黑名单断言单测绿；AI 未启用时 UI 无 AI 痕迹。

## 7. 测试清单

**Vitest（单元/集成，Phase 1 Red→Green）**

- `sanitize.ts` 脱敏断言：给定含 cardno/barcode/借还日期/馆名/rawRecords/单条周期的实体数组 → payload 仅含白名单字段；黑名单值在序列化文本中**逐值穷举**断言不出现；`serializePayload` 同输入两次调用深等价（纯函数性）。
- `sanitize.ts` 每书字段：payload 中每书含题名/作者/借阅次数且不含 `isbn13`/`tags`/`price`/借还日期（字段级断言）；借阅次数来自本地聚合（与 `profile-stats` 同源计数一致）。
- `sanitize.ts` 装配边界：空库/无借阅时 payload 结构完整（`books=[]`）；分类缺失归并；书目 ≤ `BOOKLIST_FULL_LIMIT` 时全量进 payload（与源 Book 一一对应）；超过阈值触发分层采样降级（每分类取代表、总上限 500、标注采样标记），采样集覆盖全部分类（无空分类桶）。
- `ai-client.ts` `chatStream()`：`stream:true` 请求构造（body/URL/headers 同 `chat`，**body 无 `response_format`**）；mock fetch 分片 `ReadableStream` 增量产出 `delta.content`；`[DONE]` 终止；**端点容错**——单换行分隔（无空行）逐事件产出、裸 JSON 行产出、整体 JSON 分块（message.content 形态）收尾产出；**thinking 分块（reasoning_content）产出 kind='reasoning' 增量**；**空闲超时**——慢速分片（间隔 < 60s）不中断、无字节窗口 > 60s 中止；HTTP 非 2xx / 超时 / TypeError 分级复用（与 `chat` 同一错误归一）。
- `profile-insights.ts` 弱校验：`validateProfileInsightsMarkdown` 接受非空 markdown（trim 归一）、拒绝空/纯空白/超长（抛 ZodError）；prompt 模板只含白名单变量（无黑名单字段名）+ 显式输出纯 Markdown 指令（无 JSON 格式要求）。
- `ai-provider.ts` 契约：`chat(messages, { schema })` 响应过 schema 校验，非法响应抛 `ZodError`；`chatStream(messages)` 绑定配置产出内容增量（流完整拼接 == 非流式 content）。
- `insight-pipeline.ts`：`submit` 的 `onPartial` 回调透传 markdown 文本增量（增量渲染钩子，成功/失败语义不变）。
- `profile-insights.ts`：`validateProfileInsightsMarkdown` 弱校验（非空 + 长度上限）；prompt 模板只含白名单变量（无黑名单字段名）。
- `ai-cache.ts`：缓存键含 scene/locale/key；写读回环；清除只删 `ai:` 前缀键；不随 `exportDatabase` 导出。
- 偏好扩展：`ai` 非法值（如 `baseUrl` 非字符串）降级默认；`readgraph:ai-api-key` 独立读写、不进 `userPreferencesSchema`。

**Playwright（E2E，统一 UI 里程碑接入）**

- 流式（`chatStream`）：chat 请求 body `stream:true`（无 `response_format`）；SSE 分片响应（`text/event-stream` data 行 + `[DONE]`）→ 最终 markdown 渲染成功。逐字流式时序断言归 Vitest（onPartial 字符串透传 + Hook 单测），E2E 不依赖时序。

## 8. React 性能规则引用

- `client-localstorage-schema`：`ai` 偏好与 Key 读写过 schema 校验（`userPreferencesSchema` 扩展 + 独立 Key key），避免脏值；Key 不进 React 状态持久化。
- `bundle-barrel-imports` / `bundle-dynamic-imports`：`src/ai/` 与 `ai-cache` 在 `/profile`、`/settings` 激活时动态加载（AI 默认关闭时不被主包拉入）。
- `rendering-conditional-render`：AI 解读区按 `ai.enabled` + 结果态条件渲染（三元），未启用/空态无 AI 痕迹；不渲染空壳。
- `rerender-transitions`：生成触发与重新生成用 loading 态（`Skeleton` 占位 + 按钮禁用），不阻塞页面其余渲染。
- 装配器与聚合为纯函数，单遍 `Map` 建索引（复用 [reading-profile §8](./reading-profile.md#8-react-性能规则引用) 的 `js-index-maps` 取向），无重复线性查找。

## 9. Phase 2 / Phase 3 边界

### 9.1 Phase 2：年度总结叙事 + 流式

- **年度视图落点**：`/profile/$year`（新路由，方向 B 图谱语言；路由树预留见 [ui-navigation §2](./ui-navigation.md#2-路由树)）。年度视图 = **静态骨架 + 叙事区**：
  - 静态骨架（非 AI，本地直出）：年度书单 + 最常借 Top N（bookology-benchmark §5.3 年度回顾）+ 年度目标进度卡（bookology-benchmark §5.2，目标值落 `UserPreferences`，进度 = `yearSlice.bookCount`）——数字与叙事同源；
  - **「年度叙事」AI 区**：与 /profile「AI 解读区」同构（fact/taste、AI 生成标注、重新生成、发送预览），是年度视图内的区块而非独立孤岛。
- **输入契约**：`computeYearSlice` 切片指标（[reading-profile §2.7](./reading-profile.md#2-统计维度与聚合契约) 年度切片契约；口径 = bookology-benchmark §6 语义边界：`borrowedAt ∈ 本年` UTC 左闭右开、独立 Book 去重、设备排除、不依赖 `status='returned'`）+ 年度切片内**全量**书目题名/作者（与 §3.2 同一白名单形态，切片规模更小，通常远低于阈值）→ 叙事段落（「今年借阅 23 本、最爱文学类、复借最多的是《X》…」）。叙事、目标卡、回顾三个消费方共用同一 `yearSlice` 产物——数字同源，LLM 只转译（§2.6 统计一致性）。
- **白名单边界**：年度场景 = 同一白名单形态（§3.2 每书字段集 + `yearSlice` 聚合输出），切片替代全量；**年度目标值（`UserPreferences` 用户设置）不进 payload**——非聚合统计、非书目字段，叙事不提「距目标还差 N 本」；如需纳入须显式扩展白名单并声明。
- 流式输出（`stream:true` + SSE 拼接——画像场景已先行落地同一链路，见 §4.1）、`Abort`、按 year/range/locale 缓存；年度叙事与画像同为 **Markdown 文本流**（共用 ReactMarkdown + `.ai-markdown` 渲染，见 §4.1），呈现粒度逐字。
- 脱敏断言覆盖年度场景（与 §3.2 同白名单形态，切片替代全量）；`prompts/year-narrative.ts` 就位。

### 9.2 Phase 3：本地服务后端（可选）

- Ollama / LM Studio 等 OpenAI 兼容本地端点，同一契约零成本共存（`baseUrl` 配 `http://127.0.0.1:*` 即切换）。
- 未启动时连接测试 + 明确错误提示；功能级降级（§5.4）。
（Phase 3 落地细化，2026-08-30）
- **回环端点判定**：`isLoopbackEndpoint(baseUrl)` 导出纯函数——`http:` 协议 + hostname ∈ `{127.0.0.1, localhost, ::1, [::1]}`（URL 解析后比对；带端口/路径不影响判定）。云端 https 恒为 false。
- **未启动错误分级**（§5.4 增量）：本地服务未启动时 fetch `TypeError` 与 CORS 同形，无法按错误本体区分——以端点形态分级：请求目标为回环 http 端点时，`AiNetworkError` 携带本地服务指引（「本地服务未启动或未放行来源：请确认服务已启动（如 Ollama `ollama serve`），检查端口，必要时设 `OLLAMA_ORIGINS` 放行本应用来源」）；否则沿用云端 CORS/代理文案。
- **CSP 回环集合**：`connect-src` 回环面 = `http://127.0.0.1:*` + `http://localhost:*`（dev 同源代理放行集合对齐）。**不含 `http://[::1]:*`**：CSP3 host-part 产生式不支持 IP 字面量（spec 备注 future version may allow literal IPv6/IPv4），Chromium 对该源报 invalid source；IPv6 回环由 `localhost` 覆盖。dev 代理（Node 侧无 CSP 约束）仍放行 `[::1]`。
- **连接测试即验证**：本地路径无新增 UI——设置页既有「测试并获取模型」即 Phase 3 验证入口；连接失败 toast 按上述分级给文案。
- CORS 前提：Ollama 默认回环放行（`OLLAMA_ORIGINS` 可扩展，[调研参考](../research/ai-integration-research.md#参考来源)）；LM Studio 同契约。

## 10. 待办关联

- 任务分解与 Phase 1 落地清单见 [tasks/ai-features-batch.md](../tasks/ai-features-batch.md)（汇集调研 §8 路线图与本规格 §9 阶段边界）；规格索引状态见 [app-spec §6](../app-spec.md#6-功能规格索引) #11。
- 落地前须完成：`vite.config.ts` CSP 注释记录（§5.2）；`userPreferencesSchema` 扩展（§5.1，随 [data-layer](./data-layer.md) 迁移/升级流程走 [internal-schema 版本化](../metadata/internal-schema.md)）。
- 调研文档遗留：design-decisions 技术选型表「本地 AI 预留位」与本规格同步修订（已修订，见 [design-decisions](../design-decisions.md)）。调研文档遗留：design-decisions 技术选型表「本地 AI 预留位」与本规格同步修订（已修订，见 [design-decisions](../design-decisions.md)）。
