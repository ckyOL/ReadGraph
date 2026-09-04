# 年度分享图里程碑 — 任务分解（Canvas 分享图，profile 年度视图扩展）

> 本文件是「阅读报告分享图」实现批次（SDD 阶段 0 已完成）的**唯一**任务执行清单，承接 [profile-annual-view-batch §E 后置阶段](./profile-annual-view-batch.md#e-后置阶段不在本批次)（该节 2026-09-03 更新为指向本文件）。规格权威：[reading-profile §4.1 年度分享图](../specs/reading-profile.md#41-年度分享图profileyear-新增)（2026-09-03 评审定稿，R1–R6 裁定已记录）；调研依据：[annual-share-card 调研记录](../research/annual-share-card.md)。
> 工作流：[SDD + TDD](../ai-agent-workflow-rules.md) — 规格已就位，按波次进 Tests(Red) → Code → Tests(Green) → Refactor。

## 里程碑范围与边界

- **进入条件**：规格已定稿（reading-profile §4.1，R1–R6 裁定记录在案）；`computeYearSlice` 契约与 `/profile/$year` 静态骨架已落地（[profile-annual-view-batch](./profile-annual-view-batch.md) 完结）；shadcn `dialog` 组件已就位（`src/components/ui/dialog.tsx`）；既有 Vitest 885+ 用例与 E2E 全绿。
- **本批次范围**：年度分享图最小闭环——分享图纯函数层（内容收敛 + canvas 布局描述 + 渲染器）、封面渐进加载器、入口按钮 + Dialog 预览 + 下载/系统分享、i18n 双语、E2E。
- **不在本批次**：人格化称号（R3 留 v2）；9:16 Stories 变体（R5 记增强）；封面拼贴乙版式（R2 甲先行，乙版式留 v2）；Web Share Target/og:image 等页面级分享优化。
- **依赖面共识**：**零新增运行时依赖**（R1 裁定手写 Canvas 2D；`dialog.tsx`/`lucide-react` 图标/`zod` 均已在位）；不引入新实体、不改 Repository 接口、不写库、无持久化（预览画布不落 localStorage/IndexedDB，规格 C1）。

## 并行执行策略

任务依赖与波次划分（跨任务契约由 reading-profile §4.1 锁定，无需协商；R1–R6 裁定即接口）：

| 波次 | 任务 | 并行依据 | 前置 |
|------|------|---------|------|
| **W1** | SC-1、SC-2 | 文件不相交（`share-content.ts` / `share-layout.ts`）；契约均为规格已定稿：内容白名单（§4.1 映射表）、版式结构（§4.1 四段） | — |
| **W2** | SC-3、SC-4 | 文件不相交（`share-canvas.ts` / `share-cover-loader.ts`）；SC-3 消费 SC-2 布局类型，SC-4 消费 SC-1 封面字段 | SC-1、SC-2 |
| **W3** | SC-5、SC-6 | 文件不相交（Dialog 组件 / 入口按钮 + i18n）；SC-5 消费 SC-3 渲染器，SC-6 仅加按钮与文案 | SC-3、SC-4 |
| **W4** | SC-7、SC-8 | SC-8 端到端依赖全部 | 全部 |

- **同文件串行**：`src/profile/year/share/` 目录内文件按任务独占（每任务一个模块文件 + 对应 test 文件），无并发者；`profile.$year.tsx` 仅 SC-6 触碰（SC-5 的 Dialog 组件独立文件，由 SC-6 挂载）。
- **验证不并行**：每波结束统一 `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build`，避免并行任务互相卡验证。
- **契约即规格**：跨任务接口均已定稿（下述各任务的类型签名即契约）；实现中发现规格缺口 → 先补 reading-profile §4.1 再继续，不得自行扩展契约。

## 阶段 1：纯函数层（W1 并行，TDD 核心）

- [x] **SC-1（W1）** `src/profile/year/share/share-content.ts`：分享图内容收敛纯函数 `buildShareContent(input): ShareContent`：
  - 输入类型 `ShareContentInput` 为**白名单硬约束面**：仅 `year`、`bookCount`、`topBooks`（Top 3，`{ bookId, count }`）、`classification`（Top 3）、`covers`（`Record<bookId, { title, authors, coverUrl } | undefined>`，year-book-index 同构）、`prevYear`（`{ year, bookCount } | null`，R4 历年对照）——**不含** `annualGoals`/`price`/`barcode`/`isbn13`/馆名字段（类型层面排除；规格 C2、§4.1 白名单审计）。
  - 输出 `ShareContent`：`{ year, bookCount, topItems: { title, authors, coverUrl, count }[]`（≤3，无对应书则跳过）、`topCategories: { name, ratio }[]`（≤3，占比 = value/bookCount）、`summary: { key, params }`（R3 平实总结句 i18n 描述符）、`delta: { prevBookCount } | null` }。
  - 纯函数：无 DOM/时钟/存储；同输入两次调用深等价。
  - 测试（Red 先行）：**黑名单穷举断言**——构造含 `annualGoals`/`price`/`barcode`/`isbn13`/馆名数据，断言 `buildShareContent` 输入类型编译期排除 + 运行时输出序列化文本不含任何黑名单值（逐值断言，同 ai-features §3.3 形态）；Top 3 截取（N>3 舍弃）；占比归一；无上年数据 → `delta=null`；空分类/空 Top3 降级；纯函数性。
- [x] **SC-2（W1）** `src/profile/year/share/share-layout.ts`：canvas 逻辑坐标布局纯函数 `computeShareLayout(content: ShareContent, opts: ShareLayoutOptions): ShareLayout`：
  - 版式按规格 §4.1 四段（标识段 ~120 / 主视觉段 ~560 / 事实段 ~520 / 落款段 ~240，逻辑高 1440、宽 1080、边距 64）；每段产出**位置化绘制指令**（文本块：坐标/字号/字重/对齐/最大宽/最大行数 clamp；封面槽：坐标/宽高/占位字符；色块条：分段比例与颜色索引；罫线：坐标）。
  - `ShareLayoutOptions`：`yearLabel`（locale 数字格式由调用方传入，布局不触 `Intl`）、`summaryText`（i18n 渲染由调用方完成，布局只消费字符串）、`fontStack`（明朝大标题/sans 正文双栈，规格 §4.1 字体）。
  - 布局与文本内容解耦：布局不调 `t()`、不触 canvas——**同一布局描述可被真实 canvas 渲染器（SC-3）与测试断言（结构/坐标/行数 clamp 断言）共同消费**（防「预览一套导出另一套」漂移的规格基础）。
  - 测试：四段 y 区间划分与边距；文本 clamp（长题名截断行数）；封面三联槽位坐标（1080 内 3 等分）；色块条分段比例与 `classification` 占比一致；`delta=null` 时对照行不产出指令（R4）；字号/字重 token 与规格表一致。

## 阶段 2：渲染与封面加载（W2 并行）

- [x] **SC-3（W2，前置 SC-2）** `src/profile/year/share/share-canvas.ts`：渲染器 `renderShareCard(canvas, layout, opts): void` + 导出 `exportSharePng(canvas, filename): Promise<void>`：
  - `renderShareCard`：消费 SC-2 的 `ShareLayout` 指令逐条绘制（`fillText`/`drawImage`/`fillRect`/1px 罫线）；**恒亮色纸面**（R6：`#F9F7F2` 底 + `#2A2A2A` 字，不读当前主题）；数字半角 + tabular（规格 §4.1）；无封面槽绘占位块 `#EAE0D5` + 题名首字。
  - `exportSharePng`：`canvas.toBlob('image/png')` → `URL.createObjectURL` → `<a download="readgraph-annual-{year}.png">` 点击 → revoke；失败向上抛（Dialog 层 toast，规格状态表）。
  - devicePixelRatio ×2 定标（1080×1440 逻辑 → 2160×2880 物理）保证锐度；预览与导出**同一渲染函数**（预览缩放仅 CSS，规格「预览即导出」硬约束）。
  - 测试：vitest `node` 环境（现状，无 jsdom）——canvas 不可真实绘制，按 repo 既有「cheap stand-ins」模式（参照 `src/lib/locale.test.ts`）注入记录型 2D context stub：断言指令序列（drawImage 顺序=封面槽、占位槽 fillRect 色值、fillText 参数=坐标+字号、罫线调用数）；`toBlob` 失败路径（stub 抛错 → `exportSharePng` reject）；dpr 定标参数断言。**不引入 node-canvas/happy-dom**（供应链面零新增）。
- [x] **SC-4（W2，前置 SC-1）** `src/profile/year/share/share-cover-loader.ts`：封面渐进加载纯编排 `loadShareCovers(covers, { onEach }): Promise<void>`：
  - 逐张 `Image` + `crossOrigin='anonymous'` 试加载（规格「封面加载时序」）；成功 → `onEach(bookId, img)` 回调触发局部重绘；失败/超时不重试不阻断（单张 timeout 常量）。
  - 无网络字体（C1）同约束此处不涉及；不触 Dialog/React 状态（回调注入，UI 层接线）。
  - 测试（mock `Image` 构造器 + `load`/`error` 事件手动触发）：成功回调逐张触发；CORS 失败（error 事件）→ 跳过不重试；全部失败 → resolve 不抛错；`crossOrigin` 属性断言；无 coverUrl 的书不发起加载。

## 阶段 3：UI 接线（W3 并行）

- [x] **SC-5（W3，前置 SC-3 + SC-4）** `src/profile/year/share/share-dialog.tsx`：Dialog 预览组件（`dialog.tsx` 既有组件，按需 import）：
  - 打开时一次构建：`buildShareContent` → i18n summary/delta 文案渲染（`t()`）→ `computeShareLayout` → `renderShareCard` 到预览 canvas（`role="img"` + `aria-label` `profile.year.share.previewAria`）；封面由 SC-4 渐进补入（回调局部重绘）。
  - 动作：[下载 PNG]（主按钮 → `exportSharePng`；失败 toast `profile.year.share.error`，Dialog 不关闭）；[系统分享]（`navigator.share({ files })` 支持检测 `canShare` → 支持才渲染，File 构造自同一 Blob）。
  - 隐私注脚（`profile.year.share.privacyNote`）；**无任何持久化**（关闭即弃，不做 localStorage/IndexedDB 写）；数据变更不实时重绘（打开时刻快照语义，规格交互流程）。
  - i18n key 消费走 `t()` 取值路径断言（不断言字面量，i18n-conventions §8）。
  - 测试（`renderToStaticMarkup` + mock canvas/toBlob，参照 `profile.$year.test.tsx` 模式）：Dialog 打开渲染 canvas 与 aria-label；下载按钮触发 `exportSharePng`（mock 断言文件名）；`canShare` false → 系统分享按钮不渲染；空内容降级（Top 3 空 → 占位文案）。
- [x] **SC-6（W3，前置 SC-4 + SC-5；同文件改动 = `profile.$year.tsx` 唯一波次）** 入口接线 + i18n：
  - `src/routes/profile.$year.tsx` 书单区块标题行右侧「分享图」次按钮（GhostButton + `Share2Icon`，规格入口流程）：`slice !== null && slice.bookCount > 0` 才渲染（C7；`bundle-conditional` 三元非 `&&`）；点击挂载 SC-5 Dialog（lazy 动态加载，`bundle-dynamic-imports`——分享模块不进年度视图主包）。
  - i18n `profile.year.share.*` 双语同步补齐（`src/i18n/locales/{zh-CN,en}/pages.json`）：`share.button`/`share.dialogTitle`/`share.download`/`share.systemShare`/`share.privacyNote`/`share.error`/`share.previewAria`/`share.summary`（R3 平实句，含 `{count}`/`{categories}`/`{topCategory}` 插值）/`share.delta`（`{prevCount}` 插值，R4）/`share.brand`（字标）；对齐 [i18n-conventions](../i18n-conventions.md) 两语同时补齐 + 复数形态（`_one` 后缀先例）。
  - 测试：`bookCount=0` → 无分享按钮（C7 渲染断言）；按钮 aria/title 走 `t()` 取值路径；`year-book-grid` 标题行布局不破（快照或结构断言）。

## 阶段 4：验证（W4）

- [x] **SC-7（W4）** Vitest 全量回归：SC-1–SC-6 各阶段用例 + 既有全部用例绿；`pnpm exec tsc --noEmit` + `pnpm build` 通过；`pnpm audit --audit-level=high` 通过（零新增依赖，预期无告警）。
- [x] **SC-8（W4）** Playwright E2E 增补（`e2e/profile-annual.spec.ts`，规格 §7 E2E 行）：
  - 点「分享图」→ Dialog 预览渲染（canvas 元素 + aria-label 走 t()）；下载按钮触发 download 事件且文件名 `readgraph-annual-{year}.png`。
  - 无封面 fixture（导入不含 coverUrl 数据）→ 占位版式出图不报错；暗色模式打开 → canvas 亮色底像素断言（R6，`getComputedStyle`/像素采样先例同 `e2e/profile.spec.ts` canvas 采样）。
  - 多 locale 切换 → Dialog 内文案切换（图内文字由同一 `t()` 链路产出）；关闭 Dialog → 无持久化残留（localStorage key 数量断言）；空年无分享按钮（C7）。

## 落地原则（所有阶段共同）

- SDD：每个产物先写该阶段列出的 Vitest/Playwright 测试（Red），再实现到 Green，再 Refactor；不得跳过 Red；规格缺口先补 reading-profile §4.1 再继续。
- 数字同源：分享图与目标卡/Top N/书单/叙事**共用同一 `computeYearSlice` 产物**（reading-profile §2.7）——分享图不二次聚合，`prevYear` 由同一切片函数对上一年再调一次产出（不另写对照聚合）。
- 隐私护栏：**黑名单穷举断言（SC-1）是 W1 门禁**，不过不进入 W2；输入类型层面白名单（`ShareContentInput` 不含敏感字段）+ 运行时序列化断言双层。
- 预览即导出：`computeShareLayout` + `renderShareCard` 是预览与导出唯一路径（规格「预览即导出」硬约束）——UI 层不得手绘第二套。
- 纯函数隔离：`share-content`/`share-layout` 为纯函数（无 DOM/存储/时钟）；canvas 渲染器与 loader 是唯一 DOM 触点，回调注入不持 React 状态。
- UI 文案禁止硬编码：`t()` 双语，namespace `pages`（`profile.year.share.*`），新增 key 同步补 `zh-CN`/`en`；图内文字由 `t()` 渲染后传布局（随 locale 出图，C5）。
- 性能规则引用（reading-profile §8）：`bundle-barrel-imports`（`src/profile/year/share/` 按需 import）、`bundle-dynamic-imports`（Dialog 组件与渲染器 lazy，入口按钮外不拉 chunk）、`bundle-conditional`（分享按钮按 `bookCount > 0` 三元渲染）、`rerender-memo`（Dialog 内容快照化，不随页面 rerender 重绘）。
- 不破坏既有测试：每波结束 `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build`；本批次无新依赖，跳过供应链新包审查门（C4/R1）。

## 实现指南（给执行 LLM 的速查）

- **版式常量**：画布 1080×1440（逻辑），dpr ×2 物理；边距 64；四段高度 120/560/520/240；1px 罫线 `#E8E4DC`；占位块 `#EAE0D5`；数据强调色 `--chart-1` 亮色值 `#27477A`（R6 恒亮色——**硬编码亮色 token，不读 CSS 变量**，分享图不随暗色主题）。全部常量落 `share-layout.ts` 模块导出（测试与渲染器同源）。
- **字体栈**（规格 §4.1，DESIGN.md §3.1 同源）：大标题 `600 56px "Songti SC", "Noto Serif CJK SC", "Noto Serif SC", SimSun, "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif`；正文/数字 `400 28px ui-sans-serif, system-ui, -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`；ja locale 时明朝栈首提 `"Hiragino Mincho ProN"`（对齐 `html[lang^="ja"]` 切换语义——`fontStack` 由调用方按 locale 传入）。数字 tabular：canvas 无 `font-variant-numeric`，等宽数字用逐字符布局或等宽栈（`ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace`）绘制计数。
- **封面加载**（SC-4）：`new Image()` + `img.crossOrigin='anonymous'` + `img.src=coverUrl`；单张 3s 超时（`setTimeout` + `img.src=''` 中断）；成功回调携带 `HTMLImageElement`（渲染器直接 `drawImage`）；**失败永降级占位**，不重试（规格状态表）。
- **prevYear 对照**（SC-1 输入 `prevYear`）：`profile.$year.tsx` 现有 `computeYearSlice` 对 `year-1` 复用调用（同一次实体数据、无额外查询；`useMemo` 依赖含 year）；`slice.bookCount` 与上一年产物即 `prevYear` 来源——**不新增聚合函数**。
- **A. 已就位代码快照（勿重复建）**：

| 层 | 已有文件 | 状态 |
|----|---------|------|
| 年度切片 | `src/lib/profile-stats.ts` `computeYearSlice` | 已落地（含空年零值、设备排除、纯函数性） |
| 年度视图骨架 | `src/routes/profile.$year.tsx`（ProfileYearPage/YearNav/bookIndex） | 已落地；书单区块标题行 = SC-6 按钮落点 |
| 书目索引 | `src/profile/year/year-book-index.ts`（title/authors/coverUrl） | 已落地；SC-1 `covers` 同构来源 |
| Dialog/按钮 | `src/components/ui/dialog.tsx` / `button.tsx`（ghost 变体） | 已就位（shadcn 按需 import） |
| 图标 | `lucide-react` `Share2Icon`/`DownloadIcon` | 已在位（settings.tsx 先例） |
| E2E 场景 | `e2e/profile-annual.spec.ts` + `e2e/fixtures.ts` | 已落地；SC-8 增补 describe 块 |
| i18n | `src/i18n/locales/{zh-CN,en}/pages.json`（`profile.year.*` 命名空间在位） | 已落地；SC-6 增量 `share.*` |

- **B. 精确命令**：

```bash
pnpm test                  # Vitest（Red→Green 每波跑）
pnpm exec tsc --noEmit     # 类型门
pnpm build                 # 生产构建
pnpm exec playwright test e2e/profile-annual.spec.ts   # SC-8
pnpm audit --audit-level=high                          # SC-7
```

- **C. i18n key 模式**：
  - `profile.year.share.*`：按钮/Dialog 标题/下载/系统分享/隐私注脚/错误/预览 aria/总结句/对照行/字标。
  - 总结句插值（R3）：zh `共 {count} 本 · {categories} 类 · 最爱{topCategory}`，en `{count} books · {categories} categories · mostly {topCategory}`；`{count}` 复数走 `_one` 后缀先例；`{topCategory}` 取 Top 1 分类名，无分类 → 省略该段（zh `共 {count} 本 · {categories} 类`）。
- **D. 验收 checklist（规格 §7 验收行逐条）**：

- [x] `/profile/2025`（有数据）→ 点「分享图」→ Dialog 预览：题名/作者/Top 3/分类条与 `computeYearSlice` 产物一致（数字同源断言）；下载得到 1080×1440 PNG；
- [x] 数据白名单断言：渲染函数输入不含 `annualGoals`/`price`/`barcode`/`isbn13`/馆名（SC-1 编译期 + 运行时断言）；
- [x] 无封面书 → 占位块显题名首字；封面 CORS 失败 → 占位降级出图不报错；
- [x] 空年（`bookCount=0`）→ 无分享按钮；多 locale → 图内文字随 `t()` 切换；ja locale 字体栈降级路径出图不崩；
- [x] 关闭 Dialog 无任何持久化残留；`navigator.share` 不支持时按钮不渲染。

- **E. 后置阶段（不在本批次，已立项 v2）**：
  - **人格化称号**（R3 留 v2）/ **9:16 Stories 变体**（R5 记增强）/ **封面拼贴乙版式**（R2 留 v2）——三项均已立项至 [annual-share-card-v2-batch.md](./annual-share-card-v2-batch.md)（V-1/V-2/V-3，含规格波 SDD 门禁与收尾遗留 V-0）。
- **F. 依赖**：

**零新增运行时依赖确认**（R1 裁定）：分享图运行时 = 原生 `Canvas 2D API` + `Image` + `canvas.toBlob` + `URL.createObjectURL` + `navigator.share`（特性检测）；UI 层复用既有 `dialog.tsx`/`lucide-react`/`zod`。无任何新包引入，无需过 npm-supply-chain-security §3 审查门；测试不引入 node-canvas/happy-dom（stub 模式，SC-3 测试策略）。

## 状态
- 2026-09-03 建档：设计调研与 UI/UX 规格定稿（R1–R6 裁定记录落 reading-profile §4.1；调研记录落 [research/annual-share-card.md](../research/annual-share-card.md)；原草案 `docs/tasks/annual-share-card-design.md` 拆分后移除）。阶段 1–4 待启动；推进顺序 SC-1/SC-2（W1 并行）→ SC-3/SC-4（W2）→ SC-5/SC-6（W3）→ SC-7/SC-8（W4）。
- 2026-09-04 **批次完成**：SC-1–SC-8 四波全部落地（`6bc4b0d` W1 → `f274781` W2 → `8ec81ad` W3 → `349dd13` W4），另有两笔截图反馈修正（`be52683` 标题/徽标/分类图例、`1db9165` 图例逐行/Dialog 视口适配/入口迁至工具条右上角，裁定增量落 reading-profile §4.1 2026-09-03 修正注记）。门禁：`pnpm test` 1080 用例全绿、`tsc --noEmit` 过、`pnpm build` 过（`share-dialog-*.js` 独立 chunk 保持 lazy）、`e2e/profile-annual.spec.ts` 20/20 绿。后续任务（§E v2 三项 + 收尾遗留）立项 [annual-share-card-v2-batch.md](./annual-share-card-v2-batch.md)。
