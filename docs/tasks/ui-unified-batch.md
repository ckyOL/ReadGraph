# 统一 UI 里程碑 — 任务分解

> 本文件记录 [app-spec §6](../app-spec.md#6-功能规格索引) #4「阅读画像与图表规格」中**延后到统一 UI 里程碑**处理的产物，以及 [ui-navigation](../specs/ui-navigation.md) 各页落地、[data-layer §8](../specs/data-layer.md#8-用户偏好) 主题 Provider 装配、[app-spec §6](../app-spec.md#6-功能规格索引) #5 设置与系统重置规格的配套。
> 规格（规格权威不变）：[UI 导航规格](../specs/ui-navigation.md)、[数据层规格](../specs/data-layer.md)、[导入管线规格](../specs/import-pipeline.md)、[阅读画像与图表规格](../specs/reading-profile.md)、[设置与系统重置规格](../specs/settings.md)。
> 工作流：[SDD + TDD](../ai-agent-workflow-rules.md) — Spec 已就位，按下方顺序进 Tests(Red) → Code → Tests(Green) → Refactor。

## 里程碑范围与边界

- **进入条件**：规格已就位（ui-navigation / data-layer / import-pipeline / reading-profile 全部已补）；数据层与导入管线纯函数/Parser 测试为绿；本批次**不重复**已有纯函数/Parser 实现。
- **不在本批次**：新增 Object Store/索引、Repository 接口改动、Parser 逻辑改动、聚合契约改动（`computeProfileStats`/`buildTheme` 已绿）。
- **依赖面共识**：本批次一次性引入三条运行时依赖，按 [npm-supply-chain-security §3](../npm-supply-chain-security.md) 审查（`pnpm verify`/`audit` 通过、冷却期满足；^ 范围可，frozen 锁文件兜底）。

## 前置依赖任务（供应链审查门）

- [x] **D-1** 引入 `dexie-react-hooks@4.4.0`（`useLiveQuery`）。用途：[data-layer §12](../specs/data-layer.md#12-react-性能规则引用)「UI 响应式由 `dexie-react-hooks` `useLiveQuery` 直连 Dexie」。
  - 版本决策：实现指南曾列 `1.1.7`（旧 major）；与当前 `dexie@4.4.4` 对齐的稳定版为 `4.4.0`（peer：`dexie >=4.2.0-alpha.1 <5`、`react >=16`），发布 2026-03-18（>7d 冷却）。Apache-2.0，0 传递依赖，无 lifecycle 脚本。
- [x] **D-2** 引入 `echarts@6.1.0`（[reading-profile §1](../specs/reading-profile.md#1-范围与依赖)）。按 `echarts/core` + 注册图种（`TreemapChart`/`BarChart`/`CustomChart`）+ `CanvasRenderer` 引入，不走 `echarts` barrel（`bundle-barrel-imports`）。
  - 供应链：发布 2026-07-22（>7d 冷却）；传递 `zrender@6.1.0` + `tslib@2.3.0`；Apache-2.0 / BSD-3-Clause。`pnpm audit --audit-level=high` 通过。
  - 版本演进：原锁定 `5.6.0`，于 2026-07-30 升至 `6.1.0`（修 `GHSA-fgmj-fm8m-jvvx` XSS，已达 high 门禁基线之上）。v6 breaking 对本仓零源码冲突——接触面仅为 `buildTheme()` 纯函数适配器，无图表实例化。图表实例化落地（阶段 2 C-1~C-5）须遵守 [reading-profile §3](../specs/reading-profile.md#3-echarts-主题与薄适配层) v6 实例化约束（legend 显式锚定、`grid.outerBoundsMode`）。
- [x] **D-3** 引入 `comlink@4.4.2`（Worker，[reading-profile §1](../specs/reading-profile.md#1-范围与依赖) `stats-worker.ts`，大数据聚合下放）。发布 2024-11-07，Apache-2.0，0 传递依赖，无 lifecycle 脚本。
- [x] **D-4** 评估 `date-fns@4.1.0`（[reading-profile §1](../specs/reading-profile.md#1-范围与依赖) 可选）：**不引入**。`computeProfileStats` 已使用 `Date` UTC getter + `Intl` 完成月/年桶与轴标签，无 locale 格式化刚需，故沿用现有实现，不增加 date-fns 依赖。
- [x] **D-5** 引入 `@playwright/test@1.61.1`（E2E，[ui-navigation §8](../specs/ui-navigation.md#8-测试清单)/[reading-profile §7](../specs/reading-profile.md#7-测试清单)）作为 devDependency；配置 `playwright.config.ts` + `e2e/smoke.spec.ts`；`pnpm exec playwright install chromium` 浏览器二进制本地安装（不入库）。
  - 版本决策：实现指南候选 `1.53.0`；复核锁定 `1.61.1`（发布 2026-06-23，>7d 冷却，Microsoft/Apache-2.0）。脚本：`test:e2e`。门禁：`pnpm verify` + `pnpm audit --audit-level=high` + `pnpm build` + `pnpm test` + smoke E2E 绿。

## 阶段 0：全局 Provider 与主题骨架（[ui-navigation §4](../specs/ui-navigation.md#4-主题与暗色模式骨架)，[data-layer §8](../specs/data-layer.md#8-用户偏好) 后置项）

- [x] **P0-1（Spec 已就位）** 主题 Provider：实现 `src/hooks/use-theme.ts` + Provider，装配到 `__root.tsx`。
  - **前置已就位**：DESIGN.md 设计令牌（纸墨色板/`--radius:0`/CJK 字体栈）已于 2026-07-23 落到 `src/index.css`（commit `603b7d4`）；本任务只剩 React 侧 hook + Provider + `<html class="dark">` 切换，不重写 CSS 变量。
  - 读写走 `readPreferences()`/`writePreferences()`（[data-layer §8](../specs/data-layer.md#8-用户偏好) 已落地，本任务不改 schema）。
  - 任务：把 `theme: 'light'|'dark'|'auto'` 套用到根 `<html>` 的 `class="dark"`；`auto` 模式监听 `prefers-color-scheme` 并应用 class。
  - 测试（Vitest，Red 先行）：Provider 装配、`auto` 跟随系统、`light`/`dark` 切换 + reload 持久（mock `localStorage`/`matchMedia`）。
  - 关联：[ui-navigation §4](../specs/ui-navigation.md#4-主题与暗色模式骨架)「auto 模式监听系统并应用 class」、`rendering-conditional-render`、`client-localstorage-schema`；色值/CJK 排版见根目录 [DESIGN.md](../../DESIGN.md) §2/§3。
- [x] **P0-2** ECharts 主题重建回调契约：消费方（`use-profile-stats` 或 chart 组件层）在 `.dark` 切换时调用 `buildTheme` 重建并 `setOption` 重应用；旧实例 `dispose` 防泄漏（[reading-profile §3](../specs/reading-profile.md#3-echarts-主题与薄适配层)）。随 Hook 任务一起落地。

## 阶段 1：数据响应式 Hook（[reading-profile §1](../specs/reading-profile.md#1-范围与依赖) `use-profile-stats.ts`，依赖 D-1）

- [x] **H-1** `src/profile/use-profile-stats.ts`：`useLiveQuery` 取 `books`/`catalogRecords`/`borrowCycles`/`sources` 实体 → 派生 `ProfileStatsResult`。
  - 小数据同步 `useMemo` 调 `computeProfileStats`；大数据（聚合耗时阈值候选 > 50ms，[reading-profile §5](../specs/reading-profile.md#5-数据契约与边界)）走 `stats-worker.ts`（依赖 D-3，留接口、Worker 启用条件后续配置）。
  - 输入与导航保持响应：分类体系切换与时间范围变化用 `useDeferredValue` 延迟重算（`rerender-use-deferred-value`）。
- [x] **H-2** `src/profile/stats-worker.ts`：Comlink 包装，接收实体 + opts，纯函数跑 `computeProfileStats`（[reading-profile §1](../specs/reading-profile.md#1-范围与依赖)）。本批次交付包装与启用阈值，不在 `computeProfileStats` 内放时钟/存储读。
- [x] **H-3 测试（Vitest，Red 先行）**：Hook 在小数据下同步产出与 `computeProfileStats` 直调等价；`useLiveQuery` 未就绪返回 `undefined`/`null`（渲染 `Skeleton` 契约）；切换分类体系触发重算（mock `useLiveQuery` / Dexie）。

## 阶段 2：阅读画像页与图表组件（[reading-profile §4](../specs/reading-profile.md#4-ui-设计说明)，依赖 D-1/D-2/D-3）

> 布局与交互权威见 [reading-profile §4](../specs/reading-profile.md#4-ui-设计说明)（顶部概览卡片 → 分类 treemap → 借阅甘特带 → 借阅量柱图 + 时长分布）；空态/大文件退化见 [reading-profile §5](../specs/reading-profile.md#5-数据契约与边界)；UI 文案禁止硬编码，namespace `pages`（`profile.*`），见 [i18n-conventions](../i18n-conventions.md)。

- [x] **C-1** `src/routes/profile.tsx` 改造：由占位页改为图表主导布局；装 `use-profile-stats` 与主题；顶部工具条 SegmentedControl（分类体系）/Select（时间范围）/displayTimezone 显示（不改，只显示）。
- [x] **C-2** `src/profile/charts/ClassificationTreemap.tsx`：一级呈现可交互高亮 + tooltip；子类下钻标 TODO（[reading-profile §4](../specs/reading-profile.md#4-ui-设计说明)）。echarts 按 `echarts/core` + `TreemapChart` 引入。
- [x] **C-3** `src/profile/charts/BorrowGantt.tsx`：lane=`bookId:barcode`；`borrowed` 端点组件层用 `useDeferredValue` 的 now 补齐视觉，不回写聚合产物（[reading-profile §2](../specs/reading-profile.md#2-统计维度与聚合契约)/[§5](../specs/reading-profile.md#5-数据契约与边界)）；大数据 ≥ `GANTT_THRESHOLD`（候选 2000 lane/5000 区间）启用视口下采样。
- [x] **C-4** `src/profile/charts/BorrowVolumeBar.tsx`：月/年桶轴标签用 `displayTimezone` 呈现（桶归属不变）；range 左闭右开裁剪在聚合层已处理。
- [x] **C-5** `src/profile/charts/DurationDistribution.tsx`：5 档分桶；空样本表达 `—`；avg/median 来源 `summary`。
- [x] **C-6** 空态/部分态/错误态（[reading-profile §4](../specs/reading-profile.md#4-ui-设计说明)）：无 Book/BorrowCycle 整页 `Empty` + 导入入口；部件各自 `Empty` 变体；聚合抛错被边界捕获降级（不崩整页）。
- [x] **C-7 测试（Playwright E2E，Red 先行）**：[reading-profile §7](../specs/reading-profile.md#7-测试清单) E2E 子项 — 空态 `Empty` + 导入入口跳 `/import`；脱敏数据下各 ECharts canvas 非空像素；分类体系切换重绘；暗色切换配色变化且 reload 保留；大库视口下采样不一次性渲染超量矩形（性能基线，可选）。

## 阶段 3：书库 / 时间线 / 导入向导 / Dashboard（[ui-navigation §3](../specs/ui-navigation.md#3-各功能页布局与空状态)，依赖 D-1，复用 [import-pipeline](../specs/import-pipeline.md) 已落地引擎）

- [x] **G-1 Dashboard（/）**：概览统计卡片（藏书数/周期数/在借数/最近导入）+ 最近借阅列表 + 快速入口；空态 `Empty` + 首次导入引导。
- [x] **G-2 书库列表（/library）**：`Table` 密实列表（书名/作者/ISBN13/来源徽标/分类号芯片/借阅次数），可搜索筛选排序;空态 `Empty` + 导入引导。
- [x] **G-3 书目详情（/library/$bookId）**：卷卡式 `Card`（书目元数据 + 各 `CatalogRecord` + `BorrowCycle` 时间线小图）；`$bookId` 走 z.string() 校验 loader 入参（[ui-navigation §2](../specs/ui-navigation.md#2-路由树)）。
- [x] **G-4 时间线（/timeline）**：竖向时间轴脊柱（上→下按 `borrowedAt` 递增），排列所有 `BorrowCycle`；`status='borrowed'` 强调态；可按来源/状态筛选；空态 `Empty`。
- [x] **G-5 导入向导（/import，多步）**：来源选择/创建 → 文件选择与编码检测 → 前 10 条预览与字段映射 → 执行 → 导入报告（统计 + `ParseWarning` 列表）。复用 [import-pipeline](../specs/import-pipeline.md) 已落地 Parser/pipeline，UI 层不重算去重/配对;来源选择支持 [source](../metadata/source.md) `SOURCE_TEMPLATES`；大文件导入下放 Web Worker（[ui-navigation §6](../specs/ui-navigation.md#6-数据契约与边界)）。每步可回退。
- [x] **G-6 测试（Vitest + Playwright）**：[ui-navigation §8](../specs/ui-navigation.md#8-测试清单) — AppShell 渲染与路由懒加载；侧栏六页跳转/高亮/移动端折叠；暗色/locale 切换持久；空 Dashboard → 导入入口；导入向导关键路径（模板建来源→选文件→预览→执行→报告→落库→书库可见，脱敏夹具）；分类号芯片渲染（CLC/DDC code↔category 映射）；日期/时区纯函数 UTC↔displayTimezone↔source.timezone（应已部分随 data-layer / import-pipeline 有覆盖，对齐补缺）。

## 阶段 4：设置与系统重置规格（[app-spec §6](../app-spec.md#6-功能规格索引) #5，规格已补 [settings](../specs/settings.md)）

> 本阶段是 [app-spec §6](../app-spec.md#6-功能规格索引) 清单第 5 项「设置与系统重置规格」。先补规格再进 Red/Green（SDD 前置；§6 要求每节包含用户故事/UI 说明/数据契约/测试清单/React 性能规则引用）。

- [x] **S-1（Spec 先行）** [settings](../specs/settings.md)「设置与系统重置规格」：偏好（主题/locale/displayTimezone）、数据导出/重建、系统重置原子性与二次确认（`AlertDialog` 不可单次撤销）、来源管理（列/编辑/新建 `Source`）。含用户故事、UI 设计、数据契约、Vitest/Playwright 清单、React 性能规则引用。
- [x] **S-2** 设置页（/settings）落地：复用 `usePreferences`（[data-layer §8](../specs/data-layer.md#8-用户偏好) 读写已就位）+ `useTheme`（P0-1）+ `useLocale`（已落地）+ `displayTimezone` 选择；导出/导入走 `exportDatabase`/`importDatabase`（[data-layer §7](../specs/data-layer.md#7-数据导出与重建) 已落地）；重置走 `resetDatabase`（[data-layer §6](../specs/data-layer.md#6-系统重置) 已落地）+ `AlertDialog` 二次确认 + 强制备份；来源管理 CRUD（Repository 已就位）。
- [x] **S-3 测试（Vitest + Playwright）**：偏好读写/降级（对齐已落地 `preferences.test.ts`）；重置原子性 + 二次确认不可单步撤销；导出后重置库为空；切暗色/locale 持久（与 [ui-navigation §8](../specs/ui-navigation.md#8-测试清单) 对齐）。

## 落地原则（所有阶段共同）

- SDD：每个产物先写该阶段列出的 Vitest/Playwright 测试（Red），再实现到 Green，再 Refactor；不得跳过 Red。
- UI 文案禁止硬编码：可见文本经 `react-i18next` `t()`，namespace 按路由/功能拆分；新增 key 同步补 `zh-CN`/`en` bundle。
- 性能规则引用按 [ui-navigation §9](../specs/ui-navigation.md#9-react-性能规则引用)/[import-pipeline §12](../specs/import-pipeline.md#12-react-性能规则引用)/[reading-profile §8](../specs/reading-profile.md#8-react-性能规则引用)：`bundle-barrel-imports`、`bundle-dynamic-imports`、`bundle-conditional`、`rendering-conditional-render`、`rerender-use-deferred-value`、`rerender-transitions`、`rendering-usetransition-loading`、`client-localstorage-schema`。
- 不破坏已有测试：每个阶段结束跑 `pnpm test`（20+ suites 全绿）+ `pnpm exec tsc --noEmit` + `pnpm build`；新依赖阶段另跑 `pnpm audit --audit-level=high`。
- 提交粒度：按阶段/产物分 Conventional Commits（`feat(profile):`、`feat(library):`、`feat(timeline):`、`feat(import-wizard):`、`feat(settings):`、`docs(spec):`、`chore(deps):`）。

## 状态

- 2026-07-08 建档：[reading-profile §2](../specs/reading-profile.md#2-统计维度与聚合契约) 纯函数聚合、[§3](../specs/reading-profile.md#3-echarts-主题与薄适配层) `buildTheme` 已 TDD 落地（`src/lib/profile-stats.ts`、`src/lib/echarts-theme.ts`，20 suites/196 tests 绿）；阶段 0–4 待启动，依赖面（D-1~D-5）需先经供应链审查。
- 2026-07-08 补 S-1：[settings](../specs/settings.md)「设置与系统重置规格」已补；备份序列化纯函数 `src/db/backup.ts`（`buildBackupFilename`/`serializeExportText`/`parseExportText`）已 TDD 落地。S-2/S-3（设置页 UI + 二次确认/来源管理）仍属本批次阶段 4，待 D-1（`dexie-react-hooks`）供应链审查后执行。
- 2026-07-09 D-4 决策：`date-fns@4.1.0` 不引入；`computeProfileStats` 使用 `Date` UTC + `Intl` 已满足需求。D-1~D-3、D-5 待供应链审查通过后安装。
- 2026-07-24 阶段 0 完成：`src/hooks/use-theme.tsx`（`useTheme`/`ThemeProvider`/`useEChartsTheme`）+ `src/routes/__root.tsx` 装配 + 18 Vitest 覆盖；`light`/`dark`/`auto` 切 class、`auto` 跟随 `prefers-color-scheme`、reload 经 `readPreferences` 持久；`pnpm build`/`pnpm test`/`pnpm test:e2e` smoke 全绿。下一推进：阶段 1（H-1 `use-profile-stats`）。
- 2026-07-30 依赖升级同步：`echarts` 5.6.0 → 6.1.0（修 `GHSA-fgmj-fm8m-jvvx` XSS，`zrender` 5.6.1 → 6.1.0；接触面仅 `buildTheme()` 纯函数适配器，零源码冲突）、`typescript` 6.0.3 → 7.0.2、`@tanstack/router-plugin` routeTree 重新生成。`tsc --noEmit` + Vitest 22 suites/224 tests 全绿。阶段 2 图表实例化落地时须遵守 [reading-profile §3](../specs/reading-profile.md#3-echarts-主题与薄适配层) v6 实例化约束。
- 2026-07-30 阶段 1 完成：`src/profile/use-profile-stats.ts`（`useProfileStats`/`ProfileStatsState`/`WORKER_THRESHOLD=5000`）+ `src/profile/stats-worker.ts`（Comlink `expose` 纯函数 `compute`）+ `src/db/db-instance.ts`（Dexie 浏览器单例）+ `ProfileStatsInput`/`Options`/`Result` 类型导出上移为 public；小数据同步 `useMemo` 派生与直调等价、大数据 `borrowCycles ≥ 5000` 走 Worker（`new Worker(url, {type:'module'})` + `wrap`），opts 经 `useDeferredValue` 延迟重算；H-3 Vitest 4 例覆盖未就绪/同步等价/空库/CLC↔DDC 重算。`tsc --noEmit` + Vitest 23 suites/228 tests + `pnpm build` 全绿。下一推进：阶段 2（C-1~C-7 图表组件）。

- 2026-07-31 阶段 2 完成：`src/routes/profile.tsx` 图表主导布局（工具条 SegmentedControl 分类体系 / Select 时间范围 / displayTimezone 只显示；`useTransition` + Skeleton；整页/部件空态与 ErrorBoundary 降级）+ 四图组件（`charts/use-echarts.ts` 薄适配：`echarts/core` + Treemap/Bar/Custom + CanvasRenderer 按需注册、`.dark` 重建 theme 并 dispose 防泄漏；`ClassificationTreemap` 一级高亮 + tooltip、下钻 TODO；`BorrowGantt` lane=bookId:barcode、`useDeferredValue` now 锚定在借端点、`GANTT_THRESHOLD=5000` dataZoom + 12000 矩形封顶；`BorrowVolumeBar` displayTimezone 轴标签；`DurationDistribution` 5 档桶 + `—` 空样本）+ `e2e/profile.spec.ts` 5 例（空态跳 /import、canvas 非空、范围切换重绘、暗色持久、150-lane 大库不崩；修复大库夹具缺 `id` 主键导致 bulkPut 事务回滚、页面误判空态的用例缺陷）。`tsc --noEmit` + Vitest 23 suites/228 tests + `pnpm build` + E2E 7 例全绿。下一推进：阶段 3（G-1~G-6 书库/时间线/导入向导/Dashboard）。

- 2026-07-31 阶段 4 完成：设置页（`/settings`）三区落地——偏好区（语言 DropdownMenu / 主题 SegmentedControl / displayTimezone `TimezoneSelect` 搜索 + IANA 候选，`src/lib/timezones.ts` 纯函数 + `Intl.supportedValuesOf` 运行时 + 内置兜底）、数据区（导出 `exportDatabase`→`serializeExportText`→`buildBackupFilename` 下载；导入 `parseExportText`→`importDatabase`，snapshot/replay 模式选择；系统重置 `AlertDialog` 二次确认 + 「已导出备份」Checkbox 门槛 + 可选清偏好 + `Progress`）、来源管理（`useLiveQuery` 列表 + 编辑/新建 Dialog：模板一键建源 + 自定义 manual 源；删除不提供，由重置统一处理）。**`importDatabase` replay 模式落地**（settings 规格 §4/§9-5）：按 `importLogId` 分组 → 批次按 `importedAt` 排序 → `source.parserId` 取 parser → `ImportMeta` 从 `ImportLog` 派生 → 累积 `ExistingState` 串接多批；校验与纯函数计算先于写操作，清空+写库单事务原子（失败整体回滚不触碰既有数据）；时间锚取 `importedAt` 不读 `Date.now()`；同 `(sources, rawRecords)` 两次重放深等价。新增 `src/components/ui/checkbox.tsx`（radix-ui Checkbox）、`src/settings/{timezone-select,backup-actions,sources-section}.tsx`；`e2e/settings.spec.ts` 4 例（暗色/时区持久、导出→勾选门槛→重置→各页 Empty、导入恢复书库/时间线、来源列表/编辑/新建）；修 e2e-seed 每次导航重灌库缺陷（sessionStorage 一次性守卫）、fixture source.library 形状对齐真实 `LibraryInfo`。`tsc --noEmit` + Vitest 29 suites/269 tests + `pnpm build` + E2E 26 例全绿。统一 UI 里程碑全部阶段（0–4）完成。

- 2026-07-31 阶段 3 完成：Dashboard（`/` 统计卡片 + 最近借阅 + 快速入口 + 空态）、书库列表（`/library` 搜索/来源筛选/列排序、分类号芯片 `ClassificationBadge`、待复核徽标、空态）、书目详情（`/library/$bookId` `parseParams` z.string() 校验入参；卷卡元数据 + 馆藏记录 + 借阅历史；书不存在空态）、时间线（竖向脊柱上→下按 `borrowedAt` 排列、在借强调、来源/状态筛选、空态）、导入向导（模板建来源→文件选择+`detectAndDecode` 编码检测→前 10 条预览→执行→报告；`src/import/run-import.ts` 编排复用 `importPipeline`，≥50MB 走 `import-worker.ts` Comlink 下放；每步可回退）。共享纯函数：`src/lib/classification.ts`（CLC/DDC 一级表从 profile-stats 抽离，芯片与聚合同源）、`encoding.ts`（UTF-8 fatal → GBK 回退）、`display-time.ts`（UTC→displayTimezone）、`source-templates.ts`（SOURCE_TEMPLATES）。**修复潜在 pipeline bug**：选书帮占位行共享 `metaId` 时 `crDerivedInput` 走 metaIdKey 派生同 id（bulkPut 后者覆盖前者，独立 Book 契约被破坏）→ 占位候选改按 `sourceId+barcode` 派生（§10.6 第 4 条）。`__root.tsx` 加 `SidebarTrigger` + 移动端导航点击收起 Sheet。Vitest 28 suites/260 tests + `tsc -b`/`pnpm build` + E2E 22 例（`e2e/app.spec.ts` 12 例：六页导航/高亮、移动端折叠、空态×3、暗色/locale 持久、书库搜索排序+详情、向导关键路径→落库→书库可见→Dashboard 统计）全绿。下一推进：阶段 4（S-2/S-3 设置页）。

- 推进建议顺序：~~D-1~~ → 阶段 0 → 阶段 1 → ~~D-2/D-3~~（已预装）→ ~~阶段 2~~ → ~~阶段 3~~ → ~~S-1~~ → ~~S-2/S-3~~（阶段 0–4 全部完成）。

- 2026-07-23 UI 设计令牌落地：新增根目录 `DESIGN.md`（蔦屋書店气质：瑠璃紺/白群主色、生成纸白/暖黑底、完全直角、无阴影、CJK 排版规则），色表与字体栈从 `ui-navigation.md`/`design-decisions.md` 抽离集中；`src/index.css` 按 DESIGN.md 落 CSS 变量、zh-ja 双字体栈、`::selection`、`:lang()` 行高切换，移除 `@fontsource-variable/geist` 网络字体依赖。**P0-1 前置 CSS 已就位，仅需 React 侧 hook/Provider。**


---

## 实现指南（给执行 LLM 的速查）

> 本节消除歧义：已落地代码、文件级接线、精确命令、i18n key 模式、验收 checklist。
> 执行前先读 [ui-navigation](../specs/ui-navigation.md) §1-§3 了解各页布局与空状态。

### A. 已落地代码快照（勿重复建）

| 层 | 已有文件 | 状态 |
|----|---------|------|
| 路由桩 | `src/routes/*.tsx`（6 页 + __root） | 桩：仅标题+副标题，需替换为真实 UI |
| AppShell | `src/routes/__root.tsx` | ✅ Sidebar + Outlet + ThemeProvider 已接 |
| settings | `src/routes/settings.tsx` | ✅ 语言切换已接；缺 theme/时区/导出/重置/来源管理 |
| shadcn 组件 | `src/components/ui/`（15 件） | ✅ 全装好，直接 import 用 |
| i18n | `src/i18n/` + `src/hooks/use-locale.ts` | ✅ 骨架在用；各页 key 需补 |
| DB | `src/db/db.ts` → `ReadGraphDB` class | ✅ 类已定义；**无全局单例**，见 D 节接线 |
| Repository | `src/db/repositories.ts` → `createRepositories(db)` | ✅ 六实体 CRUD |
| 重置/导出导入 | `src/db/reset.ts` `export-import.ts` `backup.ts` | ✅ 纯函数已绿 |
| 设计令牌/CSS | 根目录 `DESIGN.md` + `src/index.css` | ✅ 2026-07-23：纸墨色板/`--radius:0`/无阴影/zh-ja 双字体栈/`::selection`/CJK 行高切换已落；Geist 网络字体已移除 |
| 纯函数 | `src/lib/profile-stats.ts` `echarts-theme.ts` `time.ts` 等 | ✅ 已绿 |
| 运行时依赖 | `dexie-react-hooks@4.4.0` `echarts@6.1.0` `comlink@4.4.2` | ✅ 已锁定（echarts 2026-07-30 升 6.1.0） |
| E2E | `@playwright/test@1.61.1` + `playwright.config.ts` + `e2e/smoke.spec.ts` | ✅ 烟测绿；浏览器二进制本地 install |

### B. 依赖引入（锁定版本 + 命令）— 已执行

```bash
# D-1: 响应式查询（与 dexie@4.x 对齐；勿用旧 major 1.1.7）
pnpm add dexie-react-hooks@4.4.0
# D-2: 图表（reading-profile 规格钉 6.1.0；v6 实例化约束见 §3）
pnpm add echarts@6.1.0
# D-3: Worker（大数据聚合下放）
pnpm add comlink@4.4.2
# D-5: E2E
pnpm add -D @playwright/test@1.61.1 && pnpm exec playwright install chromium
```

每次 add 后跑：`pnpm verify && pnpm build && pnpm test && pnpm audit --audit-level=high`，全绿才提交 `package.json` + `pnpm-lock.yaml`。

> 已锁定版本见上表。echarts v6 实例化约束（legend 锚定、`grid.outerBoundsMode`）见 D-2 备注 / [reading-profile §3](../specs/reading-profile.md#3-echarts-主题与薄适配层)。

### C. 文件级任务清单（建/改哪些文件）

| 任务 | 文件 | 做什么 |
|------|------|--------|
| P0-1 | 建 `src/hooks/use-theme.ts` | `useTheme()` → `{theme,setTheme}`；读 `readPreferences().theme`，写 `writePreferences({theme})`；`auto` 监听 `matchMedia('(prefers-color-scheme: dark)')`；副作用 toggle `<html class="dark">` |
| P0-1 | 改 `src/routes/__root.tsx` | 在 `<SidebarProvider>` 外包 theme Provider（或直接在 RootLayout 内调 `useTheme()` 触发副作用） |
| H-1 | 建 `src/profile/use-profile-stats.ts` | `useLiveQuery` 取 `books`/`catalogRecords`/`borrowCycles`/`sources` → `computeProfileStats()` → 返回 `ProfileStatsResult`；大数据走 Worker（D-3，留接口） |
| C-1~C-5 | 改 `src/routes/profile.tsx` | ECharts `treemap`/`bar`/`custom` series；按 `bundle-barrel-imports` 从 `echarts/core` 按需 import |
| G-1 | 改 `src/routes/index.tsx` | 统计卡片 + 最近借阅 + 空态 `Empty` |
| G-2 | 改 `src/routes/library/index.tsx` | `Table` 列表 + 搜索/筛选/排序 + `Badge` 分类号芯片 |
| G-3 | 改 `src/routes/library/$bookId.tsx` | `Card` 卷卡式详情 + `BorrowCycle` 时间线 |
| G-4 | 改 `src/routes/timeline.tsx` | 竖向脊柱按 `borrowedAt` 排列 |
| G-5 | 改 `src/routes/import.tsx` | 多步向导（来源→文件→预览→执行→报告），复用 `importPipeline()` |
| S-2 | 改 `src/routes/settings.tsx` | 加 theme/时区/导出/重置/来源管理区 |

### D. DB 接线（关键：当前无全局单例）

```ts
// src/db/db-instance.ts（新建）
import { ReadGraphDB } from './db'
export const db = new ReadGraphDB()          // 浏览器单例
// 组件里用：
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '@/db/db-instance'
const books = useLiveQuery(() => db.books.toArray())
```

测试用 `fake-indexeddb`（已装 devDep）：`createTestDB()` 在 `src/db/test-helpers.ts` 已有。

### E. i18n key 模式

命名空间 `pages`，key 按 `页面.区域.元素` 拆。每页补 key 时同步写 `zh-CN/pages.json` + `en/pages.json`。

```
dashboard.stats.bookCount       "藏书数" / "Books"
dashboard.stats.cycleCount      "借阅周期" / "Borrow cycles"
dashboard.empty.title           "还没有藏书" / "No books yet"
dashboard.empty.action          "去导入" / "Go to import"
library.column.title            "书名" / "Title"
library.column.author           "作者" / "Author"
library.column.isbn             "ISBN"
library.column.classification   "分类号" / "Classification"
library.column.borrowCount      "借阅次数" / "Borrows"
library.empty.title             "书库为空" / "Library is empty"
settings.preferences.theme      "主题" / "Theme"
settings.preferences.themeLight "浅色" / "Light"
settings.preferences.themeDark  "深色" / "Dark"
settings.preferences.themeAuto  "跟随系统" / "Auto"
settings.preferences.timezone   "时区" / "Timezone"
settings.data.export            "导出备份" / "Export backup"
settings.data.import            "导入备份" / "Import backup"
settings.data.reset             "系统重置" / "System reset"
settings.reset.confirm          "确认重置？此操作不可撤销" / "Confirm reset? This cannot be undone"
settings.reset.backupRequired   "请先导出备份" / "Export backup first"
```

> 以上为起步 key；每页实现时按需补，保持 `页面.区域.元素` 层级。

### F. 每 task 验收 checklist

- [x] **P0-1**: `useTheme()` 切 light/dark → `<html class>` 变化；切 auto → 跟随系统；reload 后保留；Vitest 绿
- [x] **H-1**: `useProfileStats()` 返回非 null（有数据时）；空库返回空结果不崩；Vitest 绿
- [x] **C-1~C-5**: treemap/bar/custom canvas 非空像素（脱敏数据）；暗色切换配色变化；空数据 `Empty`
- [x] **G-1**: 空库 `Empty` + 导入按钮跳 `/import`；有数据统计卡片正确
- [x] **G-2**: 表格可排序/搜索；分类号 `Badge` 渲染；空态 `Empty`
- [x] **G-3**: 书目元数据 + CatalogRecord 列表 + 借阅时间线
- [x] **G-4**: 时间线按 borrowedAt 排序；在借状态区分
- [x] **G-5**: 向导每步可回退；预览 10 条；执行后书库可见
- [x] **S-2**: theme/locale/时区切换持久；导出下载文件；重置 `AlertDialog` 二次确认 + 备份门槛
- [x] **全局**: `pnpm build` 无类型错误；`pnpm test` 全绿；无硬编码中英文（全走 `t()`）
