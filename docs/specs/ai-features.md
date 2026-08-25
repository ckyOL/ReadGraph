# AI 功能规格（阅读画像分析）

> 本文件由 [research/ai-integration-research.md](../research/ai-integration-research.md)（技术调研）衍生，遵循 SDD + TDD。调研确立的架构路线：**云端高智能 + 发送前脱敏（anonymize-before-send）为主力**，本地服务为可选后端（同一 OpenAI 兼容契约）；浏览器内推理（WebLLM / Transformers.js）已否决、模型选型不做建议（端点与模型是用户自己的事）。本规格只定义 **Phase 1** 落地契约（脱敏管道 + 设置页 AI 区 + 阅读画像分析）；Phase 2（年度叙事 / 流式）、Phase 3（本地后端）边界见 §9。
> 关联：[design-decisions](../design-decisions.md)（纯前端/隐私原则）、[reading-profile](./reading-profile.md)（画像聚合契约）、[settings](./settings.md)（设置页落点）、[data-layer](./data-layer.md#8-用户偏好)（偏好持久化）、[npm-supply-chain-security](../npm-supply-chain-security.md)（依赖审查）。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 范围与依赖

**范围**：定义 AI 功能的默认关闭开关、脱敏管道（场景白名单装配 + 黑名单断言）、OpenAI 兼容端点薄客户端（fetch + SSE 解析 + Abort + 端点校验）、阅读画像分析（`insight[]`：`kind='fact'` 事实洞察 + `kind='taste'` 审美点评，同次生成、同一 Zod schema 强校验）、发送预览、结果缓存、设置页 AI 区。

**不实现**（本规格明确排除）：

- 年度总结叙事（Phase 2，§9.1）、本地服务后端（Phase 3，§9.2）
- 多轮对话 / 会话 UI（调研 §6.3 否决：用例均为单次生成，「即发即弃」与隐私承诺一致）
- 浏览器内推理（WebLLM / Transformers.js——调研 §4 删除该路线）
- 模型选型建议、默认端点、榜单（项目不提供）
- 单本/列表级批量点评（对齐 design-decisions §6「不做批量」；详情页单本点评入口已删除）

**依赖**（Phase 1）：**零新增运行时依赖**——`fetch` 薄封装 + 脱敏纯函数 + 既有 `zod`（响应校验、场景 schema）。后续若引入任何包，须先过 [npm-supply-chain-security §3](../npm-supply-chain-security.md) 审查 + `pnpm verify`/`audit`。

**代码落点**（调研 §7 草案）：

```
src/
├─ ai/
│  ├─ ai-provider.ts          # 接口：chat(messages, { schema?, stream?, signal? }) → 文本/JSON/流
│  ├─ ai-client.ts            # OpenAI 兼容 fetch 薄封装：SSE 解析、Abort、timeout、schema→response_format（纯函数可单测）
│  ├─ sanitize.ts             # 脱敏管道：场景 Schema → 白名单装配 + 黑名单断言（纯函数）
│  ├─ prompts/
│  │  ├─ profile-insights.ts  # 画像分析 prompt + Zod schema（insight[]，fact/taste 条目）
│  │  └─ year-narrative.ts    # 年度总结叙事 prompt + Zod schema（Phase 2，仅落位）
│  └─ use-ai.ts               # Hook：编排、loading/error/重试、流式拼接（Phase 2）、缓存
└─ lib/ai-cache.ts            # 生成结果缓存（localStorage，按场景+键+locale）
```

## 2. 全局契约与隐私承诺

1. **默认关闭**：`ai.enabled=false`；未启用时全站无 AI 痕迹（无入口、无文案、无区块）——区块条件渲染实现（调研 §6.3）。
2. **显式触发**：启用后仍只在用户点击生成时发数据，无后台/页面加载期调用。
3. **隐私承诺表述**（设置页与发送预览共用 i18n 文案）：「只发送完成任务所需的最少字段；直接标识符（cardno/条码/馆名）与借阅行为细节（借还时点/频率/单条记录）永不发送；发送内容发送前可见可审」。
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
  → ⑤ POST 用户配置端点（OpenAI 兼容 /v1/chat/completions；Phase 1 stream:false）
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

- **落点**：价值卡行之下、图表 Tabs 之上，与价值卡行同构（窄卡、不卡片套卡片、不抢图表全幅）；整体可重新生成。
- **输出契约**（`src/ai/prompts/profile-insights.ts`，Zod 强校验）：

```ts
interface AIInsight {
  kind: 'fact' | 'taste'       // taste 条目即审美点评（调研 §6.1）
  title?: string               // 仅 fact：洞察标题（如「偏爱文学类」）
  body: string                 // fact 为陈述+数字；taste 为一段评价性文字
  dimension?: string           // 仅 fact：关联维度 chip（分类偏好/借阅节奏/时长习惯/复借最多…）
}
```

- 生成 2–4 条洞察（含 0–1 条 `taste`）：fact 渲染为窄卡（标题+正文+维度 chip，点击激活对应图表 tab = 引用定位）；taste 渲染为一段全宽评价文字（Phase 1 非流式整段呈现，Phase 2 逐句流式）。
- **口径**：固定全量口径（与概览卡一致），**不与 range 联动**——避免 range 切换反复调用 API；缓存键含 range 以预留联动（§5.3）。
- **幻觉控制**：prompt 限定「仅可引用发送书单内的书目，不虚构书名/作者/情节」；数字只转译不生成；temperature 低；`kind='taste'` 自由文本的引用真实性**不可强校验**——规格明示诚实边界（区别于 fact 条目的数字强校验）。
- **非流式**（Phase 1）：`stream:false` + `response_format` JSON 模式，响应过 `insightSchema.safeParse`，失败提示重试。
- 不做列表级批量（对齐 design-decisions §6）。

### 4.2 设置页 AI 区（/settings，Phase 1）

- 布局：设置页偏好区/数据区之间新增 AI 区，`border-t` 分隔，不嵌套卡片（对齐 [settings §7](./settings.md#7-ui-设计说明)）。
- 控件：启用开关（默认关）→ 启用后展开：端点 URL（默认空）、API Key（可选、`Password` 输入）、模型名（**连接测试后从端点 `/v1/models` 列表选择**，模型为空时自动选中列表首项；端点未提供列表时回退手输）、「测试连接」按钮、隐私说明（§2.3 文案）、「发送预览」开关（默认开）、「清除 AI 缓存」。
- **连接测试**：`GET {baseUrl}/v1/models`（带 `Authorization: Bearer <key>`，无 key 时也允许测试以支持本地无鉴权端点）；2xx 返回模型 ID 列表（`data[].id`，兼容顶层 `[{id}]`，去重）供模型下拉；列表为空（响应结构不兼容）→ toast 提示可手输；失败 toast 明确错误（网络/鉴权/非 OpenAI 兼容端点）。
- 端点变更（URL 输入变化）→ 已抓取模型列表失效清空，需重新测试连接获取。
- 未配置端点/未启用时，`/profile` AI 解读区不渲染（§2.1）。
- 本地服务路径（Phase 3）同属本区：端点填 `http://127.0.0.1:*`，连接测试即验证。

### 4.3 发送预览

- 各生成入口**首次触发**时展示：将发送的 payload JSON（`<pre>` 等宽可折叠）+ 「仅发送以上内容」确认/取消；与实际上送同一装配函数产物（§3.3）。
- 设置页「发送预览」开关关闭后，后续生成不再弹预览（一次性确认，不重复打扰）。

## 5. 数据契约与边界

### 5.1 偏好持久化（扩展 data-layer §8）

- `userPreferencesSchema` 扩展 `ai: { enabled: boolean; baseUrl: string; model: string }`（默认 `{ enabled: false, baseUrl: '', model: '' }`，校验非空字符串；非法值降级默认，对齐 [data-layer §8](./data-layer.md#8-用户偏好)）。
- **API Key 独立存储**：存独立 `localStorage` key `readgraph:ai-api-key`，不进入 `userPreferencesSchema`、不随偏好读写/备份导出（`ExportData` 只含六张表，[data-layer §7](./data-layer.md#7-数据导出与重建)）；调用时读入内存参与请求头，不进入 React 状态持久化。
- 系统重置 `clearPreferences=true` 时一并清除 AI 配置与 Key；`/settings` 另提供单独清除。

### 5.2 CSP 放宽（vite.config.ts 注释记录）

- `connect-src` 由 `'self' + OPAC 域名` 增加 `https:`（用户 BYOK 任意云端端点，构建期静态化无法按用户配置动态放行）+ `http://127.0.0.1:*`（本地服务路径）。
- 取舍记录：放宽面为任意 https 端点，但数据只在用户**显式启用 AI 并触发功能**时发送；保守用户可自托管 header 收紧。注释落 `vite.config.ts`。

### 5.3 结果缓存（src/lib/ai-cache.ts）

- 缓存键：`ai:{scene}:{locale}:{key}`（画像场景 key 含 range 以预留联动；Phase 1 全量口径固定键）。缓存内容：生成结果 JSON + 生成时间戳。
- 生命周期：localStorage，设置页「清除 AI 缓存」可清；**不随备份导出**。
- 命中缓存直接渲染（仍标注「AI 生成」）；断网时缓存可读（AI 功能降级提示，核心功能不受影响）。

### 5.4 端点契约与降级

- 端点：用户配置的 OpenAI 兼容 `{baseUrl}/v1/chat/completions`；`baseUrl` 去尾斜杠；**已含 `/v1` 后缀（如 placeholder `https://api.example.com/v1`）自动识别、不重复拼接**（网关前缀路径如 `/proxy/v1` 同样保留前缀且不叠加）；不支持空端点调用（连接测试除外）。
- 错误分级：未启用/未配置（入口不渲染）、网络失败/超时（`AbortController` 超时 + 可重试：**chat 60s `CHAT_TIMEOUT_MS`、连接测试 15s `DEFAULT_TIMEOUT_MS`**——云端 LLM 生成耗时远超连接测试，15s 易误伤）、HTTP 非 2xx（含 401/429）、响应 Zod 校验失败——UI 均 toast 明确文案（**/profile 错误 toast 附诊断 message**：401/429/HTTP 状态/CORS 区分；超时 AbortError 给「请求超时」文案，避免固定 network 文案把鉴权失败误报成跨域），不写库、不缓存失败结果。**fetch `TypeError`（端点不可达 / 跨域 CORS 拦截）归一为 `AiNetworkError`，与超时 `AbortError` 区分**；连接测试 toast 对 CORS 给出可操作指引（云端端点需支持 CORS、本地服务放行来源、或自托管反代）。
- 断网：AI 区块降级/禁用提示，页面其余功能不受影响（对齐「纯前端离线可用」主原则）。
- **CORS 与代理**：`pnpm dev` 下 AI 请求经 Vite 同源代理（`vite.config.ts` `aiDevProxyPlugin`，路径 `/__ai-proxy/<encodeURIComponent(完整 URL)>`）转发任意 https / http 回环端点，同源消除 CORS（前端 `buildRequestUrl` 挂代理路径，构建期 `__AI_DEV_PROXY__` 开关仅 dev 开启）；**生产构建 / preview / E2E 直连**——云端端点需支持 CORS，否则沿用 `AiNetworkError` 指引（换端点或自托管反代）。代理仅放行 https 与 http 回环地址（拒绝任意 http 内网目标）；上游失败中断连接 → 浏览器 fetch `TypeError` → 前端归一 `AiNetworkError`（与直连语义一致）。E2E 有意以跨源 mock 验证真实 CORS 预检流程，不受 dev 代理影响。

## 6. 用户故事与验收用例（Phase 1）

1. 作为新用户，未启用 AI → `/profile` 无任何 AI 痕迹（无「AI 解读」区、无入口文案），`/settings` 仅有默认关闭的 AI 区开关。
2. 作为用户，在 `/settings` 填入任意 OpenAI 兼容端点（BYOK）与模型名、保存 → 点「测试连接」→ 端点可达时成功、不可达/鉴权失败时明确错误 toast；刷新后配置保留。
3. 作为用户，首次在 `/profile` 触发「AI 解读」→ 弹出发送预览，展示将发送的 payload；确认后生成 2–4 条洞察，fact 卡数字与本地概览卡一致，taste 为一段评价文字；响应标注「AI 生成」。
4. 作为用户，点击 fact 卡维度 chip → 激活对应图表 tab（引用定位）；点「重新生成」→ 再次走发送预览（或按预览开关直接生成）并覆盖结果。
5. 作为用户，生成成功后切换中英 locale → 缓存按 locale 隔离，各自生成对应语言内容（prompt 控制）；再次进入同 locale → 命中缓存秒开（可重新生成覆盖）。
6. 作为用户，断网/端点不可用触发生成 → 明确错误提示，不写库、不缓存失败；已有缓存结果仍可读。
7. 作为用户，在 `/settings` 清除 AI 缓存 → 再进入 `/profile` 需重新生成。

**Phase 1 验收**（调研 §8）：配置任意 OpenAI 兼容云端端点（BYOK）→ `/profile` 生成画像分析（fact 洞察卡 + taste 审美点评）；发送预览与实际 payload 一致；洞察数字与本地聚合一致；点评引用的书目全部来自发送书单；黑名单断言单测绿；AI 未启用时 UI 无 AI 痕迹。

## 7. 测试清单

**Vitest（单元/集成，Phase 1 Red→Green）**

- `sanitize.ts` 脱敏断言：给定含 cardno/barcode/借还日期/馆名/rawRecords/单条周期的实体数组 → payload 仅含白名单字段；黑名单值在序列化文本中**逐值穷举**断言不出现；`serializePayload` 同输入两次调用深等价（纯函数性）。
- `sanitize.ts` 每书字段：payload 中每书含题名/作者/借阅次数且不含 `isbn13`/`tags`/`price`/借还日期（字段级断言）；借阅次数来自本地聚合（与 `profile-stats` 同源计数一致）。
- `sanitize.ts` 装配边界：空库/无借阅时 payload 结构完整（`books=[]`）；分类缺失归并；书目 ≤ `BOOKLIST_FULL_LIMIT` 时全量进 payload（与源 Book 一一对应）；超过阈值触发分层采样降级（每分类取代表、总上限 500、标注采样标记），采样集覆盖全部分类（无空分类桶）。
- `ai-client.ts`：`chat()` 构造正确 URL/headers/body（`Authorization` 仅在有 Key 时携带；`baseUrl` 去尾斜杠；**`/v1` 结尾不重复拼接**；`buildRequestUrl`：dev 代理前缀编码 / 生产直连）；`stream:false` 普通 JSON 响应解析；**SSE 响应解析**（mock fetch 返回分片 `data:` 行：完整事件、事件间空行、`[DONE]`、断行重组）；Abort 中断抛 `AbortError`；超时触发 abort；HTTP 非 2xx 抛带状态错误；无鉴权端点（无 Key）请求不带头；**fetch `TypeError` → `AiNetworkError`（端点不可达 / CORS 拦截）**。
- `ai-provider.ts` 契约：`chat(messages, { schema })` 响应过 schema 校验，非法响应抛 `ZodError`。
- `profile-insights.ts`：`insightSchema` 接受合法 fact/taste 条目、拒绝缺 `kind`/`body` 或非法 `kind`；prompt 模板只含白名单变量（无黑名单字段名）。
- `ai-cache.ts`：缓存键含 scene/locale/key；写读回环；清除只删 `ai:` 前缀键；不随 `exportDatabase` 导出。
- 偏好扩展：`ai` 非法值（如 `baseUrl` 非字符串）降级默认；`readgraph:ai-api-key` 独立读写、不进 `userPreferencesSchema`。

**Playwright（E2E，统一 UI 里程碑接入）**

- route mock 端点：未启用 AI → `/profile` 无 AI 区块；启用 + 触发 → 预览内容与实际请求 body 一致（拦截断言）；确认后渲染 fact 卡 + taste 段；taste/fact 均标注 AI 生成；重新生成覆盖；断网 mock 失败 → 错误 toast 且不渲染结果。

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
- 流式输出（`stream:true` + SSE 拼接）、`Abort`、按 year/range/locale 缓存；taste 段逐句呈现。
- 脱敏断言覆盖年度场景（与 §3.2 同白名单形态，切片替代全量）；`prompts/year-narrative.ts` 就位。

### 9.2 Phase 3：本地服务后端（可选）

- Ollama / LM Studio 等 OpenAI 兼容本地端点，同一契约零成本共存（`baseUrl` 配 `http://127.0.0.1:*` 即切换）。
- 未启动时连接测试 + 明确错误提示；功能级降级（§5.4）。
- CORS 前提：Ollama 默认回环放行（`OLLAMA_ORIGINS` 可扩展，[调研参考](../research/ai-integration-research.md#参考来源)）；LM Studio 同契约。

## 10. 待办关联

- 任务分解与 Phase 1 落地清单见 [tasks/ai-features-batch.md](../tasks/ai-features-batch.md)（汇集调研 §8 路线图与本规格 §9 阶段边界）；规格索引状态见 [app-spec §6](../app-spec.md#6-功能规格索引) #11。
- 落地前须完成：`vite.config.ts` CSP 注释记录（§5.2）；`userPreferencesSchema` 扩展（§5.1，随 [data-layer](./data-layer.md) 迁移/升级流程走 [internal-schema 版本化](../metadata/internal-schema.md)）。
- 调研文档遗留：design-decisions 技术选型表「本地 AI 预留位」与本规格同步修订（已修订，见 [design-decisions](../design-decisions.md)）。调研文档遗留：design-decisions 技术选型表「本地 AI 预留位」与本规格同步修订（已修订，见 [design-decisions](../design-decisions.md)）。
