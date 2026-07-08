# 统一 UI 里程碑 — 任务分解

> 本文件记录 §6 #4「阅读画像与图表规格」中**延后到统一 UI 里程碑**处理的产物，以及 §8 各页落地、§9.8 主题 Provider 装配、§6 #5 设置与系统重置规格的配套。
> 规格（规格权威不变）：[§8 UI 导航规格](../app-spec.md#8-ui-导航规格)、[§9 数据层规格](../app-spec.md#9-数据层规格)、[§10 导入管线规格](../app-spec.md#10-导入管线规格)、[§11 阅读画像与图表规格](../app-spec.md#11-阅读画像与图表规格)。
> 工作流：[SDD + TDD](../ai-agent-workflow-rules.md) — Spec 已就位，按下方顺序进 Tests(Red) → Code → Tests(Green) → Refactor。

## 里程碑范围与边界

- **进入条件**：规格已就位（§8/§9/§10/§11 全部已补）；数据层与导入管线纯函数/Parser 测试为绿；本批次**不重复**已有纯函数/Parser 实现。
- **不在本批次**：新增 Object Store/索引、Repository 接口改动、Parser 逻辑改动、聚合契约改动（`computeProfileStats`/`buildTheme` 已绿）。
- **依赖面共识**：本批次会一次性引入三条运行时依赖，按 [npm-supply-chain-security §4.1](../npm-supply-chain-security.md) 审查锁定（精确版本、`pnpm verify`/`audit`/`security:check` 通过、冷却期满足）。

## 前置依赖任务（供应链审查门）

- [ ] **D-1** 引入 `dexie-react-hooks`（`useLiveQuery`）。候选版本在引入时复核锁定。`pnpm add dexie-react-hooks@<精确版本>` → `pnpm verify` & `pnpm audit --audit-level=high` 通过才提交 `package.json`/`pnpm-lock.yaml`。用途：§9.12「UI 响应式由 `dexie-react-hooks` `useLiveQuery` 直连 Dexie」。
- [ ] **D-2** 引入 `echarts@5.6.0`（候选，见 §11.1）。按 `echarts/core` + 注册图种（`TreemapChart`/`BarChart`/`CustomChart`）+ `CanvasRenderer` 引入，不走 `echarts` barrel（`bundle-barrel-imports`）。
- [ ] **D-3** 引入 `comlink`（Worker，§11.1 `stats-worker.ts`，大数据聚合下放）。候选版本在引入时复核锁定。
- [ ] **D-4** 评估 `date-fns@4.1.0`（§11.1 可选）：若月/年桶与轴标签无 locale 格式化刚需则不引入，沿用 `Date` UTC getter + `Intl`（`computeProfileStats` 已按此实现，无 date-fns 依赖）。决策在 Tests(Red) 阶段最终裁定并记录。
- [ ] **D-5** 引入 Playwright（E2E，§8.8/§11.7）作为 devDependency；配置 `playwright.config.ts` + 首次 `playwright install`（浏览器二进制）按供应链/平台约束处理。

## 阶段 0：全局 Provider 与主题骨架（§8.4，§9.8 后置项）

- [ ] **P0-1（Spec 已就位）** 主题 Provider：实现 `src/hooks/use-theme.ts` + Provider，装配到 `__root.tsx`。
  - 读写走 `readPreferences()`/`writePreferences()`（§9.8 已落地，本任务不改 schema）。
  - 任务：把 `theme: 'light'|'dark'|'auto'` 套用到根 `<html>` 的 `class="dark"`；`auto` 模式监听 `prefers-color-scheme` 并应用 class。
  - 测试（Vitest，Red 先行）：Provider 装配、`auto` 跟随系统、`light`/`dark` 切换 + reload 持久（mock `localStorage`/`matchMedia`）。
  - 关联：§8.4「auto 模式监听系统并应用 class」、`rendering-conditional-render`、`client-localstorage-schema`。
- [ ] **P0-2** ECharts 主题重建回调契约：消费方（`use-profile-stats` 或 chart 组件层）在 `.dark` 切换时调用 `buildTheme` 重建并 `setOption` 重应用；旧实例 `dispose` 防泄漏（§11.3）。随 Hook 任务一起落地。

## 阶段 1：数据响应式 Hook（§11.1 `use-profile-stats.ts`，依赖 D-1）

- [ ] **H-1** `src/profile/use-profile-stats.ts`：`useLiveQuery` 取 `books`/`catalogRecords`/`borrowCycles`/`sources` 实体 → 派生 `ProfileStatsResult`。
  - 小数据同步 `useMemo` 调 `computeProfileStats`；大数据（聚合耗时阈值候选 > 50ms，§11.5）走 `stats-worker.ts`（依赖 D-3，留接口、Worker 启用条件后续配置）。
  - 输入与导航保持响应：分类体系切换与时间范围变化用 `useDeferredValue` 延迟重算（`rerender-use-deferred-value`）。
- [ ] **H-2** `src/profile/stats-worker.ts`：Comlink 包装，接收实体 + opts，纯函数跑 `computeProfileStats`（§11.1）。本批次交付包装与启用阈值，不在 `computeProfileStats` 内放时钟/存储读。
- [ ] **H-3 测试（Vitest，Red 先行）**：Hook 在小数据下同步产出与 `computeProfileStats` 直调等价；`useLiveQuery` 未就绪返回 `undefined`/`null`（渲染 `Skeleton` 契约）；切换分类体系触发重算（mock `useLiveQuery` / Dexie）。

## 阶段 2：阅读画像页与图表组件（§11.4，依赖 D-1/D-2/D-3）

> 布局与交互权威见 §11.4（顶部概览卡片 → 分类 treemap → 借阅甘特带 → 借阅量柱图 + 时长分布）；空态/大文件退化见 §11.5；UI 文案禁止硬编码，namespace `pages`（`profile.*`），见 [i18n-conventions](../i18n-conventions.md)。

- [ ] **C-1** `src/routes/profile.tsx` 改造：由占位页改为图表主导布局；装 `use-profile-stats` 与主题；顶部工具条 SegmentedControl（分类体系）/Select（时间范围）/displayTimezone 显示（不改，只显示）。
- [ ] **C-2** `src/profile/charts/ClassificationTreemap.tsx`：一级呈现可交互高亮 + tooltip；子类下钻标 TODO（§11.4）。echarts 按 `echarts/core` + `TreemapChart` 引入。
- [ ] **C-3** `src/profile/charts/BorrowGantt.tsx`：lane=`bookId:barcode`；`borrowed` 端点组件层用 `useDeferredValue` 的 now 补齐视觉，不回写聚合产物（§11.2/§11.5）；大数据 ≥ `GANTT_THRESHOLD`（候选 2000 lane/5000 区间）启用视口下采样。
- [ ] **C-4** `src/profile/charts/BorrowVolumeBar.tsx`：月/年桶轴标签用 `displayTimezone` 呈现（桶归属不变）；range 左闭右开裁剪在聚合层已处理。
- [ ] **C-5** `src/profile/charts/DurationDistribution.tsx`：5 档分桶；空样本表达 `—`；avg/median 来源 `summary`。
- [ ] **C-6** 空态/部分态/错误态（§11.4）：无 Book/BorrowCycle 整页 `Empty` + 导入入口；部件各自 `Empty` 变体；聚合抛错被边界捕获降级（不崩整页）。
- [ ] **C-7 测试（Playwright E2E，Red 先行）**：§11.7 E2E 子项 — 空态 `Empty` + 导入入口跳 `/import`；脱敏数据下各 ECharts canvas 非空像素；分类体系切换重绘；暗色切换配色变化且 reload 保留；大库视口下采样不一次性渲染超量矩形（性能基线，可选）。

## 阶段 3：书库 / 时间线 / 导入向导 / Dashboard（§8.3，依赖 D-1，复用 §10 已落地引擎）

- [ ] **G-1 Dashboard（/）**：概览统计卡片（藏书数/周期数/在借数/最近导入）+ 最近借阅列表 + 快速入口；空态 `Empty` + 首次导入引导。
- [ ] **G-2 书库列表（/library）**：`Table` 密实列表（书名/作者/ISBN13/来源徽标/分类号芯片/借阅次数），可搜索筛选排序;空态 `Empty` + 导入引导。
- [ ] **G-3 书目详情（/library/$bookId）**：卷卡式 `Card`（书目元数据 + 各 `CatalogRecord` + `BorrowCycle` 时间线小图）；`$bookId` 走 z.string() 校验 loader 入参（§8.2）。
- [ ] **G-4 时间线（/timeline）**：横向时间轴脊柱，按 `borrowedAt` 排列所有 `BorrowCycle`；`status='borrowed'` 强调态；可按来源/状态筛选；空态 `Empty`。
- [ ] **G-5 导入向导（/import，多步）**：来源选择/创建 → 文件选择与编码检测 → 前 10 条预览与字段映射 → 执行 → 导入报告（统计 + `ParseWarning` 列表）。复用 §10 已落地 Parser/pipeline，UI 层不重算去重/配对;来源选择支持 source.md `SOURCE_TEMPLATES`；大文件导入下放 Web Worker（§8.6）。每步可回退。
- [ ] **G-6 测试（Vitest + Playwright）**：§8.8 — AppShell 渲染与路由懒加载；侧栏六页跳转/高亮/移动端折叠；暗色/locale 切换持久；空 Dashboard → 导入入口；导入向导关键路径（模板建来源→选文件→预览→执行→报告→落库→书库可见，脱敏夹具）；分类号芯片渲染（CLC/DDC code↔category 映射）；日期/时区纯函数 UTC↔displayTimezone↔source.timezone（应已部分随 §9/§10 有覆盖，对齐补缺）。

## 阶段 4：设置与系统重置规格（§6 #5，规格仍待补）

> 本阶段是 §6 清单第 5 项「设置与系统重置规格」。先补规格再进 Red/Green（SDD 前置；§6 要求每节包含用户故事/UI 说明/数据契约/测试清单/React 性能规则引用）。

- [ ] **S-1（Spec 先行）** 在 `docs/app-spec.md` 补 §12「设置与系统重置规格」：偏好（主题/locale/displayTimezone）、数据导出/重建、系统重置原子性与二次确认（`AlertDialog` 不可单次撤销）、来源管理（列/编辑/新建 `Source`）。含用户故事、UI 设计、数据契约、Vitest/Playwright 清单、React 性能规则引用。
- [ ] **S-2** 设置页（/settings）落地：复用 `usePreferences`（§9.8 读写已就位）+ `useTheme`（P0-1）+ `useLocale`（已落地）+ `displayTimezone` 选择；导出/导入走 `exportDatabase`/`importDatabase`（§9.7 已落地）；重置走 `resetDatabase`（§9.6 已落地）+ `AlertDialog` 二次确认 + 强制备份；来源管理 CRUD（Repository 已就位）。
- [ ] **S-3 测试（Vitest + Playwright）**：偏好读写/降级（对齐已落地 `preferences.test.ts`）；重置原子性 + 二次确认不可单步撤销；导出后重置库为空；切暗色/locale 持久（与 §8.8 对齐）。

## 落地原则（所有阶段共同）

- SDD：每个产物先写该阶段列出的 Vitest/Playwright 测试（Red），再实现到 Green，再 Refactor；不得跳过 Red。
- UI 文案禁止硬编码：可见文本经 `react-i18next` `t()`，namespace 按路由/功能拆分；新增 key 同步补 `zh-CN`/`en` bundle。
- 性能规则引用按 §8.9/§10.12/§11.8：`bundle-barrel-imports`、`bundle-dynamic-imports`、`bundle-conditional`、`rendering-conditional-render`、`rerender-use-deferred-value`、`rerender-transitions`、`rendering-usetransition-loading`、`client-localstorage-schema`。
- 不破坏已有测试：每个阶段结束跑 `pnpm test`（20+ suites 全绿）+ `pnpm exec tsc --noEmit` + `pnpm build`；新依赖阶段另跑 `pnpm audit --audit-level=high`。
- 提交粒度：按阶段/产物分 Conventional Commits（`feat(profile):`、`feat(library):`、`feat(timeline):`、`feat(import-wizard):`、`feat(settings):`、`docs(spec):`、`chore(deps):`）。

## 状态

- 2026-07-08 建档：§11.2 纯函数聚合、§11.3 `buildTheme` 已 TDD 落地（`src/lib/profile-stats.ts`、`src/lib/echarts-theme.ts`，20 suites/196 tests 绿）；阶段 0–4 待启动，依赖面（D-1~D-5）需先经供应链审查。
- 推进建议顺序：D-1 → 阶段 0 → 阶段 1 → D-2/D-3 → 阶段 2 → 阶段 3 → S-1 → S-2/S-3；ECharts 与 Worker（D-2/D-3）在阶段 1 完成后再引入，以降低单批次依赖审查面。
