# Profile 年度视图里程碑 — 任务分解（Phase 2，普通静态骨架 + AI 年度叙事）

> 本文件汇集年度视图的散落承接点：commit `eb74e74`（docs(profile): add year-slice contract for annual review, goal, and narrative）将三个消费方——年度目标（[bookology-benchmark §5.2](../research/bookology-benchmark.md)）、年度回顾（§5.3）、AI 年度叙事（[ai-features §9.1](../specs/ai-features.md#91-phase-2年度总结叙事--流式)）——收敛为 [reading-profile §2.7 年度切片契约](../specs/reading-profile.md#2-统计维度与聚合契约)；路由预留见 [ui-navigation §2/§3](../specs/ui-navigation.md#2-路由树)。本文件是**唯一**的任务执行清单，规格权威不变：[reading-profile](../specs/reading-profile.md) / [ai-features](../specs/ai-features.md) / [ui-navigation](../specs/ui-navigation.md)。
> 工作流：[SDD + TDD](../ai-agent-workflow-rules.md) — 先补规格缺口（阶段 0），再按波次进 Tests(Red) → Code → Tests(Green) → Refactor。
> 与 [ai-features-batch.md](./ai-features-batch.md) 的关系：本批次是其「E. 后置阶段 · Phase 2」的执行清单；AI 链路基础设施（流式 chatStream、脱敏管道、缓存、预览、叙事 UI 形态）已由 Phase 1 就位，本批次**复用不重写**。

## 里程碑范围与边界

- **进入条件**：规格已就位——reading-profile §2.7 yearSlice 契约（口径/输出/纯函数性，2026-08-25 定稿）；ai-features §9.1 年度视图落点（静态骨架 + 叙事区、输入契约、白名单边界）；ui-navigation §2 路由预留（`profile.$year.tsx`）。AI Phase 1 已收尾（含画像流式先行：`chatStream`/`createSseParser`/`stream-json`/`onPartial` 链路就绪）。
- **本批次范围**（两部分）：
  - **普通（纯本地静态骨架，不依赖 AI）**：`computeYearSlice` 纯函数、`/profile/$year` 路由、年度书单、最常借 Top N、年度目标进度卡（目标值落 `UserPreferences`）、入口导航、i18n。
  - **AI（年度叙事区）**：`year-narrative.ts` 模板实现（替换 Phase 1 占位）、sanitize 年度场景白名单装配、叙事区 UI（与 `/profile` AI 解读区同构）、按 year/locale 缓存、发送预览复用。
- **不在本批次**：阅读报告分享图（bookology §5.3 衔接扩展，纯前端 Canvas 留后）；Phase 3 本地服务后端（已记 ai-features-batch E 节）；**年度目标值（`UserPreferences` 用户设置）进 AI payload**（ai-features §9.1 明确排除——非聚合统计、非书目字段，叙事不提「距目标还差 N 本」；如需纳入须显式扩展白名单并声明）；多轮会话/批量点评（沿用 design-decisions 否决）。
- **依赖面共识**：**零新增运行时依赖**（同 Phase 1 结论——zod + 原生 fetch/SSE 手写解析均已就位）；不引入新实体、不改 Repository 接口、不写库（唯一写面 = 年度目标偏好，走既有 `readgraph:preferences` 通道）。

## 并行执行策略

任务依赖与波次划分（跨任务契约由 reading-profile §2.7 / ai-features §9.1 锁定，无需协商）：

| 波次 | 任务 | 并行依据 | 前置 |
|------|------|---------|------|
| **W0** | G-1、G-2、G-3 | 同批次内串行（规格先行，SDD 硬性门）；G-3 最后 | — |
| **W1** | Y-1、Y-2、P-2 | 互不依赖、文件两两不相交（`profile-stats.ts`/`preferences.ts`/`prompts/year-narrative.ts`）；输出契约为规格已定稿：yearSlice 契约（§2.7）、目标偏好结构（G-2）、叙事弱校验形态（§9.1 + 画像先例 §4.1） | G-1、G-2 |
| **W2** | S-3、U-1 | 文件不相交（`sanitize.ts`/`routes/profile.$year.tsx`+`src/profile/year/`）；S-3 消费 Y-1，U-1 消费 Y-1+Y-2 | Y-1（Y-2 仅 U-1） |
| **W3** | U-2、E-4 | U-2 消费 S-3+P-2+U-1；E-4 消费 Y-2（若 G-2 裁定设置页编辑） | S-3、P-2、U-1 |
| **W4** | T-1、T-2 | T-2 端到端依赖全部 | 全部 |

- **同文件串行**：`sanitize.ts` 的 S-3 是本批次唯一对该文件的改动（Phase 1 已收尾无并发者），仍需单任务独占；其余任务文件两两不相交。
- **验证不并行**：每波结束统一 `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build`（**年度场景黑名单断言 + 目标值排除断言为 W2 门禁**，[ai-features §3.3](../specs/ai-features.md#33-黑名单断言测试强制) 扩展），避免并行任务互相卡验证。
- **契约即规格**：跨任务接口均已定稿；实现中发现规格缺口 → 先补对应规格再继续，不得自行扩展契约。

## 阶段 0：规格补齐（W0，SDD 前置门）

> 依据：repo 规则「设计意图先落 docs」+ ai-agent-workflow-rules SDD。§2.7/§9.1/路由预留已定，但年度视图的 UI 规格（布局/交互/状态/响应式/用户故事）与目标偏好 schema 尚无章节承载，必须先补。

- [x] **G-1** [reading-profile](../specs/reading-profile.md) 新增「年度视图」UI 章节（§4 后增或独立小节）：
  - **布局**（方向 B 图谱语言，对齐 §4 基调：无外层卡片套卡片、直角、克制）：年度书单（`bookIds` 升序 → 题名/作者/封面，呈现形态规格裁定——候选：封面网格（bookology §5.2 完成网格微缩版，含编号占位）/ 密实列表，推荐网格，理由：年度回顾的画报语义 + §5.2 已指明的微缩方向）+ 最常借 Top N 卡（`topBooks` 降序，N 值规格裁定，候选 5/10）+ 年度目标进度卡（目标值 vs `yearSlice.bookCount` 差量，进度条或数字）。
  - **入口导航**（规格裁定，推荐双入口）：/profile 概览行「年度目标」卡点击 → 当年 `/profile/$year`；借阅日历「年视图」年份导航联动或「年度回顾」链接；候选增补：借阅量柱图年粒度桶点击下钻（可选增强）。
  - **年份切换**：`/profile/$year` 内上一年/下一年导航（或年份下拉），跨年可浏览。
  - **状态**：空年（无周期）→ 书单 `Empty` 变体、目标卡 0/N、叙事区不渲染或空态文案（规格裁定）；加载态 `Skeleton`；错误态边界捕获降级。
  - **路由参数**：`$year` loader 入参 `z.string()` 校验 4 位整数年，非法 → `notFound()`/重定向 `/profile`（对齐 ui-navigation §2「路由参数静态类型化」）。
  - **§6 用户故事追加**（新增 3–4 条：入口跳转、数字同源、目标卡编辑、空年）；**§7 测试清单补 UI 层条目**（路由/骨架渲染/E2E）。
- [x] **G-2** 年度目标偏好 schema 增量（落 [data-layer §8](../specs/data-layer.md#8-用户偏好) 或 reading-profile §2.7 附注，规格裁定形态）：候选 `annualGoals?: Record<number, number>`（按年记录——年度视图按年组织，历年目标需各自可读；推荐）vs 单年 `annualGoal`。约束：非法值（非整数/越界/负数）降级同既有偏好处理（safeParse 失败 → 默认）；系统重置 `clearPreferences` 清理语义对齐既有。**设置入口裁定**：bookology §5.2 承接表述为「走设置页编辑」→ 推荐设置页偏好区新增年度目标控件（当前年数字步进器，Bookology Goals 微缩形态）；候选：年度视图卡内联编辑。
- [x] **G-3** [app-spec §6](../app-spec.md#6-功能规格索引) 登记：#11 落地状态补 Phase 1 已落地 + Phase 2 计划链接；规格索引下方任务行补本文件登记（见本批次提交）。

## 阶段 1：纯函数层（W1 并行，TDD 核心）

- [x] **Y-1（W1）** `computeYearSlice(books, records, year, options)` 实现（`src/lib/profile-stats.ts`，**独立导出入口，不进 `ProfileStatsResult`**——`/profile/$year` 按需调用，不污染主聚合结构，reading-profile §2.7）：
  - 契约：`bookIds`（该年借出独立 Book id 升序）/ `bookCount`（= `bookIds.length`，年度目标进度口径）/ `topBooks`（`{ bookId, count }[]` 按年内借出次数降序 Top N）/ `classification`（该年独立 Book 按首选体系分类分布，无分类号归 `__unclassified__`）。
  - 口径：`borrowedAt ∈ [y-01-01T00:00:00.000Z, (y+1)-01-01T00:00:00.000Z)`（UTC 左闭右开）即计入；**不依赖 `status='returned'`**；同书多次借阅计 1；设备书排除（§2.0 排除总则）；跨年周期只计入 `borrowedAt` 所在年；空年零值结构（`bookIds=[]`/`bookCount=0`/`topBooks=[]`/`classification=[]`），不抛错。
  - 测试（Red 先行，清单已在 reading-profile §7）：口径边界（左闭右开、在借周期计入、同书 2 周期计 1、设备排除、跨年归属、空年）；纯函数性（同输入两次深等价、UTC 桶归属与 displayTimezone 无关、`topBooks` 降序/`bookIds` 升序、无 `Date.now()`）。
- [x] **Y-2（W1）** 年度目标偏好扩展（`src/lib/preferences.ts`，按 G-2 裁定形态）：schema 增量 + 读写 + 非法值降级；系统重置清理语义对齐。测试：合法读写回环、非法值降级默认、重置清理。
- [x] **P-2（W1）** `src/ai/prompts/year-narrative.ts` 实现（替换 Phase 1 占位 `YEAR_NARRATIVE_TEMPLATE_PHASE2`）：
  - 模板：年度切片指标（yearSlice 聚合输出：`bookCount`/`topBooks`/`classification`）+ 切片内**全量**书目题名/作者（与 §3.2 同一白名单形态，切片规模更小）→ 叙事段落（「今年借阅 23 本、最爱文学类、复借最多的是《X》…」）；数字只转译不生成（对齐 §2.6 统计一致性）；幻觉控制指令（仅可引用发送书单内的书目，不虚构书名/作者）；**年度目标值不得出现于模板变量**（§9.1 白名单边界）。
  - 弱校验 schema：非空 + 长度上限（`YEAR_NARRATIVE_MAX_LENGTH`，对齐 `validateProfileInsightsMarkdown` 形态）。
  - 测试：schema 接受/拒绝路径；prompt 模板只含白名单变量（无黑名单字段名、无目标值字段，代码审计断言）。

## 阶段 2：年度场景装配与静态骨架（W2 并行）

- [x] **S-3（W2，前置 Y-1）** `src/ai/sanitize.ts` 年度场景：`yearPayloadSchema`（yearSlice 聚合输出 + 切片内全量每书字段——题名/副标题/作者/出版年份/出版社/单书分类/`subjects`/借阅次数，与 §3.2 同一白名单形态，切片替代全量）+ 装配器（与画像场景同函数族；**同一装配函数产物供发送预览与实际发送**，防漂移；采样降级复用——切片规模通常远低于 `BOOKLIST_FULL_LIMIT`，阈值逻辑保留兜底）。
  - **黑名单断言扩展（W2 门禁）**：既有穷举断言复用 + 年度场景专项——`UserPreferences` 年度目标值（G-2 字段名）绝不出现在 payload 序列化文本；cardno/barcode/借还时点/馆名/单条周期/`isbn13`/`tags`/`price` 同 §3.2 逐值穷举；纯函数性（同输入两次深等价）。
- [x] **U-1（W2，前置 Y-1 + Y-2）** `/profile/$year` 路由与静态骨架（普通部分）：
  - `src/routes/profile.$year.tsx`（TanStack 文件路由，routeTree codegen 自动生成；lazy 动态加载，`bundle-dynamic-imports`）；loader 入参校验（G-1 裁定）。
  - 数据：`useLiveQuery` 实体 → `computeYearSlice`（按需调用，不污染 `ProfileStatsResult`）；年度书单（`bookIds` → Book 题名/作者/封面，`bookIndex` 式索引避免携带整本）；最常借 Top N（`topBooks` → 题名 + 次数）；年度目标进度卡（目标值 Y-2 + `bookCount` 差量）。
  - 入口与年份切换（G-1 裁定）；/profile 侧入口落点（概览行目标卡 / 借阅日历年视图链接）；空年/加载/错误态（G-1 裁定）。
  - i18n `profile.year.*` 双语（标题、书单、Top N、目标卡、入口、空年文案、年份导航 aria），按 [i18n-conventions](../i18n-conventions.md) 两语同时补齐；新增 key 断言渲染测试（t() 取值路径，不断言字面量）。
  - 组件落点：`src/profile/year/`（year-book-grid.tsx / year-top-books.tsx / year-goal-card.tsx 等，按需 import 避免 barrel）。

## 阶段 3：年度叙事区与目标编辑（W3）

- [x] **U-2（W3，前置 S-3 + P-2 + U-1）** 「年度叙事」AI 区（`src/profile/year/`，与 `ai-insights.tsx` 同构——**是年度视图内的区块而非独立孤岛**）：
  - 形态复用：Markdown 文本流（ReactMarkdown + `.ai-markdown`，ai-features §4.1）+ 流式逐字渲染（`chatStream`/`onPartial` 链路已就绪）+ 停止生成/打字光标/复制 + 重新生成（`bypassCache`）+ 发送预览（`ai-send-preview.tsx` 复用，sampled 标注）+ 「AI 生成，基于本地数据」标注。
  - 输入：`computeYearSlice` 切片 + 切片内全量书目（S-3 装配产物）；AI 未启用/未配置 → 本区零渲染（无 AI 痕迹）。
  - 缓存：`ai-cache.ts` 键 `ai:year-narrative:{locale}:{year}`（scene=year-narrative、key=year，§5.3 键形不变）；清除仍仅 `ai:` 前缀；失败不写缓存；断网缓存可读。
  - 测试：编排（缓存命中/损坏/bypass/失败不写缓存/locale+year 隔离）；E2E 见 T-2。
- [x] **E-4（W3，前置 Y-2；若 G-2 裁定设置页编辑）** 设置页年度目标入口：偏好区新增年度目标控件（当前年数字步进器 + 保存，Bookology Goals 微缩形态）；`settings.goal.*` 双语；非法值降级 toast/提示。若 G-2 裁定年度视图内联编辑，本任务并入 U-1 并在规格中声明。

## 阶段 4：验证（W4）

- [ ] **T-1（W4）** Vitest 全量回归：Y-1/Y-2/P-2/S-3/U-1 各阶段用例 + 既有 885+ 用例全绿；`pnpm exec tsc --noEmit` + `pnpm build` 通过。
- [ ] **T-2（W4）** Playwright E2E（`e2e/profile-annual.spec.ts`）：
  - 静态骨架：入口跳转 `/profile → /profile/$year`；年度书单/Top N/目标卡数字与 `computeYearSlice` 一致；空年不崩（Empty 变体）；年份切换；非法 `$year` 参数 → 404/重定向。
  - AI 叙事：启用 + 触发 → 发送预览与实际请求 body 深等价（§3.3 同一装配产物）；**请求 body 不含年度目标值**（拦截断言）；流式渲染后标注 AI 生成；重新生成覆盖；断网 mock 失败 → 错误 toast 不渲染；缓存按 year+locale 隔离；AI 未启用 → 年度视图无叙事痕迹。

## 落地原则（所有阶段共同）

- SDD：每个产物先写该阶段列出的 Vitest/Playwright 测试（Red），再实现到 Green，再 Refactor；不得跳过 Red；规格缺口先补 docs 再继续。
- 数字同源：叙事、目标卡、回顾三个消费方**共用同一 `computeYearSlice` 产物**——口径一次定死，LLM 只转译不生成（reading-profile §2.7 / ai-features §2.6）。
- 隐私护栏：黑名单穷举断言扩展（含**年度目标值排除**）是门禁（W2 起），不过不进入下一阶段；发送预览与实际上送同一函数产物（防漂移）。
- 纯函数隔离：`computeYearSlice`/装配/缓存/解析均为纯函数（无 DOM/存储读/时钟），UI 层只消费其产物。
- UI 文案禁止硬编码：`t()` 双语，namespace `pages`（`profile.year.*` / `profile.year.ai.*` / `settings.goal.*`），新增 key 同步补 `zh-CN`/`en`。
- 性能规则引用（ai-features §8 / reading-profile §8）：`bundle-barrel-imports`（`src/profile/year/` 按需 import）、`bundle-dynamic-imports`（年度视图与叙事区 lazy，AI 未启用不拉 `src/ai/`）、`rendering-conditional-render`（叙事区按 `ai.enabled` 三元渲染）、`rerender-transitions`（生成/切换 loading 态）、`client-localstorage-schema`（年度目标偏好读写校验）。
- 不破坏既有测试：每阶段结束 `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build`；本批次无新依赖，跳过 audit 门。
- 提交粒度：Conventional Commits（`feat(profile):`、`feat(ai):`、`feat(settings):`、`docs(spec):`）。

- 2026-08-26 **阶段 0 完成（W0）**：G-1/G-2/G-3 落地，规格裁定如下——
  - **G-1 裁定**（reading-profile §4「年度视图」子节 + §6 故事 18–21 + §7 测试 + §8 性能）：布局 = 年份导航工具条（`‹`/`›` + 标题）→ 概览窄卡行（年度目标进度卡：进度条 + 「N / M」+ 差量文案，Bookology 大网格编号占位不照搬；本年借阅卡）→ 最常借 Top 5 区块（`YEAR_TOP_BOOKS_N=5`）→ 年度书单全幅封面网格（`bookIds` 升序、无封面占位题名首字符、响应式列数、全量不折叠、`bookIndex` 式索引）→ AI 叙事区（U-2 落点，未启用/空年不渲染）；入口双入口 = /profile 概览行第 6 卡「年度目标」（栅格扩 `md:grid-cols-6`）+ 借阅日历年视图工具条「年度回顾」链接；柱图年桶下钻 = 可选增强不承诺；`$year` loader `z.string().regex(/^\d{4}$/)`，非法 `notFound()`；空年 = 书单/Top 5 `Empty` 变体 + 目标卡 0/M + 叙事区不渲染；页面只读（目标编辑在设置页）。
  - **G-2 裁定**（data-layer §8 + §11 测试条目 + reading-profile §2.7 引用）：形态 `annualGoals?: Record<number, number>`（键 4 位整数年 1000–9999、值整数 1–999；0 值不被接受，**清除 = 删除条目**）；降级 = **逐条目过滤**（键/值非法条目丢弃，合法保留，对齐 ai 字段级模式）；设置入口 = **设置页偏好区**（当前年数字步进器 1–999、减至 0 清除、即时写 `writePreferences`）→ **E-4 保留**（不并入 U-1）；重置语义 = `clearPreferences` 走既有 `readgraph:*` 清键（无需改 reset）；目标值不进 AI payload（§9.1 白名单边界重申）。
  - **G-3**：app-spec §6 #11 落地状态补 Phase 1 已 TDD 落地（2026-08-25 收尾含画像流式先行）+ Phase 2 执行清单链接（任务行已由建档登记，未重复）。
- 2026-08-26 **阶段 1 完成（W1，三任务并行 fan-out）**：Y-1/Y-2/P-2 落地，TDD 全绿——
  - **Y-1** `src/lib/profile-stats.ts`：`computeYearSlice(books, records, year, options)` 独立导出（不进 `ProfileStatsResult`），`records = { catalogRecords, borrowCycles, sources }`；`YEAR_TOP_BOOKS_N = 5` / `YearSliceOptions` / `YearSliceResult`；复用 `resolveSystem` + 提取共享 `buildClassificationBuckets`（scope 参数）/`indexRecordsByBook`（computeProfileStats 同源重构，零回归）；口径全按 §2.7（UTC 左闭右开、不依赖 returned、同书去重计 1、设备排除、跨年按 borrowedAt、空年零值、无 Date.now()）。测试 12 用例（边界/在借/去重/设备/跨年/空年/序/纯函数性/体系）。
  - **Y-2** `src/lib/preferences.ts`：`annualGoals: z.record(z.coerce.number().int().min(1000).max(9999), z.number().int().min(1).max(999)).default({})` + `DEFAULT_PREFERENCES.annualGoals = {}` + `readPreferences` 逐条目过滤（键非 4 位整数年/值非整数或越界丢弃，缺失/非对象/数组 → {}，仍走 schema 兜底）；`writePreferences` 既有合并透传（0 值整体拒写，清除 = 删条目）；`reset.ts` 零改动（clearPreferences 既有语义）；测试 17 用例（回环/多历年互不串/逐条目过滤/拒写/重置清理）+ reset.test.ts 既有整对象断言补 `annualGoals: {}`。
  - **P-2** `src/ai/prompts/year-narrative.ts`：占位替换——`YEAR_NARRATIVE_MAX_LENGTH = 20_000` / `validateYearNarrative`（非空 + 长度上限，抛 ZodError，返回 trim）/ `YEAR_NARRATIVE_TEMPERATURE = 0.2` / `buildYearNarrativePrompt({ year, slice, books, locale })`（unknown 透传、8 字段声明、目标排除指令、语言指令）；源码黑名单审计目标注释惯例 + 测试 12 用例（弱校验/消息结构/JSON 透传/**黑名单逐值穷举含 annualGoals 专项**）；占位 `YEAR_NARRATIVE_TEMPLATE_PHASE2`/`YearNarrativeScene` 删除，grep 确认无引用。
  - **门禁**：`pnpm test` 74 文件 **952 用例全绿**、`pnpm exec tsc --noEmit` 过、`pnpm build`（tsc -b + vite）过。**修复**：`buildClassificationBuckets` scope 形参 `Set<string>` 误传 `Map`（Y-1 波内纠错，改传 `new Set(bookIds)`）。
- 2026-08-26 **阶段 2 完成（W2，S-3 与 U-1 文件不相交并行）**：落地，TDD 全绿——
  - **S-3** `src/ai/sanitize.ts`：`yearPayloadSchema`/`YearPayload`/`serializeYearPayload(input, slice, year, opts)`——yearSlice 聚合白名单子集透传（`bookCount`/`topBooks`/`classification`，bookIds 由 books 数组承载不重复发送）+ 切片内全量每书字段（§3.2 同形态，借阅次数取**年内口径**与 computeYearSlice 同源）；提取共享 `indexRecordsByBook`/`bookRowOf`（画像 serializePayload 同源重构，零回归）；采样兜底复用 `sampleEntries`（`BOOKLIST_FULL_LIMIT` 阈值保留）；源码黑名单审计（`sanitize.ts?raw` 无 preferences 引用）。测试 8 用例（**黑名单逐值穷举含 annualGoals 字段名+目标值专项**、数字同源、空年、采样兜底、schema 严格、纯函数性、源码审计）。
  - **U-1** `src/routes/profile.$year.tsx` + `src/profile/year/`（year-book-grid / year-top-books / year-goal-card / year-goal-summary-card / year-book-index）：`parseYearParams` 独立导出（`z.string().regex(/^\d{4}$/)`，非法 → 路由不匹配 404 路径）；`ProfileYearPage` 单次 `computeYearSlice` 产物驱动目标卡/本年借阅卡/Top 5/封面网格（数字同源）；年份切换 `useTransition` + `isPending` 遮罩（工具条稳定）；状态全覆盖——useLiveQuery 未就绪 `Skeleton`、空年区块 `Empty` 变体 + 目标卡 0/M、全库空整页 `Empty` + 导入入口、区块级 `ErrorBoundary` 降级；双入口 = /profile 概览行第 6 卡（栅格 `md:grid-cols-6`，当年 N/M）+ 借阅日历年视图工具条「年度回顾」链接；i18n `profile.year.*`/`profile.summary.goal.*`/`profile.calendar.yearReview` 双语 21 键。测试 14 用例（loader 校验/骨架渲染 t() 取值路径断言/空年/全库空/加载态/概览入口卡）。
  - **门禁**：`pnpm test` 75 文件 **973 用例全绿**、`pnpm exec tsc -b` 过、`pnpm build` 过（routeTree codegen 注册 `profile.$year` 独立 chunk `profile._year-*.js`，lazy 分割生效）、oxlint 无 error。
  - 波次 3（W3：U-2 年度叙事区 + E-4 设置页年度目标入口，前置 S-3/P-2/U-1/Y-2）待启。

- 2026-08-28 **阶段 3 完成（W3，E-4 子代理 + U-2 主线接管）**：落地，TDD 全绿——
  - **E-4** `src/settings/goal-setting.tsx`：`stepAnnualGoals(goals, year, delta)` 纯函数（+1 未设置→1、封顶 999 不变；−1 未设置或 ≤1 → 删除该年条目即清除；其余年条目新对象保留不 mutate）+ `GoalSetting` 组件（当前年挂载态 `getUTCFullYear`；−/数值/＋ 步进器，`tabular-nums`，aria-label `settings.goal.decrease/increase`；变更即时 `writePreferences({ annualGoals })` + toast saved/cleared；未设置显示 `settings.goal.placeholder`）；挂载于设置页偏好区 timezone 行后；i18n `settings.goal.*` 双语 8 键。测试 8 用例（纯函数 6 + 组件渲染 2，t() 取值路径断言）。
  - **U-2** 编排三层重构 + 年度叙事区：
    - `src/ai/insight-pipeline.ts` **场景无关泛化**：`InsightPipelineInput<P>`（`entities/stats/classificationSystem` → `ready: boolean` + `assemble: () => P` 装配闭包）、`InsightPipelineDeps<P>`（新增 `validate` 缓存弱校验注入点；`submit` payload 泛型化）、`InsightPipelineResult<P>`；流程语义逐行保持（skipped/unconfigured/cache-hit 损坏未命中/pending-preview 同引用/success 写缓存/error 分级不写缓存）。既有 20 用例适配 + 新增 2（弱校验注入生效、ready=false skipped）。
    - `src/ai/use-ai-engine.ts` **共享引擎 hook**（use-ai.ts 90–341 行逻辑原样抽取）：状态机（markdown/streamingMarkdown/streamingReasoning/loading/error/pendingPreview）、并发闸/停止保留部分内容/流式增量落位、场景差异（scene/key/locale/temperature/assemble/buildPrompt/validate）全注入。
    - `src/ai/use-ai.ts` 变薄为画像适配层（公开 API 不变：useAiInsights/UseAiInsightsOptions/UseAiInsightsState/AiInsightError 再导出；scene 'profile' / key 'all-v2' / PROFILE_TEMPERATURE / serializePayload / buildProfileInsightsPrompt / validateProfileInsightsMarkdown）。
    - `src/ai/use-year-narrative.ts` 年度适配层：scene `year-narrative` / key `String(year)`（缓存键 `ai:year-narrative:{locale}:{year}`）/ `YEAR_NARRATIVE_TEMPERATURE` / `serializeYearPayload`（与页面 computeYearSlice 同参——数字同源）/ `buildYearNarrativePrompt` / `validateYearNarrative`；ready 门 = slice/entities 就绪且 `bookCount > 0`（空年静默）。
    - `src/profile/year/ai-section-view.tsx` 共享展示层（自 ai-insights 抽取，渲染标记逐字节一致）：标题行按钮组、loading 三态（thinking 折叠块/流式 markdown+光标/停止条）、定稿态、错误分级 toast（`useAiSectionErrorToast`）；`ai-insights.tsx` 改为消费同一展示层（行为/标记不变）。
    - `src/profile/year/year-narrative.tsx` 年度叙事区：aiEnabled 门控 → null（无痕迹）；i18n `profile.year.ai.*` 双语 14 键；AiSendPreviewDialog 复用（`AiPreviewPayload` 宽类型兼容 Profile/Year 两场景）。
    - `src/routes/profile.$year.tsx` 挂载：`aiEnabled === true && slice.bookCount > 0` 才渲染 lazy 组件（`bundle-dynamic-imports`——build 产物确认 `year-narrative-*.js` 独立 chunk 经 `__vite__mapDeps` 动态引用，主包不静态引用，AI 默认关闭不拉 `src/ai/`）；ErrorBoundary + Suspense 包裹；书单区块之后（G-1 布局序）。
    - 测试 `src/profile/year/year-narrative.test.tsx` 14 用例：管线编排（预览过 yearPayloadSchema/同一引用/写缓存 scene+locale+key/空年 skipped/失败不写缓存/bypass/缓存 year+locale 隔离/损坏未命中）+ 组件渲染（未启用 null/取值路径/AI 标注/流式光标）+ 源码审计（`?raw` 无 annualGoals、温度 0.2）；路由测试补 AI 未启用无叙事痕迹断言。
  - **门禁**：`pnpm test` 77 文件 **997 用例全绿**、`pnpm exec tsc -b` 过、`pnpm build` 过、oxlint 44 warning 与基线持平（无新增 error）。**执行记录**：E-4 子代理一次通过（9m37s）；U-2 子代理 30 分钟零产出判卡死取消，由主线按同规格接管实现。
  - 波次 4（W4：T-1 全量回归复跑 + T-2 Playwright E2E）待启。

## 实现指南（给执行 LLM 的速查）

- **yearSlice 契约即规格**：reading-profile §2.7——口径（`borrowedAt ∈ [y-01-01, (y+1)-01-01)` UTC 左闭右开、不依赖 `status='returned'`、同书去重、设备排除、跨年只计 `borrowedAt` 所在年）+ 输出（`bookIds` 升序 / `bookCount` / `topBooks` 降序 / `classification`）+ 空年零值 + 纯函数性（两次调用深等价、无 `Date.now()`）。**不进 `ProfileStatsResult`**，独立入口按需调用。
- **AI 白名单边界**：年度场景 = §3.2 每书字段集 + `yearSlice` 聚合输出（切片替代全量）；**年度目标值（`UserPreferences` 用户设置）绝不进 payload**——叙事不提「距目标还差 N 本」；如要纳入须显式扩展白名单并声明。
- **复用不重写**：流式链路（`chatStream`/`createSseParser`/`stream-json.ts`/`insight-pipeline.onPartial`）、发送预览（`ai-send-preview.tsx`）、叙事渲染形态（`ai-insights.tsx`）、缓存（`ai-cache.ts` 键形 `ai:{scene}:{locale}:{key}`）均已就位，年度场景直接复用同一基础设施。
- **规格缺口先补**：年度视图 UI 章节（G-1）与目标偏好 schema（G-2）落地前不得写 UI/偏好代码；入口与目标编辑位置以规格裁定为准，本文件列为候选不代规格。

### A. 已就位代码快照（勿重复建）

| 层 | 已有文件 | 状态 |
|----|---------|------|
| 聚合 | `src/lib/profile-stats.ts`（`computeProfileStats` 含 calendar） | ✅ 已 TDD 落地；`computeYearSlice` 未实现（契约 §2.7 已定） |
| 偏好 | `src/lib/preferences.ts`（`userPreferencesSchema` + 读写，已含 `ai`） | ✅ 已落地；年度目标未扩展（G-2 定形态） |
| 路由 | ui-navigation §2 预留 `profile.$year.tsx` | ⛔ 文件未建，本批次新建 |
| prompt | `src/ai/prompts/year-narrative.ts` | ⛔ Phase 1 占位（`YEAR_NARRATIVE_TEMPLATE_PHASE2`），P-2 实现 |
| 脱敏 | `src/ai/sanitize.ts` | ✅ 画像场景已落地（含分层采样）；年度场景未加（S-3） |
| 缓存 | `src/lib/ai-cache.ts` | ✅ 键 `ai:{scene}:{locale}:{key}`；year 键复用同形 |
| 流式 | `src/ai/ai-client.ts`（`chatStream`）/ `src/ai/insight-pipeline.ts`（`onPartial`） | ✅ 已落地（2026-08-25 画像流式先行） |
| 叙事 UI | `src/profile/ai-insights.tsx` + `src/components/ai-send-preview.tsx` | ✅ 已落地，年度叙事区同构复用 |

### B. 精确命令

```bash
pnpm test                  # Vitest（Red→Green 每阶段跑）
pnpm exec tsc --noEmit     # 类型检查
pnpm build                 # 生产构建
pnpm exec playwright test  # E2E（T-2 阶段）
```

### C. i18n key 模式

- `profile.year.*`：年度视图标题/年度书单/最常借 Top N/目标进度卡/入口/年份切换 aria/空年文案。
- `profile.year.ai.*`：年度叙事区标题/生成/重新生成/「AI 生成，基于本地数据」/预览确认/错误提示（与 `profile.ai.*` 同构，独立命名空间防混淆）。
- `settings.goal.*`：设置页年度目标控件（若 G-2 裁定设置页编辑）。
- 隐私承诺文案复用 `settings.ai.privacyNotice`（不新造 key）。

### D. 验收 checklist（Phase 2）

- [ ] `/profile` 入口可跳转 `/profile/$year`，非法 `$year` 参数 → 404/重定向，不崩；
- [ ] 静态骨架数字与 `computeYearSlice` 一致：年度书单 = `bookIds` 升序、目标卡进度 = `bookCount`、Top N 降序；空年零值呈现不报错；
- [ ] 年度目标值可设置/编辑（G-2 裁定入口），非法值降级默认；进度/差量正确；
- [ ] AI 叙事：发送预览与实际 payload 一致（同一装配函数产物）；**payload 不含年度目标值**（黑名单断言门禁绿）；叙事数字与本地聚合一致（只转译）；引用书目全部来自切片书单；
- [ ] 叙事区标注「AI 生成，基于本地数据」；可重新生成；缓存按 year+locale 隔离、可清除；断网时缓存可读；
- [ ] AI 未启用时年度视图无叙事痕迹（无区块、无入口文案）；
- [ ] 黑名单穷举断言单测绿（年度场景专项 + 既有画像场景不回归）；全量 `pnpm test`/`build`/Playwright 绿。

### E. 后置阶段（不在本批次）

- **阅读报告分享图**（bookology §5.3「衔接未来阅读报告分享」）：纯前端 Canvas 生成年度回顾分享图，页内呈现先行（本批次），分享图留扩展。
- **Phase 3 本地服务后端**（Ollama/LM Studio 同契约）：已记 [ai-features-batch.md E 节](./ai-features-batch.md)。

### F. 依赖

**零新增运行时依赖确认**（同 Phase 1 结论，[ai-features §1](../specs/ai-features.md#1-范围与依赖)）：既有 `zod` + 原生 `fetch`/`AbortController` + 手写 SSE 解析 + 既有 `react-markdown`/`remark-gfm`（Phase 1 已引入）——年度叙事与画像共用渲染链路，无新包。任何新包引入前须过 [npm-supply-chain-security §3](../npm-supply-chain-security.md) 审查 + `pnpm verify`/`audit`。
