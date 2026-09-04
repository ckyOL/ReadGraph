# 年度分享图 v2 — 后续任务批次（人格化称号 / 9:16 变体 / 封面拼贴 + 收尾）

> 本文件承接 [annual-share-card-batch.md](./annual-share-card-batch.md)（v1 已于 2026-09-04 完成，
> SC-1–SC-8 四波落地、门禁全绿），是分享图里程碑的**第二批次**执行清单。
> 规格权威：[reading-profile §4.1](../specs/reading-profile.md#41-年度分享图profileyear-新增)——
> v2 三项均由 v1 评审裁定**显式延后**（R2 乙版式 / R3 称号 / R5 Stories 变体），
> 动工前须按 SDD 先补 §4.1 对应小节（各任务 G-* 门），不得跳过规格直接编码。
> 工作流：[SDD + TDD](../ai-agent-workflow-rules.md)，波次推进 Tests(Red) → Code → Tests(Green) → Refactor。

## 里程碑范围与边界

- **进入条件**：v1 全绿（内容收敛/布局/渲染器/封面加载/Dialog/入口/i18n/E2E 均已落地，
  `src/profile/year/share/` 六模块 + 测试在位）；1080×1440 恒亮色版式为基线（v2 全部扩展
  向后兼容 v1 断言）。
- **本批次范围**：
  - **三个 v2 功能**（v1 §E 后置阶段逐项立项）：
    - **V-1 人格化称号**（R3 延后）——分享欲核心（Monzo/Wrapped 调研结论），纯函数派生 + 克制呈现；
    - **V-2 9:16 Stories 变体**（R5 延后）——`ShareLayoutOptions.variant` 双版式；
    - **V-3 封面拼贴乙版式**（R2 延后）——bookCount 大时封面拼贴带 + 「+K 本」。
  - **收尾遗留**（v1 收口时发现，非功能缺陷）：
    - **V-0 文档收尾**——v1 完成状态补登记三处缺口（见下「v1 收尾遗留」）；
    - V-0 范围内一并清理 v1 遗留小项：`share-dialog.test.tsx` 补 `fontStacksFor('ja')`
      明朝栈首提断言（实现指南 D 项要求，现缺失）；`spec §7` 分享图条目同步 v1 实际断言形态。
- **不在本批次**：Web Share Target/og:image 页面级分享优化；社区对照（无数据源不虚构，调研
  §2.2 已否决）；拟物书架/装饰（benchmark §5.2 P2 否决维持）；多页 H5 沉浸叙事（调研 §2.5 否决维持）。
- **依赖面共识**：**零新增运行时依赖**（延续 R1——原生 Canvas 2D + 既有基础设施；
  V-1/V-2/V-3 均为纯函数扩展 + 布局/渲染指令面增量，无新包）。若实现中出现真实需求缺口
  （如 9:16 需要 `OffscreenCanvas`），先补规格再议依赖，仍走 npm-supply-chain-security §3。

## 并行执行策略

| 波次 | 任务 | 并行依据 | 前置 |
|------|------|---------|------|
| **W0** | V-0 | 文档与规格层，无代码波及 | — |
| **W1** | V-1a、V-2a、V-3a | 三规格互不依赖（称号规则/版式变体/拼贴带分属 §4.1 不同小节）；文件不相交（规格文档） | V-0 |
| **W2** | V-1b、V-2b、V-3b | 文件不相交（`share-content.ts` / `share-layout.ts` / `share-canvas.ts`）；契约由 W1 规格锁定 | W1 |
| **W3** | V-1c、V-2c、V-3c | 文件不相交（Dialog 消费层改动）；V-2/V-3 消费 W2 布局扩展，V-1 消费 W2 内容扩展 | W2 |
| **W4** | V-4 | 端到端依赖全部 | 全部 |

- **同文件串行**：`share-content.ts`（V-1b 独占）、`share-layout.ts`（V-2b/V-3b——**串行**，
  两者都在布局文件加常量与指令，建议 V-2b 先行 V-3b 后继，或拆 `share-layout-collage.ts` 独占文件规避）；
  Dialog 层 V-1c/V-2c/V-3c 均触 `share-dialog.tsx` → **串行**（建议顺序 V-2c → V-3c → V-1c，
  版式切换 UI 先落，称号行与拼贴槽挂进既有版式）。
- **验证不并行**：每波结束统一 `pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build`。
- **契约即规格**：W1 规格未定稿不进 W2；实现中发现规格缺口 → 先补 §4.1 再继续。

## V-0（W0）：v1 收尾遗留（文档/规格层）

- [x] **V-0a** v1 完成状态补登记（三处）：
  - [CHANGELOG.md](../../../CHANGELOG.md) `[Unreleased]` **Added**：v1 分享图功能条目
    （v1 新功能从未补 Added 条目——现仅有 be52683 的 Fixes 条目；与既有条目同形态：功能摘要 + 规格链接）。
  - [app-spec §1.1](../app-spec.md#11-初始版本范围) #12 行：年度分享图「✅ 规格已定稿」→「✅ 已落地」。
  - [reading-profile §6](../specs/reading-profile.md#6-用户故事与验收用例) 补故事 24 落地注记（或直接并入 V-0c）。
- [x] **V-0b** `src/profile/year/share/share-dialog.test.tsx` 补 `fontStacksFor('ja')` 断言
  （v1 实现指南 D 项「ja locale 字体栈降级路径出图不崩」的单元侧缺口——ja 栈首提
  `"Hiragino Mincho ProN"`；实现已就位（`fontStacksFor` 按 `lang` 前缀分支），仅测试缺）。
- [x] **V-0c** [reading-profile §7](../specs/reading-profile.md#7-测试清单) 年度分享图条目与
  E2E 增补行同步 v1 实际断言形态（图例逐行/入口迁位后 aria/入口断言已随 `1db9165` 变化，
  规格文字仍写书单标题行入口）。

## V-1 人格化称号（R3 v2，三段：V-1a 规格 → V-1b 纯函数 → V-1c UI）

- [x] **V-1a（W1）** reading-profile §4.1 补「人格化称号」小节（**SDD 门禁**）：
  - **称号规则纯函数**（零规则维护面最小化）：候选裁定面——
    - 复借型：`topBooks[0].count ≥ 3` → 「《{title}》的重借大队长」式；
    - 增速型：`bookCount` 同比 `prevBookCount` 增长 ≥ 100% → 「加速阅读者」式；
    - 兜底句：无任何规则命中 → 平实句（复用 R3 总结句语义，不虚构称号）。
  - **en 文案独立裁定**（调研明确的文化差异点）：en 称号走独立 key（不直译 zh），评审定稿；
  - **隐私边界维持**：称号派生仅消费 `ShareContent` 白名单字段（`bookCount`/`topItems`/
    `topCategories`/`delta`），不引入任何黑名单字段；禁词断言随 V-1b 测试。
  - 产出：称号描述符 `{ key, params }` i18n 形态（与 `summary` 同构），落 §4.1 + §7 测试清单行。
- [x] **V-1b（W2，前置 V-1a）** `src/profile/year/share/share-content.ts`：`ShareContent`
  增 `badge: { key: string; params: Record<string, string | number> } | null` 字段
  （白名单约束面**不扩**——派生只读既有字段；`buildShareContent` 内派生，纯函数性维持）。
  测试（Red 先行）：规则命中路径逐条（复借阈值边界 2/3、增速边界、兜底）；黑名单穷举断言
  维持（badge 序列化文本仍不含黑名单值）；纯函数性（两次调用深等价）。
- [x] **V-1c（W3，前置 V-1b）** `share-dialog.tsx` + `share-layout.ts`：称号行渲染——
  落款段总结句上方加 badge 行（版式常量：基线/字号/强调色 token，具体数值规格裁定）；
  `t()` 渲染 badge 描述符；布局产指令（badge 传入 → 产指令，null → 不产，与 delta 行同模式）。
  i18n `profile.year.share.badge.*` 双语（en 独立文案裁定）；测试：t() 取值路径、
  badge=null 不产指令、版式不与总结句/Δ行重叠。

## V-2 9:16 Stories 变体（R5 v2，三段：V-2a 规格 → V-2b 布局 → V-2c UI）

- [x] **V-2a（W1）** reading-profile §4.1 补「9:16 Stories 变体」小节（**SDD 门禁**）：
  - `ShareLayoutOptions` 增 `variant: '3:4' | '9:16'`（**缺省 '3:4' 保持向后兼容**——既有调用
    不传 variant 行为不变，既有测试零改动）；
  - 9:16 分段高度重排（1080×1920：四段高度/锚点重排，具体数值规格裁定；主视觉段比例增大，
    落款段压缩——Stories 视觉重心在前两段）；
  - 呈现面裁定：Dialog 内版式切换 UI（`SegmentedControl` 先例在位——`profile.calendar.view.*`
    同款）；导出文件名 `readgraph-annual-{year}-story.png`（区分两版式导出物）。
- [x] **V-2b（W2，前置 V-2a）** `src/profile/year/share/share-layout.ts`：`variant` 选项落地——
  分段常量按 variant 参数化（`SHARE_SEGMENTS_3_4` / `SHARE_SEGMENTS_9_16`，或结构化
  `SHARE_SEGMENTS: Record<Variant, …>`）；`computeShareLayout` 按 variant 产指令。
  测试（Red 先行）：'3:4' 缺省行为与既有断言**逐条不变**（回归门）；'9:16' 四段区间、
  封面槽坐标、总结句 clamp、Δ行产出逻辑同构复用。
- [x] **V-2c（W3，前置 V-2b）** `share-dialog.tsx` + `share-canvas.ts`：Dialog 内 SegmentedControl
  版式切换（切换即重绘，同布局函数两次调用）；`exportSharePng` 文件名带 variant 后缀
  （'3:4' 保持原名不破坏 E2E 断言 `readgraph-annual-2024.png`）；dpr 定标不变。
  E2E（W4 统一补）：切换 variant → canvas 尺寸变化 + 下载文件名切换。

## V-3 封面拼贴乙版式（R2 v2，三段：V-3a 规格 → V-3b 布局 → V-3c UI）

- [x] **V-3a（W1）** reading-profile §4.1 补「封面拼贴乙版式」小节（**SDD 门禁**）：
  - **触发条件裁定**（v1 裁定留白点）：候选——`bookCount ≥ 阈值`（如 12，调研「书少时拼贴
    带空洞」依据）自动切乙版式 vs 用户手动切换。推荐**自动 + 手动可关**（自动按数据形态，
    手动尊重用户偏好；Dialog 内不新增 UI——乙版式是数据形态响应，非用户选项面）；
  - 主视觉段重排：三联槽 → 拼贴带（N 张封面 2×3 或 3×3 网格 + 「+K 本」角标；具体网格规格裁定）；
  - **封面加载复用**：`loadShareCovers` 增拼贴目标数（> 3 张 → 并发上限/逐张回调不变，
    超时/CORS 降级语义不变）；拼贴带占位语义（无封面槽位显 `#EAE0D5` + 题名首字，与三联同）。
- [x] **V-3b（W2，前置 V-3a）** `share-layout.ts`（与 V-2b 同文件——**串行**）：拼贴带指令
  （`ShareCoverSlotInstruction` 扩 `slotIndex 0..N` 枚举或增 `collage` 指令类型）；占位/降级语义
  与三联同构。测试：阈值边界（N=11/12/13）、网格坐标、+K 角标指令、无封面槽位占位。
- [x] **V-3c（W3，前置 V-3b）** `share-dialog.tsx` + `share-cover-loader.ts`：loader 拼贴
  并发面（逐张回调不变，目标列表扩至拼贴数）；Dialog 消费（covers map 键 = slotIndex 扩展）；
  测试：拼贴渐进补图（第 4+ 张 onEach 触发重绘）、部分失败占位出图不报错。

## V-4（W4）：验证

- [x] **V-4a** Vitest 全量回归 + `tsc --noEmit` + `pnpm build`（`share-dialog-*.js` chunk
  保持 lazy）；`pnpm audit --audit-level=high`（零新增依赖预期无告警）。
- [x] **V-4b** Playwright E2E 增补（`e2e/profile-annual.spec.ts` 分享图 describe 块扩展）：
  - 称号：badge 命中年 → 预览含 badge（canvas 不可直接断言文本，经 DOM 断言 t() 取值路径 +
    像素采样行存在性）；badge=null 年 → 版式与 v1 一致（回归）。
  - 9:16：切换 → canvas 高宽比 1920/1080 像素断言 + 下载文件名 `-story.png`。
  - 拼贴：bookCount 大 fixture → 拼贴带出图不报错（pageerror 监听先例）+ 部分封面失败占位。
  - 既有 v1 E2E **零改动全绿**（向后兼容门）。

## 落地原则（所有阶段共同）

- **SDD 门禁**：V-1a/V-2a/V-3a 规格未定稿不进对应实现波；规格缺口先补 §4.1 再继续。
- **向后兼容硬约束**：'3:4' 缺省路径与 v1 断言逐条不变（V-2b 回归门）；badge=null 与
  拼贴未触发路径产出与 v1 逐字节一致；v1 E2E 零改动全绿。
- **隐私护栏延续**：称号/拼贴/版式扩展均不扩 `ShareContentInput` 白名单；badge 序列化文本
  纳入黑名单穷举断言（V-1b）；黑名单断言仍是门禁。
- **纯函数隔离**：称号派生（V-1b）与布局扩展（V-2b/V-3b）均为纯函数（无 DOM/时钟/存储）；
  同输入两次调用深等价断言随新增面补齐。
- **UI 文案双语**：`profile.year.share.badge.*` 等新 key 同步补 `zh-CN`/`en`（badge en 文案
  需评审裁定，不直译）；t() 取值路径断言。
- **预览即导出**：所有扩展经同一 `computeShareLayout` + `renderShareCard` 路径；UI 层不手绘第二套。
- **零新增运行时依赖**（R1 延续）；不破坏既有测试；每波末统一验证门。

## 状态

- 2026-09-04 建档：v1（annual-share-card-batch SC-1–SC-8）完成收口后立项；v2 三项来自
  v1 评审 R2/R3/R5 显式延后项（原 v1 §E 后置阶段），收尾遗留 V-0 为 v1 完成时发现的
  登记缺口与测试小缺口。阶段 0–4 待启动；推进顺序 V-0 → 规格波（V-1a/V-2a/V-3a）→
  实现波（V-1b/V-2b/V-3b）→ UI 波（V-1c/V-2c/V-3c）→ V-4 验证。
- 2026-09-04 **批次完成**：W0（V-0a 三处登记 + V-0b ja 栈断言 + V-0c §7 同步）→
  W1（§4.2 三小节定稿：badge 规则/9:16 分段与锚点公式/拼贴 8 槽 4×2 与阈值 12 自动
  触发无手动开关）→ W2（`share-content.ts` badge/collage 派生 + `collageBookIds`
  单一事实源；`share-layout.ts` variant 参数化 + 拼贴带指令）→ W3（Dialog SegmentedControl
  版式切换即重绘、coverTargetIds 超集加载、badge/collageMore t() 渲染、i18n 六键双语）→
  W4（Vitest 1110 全绿、`tsc -b` 过、`pnpm build` 过且 `share-dialog-*.js` 保持 lazy、
  `pnpm audit` 零告警、E2E 23/23 全绿含 v2 三场景与 v1 零改动回归）。
  规格落点：reading-profile §4.2（4.2.1 称号 / 4.2.2 9:16 / 4.2.3 拼贴）；§7 测试清单
  增补 v2 两行。实现决策与规格差异：无——9:16 画布尺寸由 layout 推导（渲染器物理
  尺寸 = layout.width/height × dpr），SHARE_CANVAS 保留为 3:4 基线与 dpr/边距来源。
