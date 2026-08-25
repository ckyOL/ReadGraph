# AI 功能里程碑 — 任务分解

> 本文件汇集散落各处的 AI 功能阶段计划：调研路线图 [research/ai-integration-research §8](../research/ai-integration-research.md#8-推荐路线图)（Phase 1/2/3）、规格阶段边界 [ai-features §9](../specs/ai-features.md#9-phase-2--phase-3-边界)、app-spec 规格索引 [§6 #11](../app-spec.md#6-功能规格索引) 的「待 TDD 落地」状态。本文件是**唯一**的任务执行清单，规格权威不变：[AI 功能规格](../specs/ai-features.md)。
> 工作流：[SDD + TDD](../ai-agent-workflow-rules.md) — 规格已就位，按下方顺序进 Tests(Red) → Code → Tests(Green) → Refactor。
> 架构路线（调研定案）：**云端高智能 + 发送前脱敏为主力**；本地服务为可选后端（同一 OpenAI 兼容契约）；浏览器内推理（WebLLM/Transformers.js）已否决；端点与模型选型由用户自定（BYOK）。

## 里程碑范围与边界

- **进入条件**：规格已就位（[ai-features](../specs/ai-features.md)，Phase 1 契约完整）；`profile-stats` 聚合、设置页、`userPreferencesSchema` 既有实现为绿（本批次**不重复**聚合/偏好读写）。
- **本批次范围**：Phase 1 最小闭环——脱敏管道 + 设置页 AI 区 + 阅读画像分析（洞察 + 审美点评，非流式、JSON schema、Zod、缓存）。
- **不在本批次**：年度总结叙事（Phase 2，§9.1）、本地服务后端（Phase 3，§9.2）、流式输出、多轮会话 UI（已否决）、浏览器内推理（已否决）、模型选型建议/默认端点。
- **依赖面共识**：Phase 1 **零新增运行时依赖**（fetch 薄封装 + 脱敏纯函数 + 既有 `zod`）；后续引入任何包须过 [npm-supply-chain-security §3](../npm-supply-chain-security.md) 审查 + `pnpm verify`/`audit`。

## 并行执行策略

任务依赖关系与波次划分（跨任务契约由 [ai-features 规格](../specs/ai-features.md) 锁定，无需协商）：

| 波次 | 任务 | 并行依据 | 前置 |
|------|------|---------|------|
| **W1** | A-1、A-2、S-1、C-1、P-1、E-1、E-3 | 互不依赖、文件两两不相交（`sanitize.ts`/`ai-client.ts`/`ai/prompts/*`/`lib/preferences.ts`/`lib/ai-cache.ts`）；输出契约为规格已定稿：payload 形状（§3.2）、`chat()` 签名（§5.4）、`insightSchema`（§4.1）、偏好结构（§5.1）、缓存键（§5.3） | — |
| **W2** | S-2、C-2、E-2 | 各自消费 W1 产物 | S-1（同文件串行）、C-1、E-1 |
| **W3** | F-1、F-3 | F-1 编排消费 S-1+C-2+E-3；F-3 预览消费 S-1 | S-1、C-2、E-3 |
| **W4** | F-2、F-4 | F-2 渲染消费 F-1+P-1；F-4 端到端依赖全部 | F-1、F-3、P-1 |

- **同文件串行**：S-1/S-2 共享 `src/ai/sanitize.ts`，不得并行编辑；其余任务文件两两不相交（`ai-client.ts`/`ai-provider.ts`/`ai/prompts/*`/`lib/preferences.ts`/`lib/ai-cache.ts`/`routes/settings.tsx`/`routes/profile.tsx`）。
- **验证不并行**：每波结束统一 `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build`（黑名单断言为波 1 门禁，[ai-features §3.3](../specs/ai-features.md#33-黑名单断言测试强制)），避免并行任务互相卡验证。
- **契约即规格**：跨任务接口均已定稿，并行任务按规格实现；实现中发现规格缺口 → 先补 [ai-features](../specs/ai-features.md) 再继续，不得自行扩展契约。

## 阶段 0：前置（供应链与配置）

- [x] **A-1（W1）** 零新增依赖确认：Phase 1 运行时依赖 = 既有 `zod` + 原生 `fetch`/`AbortController`/`EventSource 解析（手写）`；无新包引入，无需供应链审查门（记录于「实现指南 · 依赖」）。
- [x] **A-2（W1）** CSP 放宽：`vite.config.ts` `connect-src` 增加 `https:` + `http://127.0.0.1:*`，**注释记录取舍**（放宽面为任意 https 端点，但数据只在用户显式启用 AI 并触发功能时发送；保守用户可自托管 header 收紧，[ai-features §5.2](../specs/ai-features.md#52-csp-放宽viteconfigts-注释记录)）。无测试（构建期静态配置，注释即记录）。

## 阶段 1：脱敏管道（[ai-features §3](../specs/ai-features.md#3-脱敏管道src-aisanitizets)，纯函数层，TDD 核心）

> 权威契约：[ai-features §3.2](../specs/ai-features.md#32-画像场景白名单契约草案phase-1-唯一场景) 白名单/黑名单表 + 每书字段集 + 模型知识边界；统计数值只消费 `computeProfileStats` 输出（[reading-profile §2](../specs/reading-profile.md#2-统计维度与聚合契约)）。

- [x] **S-1（W1）** `src/ai/sanitize.ts`：画像场景 Zod schema（白名单声明）+ `serializePayload()` 装配器（聚合统计 + 全量每书字段：题名/副标题/作者/出版年份/出版社/单书分类（首选体系）/`subjects`/借阅次数）。
  - 测试（Vitest，Red 先行，[ai-features §7](../specs/ai-features.md#7-测试清单)）：
    - 黑名单**逐值穷举**：构造含 cardno/barcode/借还日期/馆名/rawRecords/单条周期的数据，断言 payload 序列化文本不含任何黑名单值；
    - 每书字段断言：含题名/作者/借阅次数，不含 `isbn13`/`tags`/`price`/借还日期；借阅次数与 `profile-stats` 同源计数一致；
    - 纯函数性：同输入两次调用深等价；无 `Date.now()`/DOM/存储读。
- [x] **S-2（W2，前置 S-1，同文件串行）** 装配边界与采样降级（同文件或独立纯函数）：空库/无借阅 → `books=[]` 结构完整；分类缺失归并；书目 ≤ `BOOKLIST_FULL_LIMIT`（默认 3000）全量；超阈值**按分类分层采样**（每分类按借阅次数取代表，总上限 500，覆盖全部分类无空桶）+ 采样标记（预览标注「已采样（N/M 本）」）。
  - 测试：阈值两侧行为；采样集分类全覆盖；`serializePayload` 产物与发送预览共用（§3.3 同一函数）。

## 阶段 2：端点客户端（[ai-features §5.4](../specs/ai-features.md#54-端点契约与降级)）

- [x] **C-1（W1）** `src/ai/ai-client.ts`：OpenAI 兼容薄封装 `chat()`（`{baseUrl}/v1/chat/completions`，`stream:false` + `response_format` JSON；`baseUrl` 去尾斜杠；`Authorization` 仅在有 Key 时携带；`AbortController` 15s 超时）+ 连接测试 `GET {baseUrl}/v1/models`。
  - 测试（mock fetch）：URL/headers/body 构造；无 Key 请求不带头；超时触发 abort；HTTP 非 2xx（401/429）抛带状态错误；非 JSON/流式响应兜底解析。
- [x] **C-2（W2，前置 C-1）** `src/ai/ai-provider.ts`：`chat(messages, { schema?, stream?, signal? })` 契约（[ai-features §1](../specs/ai-features.md#1-范围与依赖) 代码落点）；响应过 schema 校验，非法抛 `ZodError`。
  - 测试：schema 校验通过/拒绝路径；Phase 1 非流式（`stream:false`）；SSE 解析纯函数（完整事件/空行/`[DONE]`/断行重组）为 Phase 2 预留并在本阶段实现+测试（mock fetch 分片响应）。

## 阶段 3：画像分析 prompt（[ai-features §4.1](../specs/ai-features.md#41-阅读画像分析profile-ai-解读区-phase-1)）

- [x] **P-1（W1）** `src/ai/prompts/profile-insights.ts`：`insightSchema`（`insight[]`：`kind: 'fact'|'taste'`，fact 带 `title`/`dimension`，taste 无维度）+ prompt 模板。
  - 测试：schema 接受合法 fact/taste、拒绝缺 `kind`/`body`/非法 `kind`；prompt 模板只含白名单变量（无黑名单字段名，代码审计断言）；幻觉控制指令在位（仅引用发送书单内书目、数字只转译、temperature 低）。
- [x] **P-2（W1，无依赖）** `src/ai/prompts/year-narrative.ts`：占位落位（Phase 2 用，仅导出类型与空模板标记，不实现）。

## 阶段 4：设置页 AI 区（[ai-features §4.2](../specs/ai-features.md#42-设置页-ai-区settings-phase-1)）

> 设置页既有三区（偏好/数据）已落地；AI 区插入偏好区与数据区之间（[settings §7](../specs/settings.md#7-ui-设计说明) 同步过）。

- [x] **E-1（W1）** 偏好扩展：`userPreferencesSchema` 增 `ai: { enabled, baseUrl, model }`（默认关/空；非法值降级默认）；API Key 独立 `localStorage` key `readgraph:ai-api-key`（不进 schema、不随偏好读写/备份导出，[ai-features §5.1](../specs/ai-features.md#51-偏好持久化扩展-data-layer-§8)）。
  - 测试：`ai` 非法值降级；Key 独立读写、`exportDatabase` 产物不含 Key/`ai` 偏好；系统重置 `clearPreferences` 清 AI 配置与 Key。
- [x] **E-2（W2，前置 E-1 + C-1）** 设置页 AI 区 UI：启用开关（默认关）→ 展开端点 URL/API Key（`Password`）/模型名（用户自填）/「测试连接」（调 C-1）/隐私说明（§2.3 文案）/发送预览开关（默认开）/清除 AI 缓存。i18n `settings.ai.*` 双语。
- [x] **E-3（W1）** `src/lib/ai-cache.ts`：缓存键 `ai:{scene}:{locale}:{key}`；写读回环；清除只删 `ai:` 前缀键；不随备份导出。
  - 测试：键含 scene/locale/key；回环；清除范围；断网时缓存可读。

## 阶段 5：/profile「AI 解读」区（[ai-features §4.1](../specs/ai-features.md#41-阅读画像分析profile-ai-解读区-phase-1)）

> 布局权威：[reading-profile §4](../specs/reading-profile.md#4-ui-设计说明)（价值卡行之下、图表 Tabs 之上）；AI 未启用时本区不渲染（全站无 AI 痕迹）。

- [x] **F-1（W3，前置 S-1 + C-2 + E-3）** `src/ai/use-ai.ts` Hook：编排生成（装配→预览→POST→校验→缓存）、loading/error/重试、缓存命中直出；输入只消费聚合 + 书目（不消费前次 AI 输出）。
- [x] **F-2（W4，前置 F-1 + P-1）** `/profile` AI 解读区：fact 窄卡（标题+正文+维度 chip，点击激活对应图表 tab = 引用定位）+ taste 全宽评价段（Phase 1 非流式整段）；「AI 生成，基于本地数据」标注；整体可重新生成；全量口径不与 range 联动。
- [x] **F-3（W3，前置 S-1）** 发送预览：各生成入口首次触发展示将发送 payload JSON（与实际上送同一装配函数产物）；设置页预览开关关闭后不再弹。
- [x] **F-4（W4，前置 F-1/F-2/F-3）** 测试（Vitest + Playwright，Red 先行）：
  - Vitest：Hook 编排（loading/成功/失败/缓存命中/重试）；缓存键 locale 隔离；预览产物与 `serializePayload` 同一引用。
  - Playwright（route mock 端点，[ai-features §7](../specs/ai-features.md#7-测试清单) E2E）：未启用 AI → `/profile` 无 AI 区块；启用 + 触发 → 预览内容与实际请求 body 一致（拦截断言）→ 确认后渲染 fact 卡 + taste 段、均标注 AI 生成；重新生成覆盖；断网 mock 失败 → 错误 toast 且不渲染结果。

## 落地原则（所有阶段共同）

- SDD：每个产物先写该阶段列出的 Vitest/Playwright 测试（Red），再实现到 Green，再 Refactor；不得跳过 Red。
- 纯函数隔离：脱敏/装配/缓存/客户端解析均为纯函数（无 DOM/存储读/时钟），UI 层只消费其产物——保证 Worker/同步/测试三路径等价。
- 隐私护栏：黑名单穷举断言是**门禁**（`sanitize` 测试不过不进入下一阶段）；发送预览与实际上送同一函数产物（防漂移）。
- UI 文案禁止硬编码：`t()` 双语，namespace `pages`（`profile.ai.*` / `settings.ai.*`），新增 key 同步补 `zh-CN`/`en`。
- 性能规则引用 [ai-features §8](../specs/ai-features.md#8-react-性能规则引用)：`bundle-barrel-imports`/`bundle-dynamic-imports`（`src/ai/` 按需加载，AI 默认关闭不拉主包）、`rendering-conditional-render`、`rerender-transitions`、`client-localstorage-schema`。
- 不破坏既有测试：每阶段结束 `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build`；Phase 1 无新依赖，跳过 audit 门（后续引入包时补）。
- 提交粒度：Conventional Commits（`feat(ai):`、`feat(settings):`、`feat(profile):`、`docs(spec):`）。

## 状态

- 2026-08-23 建档：[ai-features](../specs/ai-features.md) 规格已补（脱敏管道/每书字段集/模型知识边界/发送预览/缓存/设置页 AI 区）；白名单决策链已定稿——Top N → 全量书目 → 每书 8 字段（题名/副标题/作者/出版年份/出版社/单书分类/`subjects`/借阅次数），黑名单 10 项（cardno/barcode/借还日期/馆名/rawRecords/gantt/calendar 明细/isbn13/tags/price 等）。阶段 0–5 待启动；推进顺序 A-1 → A-2 → S-1 → S-2 → C-1 → C-2 → P-1 → E-1 → E-2 → E-3 → F-1 → F-2 → F-3 → F-4。
- 2026-08-23 补充**并行执行策略**：任务按依赖划分为 W1–W4 四波（W1 七任务并行：A-1/A-2/S-1/C-1/P-1/E-1/E-3；W2：S-2/C-2/E-2；W3：F-1/F-3；W4：F-2/F-4）；S-1/S-2 同文件串行；每波结束统一验证。执行时按波次 fan-out，契约以 [ai-features 规格](../specs/ai-features.md) 为准。
- 2026-08-23 **波次1完成**：A-1/A-2/S-1/C-1/P-1（含 P-2 占位）/E-1/E-3 七任务并行落地，TDD 全绿（sanitize 9 / ai-client 19 / prompts 14 / preferences+reset 32 / ai-cache 9 用例）；波次门禁通过——`pnpm test` 70 文件 835 用例全绿、`pnpm build`（`tsc -b` + vite）通过；黑名单穷举断言（§3.3 门禁）绿。产出：`src/ai/sanitize.ts`（`profilePayloadSchema`/`serializePayload`/`BOOKLIST_FULL_LIMIT`）、`src/ai/ai-client.ts`（`chat`/`testConnection`/`AiHttpError`）、`src/ai/prompts/{profile-insights,year-narrative}.ts`（`insightSchema`/`profileInsightsSchema`/`buildProfileInsightsPrompt`/`PROFILE_TEMPERATURE`）、`src/lib/preferences.ts` 扩展 `ai` + `src/lib/ai-api-key.ts`、`src/lib/ai-cache.ts`（`readAiCache`/`writeAiCache`/`clearAiCache`）、`vite.config.ts` CSP 放宽。波次2（S-2/C-2/E-2）待启。
- 2026-08-23 **波次2完成**：S-2/C-2/E-2 三任务并行落地。S-2 `sanitize.ts` 增分层采样（`SAMPLE_BOOKS_LIMIT=500`、`sampled:{total,sent}` 标记、分类缺失归并 `__unclassified__`、确定性比较器）；C-2 `src/ai/ai-provider.ts` 增 `createAiProvider(config).chat(messages,{schema?,stream?,signal?})`（schema 校验失败抛 `ZodError`、stream:true 明确 Phase 2 错误）+ SSE 解析纯函数 `parseSseEvents`（断行重组/[DONE]/空行，Phase 2 预留）；E-2 设置页 AI 区（启用开关→端点/API Key/模型/测试连接/隐私说明/发送预览/清缓存，`preferences.ai` 增 `sendPreview` 默认 true）+ toast 基础设施（shadcn，radix-ui 既有，挂 `__root`）+ `settings.ai.*` 双语 i18n。门禁：`pnpm test` 71 文件 862 用例全绿、`pnpm build` 通过；UI 冒烟（dev server + 浏览器）：AI 区位置/展开/即写存储（baseUrl/model 进偏好、Key 独立键）、测试连接失败 toast 分级、清缓存仅删 `ai:` 前缀、发送预览开关、隐私文案双语齐。波次3（F-1/F-3）待启。
- 2026-08-23 **波次3完成**：F-1/F-3 并行落地。F-1 `src/ai/use-ai.ts` 编排 Hook `useAiInsights(opts)`——`useLiveQuery` 实体 + `computeProfileStats`（range 固定 null 全量口径）+ `serializePayload` 装配；缓存命中直出（`readAiCache('profile',locale,'all')`，损坏视为未命中）；预览门（`ai.sendPreview` 开 → `pendingPreview` 停等确认，确认/直发同一对象引用防漂移）；上送 `createAiProvider(...).chat(buildProfileInsightsPrompt({summary,books,locale}), { schema: profileInsightsSchema })`；错误分级 network/validation/unconfigured，失败不写库不缓存；输入独立性（不消费前次 AI 输出）。F-3 `src/components/ai-send-preview.tsx` 受控预览对话框（payload `<pre>` 可折叠、sampled 标注「已采样（N/M 本）」、复用 `settings.ai.privacyNotice`、Esc/遮罩/关闭→取消）+ `profile.ai.preview.*` 双语 keys。门禁：`pnpm test` 862 用例全绿、`pnpm build` 通过。波次4（F-2 渲染 + F-4 测试）待启。
- 2026-08-23 **波次4完成**：F-2/F-4 落地，Phase 1 收尾。F-2 `/profile` AI 解读区（`src/profile/ai-insights.tsx`，lazy 动态加载、未启用零渲染）：fact 窄卡（标题+正文+维度 chip，chip 小写匹配 Tabs 值集合激活对应图表 tab=引用定位，不命中降级不可点）+ taste 全宽段，每条「AI 生成，基于本地数据」标注，整体重新生成，错误 toast 按 network/validation/unconfigured 分级；profile.tsx Tabs 受控化。**规格缺口修复**：`generate()` 缓存命中直出导致重新生成无法覆盖——`generate(bypassCache?)` + 重新生成按钮传 `true`（§4.1/§6-5）。F-4 测试：编排核心下沉 `src/ai/insight-pipeline.ts` 纯函数（依赖注入，`runInsightPipeline`/`submitInsightPayload` 阶段结果判别联合；use-ai.ts 对外签名不变）→ Vitest 15 用例（缓存命中/损坏、预览产物同一引用 `toBe`、locale 隔离、失败不写缓存、bypass、未启用/unconfigured）+ `e2e/ai-profile.spec.ts` Playwright 6 用例（未启用无区块、预览↔请求体深等价 §3.3、fact/taste 渲染、重新生成覆盖、断网 toast）。**全量门禁**：`pnpm test` 72 文件 877 用例绿、`pnpm build` 绿、`pnpm exec playwright test` 68 用例绿（含既有 11 spec 不回归）；UI 冒烟（dev server+browser+mock 端点）：生成→预览→确认→fact/taste/AI 标注→chip 引用定位→重新生成覆盖→断网 toast 全项通过。**Phase 1 里程碑达成**：脱敏管道+设置页 AI 区+画像分析最小闭环全部落地。

## 实现指南（给执行 LLM 的速查）
- 2026-08-24 **生成超时修复**：opencode.ai zen 端点生成耗时 >15s 被 `AbortController` 误杀，toast 显示固定 network 文案被误读为跨域——`chat` 超时提升 60s（`CHAT_TIMEOUT_MS`，连接测试保持 15s `DEFAULT_TIMEOUT_MS`）；/profile 错误 toast 附诊断 message（401/429/HTTP 状态/CORS 区分，`profile.ai.error.timeout` 双语处理 'Aborted'），避免鉴权失败误报「跨域」。测试：chat 超时用例 60s、testConnection 保持 15s。门禁：`pnpm test` 全绿、`pnpm build` 通过。

- 2026-08-24 **模型列表选择**：`testConnection` 由 `Promise<void>` 改返回 `Promise<string[]>`——解析 `/v1/models` 的 `data[].id`（兼容顶层数组、去重；非 JSON/缺结构 → 空数组，不抛错），新增导出 `parseModelList` 纯函数；设置页模型控件改为 shadcn `Select`（选项 = 抓取列表 + 当前已保存值回退，模型为空时测试连接后自动选列表首项；端点未提供列表时回退手输 Input），端点 URL 变更清空已抓取列表；`settings.ai.test.okModels`（带 {{count}}）/`okNoModels` 双语。测试：ai-client 30 用例（新增 data[].id 去重、顶层数组、非 JSON/缺结构 x2）。门禁：`pnpm test` 全绿、`pnpm build` 通过、UI 冒烟（dev server + 浏览器：测试连接 → 模型下拉出现并选中首项；空列表 → 手输回退）。

- 2026-08-24 **dev 同源代理**：`vite.config.ts` 增 `aiDevProxyPlugin`（`pnpm dev` 生效，`/__ai-proxy/<encoded URL>` 转发任意 https / http 回环端点，同源消除 CORS；拒绝非回环 http；上游失败中断连接→浏览器 TypeError→`AiNetworkError` 语义一致）；`define.__AI_DEV_PROXY__` 仅 dev 注入 true（build/preview/vitest 均 false → 直连，vitest.config.ts 显式补 false）。`ai-client.ts` 增 `buildRequestUrl(target, useProxy?)`（导出、可单测）。冒烟：GET/POST 转发与 body 透传、400 拒绝、上游不可达连接重置。门禁：`pnpm test` 72 文件 885 用例全绿、`pnpm build` 通过、产物直连（define 替换生效）。生产边界：云端端点仍需支持 CORS 或自托管反代；E2E 跨源 mock 不受影响。

- 2026-08-24 **修复**：端点 URL 双 `/v1` 拼接——`ai-client.ts` 增 `endpointUrl()`（`baseUrl` 已含 `/v1` 后缀不重复拼接、网关前缀路径保留，placeholder `https://api.example.com/v1` 直填即用）；fetch `TypeError`（端点不可达 / 跨域 CORS 拦截）归一 `AiNetworkError`（与超时 `AbortError` 区分），连接测试 toast 按 CORS 分级给可操作指引（`settings.ai.test.error.cors` 双语，`profile.ai.error.network` 文案补 CORS）。测试：ai-client 25 用例（新增 `/v1` 结尾 x2、网关前缀、TypeError x2）。门禁：`pnpm test` 72 文件 883 用例全绿、`pnpm build` 通过。


### A. 已就位代码快照（勿重复建）

| 层 | 已有文件 | 状态 |
|----|---------|------|
| 聚合 | `src/lib/profile-stats.ts`（`computeProfileStats`） | ✅ 已 TDD 落地，白名单消费其输出 |
| 偏好 | `src/lib/preferences.ts`（`userPreferencesSchema` + 读写） | ✅ 已落地，E-1 扩展 `ai` |
| 设置页 | `src/routes/settings.tsx`（偏好区/数据区） | ✅ 已落地，E-2 插入 AI 区 |
| 画像页 | `src/routes/profile.tsx` + `src/profile/` 图表 | ✅ 已落地，F-2 插入 AI 解读区（价值卡行下、Tabs 上） |
| 校验 | `zod@4.x` | ✅ 既有 |
| 目录 | `src/ai/`（`ai-provider.ts`/`ai-client.ts`/`sanitize.ts`/`prompts/`/`use-ai.ts`） | ⛔ 未建，本批次新建 |

### B. 精确命令

```bash
pnpm test                  # Vitest（Red→Green 每阶段跑）
pnpm exec tsc --noEmit     # 类型检查
pnpm build                 # 生产构建
pnpm exec playwright test  # E2E（F-4 阶段）
```

### C. i18n key 模式

- `settings.ai.*`：开关/端点/Key/模型/测试连接/隐私说明/预览开关/清缓存。
- `profile.ai.*`：AI 解读区标题/生成/重新生成/「AI 生成，基于本地数据」/预览确认/错误提示。
- 隐私承诺文案（§2.3）双语共用，设置页与发送预览同一 key。

### D. 验收 checklist（Phase 1，[ai-features §6](../specs/ai-features.md#6-用户故事与验收用例-phase-1)）

- [ ] 配置任意 OpenAI 兼容云端端点（BYOK）→ `/profile` 生成画像分析（fact 卡 + taste 段）；
- [ ] 发送预览与实际 payload 一致（同一装配函数产物）；
- [ ] 洞察数字与本地聚合一致（只转译不生成）；
- [ ] 点评引用书目全部来自发送书单（prompt 限定 + 全量书单兜底）；
- [ ] 黑名单穷举断言单测绿（isbn13/tags/price/借还时点/cardno/barcode 均不在 payload）；
- [ ] AI 未启用时 UI 无 AI 痕迹（`/profile` 无区块、全站无入口）；
- [ ] taste 条目标注「AI 生成，供参考」；可重新生成；缓存按 locale 隔离、可清除。

### E. 后置阶段（不在本批次）

- **Phase 2**：年度视图（`/profile/$year`，新路由）静态骨架（年度书单/最常借 Top N + 年度目标进度卡，bookology-benchmark §5.2/§5.3）+ 「年度叙事」AI 区；输入 = `computeYearSlice`（[reading-profile §2.7](../specs/reading-profile.md#2-统计维度与聚合契约)）+ 年度全量书目（§3.2 白名单形态）；**目标值不进 payload**；流式（SSE 拼接、Abort、按 year/range/locale 缓存）；`year-narrative.ts` 就位（P-2）。
- **Phase 3**：本地服务后端（Ollama/LM Studio 同契约，`baseUrl` 配 `http://127.0.0.1:*`）；未启动明确错误；CORS 前提见 [research 参考来源](../research/ai-integration-research.md#参考来源)。

### F. 依赖（Phase 1）

**零新增运行时依赖确认**（对齐 [ai-features §1](../specs/ai-features.md#1-范围与依赖)）：Phase 1 运行时依赖 = 既有 `zod`（响应/场景 schema 校验，已在 `package.json` dependencies 中）+ 平台原生 `fetch`/`AbortController` + 手写 SSE 解析（纯函数）；**无任何新包引入**，无需过 [npm-supply-chain-security §3](../npm-supply-chain-security.md) 供应链审查门。后续任何阶段引入新包时，再补审查 + `pnpm verify`/`audit`。
