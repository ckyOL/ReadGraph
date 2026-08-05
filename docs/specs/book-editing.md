# 书目统一编辑规格（/library/$bookId 编辑 + 书库列表标记/过滤）

> 状态：**已落地**（2026-08-04，SDD → Tests(Red) → Code → Tests(Green)）。改造现有 /review 页编辑能力：**删除 /review 页面**，编辑入口迁至书目详情页
> /library/$bookId，覆盖 Book 与 CatalogRecord 全字段；选书帮补全、套装结构化并入同一编辑表单；
> 书库列表承载「待完善」标记（占位/套装徽标）与类型过滤。
> 关联：design-decisions §4、ui-navigation §2/§3、data-layer §4/§5、book.md、catalog-record.md、i18n-conventions。待审类型语义见 §10（并入自原 review.md）。

## 1. 背景与动机

### 1.1 现状痛点

| 痛点 | 现状 |
|------|------|
| 编辑字段少 | 全部编辑能力集中在 /review 两个 Sheet：选书帮补全仅 书名/作者/ISBN 三字段；套装表单仅 题名 + 编目 volume。Book 其余字段（subtitle、publisher、publishDate、edition、pages、price、subjects、tags、description、coverUrl、parallelTitles、translators、isbn10）与编目字段（barcodes、classifications）均无编辑入口 |
| 写错没得修正 | 保存即 `needsReview=false`，退出待审列表后系统内再无任何编辑入口；导入错误（题名错字、ISBN 错位、条码串号）只能清库重导 |
| 两类审核与普通编辑割裂 | 占位补全/套装结构化的表单逻辑与「普通书目」无编辑能力并存，能力分层不统一；独立待审页承载两套 Sheet，维护面与交互面重复 |

### 1.2 目标

1. **详情页常驻编辑入口**：/library/$bookId 头部「编辑」按钮，打开统一编辑表单，可修改 Book 全字段与每个 CatalogRecord 的 volume/barcodes/classifications；随时可再进再改（写错即修）。
2. **三类编辑合流**：普通书目、选书帮占位、套装候选共用同一表单；待审类型差异仅体现在「初始预填、类型徽标提示、卷号解析辅助」上。
3. **删除 /review 页面**：待完善数据的发现与过滤全部由书库列表承担——行内徽标（占位/套装）+ 顶部类型筛选（全部/待完善/占位/套装）+ Sidebar 书库入口计数徽标；不再维护独立待审页与两个审核 Sheet。
4. **跨实体操作保留**：合并到已有书目、拆为独立 Book 是跨 Book 破坏性操作，不进普通表单，收口到详情页「更多」菜单（AlertDialog 二次确认，沿用既有语义）。

### 1.3 非目标

- 不做 Book/CatalogRecord 删除（系统重置是唯一清空手段，见 data-layer §6）。
- 不做自动合并建议：编辑 ISBN 撞唯一索引时仅报错阻断，不自动发起合并流程。
- 不做编辑历史/审计（纯前端本地应用，`updatedAt` 即变更记录）。
- 不改数据模型：无新字段、无 db 版本升级（`CatalogRecord.volume` 已落地）。

## 2. 统一编辑模型

### 2.1 数据层不变，动作层合流

实体与索引零变更。**删除 `src/routes/review/` 整个路由目录**（页面组件、两个 Sheet、`-review-actions.ts`、相关测试、`src/routes/review.tsx` 路由文件；`routeTree.gen.ts` 由 router 插件重新生成，禁止手改）。

新动作库 `src/routes/library/-edit-actions.ts`（沿用 review 动作库的「事务 + Zod 校验」模式）：

- `updateBookWithRecords(db, bookId, draft)` —— 新核心动作，取代 `completePlaceholder` / `saveSetBook`：单事务写 Book 全字段 + 各编目 volume/barcodes/classifications，成功即 `needsReview=false`、`updatedAt=now`。
- **扩展点**：OPAC 补全（[opac-enrichment §7.2](opac-enrichment.md#72-应用阶段编辑表单)）以本表单为应用入口——抓取结果预填编辑输入框、用户审视保存；届时 `updateBookWithRecords` 扩展可选 enrichment 载荷（同事务写 `opacEnrichment`），普通编辑行为不变。
- `markReviewed(db, bookId)` —— 仅解除 `needsReview`（承接「不是套装」语义：不改任何数据、仅确认）。
- `mergePlaceholderInto` / `splitSetBook` / `searchMergeTargets` —— 从 review 动作库原样迁移（占位合并、拆书、合并搜索）。

写路径纪律不变（对齐 review 规格既有模式与 data-layer §2/§4）：读写全走 Dexie 事务，写前对实体过 Zod `safeParse`，失败整体回滚。

`src/lib/review.ts` 收缩：仅保留被书库/详情/编辑表单消费的派生纯函数 `reviewKindOf` / `isSetBook` / `catalogTitleByRecord`，**删除**仅服务于列表页的 `buildReviewRows` / `filterReviewRows` / `ReviewRow`；文件更名 `src/lib/book-status.ts`（无页面后不再叫 review），测试同步迁移。

### 2.2 needsReview 语义

**「保存编辑」即人工确认**：`updateBookWithRecords` 成功后 `needsReview=false`。理由：

- 与既有行为一致（补全/保存都解除标记）；
- 统一表单下「保存」天然表达「我确认过这份书目」，无需再设「保持待审」开关（过度设计）；
- 只想确认不想改数据 → 详情页「标记为已确认」快速动作（`markReviewed`），覆盖原「不是套装」场景。

### 2.3 人工值与重建幂等

编辑写入派生数据，清库重导后人工值不可重建（与既有取舍一致，不新增约束）。
导入管线字段合并优先级须保证「用户手动编辑最优先」（book.md 字段优先级表已约定；实现时核对 import-pipeline 合并分支对已存在字段不覆盖人工值，必要时补测试）。

## 3. 编辑表单 UI 规格（详情页 Dialog）

> 气质：方向 A 编目终端；文案全走 `t()`（命名空间 `edit`，键表随实现补齐）。

### 3.1 形态与布局

- 详情页头部动作区新增「编辑」Button（primary）→ 打开**宽屏 Dialog**（`max-w-5xl`，移动端 Drawer 全屏）。不用独立路由：字段虽多但分区滚动可承载，且保留详情页上下文（不打断浏览借阅时间线）。
- 标题「编辑书目」（待审书追加类型徽标：占位 = `destructive`「占位」，套装候选 = outline「套装」，派生判定见 §10.2）。
- 布局：左主列 = 书目字段（§3.2）；下方 = 编目卡片（§3.3）；底部操作条 = 校验提示 + 「保存」（primary，瑠璃紺）/「取消」（outline）。保存失败内联提示，不引入 toast 依赖。

### 3.2 书目（Book）字段

| 字段 | 控件 | 校验/处理 |
|------|------|-----------|
| 题名 * | Input | 必填；空则内联错误并禁用保存 |
| 副题名 | Input | 可空 |
| 并列题名 | Input（分隔串） | 顿号/逗号分隔，保存时按现有 `splitPersons` 同款拆分逻辑入 `parallelTitles[]` |
| 作者 | Input（分隔串） | 可空；`splitPersons` 拆 `authors[]` |
| 译者 | Input（分隔串） | 可空；拆 `translators[]` |
| 出版社 | Input | 可空 |
| 出版日期 | Input | 正则校验 `YYYY` / `YYYY-MM` / `YYYY-MM-DD`；非法内联错误 |
| 版次 | Input | 可空（如「第2版」） |
| 页数 | Input（number） | 正整数；非法内联错误 |
| 定价 | 金额 Input + 货币 Input | `Price { amount, currency }`；两者同空或同填，半空视为非法 |
| ISBN-13 | Input（等宽） | 保存前 `normalizeIsbn` 归一化；非 13 位数字内联错误（对齐 data-layer §2 硬校验）；**唯一冲突预检**见 §4.2 |
| ISBN-10 | Input（等宽） | 可空；`normalizeIsbn` 归一化，末位允许 X |
| 主题 subjects | Input（分隔串） | 顿号分隔拆 `subjects[]`。book.md 原语义「受控词表不可编辑」——本期开放编辑以修正编目错误，UI 加辅助文案「来自编目，可修正」 |
| 标签 tags | Input（分隔串） | 顿号分隔拆 `tags[]` |
| 简介 | Textarea | 可空 |
| 封面 URL | Input | 可空；非空时 URL 格式校验 |

预填：全部来自当前 Book 实体；数组字段以分隔串回显。

### 3.3 编目（CatalogRecord）字段

每个 CatalogRecord 一张 Card（来源徽标 + 题名原文头）：

| 字段 | 控件 | 处理 |
|------|------|------|
| 馆藏号 metaId | Input（等宽） | 预填 `String(cr.metaId)`（null 时空白）；空白清空为 null。保存时按 `String(metaId).trim()` 同步派生 `metaIdKey`（归一化键，供 `[sourceId+metaIdKey]` 索引与去重）。仅修正展示与身份标识，不触发重新去重（去重定型于导入期） |
| 卷号 volume | Input + 「从题名解析」辅助按钮 | 预填 `parseVolumeFromTitle(catalogTitleByRecord(...))`（套装书）；辅助按钮一键填入解析结果（普通书亦可手动填卷号，为后续转套装留口） |
| 条码 barcodes | 多行 Input（每行一条）+ 增/删行 | 空白行剔除；数组写回。改条码仅修正展示值，不触发重新去重（去重定型于导入期） |
| 分类 classifications | 行编辑：system 下拉（clc/ddc/lcc/udc/other）+ code Input + 增/删行 | `category` 由系统按 code 自动映射（复用现有分类映射），不手填；无法映射留空 |

### 3.4 保存流程

1. 前端校验（§3.2/§3.3 内联规则）+ ISBN 唯一冲突预检（§4.2）全过才启用「保存」。
2. `updateBookWithRecords` 单事务：`books` + `catalogRecords` 两表，逐实体 Zod `safeParse`，任一失败整体回滚，Dialog 内联报错。
3. 成功：`needsReview=false`、`updatedAt` 刷新；Dialog 关闭；`useLiveQuery` 自动刷新详情页与书库列表。

## 4. 详情页入口与操作

### 4.1 路由与自动打开

- `/library/$bookId` 路由新增 search 参数：`edit: z.boolean().optional().default(false)`（TanStack Router search 校验，对齐 $bookId 的 loader 入参校验风格）。
- `edit=true` 进入页面时自动打开编辑 Dialog；关闭 Dialog 时 `navigate({ search: { edit: false } })` 回写，保证刷新/回退后状态一致。
- 编辑按钮点击 → `navigate({ search: { edit: true } })`（同一 URL 状态驱动，不用组件内 useState 独享）。

### 4.2 ISBN 唯一冲突预检

`updateBookWithRecords` 前置检查：`db.books.where('isbn13').equals(normalized)` 命中且 `id !== 当前 bookId` → 内联错误「该 ISBN 已属于另一书目（书名），如需归并请先合并」（`&isbn13` 唯一索引，data-layer §3）。本期仅阻断报错，不做自动合并建议（非目标）。

### 4.3 「更多」菜单（危险/跨实体操作）

详情页头部动作区「更多 ▾」（DropdownMenu），按书状态显示：

| 菜单项 | 显示条件 | 行为 |
|--------|----------|------|
| 标记为已确认 | `needsReview=true` | `markReviewed`：仅解除标记（承接原「不是套装」） |
| 合并到已有书目 | 占位书（`reviewKindOf === 'placeholder'`） | 沿用合并语义：搜索 Dialog（`searchMergeTargets`，排除自身）→ 选中 → AlertDialog 确认 → `mergePlaceholderInto`（编目与借阅重挂、占位 Book 删除） |
| 拆为独立 Book | 套装候选（`reviewKindOf === 'set'`） | 沿用拆书语义：AlertDialog 二次确认 → `splitSetBook`（按 metaIdKey 分组） |

删除操作本期不做（非目标）。

## 5. 书库列表承载待完善标记与过滤

书库列表（/library）在既有「搜索 + 来源筛选 + 排序」基础上扩展（复用现有 `LibraryRow` 与 `filtered` 派生管线）：

1. **类型徽标列**：每行状态徽标——占位书「占位」（`destructive`）、套装 Book「套装」（outline，`isSetBook` 判定）、普通书无徽标；徽标可点击直达该行详情页编辑（`search.edit=true`）。
2. **类型筛选 Select**：与来源筛选并列——`全部 / 待完善（needsReview=true）/ 占位 / 套装`；占位 = `needsReview && isbn13===null`，套装 = `needsReview && isbn13!==null`（派生判定，不落库）。
3. **Sidebar 计数徽标迁移**：原「待审」入口的 `needsReview` 计数徽标移至「书库」入口。
4. **待完善书直达编辑**：占位/套装徽标行操作「完善」→ 详情页自动打开编辑（同 §4.1 `search.edit=true`）；普通行行为不变（进详情页）。

**Sidebar 变更**：删除「待审」导航项；书库项带计数徽标。路由树删除 `review.tsx`。

## 6. 代码落点

```
src/
├─ routes/
│  ├─ __root.tsx                   # Sidebar：删「待审」项，书库项加 needsReview 计数徽标
│  ├─ review.tsx                   # 删除
│  ├─ review/                      # 整目录删除（页面、两个 Sheet、-review-actions.ts、测试）
│  ├─ library/
│  │  ├─ index.tsx                 # 类型筛选 Select + 状态徽标列 + 「完善」直达编辑
│  │  ├─ $bookId.tsx               # 头部动作区（编辑/更多菜单）、search.edit 驱动 Dialog
│  │  └─ -edit-dialog.tsx          # 统一编辑表单（新组件；Book 字段 + 编目卡片）
│  │  └─ -edit-actions.ts          # 统一动作库（updateBookWithRecords / markReviewed /
│  │                               #   mergePlaceholderInto / splitSetBook / searchMergeTargets）
├─ lib/
│  ├─ review.ts → book-status.ts   # 更名收缩：reviewKindOf / isSetBook / catalogTitleByRecord；
│  │                               #   删 buildReviewRows / filterReviewRows / ReviewRow
│  └─ volume.ts                    # 不变（parseVolumeFromTitle / stripVolumeSuffix）
├─ i18n/                           # 新增 edit 命名空间；「占位/套装」徽标键并入 pages
└─ routeTree.gen.ts                # 插件重新生成（删 review 路由），禁手改
```

不新增实体字段、不升 db 版本（§1.3）。

## 7. 实施清单与测试（SDD → Tests(Red) → Code → Green）

1. **动作库**：`-edit-actions.ts` 全量动作 + 单测：
   - `updateBookWithRecords`：合法全字段写回、`needsReview=false`、`updatedAt` 刷新、Zod 非法（空题名/坏 ISBN）回滚不落库、部分编目失败整体回滚、ISBN 冲突（他书占用）拒绝、改自身 ISBN 为同值通过。
   - `markReviewed`：仅解除标记、数据不动。
   - 迁移断言：`mergePlaceholderInto`/`splitSetBook`/`searchMergeTargets` 行为与既有测试等价（复用原用例，从 review 目录迁移）。
2. **编辑表单**：`-edit-dialog.tsx` SSR 渲染契约 + 交互（Vitest）：预填正确（数组字段分隔回显、编目卡馆藏号/卷号/条码/分类预填）、必填/ISBN/日期/页数/定价校验内联错误、冲突错误展示、保存成功回调。
3. **详情页**：`$bookId.tsx` search `edit` 驱动 Dialog 开合；「更多」菜单按状态显隐。
4. **书库列表**：类型筛选三分支（待完善/占位/套装）与「全部」等价性；徽标列渲染（占位 destructive / 套装 outline / 普通无）；「完善」跳转断言（URL 带 `edit=true`）；`lib/book-status.ts` 迁移后既有 `reviewKindOf`/`isSetBook`/`catalogTitleByRecord` 断言不回归。
5. **Sidebar**：无「待审」项；书库项计数徽标 = `needsReview` 书数。
6. **E2E（Playwright）**：详情页编辑流——改题名+作者 → 保存 → 详情页刷新显示新值、`needsReview` 徽标消失、书库计数减一；书库类型筛选「占位/套装」命中正确行；占位书「合并到已有书目」与套装「拆为独立 Book」在详情页菜单可完整走通（复用现有夹具）；/review 路由 404。
7. **文档同步**：design-decisions §4、ui-navigation §2/§3/§8、review.md 并入本节后删除（已执行）。

## 8. 风险与边界

- **重建幂等**：人工编辑值清库重导后丢失（既有取舍，§2.3）；volume 预填可重建，纯人工字段不可。
- **导入覆盖**：导入期字段合并必须尊重人工编辑值（book.md 优先级表）；落地时核对 import-pipeline 合并分支，若现行为「后导入覆盖」，需在管线侧补「已存在人工值不覆盖」规则并加测试——这是本改造唯一可能触及管线的点。
- **ISBN 冲突**：本期阻断报错；「改 ISBN 触发合并建议」留作未来增强。
- **条码/馆藏号/分类编辑**：仅修正展示与后续统计口径，不回溯重放 dedupe。
- **拆书/合并误操作**：均走 AlertDialog 二次确认；无撤销（与系统「不支持按单次导入撤销」一致）。
- **历史数据**：本改造无 schema 变更，存量数据零迁移。
- **书库列表性能**：类型筛选在内存 `filtered` 管线内完成（books/catalogRecords 全量已加载，书库既有模式），无新增查询；`isSetBook` 按编目数组派生，与既有套装 Badge 逻辑同源。

## 9. 存档：备选方案对比

| 方案 | 评价 | 结论 |
|------|------|------|
| 独立编辑路由 `/library/$bookId/edit` | 上下文割裂（借阅时间线不可见）、路由+导航状态双维护 | 弃：Dialog 分区滚动即可承载全字段，保详情上下文 |
| 保留 /review 列表页（行跳详情编辑） | 与书库列表信息重复（同一批书两处列表），导航项与徽标双份维护 | 弃：书库列表已有搜索/筛选/排序基建，类型筛选 + 徽标列直接承载 |
| Sheet 640px 内堆全字段 | 17+ 字段 + 编目卡片在 640px 内体验差 | 弃：宽屏 Dialog（max-w-5xl） |
| 表单内直接放「合并/拆书」 | 破坏性跨实体操作与普通保存并列易误触 | 弃：收口详情页「更多」菜单，二次确认 |
| 保存时可选「保持待审」 | 语义模糊、过度设计；「标记为已确认」独立动作已覆盖 | 弃：保存即解除 |

## 10. 待审类型语义（并入自原 review.md）

> 原 `docs/specs/review.md` 已删除；两类待审数据的语义定义（判定、卷号解析、人工操作与事务语义）并入本节，仍被
> dedupe、导入管线、编辑表单与书库徽标/筛选消费。

### 10.1 两类待完善数据

**选书帮占位**（福田图书馆「选书帮」）：记录共享占位书名「福田图书馆读者自选图书」、ISBN 为空、索书号共享，仅 barcode 可区分 → 解析时每 barcode 独立 Book、`needsReview=true`（dedupe 第 4 条）。用户需补全真实书目（书名/作者/ISBN）或合并到库中已有书。

**套装候选**（同 ISBN 多卷）：同一 ISBN 对应多卷/多作品是出版方违规但普遍的现象（如夹具 [szlib-202605.json](../../tests/fixtures/szlib-202605.json) 中「合成书目052 . 3 / 合成书目053 . 4」共用 ISBN 978-7-5740-1274-5，深图编目分开为 metaid 7109377/7109378）。导入时同 ISBN 合并为一 Book（现状保持），卷级信息无处安放 → 标记待审，由用户结构化（卷号入编目、题名规范化）。

外部依据（2026-08 检索）：[ISBN 用户手册 §6.5](https://www.isbn-international.org/sites/default/files/ISBN%20users%27%20Manual%202017-simplified%20chinese%20%28Chinese%20translation%20of%20seventh%20edition%29.pdf)（多卷出版物应分配整套 ISBN，套装共用 ISBN 是违规但普遍）；[台湾国家图书馆编目园地 Q&A（2025-09）](https://catweb.ncl.edu.tw/QandA/page/32331)（《纳尼亚传奇》3 册同一 ISBN，官方指导整套 1 条记录）；台大图书馆期刊论文（《大學圖書館》20-2）（ISBN 一对多是已知数据质量问题，需人工确认）；[r/Libraries：图书系列编目](https://www.reddit.com/r/Libraries/comments/1dfzskm/cataloging_book_series/)（每卷独立 MARC 记录是馆方主流）。

两类都是「导入期零决策 + 人工确认」：导入管线保持纯函数，不做自动拆分/合并判断（跨馆时题名/元数据不可靠）；用户在详情页编辑表单确认（保存即解除标记）。

### 10.2 数据模型与类型判定

- `CatalogRecord.volume: string | null`（原文卷号，如 `"3"`/`"上"`；非索引字段，无需 db 版本升级；同步 entities.ts / schemas.ts / 导出备份 schema）。
- `Book` 不新增字段；套装 = 同 Book 下 ≥2 个 `volume` 非空编目（查询派生）。
- `books` 表 `&isbn13` 唯一索引保持不变（同 ISBN 併入一本，唯一性仍成立）。
- 待审类型判定（派生不落库，`lib/book-status.ts`）：**选书帮占位** = `needsReview=true && isbn13===null`；**套装候选** = `needsReview=true && isbn13!==null`。补全/结构化完成后 `needsReview=false`，两类都退出待完善视图，故派生判定不歧义；若未来出现第三种待审类型再引入显式 `reviewKind` 字段。

### 10.3 卷号解析

`src/lib/volume.ts`：`parseVolumeFromTitle(title)` 纯函数（单测覆盖），只匹配题名**末尾**卷号段（由后往前）：

- `. N` / `(N)` / `〔N〕` / `【N】`：N 为阿拉伯或 CJK 数字；「N卷/册/集/部」同族。
- 汉字卷标：`上/中/下/前/后`、`上册/中册/下册`。
- 非尾部数字不提取（`1984` 不作卷号）；解析失败 → null（人工填写）。

配套 `stripVolumeSuffix(title)` 供编辑表单「公共题名建议」使用。

### 10.4 人工操作与事务语义

- **补全**（占位书）：写补全字段（书名必填、作者顿号分隔拆 `authors[]`、ISBN 归一化）+ `needsReview=false` → 统一动作 `updateBookWithRecords`。
- **合并到已有书目**：`searchMergeTargets`（`searchByTitle` + `findByIsbn13` 合并去重，排除占位书自身）→ `mergePlaceholderInto`：占位 Book 删除，CatalogRecord/BorrowCycle/rawRecords 重挂目标书（catalogRecordId 不变），目标书保持原状、`needsReview` 解除。
- **保存为套装**：写各编目 volume（null 清空）+ Book.title + `needsReview=false` → `updateBookWithRecords`。
- **确认非套装/标记已确认**：仅 `needsReview=false`，title/volume 不动 → `markReviewed`。
- **拆为独立 Book**：`splitSetBook` 按 `metaIdKey` 分组拆为多 Book，title 取各自编目题名原文、volume 保留、`needsReview=false`；CatalogRecord/BorrowCycle 重挂，rawRecords 按 metaid/条码重指；同 ISBN 无法进 `&isbn13` 唯一索引 → 拆分书 isbn13/isbn10 置 null（重导时由去重重新判定）。

### 10.5 风险与边界

- **重建幂等**：volume 与补全字段的人工修正值存派生数据，清库重导后丢失需重新完善（volume 预填可重建；补全书目为纯人工输入不可重建）——既有取舍。
- **统计口径**：套装 Book 按整套聚合；卷级统计需按 catalogRecordId 聚合（可选增强）。
- **跨馆**：广图卷3/卷4 併入同一 Book，卷号预填依赖题名解析，写法差异时人工修正。
- **误标记解除**：重编目等误标在「标记为已确认」解除，不阻塞。
- **历史数据**：旧版已入库的合并书无标记，不回溯；如需可提供一次性扫描脚本标出既有同 ISBN 多 metaid 合并书（可选）。

### 10.6 存档：方案 A（自动拆分）为何放弃

原草案：Book=卷，dedupe 按「同源异 metaid / 跨源异题名」自动拆分，`&isbn13` 放开唯一索引。弃因：**跨馆归属不可靠**（同 ISBN 多 Book 时他馆同卷题名归一化匹配不上，误拆/无法判定归属）；**破坏性 schema 变更**（放开 `&isbn13` 唯一索引）；**与零人工路线相悖**（题名信号不可靠，导入期不可控）。保留价值：`parseVolumeFromTitle` 对方案 A 同样有用；卷号一致可作为未来「自动转套装」的辅助信号。
