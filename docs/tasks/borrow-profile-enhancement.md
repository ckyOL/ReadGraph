# 借阅画像增强里程碑 — 任务分解（源自 Bookology 调研）

> 来源：Bookology（iOS 阅读追踪 App）调研结论——可借鉴点收敛为两项**纯派生画像视图**：借阅日历热力图、年度总结页。二者只消费已有 `BorrowCycle` 数据，不引入新数据需求、新 Object Store、新写路径。取舍标准：只借鉴服务于「把图书馆借阅数据变成图书馆不会提供的画像」的功能；凡以「前向持续录入」为前提的习惯养成机制（目标/streak、笔记层、格式分面）不在范围。
> 规格权威：[reading-profile](../specs/reading-profile.md)。本批次落地前须先补该规格对应章节（SDD 前置），再按 [ai-agent-workflow-rules](../ai-agent-workflow-rules.md) 进 Tests(Red) → Code → Tests(Green) → Refactor。
> 明确不做（调研已否决）：阅读目标/streak、笔记层、格式分面——均以「前向持续录入」为前提，与「给图书馆借阅数据补画像」的产品目的不符。

## 里程碑范围与边界

- **进入条件**：阶段 2 图表栈（`use-echarts.ts` / Tabs 布局 / 空态降级）已绿；`computeProfileStats` 纯函数契约稳定。
- **不在本批次**：新增 Object Store/索引、Repository 接口改动、Parser 改动、schema 变更；不引入任何新依赖（ECharts heatmap 由既有 `echarts@6.1.0` 按需注册，零依赖面增量）。
- **口径红线**：图书馆借阅数据无「阅读行为」信号——所有新统计的文案必须表达「在借」（borrowed）而非「阅读/读完」，禁止 streak/打卡式表述（i18n 两语同审）。

## 阶段 A：规格补齐（SDD 先行）

- [ ] **A-1** [reading-profile](../specs/reading-profile.md) 补 §2.6「借阅日历热力图」聚合契约：`activityCalendar: { date: string; count: number }[]`——某日处于任意 `[borrowedAt, returnedAt]` 区间即计入，`count` = 当日有效在借册数；桶归属基于 UTC 日（对齐 §2 时间聚合一律 UTC）；`status='borrowed'` 的开放区间以组件层 now 锚补齐视觉、不改聚合产物（对齐甘特带先例）。含空态/大库退化/测试清单章节同步。
- [ ] **A-2** reading-profile 补「年度总结」章节：路由形态（`/profile/$year` 或 `/profile` year 维度切换，二选一定案）、叙事性指标定义（本年首末借阅日期、最长在借周期、复借之最 Book、当年新增独立书目数）、与现有 Tabs 的关系（独立区块或独立页）。
- [ ] **A-3** app-spec §6 表格登记本批次条目（状态列标注「规格已补/待 TDD」）。

## 阶段 B：借阅日历热力图

- [ ] **B-1 测试先行（Vitest，Red）**：`src/lib/profile-stats.test.ts` 新增——区间覆盖计数正确（单周期跨月/跨年、多周期重叠日 count 叠加）；`returnedAt=null` 不参与聚合（组件层锚定）；range 裁剪生效；空入参返回 `[]`；同输入深等价；无 `Date.now()`。
- [ ] **B-2** `computeProfileStats` 增加 `activityCalendar` 维度：单遍扫描 BorrowCycle，逐日增量用差分数组（`borrowedAt` 日 +1 / `returnedAt` 次日 −1，UTC 日粒度），避免 O(周期×天数) 展开长在借区间（对照 `js-combine-iterations`）。
- [ ] **B-3** `src/profile/charts/BorrowCalendar.tsx`：ECharts heatmap（`echarts/core` 注册 `HeatmapChart`，随现有 `use-echarts.ts` 按需引入）；年视图 12 月 × 31 日网格或 GitHub 式周列热力图（实现期定案，规格 A-1 同步钉死）；色阶沿用 `--chart-*` palette 单色渐变（方向 B 图谱语言，数据色只在本页发力）；tooltip 显示日期 + 在借册数。
- [ ] **B-4** 接入 `/profile` 图表 Tabs（新增 tab「借阅日历」，键 `profile.chart.calendar.title`，zh-CN/en 同步）；非激活卸载释放实例（Tabs 既有约定）；空态 `Empty` 变体；≥ 大库阈值时随 Worker 路径自动覆盖（同一纯函数入口）。
- [ ] **B-5 E2E（Playwright，Red 先行）**：脱敏夹具下 calendar tab canvas 非空像素；空库整页 Empty 不出现孤立 tab；暗色切换配色变化。

## 阶段 C：年度总结页

- [ ] **C-1 测试先行（Vitest，Red）**：年度切片纯函数（落点独立 `src/lib/year-review.ts` + `.test.ts`，不扩展 `profile-stats.ts`——并行契约见「并行开发方案」节）——按 UTC 年切 BorrowCycle/Book；首末借阅、最长在借（含并列取首）、复借之最（同书多年份周期计数）、新增独立书目数各指标边界（空年返回 null/0 结构完整）。
- [ ] **C-2** 年度总结视图落地（形态依 A-2 定案）：概览数字卡（本年借阅周期数/独立书目数/在借天数合计）+ 叙事指标区 + 复用既有图表按年切片（treemap/柱图传 range 即得，不新建图表种类）。
- [ ] **C-3** Canvas 报告导出（design-decisions 未来扩展 #3 的首个落地场景）：纯前端渲染年度报告分享图（概览数字 + 分类分布缩略 + 年份标识），本地字体/无网络资源；下载文件名含年份。若实现期评估工作量超预期，可裁为本批次后续小批，但须在本文档记录决策，不得静默缩水。
- [ ] **C-4 i18n**：`profile.year.*` 键两语同步；年份/日期经 `Intl.DateTimeFormat`（displayTimezone 只影响呈现）。
- [ ] **C-5 E2E（Playwright，Red 先行）**：有数据年份渲染数字卡与叙事区；无数据年份空态；Canvas 导出触发下载（download 事件断言）。

## 并行开发方案

**结论：可并行**。阶段 A 内部 A-1/A-2 可并行撰写（同一规格文档不同章节）；B（热力图）与 C（年度总结）两条线在下列前置契约钉死后**零共享编辑面**，可双 worktree 并行开发，最后串行收口整合。

### 依赖图

```
A-1 ──→ B-1…B-5 ──┐
A-2 ──→ C-1…C-5 ──┼─→ Wave 2 整合验证（全量 test/build/e2e）→ 分线提交
A-3（依赖 A-1+A-2，串行收口）
```

### 并行前置契约（A 阶段必须一并钉死）

1. **C-1 落点 = 独立 `src/lib/year-review.ts`**：不得扩展 `profile-stats.ts` / `profile-stats.test.ts`（B 线专属）；年度切片从实体数组直取，不复用 `computeProfileStats` 输出。
2. **C-2 路由形态 = 独立 `/profile/$year`**：不改 `routes/profile.tsx`（B-4 的 Tabs 接入专属）；复用既有图表组件按年传 range，只 import 不修改。
3. **E2E 文件分离**：B-5 追加进既有 `e2e/profile.spec.ts`；C-5 新建 `e2e/year-review.spec.ts`。
4. **i18n 键前缀隔离**：B 用 `profile.chart.calendar.*`，C 用 `profile.year.*`；各线自行补 zh-CN/en 两份 bundle。

### 文件归属矩阵

| 文件 | B 线 | C 线 |
|------|------|------|
| `specs/reading-profile.md` | §2.6 日历契约（A-1） | 年度总结章节（A-2） |
| `src/lib/profile-stats.ts` + `.test.ts` | ✅ B-1/B-2 | ❌ |
| `src/lib/year-review.ts` + `.test.ts` | ❌ | ✅ C-1 |
| `src/profile/charts/BorrowCalendar.tsx` | ✅ B-3 | ❌ |
| `src/routes/profile.tsx`（Tabs 接入） | ✅ B-4 | ❌ |
| `src/routes/profile/$year.tsx` | ❌ | ✅ C-2 |
| `e2e/profile.spec.ts` / `e2e/year-review.spec.ts` | ✅ / ❌ | ❌ / ✅ |
| `locales/*/pages.json` | `calendar.*` 键 | `year.*` 键 |

### 执行波次

1. **Wave 0（可并行）**：A-1 ∥ A-2 → A-3 串行收口（登记两条目需两者就位）。
2. **Wave 1（双 worktree 并行）**：B 线 B-1→B-5、C 线 C-1→C-5 各自 Red→Green；dev server / Playwright webServer 端口按 [ai-agent-workflow-rules §4](../ai-agent-workflow-rules.md) 按 worktree 序数分配，禁止共用默认端口或依赖自动递增。
3. **Wave 2（串行收口）**：合并后跑全量 `pnpm verify` + `pnpm build` + `pnpm test` + 全部 E2E；再按下方提交粒度分线入库。

### 冲突处理

- 唯一必然同文件编辑点是 `locales/*/pages.json`（不同键前缀、不同区段，git 自动合并即可）。
- 任一线实现中发现需要动对方归属文件 → 先停，回本文档修订契约并同步另一线，不得静默越界。

## 验证与提交

- 每 task 收尾：`pnpm test` + `pnpm exec tsc --noEmit` + `pnpm build` 全绿；阶段收尾加 `pnpm test:e2e` 相关 spec。
- 无新依赖引入，无需重跑供应链门禁；若实现期确需新增（预期外），先停并走 [npm-supply-chain-security §3](../npm-supply-chain-security.md) 审查。
- 提交粒度（Conventional Commits）：`docs(spec): add borrow calendar & year review to reading-profile` → `feat(profile): activity calendar heatmap` → `feat(profile): year review view` → `feat(profile): year review canvas export`。
- UI 文案全走 `t()`（[i18n-conventions](../i18n-conventions.md)）；性能规则引用 [reading-profile §8](../specs/reading-profile.md#8-react-性能规则引用)（`bundle-barrel-imports`/`rendering-conditional-render`/`rerender-memo` 等）。

## 状态

- 2026-08-21 建档：源自 Bookology 调研（调研结论已并入本文件头部，独立调研文档不留存）。阶段 A 未启动；推进顺序 A → B → C。
- 2026-08-21 增补并行开发方案：A-1∥A-2 → B、C 双 worktree 并行（前置契约四条 + 文件归属矩阵钉死零共享编辑面）→ Wave 2 串行整合验证。
- 2026-08-21 阶段 A 完成（A-1/A-2/A-3）：§2.6 定案 GitHub 式周列热力图 + tab 内年份切换、开放区间不进聚合；§2.7 定案独立路由 `/profile/$year`（`profile.tsx → profile/index.tsx` 机械移动由协调者完成，URL 不变）；`use-echarts.ts` 注册清单归 B 线；`/profile` 页头年度总结入口挂接归 Wave 2 整合期。Wave 1 双 worktree 并行启动。
