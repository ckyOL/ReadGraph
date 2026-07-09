# UI 导航规格

> 本文件从 `docs/app-spec.md` §8 拆出，遵循 SDD + TDD。落地前先补本节，再进 Tests(Red) → Code → Tests(Green)。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 设计方向与气质

- **主壳（全站导航、书库、时间线、导入、设置）= 方向 A「编目终端」**：左侧窄导航 + 主区表格主导，密实、可排序可筛选，像图书馆 OPAC 检索台。
- **阅读画像页（/profile）= 方向 B「阅读图谱」**：图表是主角，全幅图谱语言，ECharts 数据色只在图谱发力。
- **视觉基线**（方向锚定，具体令牌由 `shadcn init` 落 CSS 变量）：
  - 色彩：中性墨黑/纸白奠定底色，**单一克制强调色**（深茶青方向，具体由 shadcn `--primary` 令牌定）；分类号芯片（`Badge`）用强调色或语义色。
  - 暗色模式：暖黑底 + 暖白文字，不取全黑冷黑单色调；见 §4。
  - 等宽呈现：`metaId`、`barcode`、分类号 `code`、ISBN 一律走等宽字（本地打包字体，见 [design-decisions](../design-decisions.md) 安全与隐私），像「编目卡」标签条。
  - 分类法芯片：CLC/DDC 分类号是一等视觉元素（本项目核心心智模型：物理副本 × 书目合并 × 多分类法）。
  - 禁单色主导：勿让界面读成单一色族（尤其避开米/沙、纯灰一统）。
- **取向护栏**：A 面密实、可扫读、界面克制工作向；C（阅读手帐）的「温度感」仅作为书目详情的卷卡式细节吸收，不进主架构。

## 2. 路由树

仅用 `@tanstack/react-router` + `@tanstack/router-plugin`（Vite 插件）。**禁用** `@tanstack/react-start` 等带服务端运行时（见 [app-spec §1.2](../app-spec.md)、[§5.2](../app-spec.md)）。

```
src/routes/
  __root.tsx              AppShell：Sidebar + Outlet + 主题/locale/DB Provider
  index.tsx               Dashboard 概览（/）
  library/
    index.tsx             书库列表（/library）
    $bookId.tsx           书目详情（/library/$bookId）
  timeline.tsx            借阅时间线脊柱（/timeline）
  import.tsx              导入向导（/import）：来源→预览→执行→报告
  profile.tsx             阅读画像（/profile）：图表主导（方向 B）
  settings.tsx            设置（/settings）：主题/locale/时区/系统重置
```

- 文件路由由 `@tanstack/router-plugin` codegen 出 `routeTree.gen.ts`；**禁止手动编辑生成文件**。
- 路由参数静态类型化（`$bookId` 为 `z.string()` 校验的 loader 入参）。
- 布局路由 `__root.tsx` 承载 AppShell 与全局 Provider；按 `bundle-barrel-imports` 规则避免 barrel，组件按需 import。

## 3. 各功能页布局与空状态

交互通用：表头可排序/筛选，行/详情走 `Sheet`/`Dialog`（移动端 `Drawer`），无破坏性无二次确认不变更。空态统一用 shadcn `Empty` 组件（见 SKILL `composition.md`），不写自定义空态标记。

1. **Dashboard（/）**：概览统计卡片（藏书数 / 借阅周期数 / 在借数 / 最近导入）+ 最近借阅列表 + 快速入口（导入 / 书库）。
   - 空态：`Empty` + 首次导入引导（按钮跳 `/import`）。
2. **书库（/library）**：`Table` 密实列表，列含书名、作者、ISBN13、来源徽标（`Badge`）、分类号芯片、借阅次数；可搜索/筛选/排序。
   - 书目详情（/library/$bookId）：卷卡式（方向 A），`Card` 容器展示书目元数据 + 该 Book 的各 `CatalogRecord`（来源、`metaId`、`barcodes`、`classifications`）+ `BorrowCycle` 时间线小图。
   - 空态：无 Book 时 `Empty` + 导入引导。
3. **时间线（/timeline）**：横向时间轴脊柱，按 `borrowedAt` 排列所有 `BorrowCycle`；借中（`status='borrowed'`）以不同强调态区分。可按来源/状态筛选。
   - 空态：无周期 `Empty`。
4. **导入（/import）**：多步向导（来源选择/创建 → 文件选择与编码检测 → 前 10 条预览与字段映射 → 执行 → 导入报告）。报告显示统计与 `ParseWarning` 列表。
   - 每步可回退；来源选择支持从预置模板（[source](../metadata/source.md) `SOURCE_TEMPLATES`）挑选。
   - 空态：无来源时引导从模板创建。
5. **阅读画像（/profile）**：方向 B，图表主导、全幅。ECharts（thin adapter，见 [reading-profile](reading-profile.md)）渲染：
   - 分类法分布 treemap（CLC/DDC，取 Source 配置的默认分类体系）。
   - 借阅甘特带（同条码多次借阅 / 同书多次借阅的周期叠放）。
   - 按月/按年借阅量柱图、借阅时长分布。
   - 空态：无数据 `Empty`，图表区隐去占位，给出导入入口。
6. **设置（/settings）**：[设置与系统重置规格](settings.md)。

## 4. 主题与暗色模式骨架

- shadcn CSS 变量 + Tailwind v4（`@theme inline`）；暗色用 class 策略（根 `<html class="dark">`），不取 `prefers-color-scheme` 唯一驱动，`auto` 模式监听系统并应用 class。
- 主题令牌用语义色（`bg-background`/`text-foreground`/`text-muted-foreground` 等），**禁手写 `dark:` 覆盖**（见 shadcn `styling.md`）。
- 偏好落 `localStorage` key `readgraph:preferences`，读写走 schema 校验（引用 `client-localstorage-schema` 规则，Zod 校验 `UserPreferences`，[data-layer §8 用户偏好](data-layer.md#8-用户偏好)）。
- ECharts 主题：thin adapter（`src/lib/echarts-theme.ts`）把 shadcn `--chart-1..5` 等变量映射为 echarts palette + 坐标轴/tooltip 样式，随 `.dark` 切换重建主题（[reading-profile §3](reading-profile.md#3-echarts-主题与薄适配层)）。

## 5. 国际化与本地化骨架

- **落地状态（2026-07-01）**: ✅ 骨架已落地 — `src/i18n/`、`src/lib/locale.ts`、`src/hooks/use-locale.ts` 在用；双语 bundle + 命名空间 `common`/`nav`/`pages`，`fallbackLng: 'zh-CN'`，`<html lang>` 随切换同步。规则权威见 [i18n-conventions](../i18n-conventions.md)；单元测试覆盖 §8 的 locale 校验项（`src/lib/locale.test.ts`、`src/i18n/i18n.test.ts`、`src/hooks/use-locale.test.tsx`）。theme Provider 仍待数据层里程碑。
- 范围：本期仅 `zh-CN` 与 `en`。`zh-TW` **不预留枚举**（见 [internal-schema](../metadata/internal-schema.md) `UserPreferences.locale` 收窄说明），日后加回需补翻译 bundle 并恢复枚举。
- 方案：`react-i18next`，命名空间按路由/功能拆分，浏览器语言检测 + 动态加载（按需 chunk）。
- l10n：数字/货币/排序用原生 `Intl`；日期用 `date-fns` + locale 包；时间显示见 §6 契约。
- `index.html` `lang` 随当前 locale 切换（默认 `zh-CN`），无网络字体/图标（本地资产，见 [design-decisions](../design-decisions.md) 安全与隐私）。

## 6. 数据契约与边界

- 全部数据在浏览器（Dexie 封装 IndexedDB，库名 `readgraph`），无网络、无后端、无数据上传（[app-spec §1](../app-spec.md) 纯前端约束）。
- UI 层经 Repository（Dexie + `dexie-react-hooks` 响应式）读实体；本规格不定义 Repository 接口细节（属 [数据层规格](data-layer.md)），仅约定 UI 侧契约：
  - 时间全部以 **UTC 存储**，UI 显示按 `UserPreferences.displayTimezone` 转；导入详情页可切回 `source.timezone` 比对（[design-decisions §2](../design-decisions.md) UTC 原则）。
  - 实体关系按 metadata：`Book ←(bookId)→ CatalogRecord →(N) BorrowCycle`；`Source` 为入口。分类统计优先取 `Source.classificationSystem` 默认体系。
  - 去重结果在导入阶段已落库；UI 不重算去重，只呈现（分类号芯片、来源徽标、条码等）。
  - 系统重置为「全有或全无」单事务清空（[internal-schema](../metadata/internal-schema.md) 系统重置），UI 不提供单次导入撤销。
- 边界：
  - 空库首次进入：Dashboard/书库/时间线/画像均 `Empty` + 导入入口。
  - 大文件（≥50MB，[import-workflow](../metadata/import-workflow.md) 通用约束）：预览限前 10 条，导入执行在 Web Worker（[design-decisions](../design-decisions.md) 并发与性能），UI 显示 `Progress`/`Spinner`，不阻塞导航。
  - 离线可用：所有静态资产本地打包，PWA 预留（v1 不强求）。

## 7. 用户故事

- 作为新用户，首次打开空库 → 在 Dashboard 看到引导，一键进入导入向导，从模板创建「深圳图书馆」来源并完成一次导入，看到 Books/周期 入库。
- 作为用户，在书库按分类号筛选、按借阅次数排序，点开某 Book 看 CatalogRecord 与借阅时间线。
- 作为用户，在时间线按来源筛选，查看当前在借（status='borrowed'）。
- 作为用户，在阅读画像看到分类法 treemap 与借阅甘特带，空数据时见导入入口。
- 作为用户，在设置切暗色、切中英，刷新后偏好保留。
- 作为用户，导出备份后清空系统，确认不可撤销，重置后库为空。

## 8. 测试清单

**Vitest（单元/集成）**
- AppShell 渲染与路由树懒加载（mock routeTree）。
- ✅ locale Provider：读写 `readgraph:preferences`，Zod 同义校验非法值降级（已落地，见 `src/lib/locale.test.ts`、`src/hooks/use-locale.test.tsx`、`src/i18n/i18n.test.ts`）。theme Provider 待数据层里程碑。
- 日期/时区纯函数：UTC ↔ `displayTimezone`、`source.timezone` 转换（对照 [design-decisions §2](../design-decisions.md)）。
- 分类号芯片渲染：CLC/DDC code 与 category 映射。
- Empty 状态在各页分支渲染正确。

**Playwright（E2E）**
- 侧栏导航：六页跳转、当前项高亮、移动端折叠展开。
- 暗色切换持久：切换后 reload 仍为暗色。
- locale 切换：中英文本切换且 `html[lang]` 更新。
- 空态 → 导入：空 Dashboard 点导入入口到 `/import`。
- 导入向导关键路径：模板建来源 → 选文件 → 预览 → 执行 → 报告 → 落库 → 书库可见（用脱敏夹具）。
- 阅读画像：ECharts canvas 非空像素（脱敏数据下）。
- 系统重置：导出后确认流程完成，重置后空库。

## 9. React 性能规则引用

- `client-localstorage-schema`：`readgraph:preferences` 读写做 Zod schema 校验，避免脏值。
- `bundle-barrel-imports`：shadcn 组件与路由按需 import，避免 barrel 拉宽依赖/体积。
- 大文件导入下放 Web Worker（[design-decisions](../design-decisions.md) 并发与性能），主线程不阻塞导航。
