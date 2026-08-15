# 质量硬化路线图 — 任务分解

> 本文件记录 2026-08-14 全面评估（5 模块代码侦察 + 实测 build/test/e2e/audit/浏览器视觉）发现的问题清单与改进任务。
> 评估结论：**代码层接近优秀 OSS 水准（约 8/10），工程化基建层不达标（无 CI、无 LICENSE、主分支 E2E 红灯、审计噪音 19 项）**。
> 工作流：[SDD + TDD](../ai-agent-workflow-rules.md) — 每个修复先写 Red 测试，再实现到 Green。
> 规格权威：各 feature spec 不变；本文件只派任务、不重写规格。涉及规格改动的任务已在条目内注明。

## 评估基线（证据）

| 项 | 实测结果 |
|---|---|
| 单元测试 | 651 tests / 54 files 全绿（3.1s） |
| 生产构建 | `pnpm build` 绿；主 chunk 262KB，图表懒加载 |
| E2E | 38 例中 **4 例稳定红**（`748f52a` 响应式双视图引入，复跑两次一致） |
| Lint | 仅 fast-refresh 警告（cosmetic） |
| 安全审计 | `pnpm audit`：19 漏洞（7 high）——**全部**经 `shadcn` CLI 传入（undici/dotenvx/ajv/hono…），运行时依赖零命中 |
| CI | `.github/workflows/` **不存在**；无 Dependabot/Renovate、无 tag/release、version 0.0.0 |
| 开源合规 | **无 LICENSE**（README 已写 Contributing，法律上尚未开源） |
| 数据正确性 | `dedupeBorrowCycles` exactKey 缺身份分量 → 同秒空条码不同书误判重复（数据丢失，见 Q-1） |

## 标准全景（适用性评估）

> 本项目适用的国际/领域规范清单。达标项不派任务；不适用项记录结论防止重复评估。

| 标准/规范 | 类别 | 适用性 | 现状 | 任务 |
|---|---|---|---|---|
| WCAG 2.2 | 无障碍 | 适用（纯前端 SPA 全量适用） | 未达 AA（3 项 A 级失败） | 阶段 2 |
| EN 301 549 / Section 508 | 无障碍法规 | 等价基线 | 随 WCAG 2.2 AA 覆盖 | 阶段 2 |
| OWASP Top 10 / ASVS 子集 | Web 安全 | 适用（无后端 SPA 子集） | 无 CSP；XSS 面窄（无 `dangerouslySetInnerHTML`，React 转义兜底） | SEC-1 / SEC-2 |
| Core Web Vitals（LCP/INP/CLS） | 性能 | 适用（前端性能基线） | 无基线测量；图表懒加载已做 | SEC-4 |
| ISO 8601 / RFC 3339 + IANA tz | 时间 | 适用 | **已达标**（design-decisions §2 UTC 存储 + @vvo/tzdb） | — |
| ISO 2108（ISBN） | 书目域 | 适用 | **已达标**（`src/lib/isbn.ts` 校验/转换 + 测试） | — |
| CLC / DDC / UDC / LCC | 分类法域 | 适用 | 已达标 CLC/DDC；UDC/LCC 预留（design-decisions §5） | — |
| BCP 47 / Unicode CLDR | i18n | 适用 | **已达标**（原生 Intl + i18next） | A-5 |
| Web App Manifest / Service Worker | 平台（PWA） | 部分——README 声称 offline，无 SW 实现 | SEC-3 |
| Conventional Commits / SemVer | 工程 | 适用 | CC 已用；SemVer 未起步（0.0.0、无 tag/release） | SEC-5 |
| GDPR / PIPL | 隐私合规 | **不适用**——工具提供者非控制者/处理者；用户本人数据处理属家庭豁免（GDPR Art.2(2)(c)、PIPL §72）。已评估定案，不派任务 | — |

## 范围与边界
 
- **进入条件**：阶段 0–5 任务全部就绪即可开工；阶段间存在依赖时已注明。
- **非目标**：不改实体数据模型、不加 Object Store/索引（Q-6 除外，仅补读路径归一）；不引入新运行时依赖；不重写 UI 框架/组件库；不做功能扩展（阅读笔记、多用户等未来项不在本路线图）。
- **依赖面共识**：本路线图唯一依赖变更是**移除** `shadcn`（I-3）；SEC-3 可选 SW 若做需走供应链审查（新 devDep），不落本批次。


## 并行执行协议

> 定案：路线图任务**可并行执行**。唯一硬约束是阶段门——阶段 0 全绿 → 阶段 1 → 阶段 2/3/4/5（SEC-5 另依赖阶段 0–2 绿，见文末依赖链）。阶段内各任务逻辑独立，已逐一核对改动文件与区域，无「A 产出是 B 输入」的硬依赖；共享文件仅需合并协调（见下）。

### 并行批次

- 阶段 0：Q-1~Q-6 一批并行；Q-2 负责转绿 4 例 E2E 红灯，批内其余任务不触碰 E2E 断言。
- 阶段 1：I-1~I-3 一批并行；I-1 的 audit 硬门禁在 I-3 落地前为已知红——合并顺序 I-3 先合，I-1 再验绿。
- 阶段 2/3/4/5：CI 门禁生效后，各阶段内部并行，阶段间亦可并行启动（SEC-5 除外）。

### 共享文件簇

同一文件多个任务改动区域互不重叠，git 合并可解；执行时每任务独立分支/worktree、小步提交，按区域先合先得：

| 文件 | 任务（改动区域） |
|---|---|
| `src/enrich/enrich-service.ts` | Q-3（状态回写异常）、Q-5（`hasLookupKey` metaId 判定） |
| `src/routes/library/$bookId.tsx` | Q-3（catch 兜底）、Q-6（读路径归一接入）、H-2（publishDate 下沉）、SEC-2（外链守卫） |
| `src/routes/library/index.tsx` | Q-2（data-slot 容器）、A-2（筛选 Select 可访问名）、A-6（目标尺寸审计）、Q-6（列表读路径归一接入） |
| `src/routes/profile.tsx` | A-2（日期输入 label）、A-6（`aria-busy`/`aria-live` 遮罩）；A-1 的图表容器在 `src/profile/charts/*`（5 图），与 A-2/A-6 不重叠 |
| `src/routes/library/-edit-dialog.tsx` | A-5（分隔符）、H-2（publishDate 归一） |
| `src/lib/types.ts` | H-1（删 `supportedFormats`）、H-3（瞬态字段 JSDoc） |
| `src/parsers/dedupe.ts`、`src/parsers/pipeline.ts` | Q-1（exactKey/exactByKey）、H-1（dedupe 第 4 参）、H-3（缺 `_bookKey` 警告） |
| `README.md` | I-1（CI 说明）、I-2（License 徽标）、SEC-3（offline 措辞） |
| `AGENTS.md` | I-1（ci 命令）、I-3（dlx 命令）、SEC-5（发布流程） |
| `package.json` + lockfile | I-3（移除 shadcn 重锁）、SEC-5（version）——顺序执行，避免 lockfile 反复冲突 |
| `e2e/editing.spec.ts` | Q-2、T-3；`e2e/classification.spec.ts`：Q-2、T-5 |

**软耦合注意**：T-3 的 `e2e/fixtures.ts` 是 T-1「断言从 fixture 派生」的天然底座——并行时 T-1 先自行派生，T-3 合入后再接线；Q-1 改变 dedupe 行为，合入后跑一次全量 E2E 复查（app.spec 硬编码统计若受波及，归 H-6 处理）。

### 进程与验证卫生

- **E2E 单实例**：`playwright.config.ts` webServer 固定端口 4173（`pnpm build && pnpm preview`）——同一 checkout 同一时间只跑一个 `pnpm test:e2e`；并行任务用不同 worktree 或串行执行测试。
- **每任务验收**：`pnpm test` + `pnpm build`；触碰 E2E 的任务合并前跑一次全量 `pnpm test:e2e`（先合 Q-2 让基线转绿）。
- 流程卫生遵循 [ai-agent-workflow-rules §3](../ai-agent-workflow-rules.md#3-进程生命周期管理启动即登记结束即清理)。


---

## 阶段 0：正确性与主分支红灯（最高优先）

> 数据正确性先于基建；主分支先绿，CI 上来即绿。Q-1~Q-6 相互独立，可并行。

### Q-1 dedupe 精确键数据丢失缺陷（真实 bug）

- **现状**：`src/parsers/dedupe.ts:306-308,389` 精确键为 `sourceId|barcode|borrowedAt.getTime()`，**不含 bookId/metaIdKey**。空条码两本不同书在同一秒借出 → 第二条候选被判「批次内重复」跳过且 rawRecord 标 skipped；既有周期侧 `exactByKey` 同样误杀。
- **改动**：`exactKey` 与 `exactByKey` 加入身份分量（候选侧用 `cand.bookId ?? ''`，既有侧用 `ex.bookId`）。同键同书仍去重；同键不同书不再互相吞。
- **测试（Red 先行）**：`dedupe.test.ts` 补「同秒空条码不同 bookId 两条候选均保留」「既有周期同键不同 bookId 不跳过」。
- **验收**：`pnpm test` 绿；`pipeline.test.ts` 既有确定性/幂等用例不回归。

### Q-2 修复 4 个 E2E 红灯（748f52a 回归）

- **现状**：桌面表格（`hidden lg:block`）与卡片网格（`lg:hidden`）双视图同时挂 DOM（CSS 断点切换，`src/routes/library/index.tsx:295,341`），书名/徽标文本出现两份 → strict-mode 冲突：
  - `e2e/classification.spec.ts:60`：`[data-slot="badge"]` count=1 断言失败（现为 2）；
  - `e2e/editing.spec.ts:190`（Placeholder 可见性）、`:237`（Set count=1）、`:252`（小说A 可见性）。
- **改动**：给两容器加 `data-slot="library-table"` / `data-slot="library-cards"`（沿用 sidebar/badge 的 data-slot 约定）；E2E 断言按容器限定——桌面视口（1280px ≥ lg）断言表格容器，另补一例 375px 视口卡片容器用例锁定 card grid。
- **理由**：CSS-only 双渲染是合理模式（无 JS resize 状态、无 hydration 成本），不改渲染结构、只修测试作用域。
- **验收**：`pnpm test:e2e` 38 例全绿；新增移动端用例覆盖卡片视图字段可见性。

### Q-3 enrich 异常路径逸出（R1）

- **现状**：`src/routes/library/$bookId.tsx:200-223` `handleEnrich` 仅 try/finally 无 catch；`src/enrich/enrich-service.ts:129-139` `writeEnrichmentStatus` 内部 `validated()`/Dexie 写失败会抛出 → unhandled rejection，用户零反馈。
- **改动**：`enrichOneRecord` 把状态回写失败转为返回 `{kind:'failed'}` 而非抛出（补全「不抛错」契约）；UI 层 catch 兜底 `setEnrichMsg(failed)` 双保险。
- **测试**：`enrich-service.test.ts` 补「状态回写抛错 → 返回 failed 不抛」。
- **验收**：`pnpm test` 绿；详情页补全在断网/Dexie 异常下显示失败文案而非无响应。

### Q-4 enrich not_found 缺键漏判（R2）

- **现状**：`src/enrich/providers/szlib/detail.ts:43-46` 判定 `json.title === '' && json.isbn === ''`——缺键（undefined）或 `{}` 响应漏判为 ok+全 null，弹空建议 Dialog。
- **改动**：字段读取归一 `?? ''` 再判定。
- **测试**：`detail.test.ts` 补 `{}`、缺 title/isbn 键负载 → `not_found`。
- **验收**：`pnpm test` 绿。

### Q-5 enrich metaId 字符串 '0' 放行（R4）

- **现状**：`src/enrich/enrich-service.ts:36-41` 与 `src/enrich/providers/szlib/index.ts:22-25` 均 `=== 0` 严格比较，字符串 `'0'` 通过候选判定 → 白发一次 not_found 请求。
- **改动**：统一 `String(x) === '0'` 或 Number 归一后比较（单一实现，两处共用）。
- **测试**：候选判定补 `'0'` 用例。
- **验收**：`pnpm test` 绿。

### Q-6 zod 默认值读路径兜底（M1 同类风险）

- **现状**：zod 默认值只覆盖写路径（Repository validate）；`useLiveQuery` 直读旧记录缺新字段（如 `parallelTitles`）时详情页直接崩溃——与已发生过的 M1（classCodes）同类。
- **改动**：`src/lib/` 加读路径归一函数（与 schema 默认值同源，避免双维护）：读取侧 `parseOrDefault` 或启动回填补字段（选前者，无全表扫描成本）。
- **测试**：构造缺字段旧记录（fake-indexeddb），详情页/列表渲染不崩。
- **验收**：`pnpm test` 绿；`pnpm build`。

**阶段 0 总验收**：`pnpm test` + `pnpm test:e2e` + `pnpm build` 全绿。

---

## 阶段 1：项目基建（使红灯无法再进主分支）

> 依赖阶段 0 绿。I-1~I-3 独立可并行。

### I-1 CI（GitHub Actions）

- **现状**：无任何 CI；`748f52a` 红灯正是无门禁的直接代价。
- **改动**：新增 `.github/workflows/ci.yml`：
  - 触发：push + PR to main；
  - jobs（pnpm 11 经 corepack 固定，Node 20+）：
    1. `verify`：`pnpm install --frozen-lockfile --ignore-scripts`；
    2. `lint`：`pnpm lint`；
    3. `build`：`pnpm build`（含 tsc -b）；
    4. `test`：`pnpm test`；
    5. `e2e`：`pnpm exec playwright install --with-deps chromium` + `pnpm test:e2e`；
    6. `audit`：`pnpm audit --audit-level=high` 为硬门禁（I-3 落地后归零）。
  - PR 合入门槛：全部绿；README/AGENTS.md 补 CI 状态说明。
- **验收**：故意制造一次失败提交验证门禁拦截（Red 验证 CI 本身）。
- **关联**：[AGENTS.md](../../AGENTS.md) 命令表补 `ci` 说明。

### I-2 LICENSE ✅（2026-08-15 完成）

- **现状**：无 LICENSE——法律上非开源，与 README「Contributing」矛盾。
- **改动**：根目录新增 `LICENSE`（**默认 MIT**；若倾向 copyleft 改 GPL-3.0，需立项时定夺——本路线图按 MIT 排期，README 补 License 徽标）。
- **落地（2026-08-15，定夺为 MIT，版权人 ckyOL）**：
  - `LICENSE`：MIT 全文；
  - `package.json`：补 `"license": "MIT"` 字段；
  - `README.md` / `README-zh.md`：License 徽标 + License 小节；
  - 合规延伸：新增 `THIRD_PARTY_NOTICES.md`（20 个运行时依赖的 SPDX 表格、版权行、Apache NOTICE 全文、MIT/ISC/Apache-2.0 标准许可全文——覆盖 Apache-2.0 §4(d) NOTICE 保留义务（ECharts/Dexie/comlink/CVA/dexie-react-hooks）与 MIT/ISC 再分发声明义务）与 `scripts/generate-third-party-notices.mjs`（幂等生成脚本，`pnpm generate:notices` 重跑，新增依赖后需重新生成）。
- **验收**：`license` 字段 / LICENSE / 双 README 徽标三者一致（grep 验证）；生成脚本幂等性通过。

### I-3 移除 shadcn CLI 运行时依赖
- **现状**：`package.json:42` `"shadcn": "^4.14.0"` 挂在 **dependencies**——CLI 构建工具零运行时引用（已 grep 证实），却把 undici/@dotenvx/ajv/hono 整条供应链拖进 lockfile，造成 19 项 audit 噪音（7 high），与 [npm-supply-chain-security](../npm-supply-chain-security.md) 最小化原则自相矛盾。
- **改动**：
  - `package.json` 移除 `shadcn`；`pnpm install --frozen-lockfile` 重锁；
  - 组件引入改按需 `pnpm dlx shadcn@latest add <name>`（不落依赖）；AGENTS.md 与 supply-chain 文档同步该命令；
  - `components.json` 保留（dlx 仍读它）。
- **验收**：`pnpm audit --audit-level=high` **0 项**（或全绿无 high）；`pnpm build`/`pnpm test` 不回归。

---

## 阶段 2：无障碍（WCAG 2.2 AA）与本地化

> 术语统一：无障碍（accessibility）——原「可达性」一词在仓库内一律改称「无障碍」。
> 依赖阶段 1（CI 门禁生效后进）。A-1~A-6 独立可并行。

### 标准基准（评估依据）

- **合规目标**：**WCAG 2.2 Level AA**（W3C Recommendation，2023-10 发布、2024-12 终版）——优秀 OSS 与各国数字产品法规的通行基线；本项目为纯前端 SPA，WCAG 全量适用。
- **法规等价物**：EN 301 549（欧盟 ICT 无障碍协调标准，web 条款对齐 WCAG 2.1 AA；欧洲无障碍法案 EAA 2025-06 起强制）、美国 Section 508（对齐 WCAG 2.0 AA）。按 WCAG 2.2 AA 排期即天然覆盖前两者基线。
- **验证方法**：axe-core 自动化抽查（仅覆盖约 30–40% SC）+ 手工键盘流 + e2e 语义断言（`getByRole`/`getByLabel`，负路径并入 T-1）；不做一次性全面审计，随各任务内嵌验证。

### 评估对照表（2026-08-14 基线 vs WCAG 2.2）

| SC | 级别 | 现状 | 任务 |
|---|---|---|---|
| 1.1.1 非文本内容 | A | ❌ 5 个 canvas 图表无 `role="img"`/aria-label（Summary 卡片文本部分补偿，不足以构成替代文本） | A-1 |
| 1.3.1 信息和关系 | A | ⚠️ 表格 `aria-sort`、radiogroup 已达标；日期输入 label 未关联 | A-2 |
| 2.1.1 键盘 | A | ❌ treemap 下钻仅鼠标事件，键盘用户只能回退不能下钻 | A-1 |
| 2.4.6 标题和标签 | AA | ⚠️ 部分 Select/日期输入缺可访问名 | A-2 |
| 2.5.3 标签在名称中 | A | ⚠️ 视觉 `<span>` 标签与程序化名未关联 | A-2 |
| 2.5.8 目标尺寸（2.2 新增） | AA | 未测——移动端卡片/图标触点尺寸 | A-6 |
| 3.1.1 页面语言 | A | ✅ `<html lang>` 随 locale 同步（i18n/index.ts） | 已达标 |
| 3.1.2 局部语言 | AA | ❌ vendored 组件英文 a11y 名 + 英文 `Error.message` 上屏 | A-3 / A-4 |
| 3.3.1 错误标识 | A | ⚠️ 表单 `aria-invalid`/`role="alert"` 已有；原始异常未标识；日期 from>to 倒置无校验 | A-2 / A-4 |
| 3.3.2 标签或说明 | A | ❌ 日期范围输入无标签、无说明 | A-2 |
| 3.3.3 错误建议 | AA | ❌ 失败无用户可行动建议（含 ISBN 含字母静默丢值） | A-4 |
| 4.1.2 名称、角色、值 | A | ⚠️ radiogroup/aria-checked、icon 按钮 aria-label 达标；日期输入/Select 缺名 | A-2 |
| 4.1.3 状态消息 | AA | ❌ 计算遮罩/加载态无 `aria-busy`/`aria-live` | A-6 |
| 1.4.10 重排 | AA | ✅ 响应式三档布局（748f52a）已达标 | 已达标 |

**结论**：Level A 存在 3 项硬失败（1.1.1、2.1.1、3.3.2 相关），Level AA 存在 4 项失败——当前**未达 WCAG 2.2 AA**；A-1~A-6 完成后即具备宣称 AA 的依据（含 axe 抽查记录）。

### A-1 图表替代文本与键盘操作

- **SC**：1.1.1（A）、2.1.1（A）、1.3.1（A）
- **现状**：5 个 ECharts canvas 容器无 `role="img"`/aria-label；treemap 下钻仅 canvas 鼠标点击。
- **改动**：
  - 各图容器加 `role="img"` + `aria-label`（`t()` 键，zh-CN/en 同步）；
  - **键盘等价路径（2.1.1 为 A 级，不可豁免）**：treemap 旁加同级「列表视图」Toggle——同一分类树数据渲染为键盘可导航的分层列表（复用分类面包屑组件数据源，下钻/回退与 canvas 同步），满足「等效且同页可达」的合规替代；canvas 内箭头键导航不做（ECharts 无原生 a11y 层，成本不成比例）。
- **测试**：e2e 补各图 aria-label 断言 + 列表视图 Tab 键盘下钻断言。
- **验收**：`pnpm test:e2e` 绿；axe 抽查 0 critical/serious。

### A-2 表单可访问名与输入校验

- **SC**：2.5.3（A）、3.3.2（A）、4.1.2（A）、2.4.6（AA）、3.3.1（A）
- **现状**：`src/routes/profile.tsx:209-225` 日期输入 label 未 `htmlFor`/无 aria-label；`timeline.tsx:144-152`、`library/index.tsx:188-213` 筛选 Select 无可访问名（与移动端排序 Select 有 aria-label 的做法不一致）；日期 from>to 倒置无校验无提示。
- **改动**：补 `htmlFor`/`aria-label`，点击标签可聚焦；日期范围倒置时输入 `aria-invalid` + 可行动提示（或直接钳制并提示）。
- **测试**：e2e 断言 `getByLabel` 可定位 + 倒置输入提示断言。
- **验收**：`pnpm test:e2e` 绿。

### A-3 vendored 组件无障碍名本地化

- **SC**：3.1.2 局部语言（AA）
- **现状**：`ui/dialog.tsx:77`、`ui/sheet.tsx:78`（sr-only "Close"）、`ui/sidebar.tsx:199,274,286-289`（"Displays the mobile sidebar."/"Toggle Sidebar"）英文硬编码，读屏在 zh-CN 下读出英文。
- **改动**：透传 `aria-label` prop 或注入 `t()` 键（i18n 两语言同步）。
- **验收**：`pnpm test:e2e` 语言切换下 aria 名切换断言。

### A-4 错误消息识别与建议

- **SC**：3.3.1（A）、3.3.3（AA）、3.1.2（AA）
- **现状**：`import.tsx:279`（`{runError}`）、`settings.tsx:249,353`（`{importError}`/`{error}`）直接展示 `(e as Error).message`——ZodError 等英文技术长文本上屏；无「下一步怎么做」的可行动建议。
- **改动**：`src/lib/error-messages.ts` 错误分类映射（`ErrorKind` → 本地化文案 + 可行动建议 i18n 键）；UI 展示通用本地化文案，原始 message 走 `console.error` 保留诊断。
- **测试**：纯函数映射单测 + i18n 键存在性测试。
- **验收**：`pnpm test` 绿；导入失败路径 e2e（并入 T-1）断言无英文技术文本。

### A-5 语言相关分隔符

- **SC**：非 WCAG 条款——本地化质量项（与 3.1.1/3.1.2 同源）
- **现状**：`-edit-dialog.tsx:199,202,205,238,240,380,677` 数组展示 `join('，')`——en 语言下作者/主题仍以中文顿号连接。
- **改动**：`Intl.ListFormat`（按 `i18n.language` 构造）或 `t()` 注入分隔符。
- **测试**：en/zh 分隔符单测。
- **验收**：`pnpm test` 绿。

### A-6 状态消息与目标尺寸审计

- **SC**：4.1.3 状态消息（AA）、2.5.8 目标尺寸（AA，2.2 新增）
- **现状**：Summary/Money 卡片计算遮罩（`profile.tsx:348-356`）与多处加载态裸 `<div>` 无 `aria-busy`/`aria-live`，读屏用户不知道在计算；移动端卡片/图标触点尺寸从未测。
- **改动**：遮罩/加载容器加 `aria-busy`，计算完成结果更新用 `aria-live="polite"`；对交互目标（图标按钮、卡片链接、Tab）做 24×24 CSS px 目标尺寸审计，不足者扩内边距。
- **测试**：e2e 断言 `aria-busy` 过渡与完成态。
- **验收**：`pnpm test:e2e` 绿；审计清单记录于本文件状态节。

---

## 阶段 3：测试加固

> 依赖阶段 1。T-1~T-6 独立可并行（T-3 内两子项独立）。

### T-1 导入负路径 E2E

- **现状**：导入仅 happy path + 警告路径；无文件类型不支持、解析失败、取消、去重合并 UI 断言。
- **改动**：`e2e/import-negative.spec.ts` 新文件：不支持类型拒绝文案、坏 JSON 失败报告、取消流程、二次导入同文件去重统计（断言与 fixture 派生而非硬编码）。
- **验收**：新 spec 绿。

### T-2 恢复模式覆盖

- **现状**：只测默认 snapshot；incremental/overlay/冲突未测。
- **改动**：`settings.spec.ts` 补 incremental 追加、overlay 覆盖、参照冲突拒绝三例。
- **验收**：spec 绿。

### T-3 夹具收敛与类型化

- **现状**：150-lane 大夹具内联复制三份（profile.spec.ts:114-183、diagnose.spec.ts、editing.spec 区域）；`editing.spec.ts:24-102` 用 `Record<string, unknown>` 重实现工厂（字段拼错静默通过）。
- **改动**：大夹具单一导出进 `e2e/fixtures.ts`；editing 工厂改复用类型化工厂；删除 `diagnose.spec.ts`（零断言、固定 3s 等待、永远通过）与 `smoke.spec.ts`（功能 E2E 齐备后冗余占位）。
- **验收**：`pnpm test:e2e` 绿且 suite 无零断言文件。

### T-4 ArrayBuffer 入口测试

- **现状**：`szlib.ts` validate/parse 的 ArrayBuffer 分支（:87-89,120-122）零测试。
- **改动**：`szlib.test.ts` 补 ArrayBuffer 输入两例（编码正确/错误）。
- **验收**：`pnpm test` 绿。

### T-5 分类树降级路径

- **现状**：`classification.spec.ts:55-58` 三个 JSON 路由永远拦截成功，404 降级到一级表路径未测。
- **改动**：补分类 JSON 路由中断 → 芯片/treemap 降级断言。
- **验收**：spec 绿。

### T-6 浏览器矩阵（可选）

- **改动**：`playwright.config.ts` 补 webkit/firefox 项目；CI 仅跑 chromium 保时长，其余本地按需。
- **验收**：三引擎本地绿。

---

## 阶段 4：卫生与文档漂移

> 依赖阶段 1。H-1~H-6 独立可并行。

### H-1 死代码清理

- **现状**：`useEChartsTheme`（`use-theme.tsx:159-164`，仅自身测试引用，生产路径在 `use-echarts.ts:155` 重复逻辑）；`supportedFormats`（`types.ts:20`）全库零读取；`ParseResult.stats` 三字段只产出不消费；`rowRef`/`rawRef` 零调用；`dedupeCatalogsAndBooks` 第 4 参 `_parser` 未使用。
- **改动**：删除或真正接线（首选删除，含对应测试）；`useEChartsTheme` 删除后 `use-echarts.ts` 成为主题唯一实现。
- **验收**：`pnpm build`/`pnpm test` 绿；grep 无残留引用。

### H-2 publishDate 归一重复下沉

- **现状**：`$bookId.tsx:313-318` 与 `-edit-dialog.tsx:208-212` 同一段 `typeof === 'object'` 防御重复。
- **改动**：下沉 `src/lib/` 单一实现，两处引用。
- **验收**：`pnpm test` 绿。

### H-3 贡献指南与实现对齐

- **现状**：`docs/metadata/parsers/contributing-parser.md:20` import 路径 `../types` 实为 `./types`；示例 parse 签名缺 `unknown[]` 入参与 `filterRows`；:50 注册指向不存在的 `src/parsers/index.ts`（实为 registry.ts）；瞬态字段契约 `_rowIndexes`/`_bookKey`（`szlib.ts:171-175,272,281` ↔ `pipeline.ts:246-248,470-478`）完全未文档化——按指南写的 parser 会产出静默错误数据。
- **改动**：指南同步修正；瞬态契约写入 `types.ts` JSDoc（首选）或改类型化字段；pipeline 对缺失瞬态字段的候选加警告而非静默。
- **验收**：文档与实现 grep 一致；新增「缺 `_bookKey` 候选 → 警告」测试。

### H-4 szlib_scraper 加固

- **现状**：`szlib_scraper.py` 零测试；:84 页容量魔法数；单页失败直接 break 无重试/resume；int()/AttributeError 错误归因误标「JSON 解析失败」（:106-109）；无最大页数保护。
- **改动**：页容量从响应派生；失败重试（退避）+ 断点续传；错误归因分类修正；补最小 pytest（requests mock）。
- **验收**：`uv run pytest` 绿。

### H-5 启动回填失败可见性

- **现状**：`main.tsx:14-21` 三回填 `.catch(() => {})` 静默吞错——classCodes 回填失败时分类筛选静默不完整。
- **改动**：至少 `console.error` + 分类索引数据页内自愈（读取侧兜底，与 Q-6 同源实现）。
- **验收**：回填失败时控制台有错误且 UI 不崩（Q-6 测试延伸）。

### H-6 E2E 数据耦合

- **现状**：`app.spec.ts:166-167` 硬编码 `'11'/'12'` 统计，与 `szlib-sample.json` 行数强耦合，样本行数变动即碎。
- **改动**：断言值从 fixture 派生（测试侧计算期望值）。
- **验收**：spec 绿。

## 阶段 5：安全与平台规范（OWASP 子集 / Web 平台 / 工程规范）

> 标准全景表中适用项的落地。依赖阶段 1（CI 后进）；SEC-5 依赖阶段 0–2 绿。

### SEC-1 CSP 与部署安全基线（OWASP A03/A08）

- **现状**：`index.html` 无 CSP、无 Referrer-Policy meta；静态托管（GitHub Pages 等）无法配 header；OPAC 生产直连唯一域名 `https://www.szlib.org.cn`（dev 走 vite proxy 同源，`src/enrich/providers/szlib/index.ts:13-16`）。
- **改动**：
  - `vite.config.ts` 用 `transformIndexHtml` **仅 build 时**注入 CSP meta（dev 下 Vite/plugin-react 有内联脚本，注入即坏）：
    `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://www.szlib.org.cn; font-src 'self'; object-src 'none'; base-uri 'self'`
    （`style-src 'unsafe-inline'` 为 ECharts/Radix 内联样式保留，注释说明）；
  - meta `referrer-policy: strict-origin-when-cross-origin`（外链已 `rel="noreferrer"`，双保险）；
  - **注意**：`frame-ancestors` 经 meta 无效（浏览器忽略）——部署清单记录：自有托管加 `X-Frame-Options: DENY` header；Pages 托管接受默认。
- **测试**：e2e 断言生产构建 CSP meta 存在 + 全流程 console 无 CSP violation。
- **验收**：`pnpm build` + `pnpm test:e2e` 绿。

### SEC-2 外链 scheme 白名单

- **现状**：`$bookId.tsx:266-267` `href={detailUrl}` 由 provider 模板构造（恒 `https://www.szlib.org.cn/opac/searchDetail`），`rel="noreferrer"` 已有；无 scheme 防御——新 provider 若从数据构造 URL 即引入 `javascript:` 注入面。
- **改动**：`src/lib/` 加 `isSafeExternalUrl`（仅 `https:`）；渲染层 defense-in-depth 守卫，违者不渲染；`OpacProvider.detailUrl` 契约 JSDoc 明示「仅 https 或 null」。
- **测试**：纯函数单测（`javascript:`/`data:`/`http:` 拒绝、`https:` 放行）。
- **验收**：`pnpm test` 绿。

### SEC-3 离线声明核对（PWA）

- **现状**：README「works fully offline」与实现不符——无 service worker/manifest；IndexedDB 数据离线可用，但静态资源依赖 HTTP 缓存，刷新即失效。
- **改动（boring 选择）**：README 措辞修正为「数据离线存储于浏览器（IndexedDB）；断网可用性取决于托管方缓存策略，本仓库不提供 Service Worker」。SW（`vite-plugin-pwa`）列为可选后续，若做须走 [npm-supply-chain-security](../npm-supply-chain-security.md) 审查（新 devDep）。
- **验收**：README 与实际能力一致。

### SEC-4 Core Web Vitals 基线

- **现状**：无性能基线；主 chunk 262KB（gzip 83KB），图表懒加载 chunk 259KB 按需。
- **改动**：Lighthouse 本地一次测量（3G 节流移动档）记录 LCP/INP/CLS 于本文件状态节；预算：**LCP ≤ 2.5s、INP ≤ 200ms、CLS ≤ 0.1**；超标项转任务（Lighthouse CI 列为可选后续）。
- **验收**：基线记录；无超标或超标项已立项。

### SEC-5 SemVer 与发布起步

- **现状**：version 0.0.0；无 tag/release/changelog（Conventional Commits 已就位）。
- **改动**：阶段 0–2 完成后首个发布 v1.0.0：`package.json` version、git tag、GitHub Release + changelog（首版手写，后续可引入 conventional-changelog）；AGENTS.md 补发布流程段。
- **验收**：tag + release 存在；AGENTS.md 发布流程可执行。

---

## 落地原则（所有阶段共同）

- **SDD + TDD**：每个任务先写 Red 测试（Vitest/Playwright），实现到 Green，再 Refactor；不得跳过 Red。
- **UI 文案禁止硬编码**：可见文本经 `react-i18next` `t()`，新增 key 同步补 `zh-CN`/`en` bundle（[i18n-conventions](../i18n-conventions.md)）。
- **不破坏既有测试**：每任务结束跑 `pnpm test` + `pnpm build`；阶段 0 结束与阶段 1 开始前跑全量 `pnpm test:e2e`。
- **提交粒度**：Conventional Commits，按任务拆分（`fix(parsers):`、`ci:`、`chore(deps):`、`test(e2e):`、`docs:`…）。
- **性能规则**：不引入全表扫描进渲染路径；读路径归一不做深层拷贝（一次映射）。
- **无障碍原则**：新 UI 必须满足 WCAG 2.2 AA（对照表为基线）；语义化 e2e 断言优先 `getByRole`/`getByLabel`；新增 canvas/自定义交互须同时提供键盘等价路径。
- **安全原则**：新增网络接触点/外链必须过 SEC-2 scheme 白名单并同步 CSP；`connect-src` 白名单单一来源（现为 OPAC 域名），新 provider 引入新域名先评估 CSP 影响。
- **进程卫生**：[ai-agent-workflow-rules §3](../ai-agent-workflow-rules.md#3-进程生命周期管理启动即登记结束即清理)——E2E/预览进程用完即关。

## 状态

- 2026-08-15 **I-1 完成**：`.github/workflows/ci.yml` 落地（push+PR to main，verify/lint/build/test/e2e/audit 六 job，audit 硬门禁）；README 双版 CI 徽标 + AGENTS.md 命令表补 CI 说明。**Red 验证通过**：临时分支 `ci-red-verify`（故意失败测试）+ PR，Test job 在 `pnpm test` 步骤红掉拦截，PR 未合并即关、分支已删。偏差：GitHub runner 已移除 corepack（实测 `Unable to locate executable file: pnpm`），改用官方 `pnpm/action-setup@v6`（version 11.9.0，v6 消除 Node-20 deprecation 警告），checkout/setup-node 升 v5。
- 2026-08-15 **I-3 完成**：`shadcn` 移出 dependencies，lockfile 重锁（674→400 keys，仅 shadcn 子树删除，其余逐位一致）；`components.json` 保留；AGENTS.md 与 supply-chain 文档补 `pnpm dlx shadcn@latest add <name>` 按需引入约定。偏差一：原「零运行时引用已 grep 证实」对 JS import 成立，但 `src/index.css:4` 存在 `@import "shadcn/tailwind.css"` 构建期引用——已将该 629 行文件**原样内联落盘**到同位置（零行为变化），`grep shadcn src/` 归零。偏差二：audit 归零需补 2 项既有工具链漏洞（非 shadcn 来源）——`pnpm-workspace.yaml` 新增 `overrides: nanoid ^3.3.18`（GHSA-2v37-7h3g-55p8）、`postcss ^8.5.23`（GHSA-fxqj-rqcc-2cmp，均 vite→postcss 链），两版本均过 7 天冷却；`pnpm audit` 现 0/0/0/0。原文档「19 项全部经 shadcn 传入」结论修正：19→2（I-3 后残留 1 high + 1 moderate，非 shadcn 来源），2→0（override）。
- 2026-08-15 **I-2 完成**：LICENSE 定夺并落地为 **MIT**（版权人 ckyOL）——`LICENSE` 全文、`package.json` `license` 字段、双 README 徽标与 License 小节；合规延伸落地 `THIRD_PARTY_NOTICES.md` + 幂等生成脚本 `scripts/generate-third-party-notices.mjs`（`pnpm generate:notices`），覆盖 20 个运行时依赖的再分发声明义务（Apache-2.0 §4(d) NOTICE 保留 + MIT/ISC 声明）。
- 2026-08-15 **并行执行定案**：全路线图任务确认可并行执行（阶段门为唯一硬约束，阶段内无逻辑依赖）；新增「并行执行协议」节——并行批次、共享文件簇与合并顺序、E2E 单实例等进程卫生。
- 2026-08-14 **标准全景定案**：新增「标准全景（适用性评估）」表——适用项 9 类（WCAG 2.2、OWASP 子集、CWV、ISO 8601/2108、分类法、BCP 47/CLDR、PWA、SemVer），已达标 4 项，派任务 5 项（SEC-1~SEC-5，阶段 5）；GDPR/PIPL 定案不适用（家庭豁免）。
- 2026-08-14 **术语与标准定案**：仓库用语统一为「无障碍」（accessibility，原「可达性」）；合规目标 **WCAG 2.2 Level AA**（等价覆盖 EN 301 549 / Section 508 基线），基线评估对照表与 6 项任务见阶段 2。
- 2026-08-14 **建档**：评估完成（阶段 0–5 全部待启动）。基线：651 单测绿、38 E2E 中 4 红（Q-2）、audit 19 项（I-3）、无 CI/LICENSE（I-1/I-2）、dedupe 精确键缺陷（Q-1）。
- 依赖链：阶段 0（Q-1~Q-6 并行）→ 阶段 1（I-1~I-3 并行）→ 阶段 2/3/4/5（可跨阶段并行启动；SEC-5 依赖阶段 0–2 绿）。
