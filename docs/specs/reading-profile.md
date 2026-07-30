# 阅读画像与图表规格

> 本文件从 `docs/app-spec.md` §11 拆出，遵循 SDD + TDD。落地本节规格后再进 Tests(Red) → Code → Tests(Green)。实体字段、分类体系与索引语义以 [internal-schema](../metadata/internal-schema.md) 及各实体元数据文档为唯一来源；本节不重复抄录字段表，只定义「代码落点、聚合契约、图表配置、退化策略与测试」。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 范围与依赖

**范围**：定义阅读画像页（`/profile`，方向 B「阅读图谱」）的统计维度、纯函数聚合契约、ECharts 薄适配主题、空数据与大文件退化策略。本里程碑**不实现**导入管线增量（属 [导入管线规格](import-pipeline.md)）、不新增 Object Store/索引（属 [数据层规格](data-layer.md)）、不改 Repository 接口（仅消费现有读取方法 + `useLiveQuery`）。统计与图表**只读**：不写库、不触发迁移、不修改实体。

**依赖**（本里程碑拟新增，审查在引入时按 [npm-supply-chain-security §3](../npm-supply-chain-security.md) 落地，下表为版本候选；最终以 PR 中的 `pnpm verify`/`audit` 通过为准）：

| 包 | 类型 | 版本候选 | 用途 |
|----|------|---------|------|
| `echarts` | runtime | `5.6.0` | canvas 渲染、treemap/自定义 series/柱图；依赖面仅 `zrender`+`tslib`（见 [design-decisions](../design-decisions.md) 图表选型） |
| `date-fns` | runtime | `4.1.0` | 月份/年份桶的 locale 友好格式化与区间生成（按需引入子模块；时间转换仍走已落地的 `date-fns-tz`） |

> `date-fns` 为可选：月份桶与 duration 直方图可用 `Date` 的 UTC getter + `Intl` 完成，若实现期评估后无 locale 格式化刚需则不引入，以缩小依赖面。是否引入在 Tests(Red) 阶段最终裁定。

**代码落点**：

```
src/
├─ lib/
│  ├─ echarts-theme.ts        # 薄适配：shadcn CSS 变量 → echarts theme（palette/坐标轴/tooltip），随 .dark 重建
│  ├─ profile-stats.ts         # 纯函数聚合：实体数组 → 各图表 dataset（无 Date.now()/无 DOM/无存储读）
│  └─ profile-stats.test.ts    # 聚合纯函数单测
├─ profile/
│  ├─ stats-worker.ts          # Comlink 包装：大数据集下放 Worker 跑 profile-stats（≥阈值启用）
│  ├─ use-profile-stats.ts     # Hook：useLiveQuery 取实体 → memo 派生 dataset（小数据同步/大数据走 Worker）
│  └─ charts/                  # 各图组件（按需 import，避免 barrel）
│     ├─ ClassificationTreemap.tsx
│     ├─ BorrowGantt.tsx
│     ├─ BorrowVolumeBar.tsx
│     └─ DurationDistribution.tsx
└─ routes/
   └─ profile.tsx             # 阅读画像页（改造现有占位页为图表主导布局）
```

## 2. 统计维度与聚合契约

所有聚合为**纯函数**：入参为实体数组（`Book[]`/`CatalogRecord[]`/`BorrowCycle[]`/`Source[]`）+ 选项（分类体系、时间范围、displayTimezone），出参为结构化 dataset；不带时钟、不读写 IndexedDB、不触 DOM、不依赖全局可变状态。同一入参产出深等价输出（对照 [import-pipeline §3](import-pipeline.md#3-纯函数-pipeline-契约) 纯函数 pipeline 契约）。时间聚合一律基于 **UTC**（`getUTCFullYear`/`getUTCMonth`），保证 displayTimezone 改变只影响标签呈现、不改变桶归属。

**`src/lib/profile-stats.ts` 契约**：

```ts
type ClassificationSystem = 'clc' | 'ddc' | 'lcc' | 'udc' | 'other'

interface ProfileStatsInput {
  books: Book[]
  catalogRecords: CatalogRecord[]
  borrowCycles: BorrowCycle[]
  sources: Source[]
}

interface ProfileStatsOptions {
  /** 分类体系，缺省取各 Source 的 LibraryInfo.classificationSystem 多数票；仍空取 'clc' */
  classificationSystem: ClassificationSystem | null
  /** 时间范围（UTC），null 表示不限；用于按月/按年/甘特的区间裁剪 */
  range: { from: Date | null; to: Date | null } | null
  /** displayTimezone（IANA），仅影响轴标签呈现，不影响桶归属 */
  displayTimezone: string
}

interface ProfileStatsResult {
  summary: { totalBooks: number; totalCycles: number; inBorrow: number; avgDurationDays: number | null; medianDurationDays: number | null }
  classification: { name: string; code: string; category: string | null; value: number }[]   // treemap
  borrowVolume: { bucket: string; count: number }[]                                          // 按月（或按年，按数据跨度自动切粒度）
  durationDistribution: { range: string; count: number }[]                                     // 借阅时长直方图
  gantt: { laneKey: string; label: string; intervals: { start: string; end: string | null; status: BorrowCycle['status'] }[] }[]
}

function computeProfileStats(input: ProfileStatsInput, opts: ProfileStatsOptions): ProfileStatsResult
```

**各维度语义**：

1. **分类法分布 treemap**（`classification`）
   - 体系取 `opts.classificationSystem`；缺省度量为各 `Source.library.classificationSystem` 的多数票（无则 `'clc'`）。
   - 每个 `Book` 计一次，避免多 `CatalogRecord` 多副本重复计数。Book 的分类号取其 `CatalogRecord.classifications` 中**首选匹配体系**的条目；命中多条取首条；无匹配则归入 `未分类`（`code: '__unclassified__'`）。
   - CLC 归并到一级类目（取 `code` 首字母 A–Z，`category` 取 [catalog-record 分类号对照表]）；DDC 归并到一级（`code` 首位 0–9 + 主类名）；子类细分留作交互下钻（本里程碑不要求）。
   - treemap `value` = 归并后桶内 Book 数；`name` = 类目名（中/英随 locale）。

2. **借阅甘特带**（`gantt`）
   - lane = `bookId + barcode`（无 barcode 退化 `bookId + '__noBarcode__'`）；同 lane 的 `BorrowCycle` 按 `borrowedAt` 升序叠放为区间 `[borrowedAt, returnedAt]`。
   - `status='borrowed'` 的 `returnedAt=null`，区间呈现「在借」强调态；纯函数**不读 `Date.now()`**，`end` 在 dataset 层留 `null`，由图表组件在渲染时用 `useDeferredValue` 的 now 锚补齐仅作视觉，不回写聚合结果。
   - 大数据退化见 §5。

3. **借阅量柱图**（`borrowVolume`）
   - 按 `BorrowCycle.borrowedAt` 的 UTC 年月桶；数据跨度 ≤ 2 年用月粒度，> 2 年用年粒度（纯函数判定，与 displayTimezone 无关）。
   - `range` 非空时裁剪仅落入区间（左闭右开，UTC）的周期。

4. **借阅时长分布**（`durationDistribution`）
   - 仅 `status='returned'` 且 `returnedAt != null` 的周期计入。`duration = ceil((returnedAt - borrowedAt) / 86_400_000)`（对照 [borrow-cycle 派生计算]）。
   - 固定分桶：`0–7`/`8–14`/`15–30`/`31–60`/`>60`（天）；`status='borrowed'`/`unknown` 不计入，不进 `summary.avgDuration`。
   - `summary.avgDurationDays` 与 `medianDurationDays` 仅基于已归还周期；样本为 0 时记 `null`，UI 表达为 `—`。

## 3. ECharts 主题与薄适配层

`src/lib/echarts-theme.ts`（对照 [design-decisions](../design-decisions.md)「图表选型」薄适配约束）：

- 读 shadcn CSS 变量（`--background`/`--foreground`/`--muted-foreground`/`--chart-1..5` 等）组装 echarts theme 对象：palette 取 `--chart-1..5`（扩展按需循环）；坐标轴线/文字用 `--border`/`--muted-foreground`；tooltip 背景用 `--popover`/`--popover-foreground`。
- 不在模块顶层读 DOM 变量；提供 `buildTheme(isDark: boolean, cssVars: Record<string,string>): EChartsTheme`，由消费方在 `.dark` class 切换时重建并 `setOption` 重应用。
- 主题随暗色切换：`use-profile-stats` 监听根 `.dark`（沿用 [ui-navigation §4](ui-navigation.md#4-主题与暗色模式骨架) theme Provider 信号），变化时重建 theme 并更新各图实例；旧实例 `dispose` 防泄漏。
- 数据色（蓝宝石/青绿方向）**只在本页发力**，其余界面保持冷静灰（[design-decisions](../design-decisions.md) 阅读图谱方向 B）。
- import 策略：`echarts` 核按需引入 `echarts/core` + 注册的图种（`TreemapChart`/`BarChart`/`CustomChart`）+ `CanvasRenderer`，不走 `echarts` barrel；shadcn 组件按需 import（`bundle-barrel-imports`）。ECharts 初始化组件用 `lazy()`/动态 import 在 `/profile` 激活时加载（`bundle-dynamic-imports`、`bundle-conditional`）。

## 4. UI 设计说明

**布局**（单页全幅，方向 B 图谱语言）：
- 顶部一行概览统计卡片（藏书数 / 借阅周期数 / 在借数 / 平均借阅时长），等宽数字 + 标签；卡片窄、克制，不抢图谱视觉。
- 卡片下方为图表区，竖向堆叠的「图谱块」：分类法 treemap（大块，高度 ≥ 320px）→ 借阅甘特带（高度按 lane 数自适应，≥ 280px）→ 借阅量柱图 + 时长分布（两列，移动端折叠为单列）。
- 图表是主角、全幅；无外层装饰卡片包裹图谱块（[ui-navigation §3](ui-navigation.md#3-各功能页布局与空状态) 禁卡片套卡片），仅以 `border-t` 分隔。

**交互**：
- 顶部工具条：分类体系切换（`SegmentedControl`：CLC/DDC/LCC/UDC，仅列数据中实际出现的体系）、时间范围（`Select`：全部 / 近 1 年 / 近 3 年 / 自定义区间）、displayTimezone 跟随设置（不在本页改，只显示当前值）。
- 切换交互走 `useTransition` 标注非紧迫更新，期间图表区显示 `Skeleton`（不阻断概览卡片与导航，`rerender-transitions`/`rendering-usetransition-loading`）。
- treemap 块下钻（点一级类目展开子类）为可选增强；本里程碑要求一级呈现可交互高亮与 tooltip，子类下钻标 TODO。
- 无破坏性操作：本页只读，不做任何写库或重置入口。

**状态**：
- 空态：无任何 Book/BorrowCycle 时，整页用 shadcn `Empty` + 导入入口（按钮跳 `/import`），图表区隐去占位（`rendering-conditional-render` 用三元，非 `&&`）。
- 部分（仅有书无周期 / 仅有周期无书）相应图表块各自 `Empty` 变体，不整页空白。
- 加载态：`useLiveQuery` 未就绪时 `Skeleton`；大数据 Worker 计算时 `Progress`。
- 错误态：聚合抛错（数据异常的周期）被边界捕获，对应图谱块降级为 `Empty` + 错误文案（不崩溃整页）。

**响应式**：移动端单列堆叠，图表最小高度不塌缩；甘特带在窄屏启用横向滚动（`overflow-x-auto`）而非压缩 lane。所有可见文本经 `react-i18next` `t()`，namespace `pages`（`profile.*`），禁止硬编码中英文字面量（[i18n-conventions](../i18n-conventions.md)）。

## 5. 数据契约与边界

- **纯前端/只读**：所有数据来自 IndexedDB（Dexie + `useLiveQuery`），无网络、无后端、无数据上传（[app-spec §1](../app-spec.md)/[ui-navigation §6](ui-navigation.md#6-数据契约与边界)）。聚合为纯函数，结果不落库、不缓存到 localStorage。
- **UTC 与 displayTimezone**：桶归属基于 UTC getter（`getUTCFullYear`/`getUTCMonth`），`displayTimezone` 仅用于轴标签（柱图 x 轴月份按 `Intl.DateTimeFormat` 用该时区呈现）。甘特区间的「在借」端点视觉锚由组件层以 `useDeferredValue` 的 now 补齐，**不改聚合产物**，保证可复现（对照 [import-pipeline §3](import-pipeline.md#3-纯函数-pipeline-契约) 确定性）。
- **空数据**：`computeProfileStats` 对空入参返回结构完整但全零的 `ProfileStatsResult`（`classification=[]`/`gantt=[]`/...，`summary.*` 为 0 或 `null`），UI 映射为整页 `Empty`；聚合函数不抛空异常。
- **大文件退化**（阈值对齐 [ui-navigation §6](ui-navigation.md#6-数据契约与边界) ≥50MB 导入约束的下游表现）：
  - `BorrowCycle` 数量 ≥ `GANTT_THRESHOLD`（候选 2000 条 lane / 5000 区间）时甘特带启用**视口下采样**：按当前甘特 x 域采样区间，域外折叠为「疏密指示条」；不一次性渲染全部矩形（canvas 压力）。
  - 聚合耗时阈值（候选 > 50ms）触发 Worker：`use-profile-stats` 小数据同步 `useMemo` 计算，大数据走 `stats-worker.ts`（Comlink，对照 [design-decisions](../design-decisions.md) 并发与性能）。
  - treemap/柱图数据量为聚合后桶数（远小于原始记录），不单独退化；分类体系切换与时间范围变化用 `useDeferredValue` 延迟重算，输入与导航保持响应（`rerender-use-deferred-value`）。
  - 退化策略只降视觉保真，**不改统计正确性**：被下采样的区间仍计入 `borrowVolume`/`durationDistribution`/`summary`，仅甘特矩形数受视口约束。
- **边界**：分类号缺失、`borrowedAt > returnedAt`（数据异常）等已在导入阶段落警告（[import-pipeline §8](import-pipeline.md#8-借还配对与错误警告模型)）；聚合层对异常周期跳过计入 duration 桶但仍计入 `borrowVolume` 与甘特（带 `status` 标记），不二次告警、不丢区间。

## 6. 用户故事与验收用例

1. 作为新用户，空库打开 `/profile` → 看到 `Empty` + 导入入口，不出现空坐标轴或报错。
2. 作为用户，导入脱敏数据后进入 `/profile` → 概览卡片数字正确（藏书数=Book 数、周期数=BorrowCycle 数、在借数=`status='borrowed'` 数、平均时长=已归还周期均值）。
3. 作为用户，切换分类体系（CLC↔DDC）→ treemap 重建且类目名随 locale 变化；切换时间范围「近 1 年」→ 借阅量柱图与甘特仅显示区间内周期。
4. 作为用户，切暗色 → 图表配色随 `.dark` 切换，无白底刺眼；刷新后偏好与主题保留（[ui-navigation §4/§5](ui-navigation.md#4-主题与暗色模式骨架) 已落地）。
5. 作为用户，切中英 → 概览卡片标签、treemap 类目名、坐标轴月份名、tooltip 均切换语言。
6. 作为用户，大库（≥ GANTT_THRESHOLD）打开 `/profile` → 甘特带视口下采样，滚动顺畅、概览卡片与其他图表仍秒开；聚合结果数值与全量一致。
7. 作为用户，存在 `borrowedAt > returnedAt` 异常数据 → 该周期在甘特标记异常态，不进入时长直方图，整页不崩溃。

## 7. 测试清单

**Vitest（单元/集成，`src/lib/profile-stats.test.ts` 等）**
- `computeProfileStats` 空入参返回全零结构，不抛异常。
- 分类体系缺省度量：多 Source 不同体系时取多数票；全空回退 `'clc'`。
- CLC/DDC 一级归并正确（取首字母/首位 + 类名映射）；无分类号归入 `__unclassified__`。
- Book 计一次：多 CatalogRecord 同 ISBN 不同分类号时 treemap 按首选体系条目计一次，不翻倍。
- 时间桶：月/年粒度切换阈值（≤ 2 年月、> 2 年年）正确；`range` 左闭右开裁剪生效；桶归属与 displayTimezone 无关（同输入不同 tz 桶相同）。
- duration：`status='returned'` 计入，`borrowed/unknown` 不计；分桶边界（7/14/30/60 天）正确；空样本 `avg/median` 为 `null`。
- 甘特：lane=`bookId+barcode`；无 barcode 退化；区间升序；`borrowed` 返回 `end=null`。
- 纯函数性：同输入两次调用深等价；无 `Date.now()`（代码审计/依赖检查）。

**Playwright（E2E）**
- `/profile` 空态：显示 `Empty` + 导入入口按钮，点击跳 `/import`。
- 脱敏数据下 ECharts canvas 非空像素（treemap/柱图/甘特分别校验）。
- 分类体系 `SegmentedControl` 切换后 canvas 重绘、类目 tooltip 文本随 locale 切换。
- 暗色切换 → 图表配色变化（canvas 像素采样差异），reload 仍为暗色。
- 大库夹具下甘特视口下采样：滚动流畅，不一次性渲染超量矩形（性能基线，可选）。

## 8. React 性能规则引用

- `bundle-barrel-imports`：`echarts` 按 `echarts/core` + 按图种引入，shadcn 组件按需 import，避免 barrel 拉宽依赖。
- `bundle-dynamic-imports` / `bundle-conditional`：ECharts 初始化与各图组件在 `/profile` 激活时动态加载。
- `bundle-preload`：侧栏悬停 `/profile` 时预加载图表 chunk（可选增强）。
- `rerender-lazy-state-init` / `rerender-derived-state-no-effect`：dataset 在 render 期由 `useMemo` 从 `useLiveQuery` 实体派生，不写 effect 同步 state。
- `rerender-memo`：各图组件 `memo` 化，仅以自身 dataset 为依赖；概览卡片独立 memo，不被图表重算波及。
- `rerender-transitions` / `rendering-usetransition-loading`：分类体系/时间范围切换用 `useTransition`，图表区配合 `Skeleton`。
- `rerender-use-deferred-value`：大数据/范围变化用 `useDeferredValue` 延迟聚合重算，保输入响应。
- `js-combine-iterations` / `js-index-maps` / `js-set-map-lookups`：聚合单遍建 `Map`（catalog→classification、bookId→book），避免重复线性查找。
- `js-min-max-loop`：duration 分桶用一遍扫描，`avg`/`median` 用单遍求和与选择，不 `sort`。
- `client-localstorage-schema`：本页只读 `readgraph:preferences`（displayTimezone），不写入；读侧仍受 [ui-navigation §4](ui-navigation.md#4-主题与暗色模式骨架) 的 Zod 校验保护。
- `rendering-conditional-render`：空态/部分空态图表块用三元表达式，不用 `&&` 渲染。
