# 阅读画像与图表规格

> 本文件从 `docs/app-spec.md` §11 拆出，遵循 SDD + TDD。落地本节规格后再进 Tests(Red) → Code → Tests(Green)。实体字段、分类体系与索引语义以 [internal-schema](../metadata/internal-schema.md) 及各实体元数据文档为唯一来源；本节不重复抄录字段表，只定义「代码落点、聚合契约、图表配置、退化策略与测试」。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 范围与依赖

**范围**：定义阅读画像页（`/profile`，方向 B「阅读图谱」）的统计维度、纯函数聚合契约、ECharts 薄适配主题、空数据与大文件退化策略。本里程碑**不实现**导入管线增量（属 [导入管线规格](import-pipeline.md)）、不新增 Object Store/索引（属 [数据层规格](data-layer.md)）、不改 Repository 接口（仅消费现有读取方法 + `useLiveQuery`）。统计与图表**只读**：不写库、不触发迁移、不修改实体。

**价值统计（§2.5）同属只读范围**：仅消费 `Book.price`（结构化 `Price`，由 OPAC 补全 [opac-enrichment §5.2](opac-enrichment.md) 与统一编辑表单落库；`price=null` 的书不计值）。不引入汇率换算（纯前端无网络且静态汇率会过时，见 §2.5 多币种决策）、不新增依赖、不落库。是否补全定价由用户自由抉择，本页不做覆盖统计、不设补全引导入口。

**依赖**（本里程碑拟新增，审查在引入时按 [npm-supply-chain-security §3](../npm-supply-chain-security.md) 落地，下表为版本候选；最终以 PR 中的 `pnpm verify`/`audit` 通过为准）：

| 包 | 类型 | 版本候选 | 用途 |
|----|------|---------|------|
| `echarts` | runtime | `6.1.0` | canvas 渲染、treemap/自定义 series/柱图；依赖面 `zrender@6.1.0`+`tslib`；接触面为 `buildTheme()` 纯函数适配器，无实例化调用，色板/轴/tooltip theme 字段不变（v6 实例化约束见 §3） |
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
│     ├─ DurationDistribution.tsx
│     ├─ BorrowCalendar.tsx      # 借阅日历热力图（ECharts heatmap；年/月视图 + 导航）
│     └─ calendar-grid.ts        # 日历网格纯函数：年/月视图产格、周序、配色、tooltip HTML
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
  /** 时间范围（UTC），null 表示不限；用于按月/按年/甘特/借阅日历的区间裁剪 */
  range: { from: Date | null; to: Date | null } | null
  /** displayTimezone（IANA），仅影响轴标签呈现，不影响桶归属 */
  displayTimezone: string
  /** 借阅日历「今天」锚（调用方传入，纯函数不读 Date.now()）：开区间在借周期（returnedAt=null）的天区间收敛到该日；null 时在借周期只计入借出当日（单日口径，§2.6） */
  calendarAnchor: Date | null
}

interface ProfileStatsResult {
  summary: { totalBooks: number; totalCycles: number; inBorrow: number; avgDurationDays: number | null; medianDurationDays: number | null }
  classification: { name: string; code: string; category: string | null; value: number }[]   // treemap
  borrowVolume: { bucket: string; count: number }[]                                          // 按月（或按年，按数据跨度自动切粒度）
  durationDistribution: { range: string; count: number }[]                                     // 借阅时长直方图
  gantt: { laneKey: string; label: string; volume: string | null; intervals: { start: string; end: string | null; status: BorrowCycle['status'] }[] }[]
  money: MoneyStats                                                                           // 价值统计（§2.5）
  calendar: CalendarStats                                                                     // 借阅日历（§2.6，bookology-benchmark §5.1）
}

/** 借阅日历单日格：当天处于在借期（`[borrowedAt, returnedAt)` 与该 UTC 日相交）的独立 Book。 */
interface CalendarDay {
  /** UTC 日桶键 'YYYY-MM-DD'（日起点；displayTimezone 不影响桶归属） */
  date: string
  /** 当天在借的独立 Book 数（bookId 去重，设备排除） */
  count: number
  /** 当天在借的独立 bookId，升序（图表 tooltip 列书名用） */
  bookIds: string[]
}

interface CalendarStats {
  /** 去重 UTC 天格（升序）；range 口径——仅 borrowedAt ∈ range 的非设备周期计入（与 gantt/borrowVolume 同） */
  days: CalendarDay[]
  /** 借阅天数（全量口径）：所有非设备周期的天区间并集去重计数，与 range 无关；概览行「借阅天数」卡 */
  borrowDays: number
  /** days 最早/最晚日 'YYYY-MM-DD'；无数据 → null（图表视图/导航边界） */
  minDate: string | null
  maxDate: string | null
  /** days 中出现过的 bookId → 题名/封面（tooltip 列书名与封面缩略图；不携带整本 Book） */
  bookIndex: Record<string, { title: string; coverUrl: string | null }>
}

/** 单币种金额聚合：整数「分」累计避免浮点误差；amount 为元，展示层格式化 */
interface MoneyAmount {
  currency: string          // ISO 4217
  amount: number            // 元（= 分累计 / 100，四舍五入到分）
  count: number             // 计入该币种的 Book 数（平均 = amount / count）
}

interface MoneyStats {
  /** 馆藏总价值：全量非设备、有定价 Book 按币种合计；与 time range 无关 */
  collectionValue: MoneyAmount[]
  /** 借阅价值：range 内有 ≥1 个 BorrowCycle 的独立 Book（去重，同书多次借阅只计一次）按币种合计；range=null 时 = 全部有借阅的独立 Book */
  borrowedValue: MoneyAmount[]
  /** 平均书价：按币种（amount / count），count=0 的币种不出现 */
  avgPrice: MoneyAmount[]
  /** 主导币种：有定价 Book 数最多的币种；无定价 → null */
  dominantCurrency: string | null
  /** 价格分布直方图（仅主导币种 Book；其余币种不入图，记 multiCurrency） */
  distribution: { range: string; count: number }[]
  /** 有定价 Book 中是否出现 ≥2 种币种 → UI 展示币种拆分脚注 */
  multiCurrency: boolean
}

function computeProfileStats(input: ProfileStatsInput, opts: ProfileStatsOptions): ProfileStatsResult
```

**各维度语义**：

0. **设备排除总则**（[device-borrows 规格 §4](device-borrows.md#4-统计排除stats)）：`Book.materialType='device'`（电子书阅读器等非书实物，由 szlib parser 依 `cirtype="电子设备外借"` 标记）的 Book 与其全部 BorrowCycle **不进入任何维度**——`summary.*`、分类 treemap、借阅量柱图、时长分布、甘特带、借阅日历均排除；`inBorrow` 不计设备在借。排除在 `computeProfileStats` 内部完成（同步 `useMemo` 与 Worker 共用同一纯函数入口，两路径自动覆盖）；无设备数据时结果与旧语义等价。设备借阅历史仍由 `/timeline` 展示，本页仅统计排除。

1. **分类法分布 treemap**（`classification`）
   - 体系取 `opts.classificationSystem`；缺省度量为各 `Source.library.classificationSystem` 的多数票（无则 `'clc'`）。
   - 每个 `Book` 计一次，避免多 `CatalogRecord` 多副本重复计数。Book 的分类号取其 `CatalogRecord.classifications` 中**首选匹配体系**的条目；命中多条取首条；无匹配则归入 `未分类`（`code: '__unclassified__'`）。
   - CLC 归并到一级类目（取 `code` 首字母 A–Z，`category` 取 [catalog-record 分类号对照表]）；DDC 归并到一级（`code` 首位 0–9 + 主类名）；子类细分留作交互下钻（本里程碑不要求）。
   - treemap `value` = 归并后桶内 Book 数；`name` = 类目名（中/英随 locale）。

2. **借阅甘特带**（`gantt`）
   - lane = `bookId + barcode`（无 barcode 退化 `bookId + '__noBarcode__'`）；同 lane 的 `BorrowCycle` 按 `borrowedAt` 升序叠放为区间 `[borrowedAt, returnedAt]`。
   - `status='borrowed'` 的 `returnedAt=null`，区间呈现「在借」强调态；纯函数**不读 `Date.now()`**，`end` 在 dataset 层留 `null`，由图表组件在渲染时用 `useDeferredValue` 的 now 锚补齐仅作视觉，不回写聚合结果。
   - 套装书（`isSetBook`：≥2 个 volume 非空编目）lane 携带 `volume`（该 lane 周期 → 编目卷号：`catalogRecordId` 直查、barcode 兜底，见 `src/lib/volume.ts` `volumeOfCycle`）；非套装/解析不到为 `null`。`label` 恒为公共题名，图表层按 `volume` **原始值**直接追加「 · 3」式后缀（不格式化/不 i18n，区分套装各卷，tooltip 同）。
   - 大数据退化见 §5。

3. **借阅量柱图**（`borrowVolume`）
   - 按 `BorrowCycle.borrowedAt` 的 UTC 年月桶；数据跨度 ≤ 2 年用月粒度，> 2 年用年粒度（纯函数判定，与 displayTimezone 无关）。
   - `range` 非空时裁剪仅落入区间（左闭右开，UTC）的周期。

4. **借阅时长分布**（`durationDistribution`）
   - 仅 `status='returned'` 且 `returnedAt != null` 的周期计入。`duration = ceil((returnedAt - borrowedAt) / 86_400_000)`（对照 [borrow-cycle 派生计算]）。
   - 固定分桶：`0–7`/`8–14`/`15–30`/`31–60`/`>60`（天）；`status='borrowed'`/`unknown` 不计入，不进 `summary.avgDuration`。
   - `summary.avgDurationDays` 与 `medianDurationDays` 仅基于已归还周期；样本为 0 时记 `null`，UI 表达为 `—`。

5. **价值统计（`money`）**
   - **计值口径 = Book（书目）级**：价格挂在 `Book.price`，天然按书计一次；同书多 `CatalogRecord`（多馆藏）不翻倍。**去重**：`borrowedValue` 只取 range 内有 ≥1 个周期（`borrowedAt ∈ range`，左闭右开 UTC）的独立 Book，同书多次借阅只计一次——「借阅价值」语义 =「这些书若购买所需金额的估值」，周期口径会重复计同一本书，不采用。
   - **多币种决策：不隐式汇率换算，按币种分组合计**。纯前端无网络（[design-decisions](../design-decisions.md) 纯前端约束）且静态汇率会过时；用户录入汇率属未来扩展（偏好扩展位）。`collectionValue`/`borrowedValue`/`avgPrice` 均为 `MoneyAmount[]`（每币种一项）；UI 头条取 `dominantCurrency`（有定价 Book 数最多者）对应项，`multiCurrency=true` 时卡片脚注列出其余币种（`其他币种：USD $… / JPY …`）。OPAC 补全定价解析默认 CNY、台版取主价 CNY（[opac-enrichment §5.2](opac-enrichment.md)），实际数据几乎单一币种，多币种仅作正确性兜底。
   - **金额精度**：以整数「分」累计（`Math.round(amount * 100)`），汇总后 /100 得 `amount`（元），杜绝浮点累计误差；展示层用原生 `Intl.NumberFormat(locale, { style: 'currency', currency })`（[design-decisions](../design-decisions.md) l10n 零依赖）。
   - **范围语义**：`collectionValue`/`avgPrice`/`distribution` 为**全量**（与 time range 无关——馆藏价值是存量快照）；`borrowedValue` 随 range 裁剪（近 1 年/近 3 年/自定义区间只计区间内首次借出的书）。
   - **价格分布直方图**（`distribution`）：仅统计 `currency === dominantCurrency` 的有定价 Book（其余币种不入图，`multiCurrency` 标记由 UI 脚注说明）；固定分桶 `<20`/`20–50`/`50–100`/`100–200`/`>200`（主导币种单位，range 串不带货币符号，币种由图表上下文标注；分桶阈值与 `durationDistribution` 同为纯函数内常量）。零定价（amount=0）书仍计 `count`，不特殊排除。

6. **借阅日历（`calendar`，bookology-benchmark §5.1 可借鉴点 P0）**
   - **语义边界**：Bookology 的日历是「读过/在读」的**阅读行为**日历；ReadGraph 只有借阅周期，本维度是「手上有书」的**借阅日历**——文案一律「借阅」口径（`profile.calendar.*`/`profile.summary.borrowDays`），禁止「阅读」措辞。
   - **单日格语义**：UTC 日 D（`[D 00:00, D+1 00:00)`）有在借周期，当且仅当存在非设备周期使 `[borrowedAt, returnedAt)` 与 D 相交（`borrowedAt < D+1 00:00` 且 `returnedAt` 为 null 或 `> D 00:00`）。借出日与归还日当天均计入（当天手上确实有书）；`returnedAt` 恰为某日 00:00:00.000 时该日不计（实现用 `dayNum(returnedAt - 1ms)` 退一天，跨年/跨月边界正确）。
   - **天区间实现**：`dayNum(t) = floor(t / 86_400_000)`；周期覆盖 `[dayNum(borrowedAt), end]` 全部整日，其中 `end = returnedAt != null ? dayNum(returnedAt - 1) : dayNum(calendarAnchor ?? borrowedAt)`。开区间（`status='borrowed'`）收敛到锚点日；锚为 null 时收敛到借出当日（单日口径）；锚早于借出日（数据异常）→ 天区间为空，不计入、不抛错。
   - **口径**：`days` 为 range 口径（仅 `borrowedAt ∈ range` 的周期计入，与 gantt/borrowVolume 一致，图表随工具条范围联动）；`borrowDays` 为全量口径（所有非设备周期天区间并集去重，与 range 无关——与概览行其余卡片全量口径一致，对照 money `collectionValue`/`borrowedValue` 的全量/range 双口径先例）。
   - **每日去重**：同一天多个周期来自同一 bookId 只计一次（`count` 为独立 Book 数）；`bookIds` 升序。跨日叠加（同日两本书）各自展开到所属天。
   - **呈现**：ECharts `heatmap` series（已选型，[design-decisions 图表选型](../design-decisions.md)），GitHub 贡献图式网格；年视图（x=周列，y=7 行星期）+ 月视图（x=7 列星期，y=月内周行）由 `src/profile/charts/calendar-grid.ts` 纯函数产格；格子以计数强度着色（`--chart-2` 松叶色 + alpha 阶），无数据日弱底格；tooltip 列当日题名（含 `Book.coverUrl` 封面缩略图，≤8 本 + 「另有 N 本」折叠）。封面无数据也成立（计数格恒有）。**无需新依赖**（heatmap 为 ECharts 内置图种）。
   - **UTC 桶归属**：日键取 UTC getter，`displayTimezone` 不影响桶归属；周起始日随 locale（zh 周一 / en 周日），仅影响行列排布，不影响日→桶映射。

## 3. ECharts 主题与薄适配层

`src/lib/echarts-theme.ts`（对照 [design-decisions](../design-decisions.md)「图表选型」薄适配约束）：

- 读 shadcn CSS 变量（`--background`/`--foreground`/`--muted-foreground`/`--chart-1..5` 等）组装 echarts theme 对象：palette 取 `--chart-1..5`（扩展按需循环）；坐标轴线/文字用 `--border`/`--muted-foreground`；tooltip 背景用 `--popover`/`--popover-foreground`。
- 不在模块顶层读 DOM 变量；提供 `buildTheme(isDark: boolean, cssVars: Record<string,string>): EChartsTheme`，由消费方在 `.dark` class 切换时重建并 `setOption` 重应用。
- 主题随暗色切换：`use-profile-stats` 监听根 `.dark`（沿用 [ui-navigation §4](ui-navigation.md#4-主题与暗色模式骨架) theme Provider 信号），变化时重建 theme 并更新各图实例；旧实例 `dispose` 防泄漏。
- 数据色（蓝宝石/青绿方向）**只在本页发力**，其余界面保持冷静灰（[design-decisions](../design-decisions.md) 阅读图谱方向 B）。
- import 策略：`echarts` 核按需引入 `echarts/core` + 注册的图种（`TreemapChart`/`BarChart`/`CustomChart`）+ `CanvasRenderer`，不走 `echarts` barrel；shadcn 组件按需 import（`bundle-barrel-imports`）。ECharts 初始化组件用 `lazy()`/动态 import 在 `/profile` 激活时加载（`bundle-dynamic-imports`、`bundle-conditional`）。
- **v6 实例化约束**（图表实例化落地时必须遵守，规避 v6 breaking）：
  - `option.legend.top`/`bottom` 显式声明锚定位置，不依赖 v6 默认（v6 legend 默认移到底部，与本页图谱块布局冲突）。
  - 若使用 `axisName`（轴标题），显式设 `grid.outerBoundsMode: 'none'`（或对应轴 `nameMoveOverlap: false`），避免 v6 默认开启的外溢/重叠规避导致轴位微移。

## 4. UI 设计说明
**布局**（单页全幅，方向 B 图谱语言）：
- 顶部一行概览统计卡片（藏书数 / 借阅周期数 / 在借数 / 平均借阅时长 / **借阅天数**），等宽数字 + 标签；卡片窄、克制，不抢图谱视觉。借阅天数取 `calendar.borrowDays`（全量口径，与其余概览卡一致；随 4 卡变 5 卡，栅格 `md:grid-cols-5`）。
- 概览行下方为**价值统计卡行**（同款窄卡片，独立一行）：馆藏总价值 / 借阅图书价值 / 平均书价。金额用 `Intl.NumberFormat` 货币格式（等宽数字，符号随 locale）；馆藏总价值与平均书价不受时间范围影响，**借阅图书价值随 range 切换联动**（卡片标签标注当前 range，如「近 1 年」）；多币种时头条取 `dominantCurrency`，`multiCurrency=true` 时该卡下方加脚注（`其他币种：USD $… / JPY …`，一行灰字）。
- **AI 解读区**（Phase 1，AI 启用后渲染）：价值统计卡行之下、图表 Tabs 之上，呈现画像分析结果——fact 洞察窄卡（标题+正文+维度 chip，点击激活对应图表 tab = 引用定位）+ taste 审美点评段（全宽）；形态/口径/预览/缓存契约见 [AI 功能规格](ai-features.md) §4.1；AI 未启用时本区不渲染（无 AI 痕迹）。
- 卡片下方为图表区，**Tabs 切换**（shadcn `Tabs`，横向标签：分类法分布 / 借阅甘特带 / 借阅量 / 借阅时长分布 / 价格分布 / **借阅日历**，标签键 `profile.chart.*.title`，新增 `profile.calendar.*` 与 `profile.summary.borrowDays` 键时按 [i18n-conventions](../i18n-conventions.md) 两语同时补齐）：
  - 每次仅激活一个图谱块，独占全幅宽度与视口高度，互不挤压（书多时甘特 lane 不再被压扁）；
  - 分类法 treemap（视口 ≥ 480px）→ 借阅甘特带（高度按 lane 数自适应：lane 可视高 24px，视口 `[280, 624]px`；lane 数超过可视上限（26，= 624/24）时启用 y 轴缩放（右侧 slider，默认窗口显示最新 26 lane），lane 保持可读高度不压扁）→ 借阅量柱图（≥ 360px）→ 借阅时长分布（≥ 360px）→ 价格分布（≥ 360px，BarChart，仅主导币种分桶，见 §2.5）→ 借阅日历（年视图 ~280px / 月视图 ~380px，heatmap 网格）。
  - **借阅日历 tab 内部**：内容区顶部一行薄工具条（不抢图）：左「借阅天数」口径显示（当前可见月/年 `days` 内的去重天数，如「2026 年 · 借阅 45 天」）+ 视图切换 `SegmentedControl`（年视图 / 月视图，默认月视图，键 `profile.calendar.view.*`）+ 上一/下一导航按钮（`‹`/`›`，aria-label 随视图：上一年/下一年/上一月/下一月）；默认锚定 `maxDate` 所在月/年，导航不越界钳制（无数据期间渲染全弱底网格，不空态）。
  - **热力图**：年视图 x 轴 = 周列（含月名标签，仅月初列标 `Intl` 月名）、y 轴 = 7 行星期短名（`Intl`，UTC）；月视图 x 轴 = 星期短名，y 轴无标签（月内周行）。格色 = `--chart-2` 松叶色按 count 分 alpha 阶（1–4+ 步进），count=0 弱底格（border 色低 alpha）；tooltip 为日期 + 在借本数 + 题名列表（封面缩略图 ≤8 本 + 「另有 N 本」），HTML 转义书名/URL（防注入）。容器 `role="img"` + aria-label（A-1）。
- 图表是主角、全幅；无外层装饰卡片包裹图谱块（[ui-navigation §3](ui-navigation.md#3-各功能页布局与空状态) 禁卡片套卡片）；TabsList 即区块标题，内容区不重复标题。

**交互**：
- 顶部工具条：分类体系切换（`SegmentedControl`：CLC/DDC/LCC/UDC，仅列数据中实际出现的体系）、时间范围（`Select`：全部 / 近 1 年 / 近 3 年 / 自定义区间）、displayTimezone 跟随设置（不在本页改，只显示当前值）。**时间范围切换联动价值卡行**：`borrowedValue`（借阅图书价值）随 range 重算并在卡片标签标注当前 range；馆藏总价值/平均书价/价格分布为全量，不随 range 变。
- 切换交互走 `useTransition` 标注非紧迫更新，期间当前 tab 内容区显示 `Skeleton`（tab 栏保持稳定，不闪断；不阻断概览卡片与导航，`rerender-transitions`/`rendering-usetransition-loading`）。
- 图表区 Tabs：切换 tab 时非激活图谱块卸载（echarts 实例随卸载 `dispose`，仅激活块占用 DOM/定时器；甘特 `nowTick` 定时器仅在激活时运行）；切回时按当前 option 重新 init，容器尺寸变化由 `useECharts` 的 ResizeObserver 自适应 `resize`。
- treemap 块下钻（点一级类目展开子类）为可选增强；本里程碑要求一级呈现可交互高亮与 tooltip，子类下钻标 TODO。
- 无破坏性操作：本页只读，不做任何写库或重置入口。

**状态**：
- 空态：无任何 Book/BorrowCycle 时，整页用 shadcn `Empty` + 导入入口（按钮跳 `/import`），图表区隐去占位（`rendering-conditional-render` 用三元，非 `&&`）。
- 部分（仅有书无周期 / 仅有周期无书）相应图表块各自 `Empty` 变体，不整页空白。
- 有书但全库无任何定价：价值卡行金额显示 `—`（不出现裸 `0` 误导）；价格分布 tab 呈现 `Empty` 变体；不提供补全引导（补价与否由用户自由抉择，既有编辑/OPAC 补全入口位于书库与详情页）。
- 多币种（`multiCurrency`）：价值卡脚注列出非主导币种合计（`其他币种：USD $… / JPY …`），价格分布 tab 图内仅主导币种，脚注同样说明。
- 加载态：`useLiveQuery` 未就绪时 `Skeleton`；大数据 Worker 计算时 `Progress`。
- 错误态：聚合抛错（数据异常的周期）被边界捕获，对应图谱块降级为 `Empty` + 错误文案（不崩溃整页）。

**响应式**：移动端 TabsList 允许横向滚动（`overflow-x-auto`）而非换行挤压标签；图表最小高度不塌缩；甘特带在窄屏启用横向滚动（`overflow-x-auto`）而非压缩 lane。所有可见文本经 `react-i18next` `t()`，namespace `pages`（`profile.*`），禁止硬编码中英文字面量（[i18n-conventions](../i18n-conventions.md)）。

## 5. 数据契约与边界

- **纯前端/只读**：所有数据来自 IndexedDB（Dexie + `useLiveQuery`），无网络、无后端、无数据上传（[app-spec §1](../app-spec.md)/[ui-navigation §6](ui-navigation.md#6-数据契约与边界)）。聚合为纯函数，结果不落库、不缓存到 localStorage。**AI 功能例外**（默认关闭、显式启用）：仅向用户配置端点发送脱敏最小字段（本页 `computeProfileStats` 输出 + Top 书目题名/作者，发送前预览可见）——契约见 [AI 功能规格](ai-features.md)。
- **UTC 与 displayTimezone**：桶归属基于 UTC getter（`getUTCFullYear`/`getUTCMonth`），`displayTimezone` 仅用于轴标签（柱图 x 轴月份按 `Intl.DateTimeFormat` 用该时区呈现）。甘特区间的「在借」端点视觉锚由组件层以 `useDeferredValue` 的 now 补齐，**不改聚合产物**，保证可复现（对照 [import-pipeline §3](import-pipeline.md#3-纯函数-pipeline-契约) 确定性）。
- **空数据**：`computeProfileStats` 对空入参返回结构完整但全零的 `ProfileStatsResult`（`classification=[]`/`gantt=[]`/...，`summary.*` 为 0 或 `null`，`money.*` 为空数组/`null`/0），UI 映射为整页 `Empty`；聚合函数不抛空异常。
- **价值统计确定性**：`money` 仅由 `Book.price` 与 `BorrowCycle.borrowedAt` 派生，无时钟、无汇率、无外部输入；`distribution` 分桶阈值（`<20`/`20–50`/…）为模块常量。`Intl.NumberFormat` 只出现在渲染层，聚合层不格式化、只产数值（元，两位小数语义）——保证 Worker 与同步 `useMemo` 两路径产物深等价。
- **大文件退化**（阈值对齐 [ui-navigation §6](ui-navigation.md#6-数据契约与边界) ≥50MB 导入约束的下游表现）：
  - `BorrowCycle` 数量 ≥ `GANTT_THRESHOLD`（候选 2000 条 lane / 5000 区间）时甘特带启用**视口下采样**：按当前甘特 x 域采样区间，域外折叠为「疏密指示条」；不一次性渲染全部矩形（canvas 压力）。
  - 聚合耗时阈值（候选 > 50ms）触发 Worker：`use-profile-stats` 小数据同步 `useMemo` 计算，大数据走 `stats-worker.ts`（Comlink，对照 [design-decisions](../design-decisions.md) 并发与性能）。
  - treemap/柱图数据量为聚合后桶数（远小于原始记录），不单独退化；价值统计为 O(Book) 单遍扫描（币种 → 整数分累计的 `Map`），数据量远小于原始记录，不单独退化；分类体系切换与时间范围变化用 `useDeferredValue` 延迟重算，输入与导航保持响应（`rerender-use-deferred-value`）。
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
8. 作为用户，书多（lane 数超过可视上限 26）→ 甘特 tab 高度自适应封顶 624px 并启用 y 轴缩放，lane 高度保持可读，不被压扁；切 tab 后各图表全幅呈现，互不挤压。
9. 作为用户，经 OPAC 补全/编辑表单给书补上定价后进入 `/profile` → 价值卡行显示馆藏总价值、借阅图书价值、平均书价（`Intl` 货币格式，符号随 locale）；借阅价值 = 独立 Book 价格合计，同书多次借阅只计一次。
10. 作为用户，切换时间范围「近 1 年 / 近 3 年 / 自定义」→ 借阅图书价值卡随 range 联动（仅计区间内 `borrowedAt` 的书），馆藏总价值 / 平均书价 / 价格分布不变。
11. 作为用户，藏书含外币计价书（如 USD/JPY）→ 头条显示主导币种合计，卡脚注列出其余币种金额，价格分布图仅主导币种且有脚注说明；不做任何隐式汇率换算。
12. 作为用户，有书但全库无定价 → 价值卡金额显示 `—`，价格分布 tab 空态，整页不报错；不出现补全引导（补价与否自由抉择）。
13. 作为用户，藏书中含设备书（电子书阅读器）与占位书 → 设备书不计入价值；占位书（无定价）不计值，无异常。
14. 作为用户，导入数据后进入 `/profile` → 概览行第 5 卡「借阅天数」= 全量有在借周期的去重 UTC 天数（设备书不计）；切「近 1 年」后该卡不变（全量口径），借阅日历 tab 图内天格随 range 裁剪。
15. 作为用户，打开借阅日历 tab → 默认月视图锚定最新有数据月份；当天格按在借 Book 数着色，无数据日弱底格；切「年视图」显示全年网格与月初月名标签；切中英 → 星期名、月名、tooltip 随 locale，周起始日切换（zh 周一 / en 周日）；上一/下一导航切换月/年，空期间全弱底网格不报错。
16. 作为用户，同日借多本书（含同书重复借阅周期叠加）→ 该日格计数 = 独立 Book 数（不按周期数）；hover 该格 tooltip 列当日书名与封面缩略图（>8 本折叠「另有 N 本」），书名含 `<`/`&` 等字符正常显示不注入。
17. 作为用户，存在 `status='borrowed'` 在借周期 → 其天格延续至今天（会话内锚点）；`returnedAt` 恰为某日 00:00（UTC）的周期不计归还当日；异常（锚早于借出日）周期不产生天格、页面不崩。

## 7. 测试清单

**Vitest（单元/集成，`src/lib/profile-stats.test.ts` 等）**
- `computeProfileStats` 空入参返回全零结构，不抛异常。
- 分类体系缺省度量：多 Source 不同体系时取多数票；全空回退 `'clc'`。
- CLC/DDC 一级归并正确（取首字母/首位 + 类名映射）；无分类号归入 `__unclassified__`。
- Book 计一次：多 CatalogRecord 同 ISBN 不同分类号时 treemap 按首选体系条目计一次，不翻倍。
- 时间桶：月/年粒度切换阈值（≤ 2 年月、> 2 年年）正确；`range` 左闭右开裁剪生效；桶归属与 displayTimezone 无关（同输入不同 tz 桶相同）。
- duration：`status='returned'` 计入，`borrowed/unknown` 不计；分桶边界（7/14/30/60 天）正确；空样本 `avg/median` 为 `null`。
- money 合计：单币种 `collectionValue`/`avgPrice` 正确（整数分累计：`9.99 + 0.01 = 10.00` 无浮点误差）；多币种按币种分组互不串；`dominantCurrency` 取有定价 Book 数最多者、`multiCurrency` 判定（1 币种 false / 2+ 币种 true）。
- money 借阅价值：独立 Book 去重（同书 2 次借阅只计 1 次）；`range` 左闭右开裁剪（`borrowedAt` 恰为 `from` 计入、恰为 `to` 不计）；`range=null` 计全部有借阅的独立书。
- money 排除：设备书不计值；占位书（无定价）不计值；零定价书（`amount=0`）计 `count`（入合计与分布）。
- money 分布：`distribution` 仅主导币种（其余币种不入图）；分桶边界（20/50/100/200）与桶标签串格式正确；无定价 → `dominantCurrency=null`、`distribution=[]`、`collectionValue=[]`、`avgPrice=[]`、`multiCurrency=false`。
- 纯函数性：`money` 同输入两次调用深等价（含整数分累计路径）；聚合层不产生 `Intl` 格式化（代码审计）。
- 甘特：lane=`bookId+barcode`；无 barcode 退化；区间升序；`borrowed` 返回 `end=null`；套装书 lane 携带 `volume`（catalogRecordId 直查 / barcode 兜底 / 解析不到为 null），非套装恒 `null`。
- 纯函数性：同输入两次调用深等价；无 `Date.now()`（代码审计/依赖检查）。
- calendar 空态：空入参 `calendar.days=[]`、`borrowDays=0`、`minDate/maxDate=null`、`bookIndex={}`。
- calendar 天区间：借出日与归还日均计入（相交语义）；`returnedAt` 恰为 UTC 日 00:00 → 该日不计；跨月/跨年（含闰年、`-1ms` 跨 1 月 1 日）边界正确。
- calendar 开区间：`status='borrowed'` 天格收敛到 `calendarAnchor`；锚为 null → 仅借出当日；锚早于借出日 → 零天格不抛错。
- calendar 去重：同日同书多周期计 1；`bookIds` 升序；同日多书 count=独立 Book 数；跨日叠加各自展开。
- calendar 口径：`borrowDays` 全量（与 range 无关、含 range 外周期）；`days` 随 range 裁剪（`borrowedAt ∈ range` 左闭右开）；`minDate/maxDate` 取自 `days`。
- calendar 排除：设备书周期不产生天格、不入 `borrowDays`；UTC 桶归属与 displayTimezone 无关；纯函数性（同输入含锚两次调用深等价、不读 `Date.now()`）。
- calendar-grid 纯函数：年/月视图产格行列正确（周起始随 locale、月初列标签、月内周行）；格色 alpha 阶（0/1/2/3/4+）；`bookIndex` 缺失 bookId 不抛错；tooltip HTML 转义书名与 URL。

**Playwright（E2E）**
- `/profile` 空态：显示 `Empty` + 导入入口按钮，点击跳 `/import`。
- 脱敏数据下逐 tab 激活后 ECharts canvas 非空像素（treemap/柱图/甘特/价格分布/借阅日历分别校验；每次仅激活一个图谱块 canvas——借阅日历例外：HeatmapView 内建分层渲染固定 2 个 canvas（主层 + HeatmapLayer），断言按 2 计）；借阅日历 tab 内切「年视图」后 canvas 重绘且月名标签随 locale。
- 脱敏数据（含定价字段）下价值卡行：馆藏总价值/借阅图书价值/平均书价按 `Intl` 货币格式呈现；切 locale 后货币符号与标签切换；切「近 1 年」后借阅图书价值变化而馆藏总价值不变。
- 分类体系 `SegmentedControl` 切换后 canvas 重绘、类目 tooltip 文本随 locale 切换。
- 暗色切换 → 图表配色变化（canvas 像素采样差异），reload 仍为暗色。
- 大库夹具下甘特 tab：高度自适应封顶（`[280, 624]px`）并启用 y 轴缩放，滚动流畅，不一次性渲染超量矩形（性能基线，可选）。

## 8. React 性能规则引用

- `bundle-barrel-imports`：`echarts` 按 `echarts/core` + 按图种引入，shadcn 组件按需 import，避免 barrel 拉宽依赖。
- `bundle-dynamic-imports` / `bundle-conditional`：ECharts 初始化与各图组件在 `/profile` 激活时动态加载。
- `bundle-preload`：侧栏悬停 `/profile` 时预加载图表 chunk（可选增强）。
- `rerender-lazy-state-init` / `rerender-derived-state-no-effect`：dataset 在 render 期由 `useMemo` 从 `useLiveQuery` 实体派生，不写 effect 同步 state。
- `rerender-memo`：各图组件 `memo` 化，仅以自身 dataset 为依赖；概览卡片与价值卡行独立 memo，不被图表重算波及。
- `rerender-transitions` / `rendering-usetransition-loading`：分类体系/时间范围切换用 `useTransition`，图表区配合 `Skeleton`；价值卡行随 range 联动重算走同一 transition，不单独闪断。
- `rerender-use-deferred-value`：大数据/范围变化用 `useDeferredValue` 延迟聚合重算，保输入响应。
- `js-combine-iterations` / `js-index-maps` / `js-set-map-lookups`：聚合单遍建 `Map`（catalog→classification、bookId→book、currency→minor-unit sum/count），避免重复线性查找；价值统计与既有维度共用同一次实体遍历（`js-combine-iterations`），不二次循环。
- `js-min-max-loop`：duration 分桶用一遍扫描，`avg`/`median` 用单遍求和与选择，不 `sort`。
- Intl 实例复用：`Intl.NumberFormat` 按 `locale + currency` 缓存复用（模块级 `Map` 或 `useMemo`），避免每次渲染新建格式化器（构建成本高）；聚合层不触 Intl。
- `client-localstorage-schema`：本页只读 `readgraph:preferences`（displayTimezone），不写入；读侧仍受 [ui-navigation §4](ui-navigation.md#4-主题与暗色模式骨架) 的 Zod 校验保护。
- `rendering-conditional-render`：空态/部分空态图表块用三元表达式，不用 `&&` 渲染；无定价时价值卡金额用 `—` 占位、价格分布 tab 空态走条件渲染。
