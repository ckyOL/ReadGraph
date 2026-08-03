# 待审书目页（/review）设计规格

> 状态：已落地（SDD 阶段 1 定稿 → Tests(Red) → Code → Tests(Green)，2026-08-03）。本文档整合两类人工审核——**选书帮占位补全**（既有，szlib-parser §5）与**套装结构化**（同 ISBN 多卷，本规格新增）——统一收口到 /review 页。
> 关联：design-decisions §4、internal-schema 去重策略、import-pipeline §6、szlib-parser §4/§5、ui-navigation §2/§3。本文档由 book-merge-granularity.md 升级而来。

## 1. 背景：两类需要人工审核的数据

### 1.1 选书帮占位（既有）
福田图书馆「选书帮」记录共享占位书名「福田图书馆读者自选图书」、ISBN 为空、索书号共享，仅 barcode 可区分 → 解析时每 barcode 独立 Book、`needsReview=true`（dedupe 第 4 条）。用户需补全真实书目（书名/作者/ISBN）或合并到库中已有书。

### 1.2 套装候选（同 ISBN 多卷，新增）
同一 ISBN 对应多卷/多作品是出版方违规但普遍的现象（如夹具 [szlib-202605.json](../../tests/fixtures/szlib-202605.json) 中的「合成书目052 . 3 / 合成书目053 . 4」套装共用 ISBN 978-7-5740-1274-5，深图编目分开为 metaid 7109377/7109378）。导入时同 ISBN 合并为一 Book（现状保持），卷级信息无处安放 → 标记待审，由用户结构化（卷号入编目、题名规范化）。

外部依据（2026-08 检索）：

| 来源 | 要点 |
|---|---|
| [ISBN 用户手册 §6.5](https://www.isbn-international.org/sites/default/files/ISBN%20users%27%20Manual%202017-simplified%20chinese%20%28Chinese%20translation%20of%20seventh%20edition%29.pdf) | 多卷出版物应分配整套 ISBN；仅当每卷可单独销售时才各配唯一 ISBN。→ 套装共用 ISBN 是出版方违规但普遍的现象。 |
| [台湾国家图书馆编目园地 Q&A（2025-09）](https://catweb.ncl.edu.tw/QandA/page/32331) | 《纳尼亚传奇》3 册同一 ISBN：官方指导为**整套编目 1 条记录**。→ 馆方对同 ISBN 套书存在「整套 1 条」与「分卷多条」两种合法做法，深图属后者。 |
| 台大图书馆期刊论文（《大學圖書館》20-2） | 「同一組 ISBN 對照到多本書籍…必須透過圖書館人工檢查與偵錯」。→ ISBN 一对多是已知数据质量问题，需人工确认。 |
| [r/Libraries：图书系列编目](https://www.reddit.com/r/Libraries/comments/1dfzskm/cataloging_book_series/) | 每卷独立 MARC 记录是馆方主流：利于单卷描述、预约特定卷。 |

### 1.3 统一工作流
两类都是「导入期零决策 + 人工确认」：导入管线保持纯函数，不做自动拆分/合并判断（跨馆时题名/元数据不可靠，自动判定会误拆）；用户在 /review 页确认。与选书帮既有工作流一致，同一入口、同一列表。

## 2. 数据模型与类型判定

- `CatalogRecord.volume: string | null`（原文卷号，如 `"3"`/`"上"`；非索引字段，**无需 db 版本升级**；同步 entities.ts / schemas.ts / 导出备份 schema）。
- `Book` 不新增字段；套装 = 同 Book 下 ≥2 个 `volume` 非空编目（查询派生）。
- `books` 表 `&isbn13` 唯一索引**保持不变**（同 ISBN 併入一本，唯一性仍成立）。
- 待审类型判定（列表 Tabs 分流，派生不落库）：
  - **选书帮占位**：`needsReview=true && isbn13 === null`
  - **套装候选**：`needsReview=true && isbn13 !== null`
  - 补全/结构化完成后 `needsReview=false`，两类都退出列表，故派生判定不歧义；若未来出现第三种待审类型再引入显式 `reviewKind` 字段。

## 3. 路由与入口

- 新路由 `src/routes/review.tsx`（/review）。
- Sidebar 新增「待审」入口（icon + 文案），徽标显示 `needsReview=true` 的 Book 数（`findNeedsReview()` 响应式计数）。
- 聚合两类待审；类型由徽标区分（见 §4）。

## 4. 列表页

> 气质：方向 A 编目终端（密实表格、直角、瑠璃紺强调，DESIGN.md / ui-navigation §1）。文案走 `t()`（命名空间 `review`）；空态 `Empty`。

- `Table` 列：题名（截断）、类型徽标、ISBN13（等宽）、编目数、借阅次数、最近借阅、操作（「审核」Button）。
- 类型徽标：选书帮占位 = `destructive`「占位」；套装候选 = outline「套装」。
- 顶部筛选：Tabs「全部 / 选书帮 / 套装候选」+ 搜索框（题名/ISBN）。
- 空态：`Empty`（「无待审」）；有数据时按类型徽标 + 借阅次数降序。
- 行「审核」→ 打开对应审核 Sheet（占位 → §5 补全表单；套装候选 → §6 套装表单）。

## 5. 选书帮补全表单（Sheet）

> 规划依据 szlib-parser §5；此前无 UI 实现，本节约定。Sheet 宽 640px（移动端 Drawer）。

标题「补全书目」，三区：

1. **已知信息**（只读 Card）：barcode（等宽，`CatalogRecord.barcodes[0]`）、索书号/分类号（分类芯片）、借阅次数与最近借阅、来源徽标。
2. **补全字段**（Form）：
   - 书名 *（Input，必填，预填占位原文）
   - 作者（Input，可选；逗号/顿号分隔，保存时按现有 `splitPersons` 逻辑拆为 `authors`）
   - ISBN（Input，可选；保存时 `normalizeIsbn` 合法化，非法则内联错误并禁用保存）
   - 出版社/出版年：预留扩展位（本期不做，szlib-parser §5 范围外）。
3. **操作**：
   - 「保存」（primary）：写入补全字段 + `needsReview=false`，Sheet 关闭、列表刷新。
   - 「合并到已有书目」区（独立于保存，两者互斥触发）：搜索框（书名/ISBN 关键词，`searchByTitle` + `findByIsbn13` 合并去重）→ 结果行（题名/作者/ISBN/借阅次数，排除占位书自身）→ 选中后「合并」→ `AlertDialog` 确认（说明：占位书的 N 条借阅将归入目标书）→ 执行：占位 Book 删除，其 CatalogRecord 与 BorrowCycle 重挂目标书，目标书保持原状，`needsReview` 解除。搜索无结果显示「无匹配」。

## 6. 套装审核表单（Sheet）

标题「转换为套装」，三区：

1. **书目**（Card）：`Book.title` Input（预填公共前缀建议：取首个编目题名、去掉卷号段，可改）；ISBN（等宽只读）；借阅次数/来源摘要（只读）。
2. **编目卷号**（Table 行）：每个 CatalogRecord 一行——题名原文、metaId（等宽）、条码（等宽）、来源徽标、`volume` Input（预填 `parseVolumeFromTitle` 结果，可改、可清空）。
3. **操作**：
   - 「保存为套装」（primary 瑠璃紺）：写入各编目 volume + Book.title + `needsReview=false`，Sheet 关闭、列表刷新。
   - 「不是套装」（outline）：仅 `needsReview=false`，title/volume 不动（确认非套装，如重编目误标）。
   - 「拆为独立 Book」（ghost 危险色）：`AlertDialog` 二次确认（破坏性：按 metaIdKey 分组拆为多 Book，title 取各自编目题名、volume 保留、`needsReview=false`；CatalogRecord 与 BorrowCycle 重挂），确认后执行。

保存失败（字段校验等）在 Sheet 内联提示，不引入 toast 依赖。

## 7. 卷号解析（新 lib）

`src/lib/volume.ts`：`parseVolumeFromTitle(title: string): string | null`（纯函数，单测覆盖）。规则（只匹配题名**末尾**卷号段，由后往前）：

- `. N` / `(N)` / `〔N〕` / `【N】`：N 为阿拉伯或 CJK 数字（一二三…）；「N卷/册/集/部」同族。
- 汉字卷标：`上/中/下/前/后`、`上册/中册/下册`。
- 非尾部数字不提取（`1984` 不作卷号）；解析失败 → null（人工填写）。

## 8. 书库与详情联动

- 详情页（/library/$bookId）CatalogRecord 区：volume 非空时显示卷号 `Badge`。
- 书库列表：套装 Book（≥2 个 volume 编目）title 旁加「套装」outline Badge；占位书维持现有「待复核」Badge。

## 9. 实施清单与测试

1. **数据层**：`entities.ts`/`schemas.ts` 加 `CatalogRecord.volume`（zod nullable string）；导出/备份 schema 同步；db 测试补字段断言。
2. **dedupe**：第 2 条合并分支加待审标记（同源异 metaid / 跨源异题名），返回逐候选 `reviewFlags`；批内同 ISBN 多 metaid 同样标记；警告文案含双方 metaid。
3. **pipeline**：建书/复用书时应用 reviewFlags（existing Book 置 `needsReview` 需更新 state.books）。
4. **`src/lib/volume.ts`** + 单测。
5. **/review 页**：路由 + Sidebar 入口（含计数徽标）+ 列表（Tabs/搜索/徽标）+ 选书帮补全 Sheet（含合并搜索与 AlertDialog）+ 套装审核 Sheet（含拆书 AlertDialog）+ 查询 hook（待审计数/列表、套装派生判定）+ i18n `review` 命名空间（键表随实现补齐：列表列头、两类徽标、两个表单的全部标签/按钮/确认文案、空态）。
6. **书库/详情**：套装 Badge 与卷号展示。
7. **测试**：
   - dedupe：同 ISBN 异 metaid → 合并 + flag + 警告；跨源异题名 → flag；同源同 metaid 多复本 → 不 flag。
   - pipeline / run-import：卷3/卷4 夹具改断言 1 Book + `needsReview=true` + 警告；选书帮夹具断言不变。
   - volume.ts 单测（尾部卷号族、非尾部数字不提取、null）。
   - review 页组件：列表渲染与 Tabs 分流；补全保存（必填/ISBN 校验/解除标记）；合并确认流（编目与周期重挂、占位书删除）；套装预填与保存；「不是套装」；拆书确认流。
8. **文档同步**：szlib-parser §4.2/§5（指向 /review 落实）、internal-schema（CatalogRecord.volume、去重策略、待审语义）、design-decisions §4（人工审核路线）、ui-navigation（路由/测试清单）。

## 10. 风险与边界

- **重建幂等**：volume 与补全字段的人工修正值存派生数据，清库重导后丢失需重新审核（volume 自动预填值可重建；补全书目为纯人工输入不可重建）——与选书帮补全的既有取舍一致。
- **统计口径**：套装 Book 按整套聚合；卷级统计需按 catalogRecordId 聚合（可选增强，另做）。
- **跨馆**：广图卷3/卷4 併入同一 Book，卷号预填依赖题名解析，写法差异时人工修正。
- **误标记解除**：重编目等误标在「不是套装」解除，不阻塞。
- **历史数据**：本版本前已入库的合并书无标记，不回溯；如需可提供一次性扫描脚本标出既有同 ISBN 多 metaid 合并书（可选）。

## 11. 存档：方案 A（自动拆分）为何放弃

原草案：Book=卷，dedupe 按「同源异 metaid / 跨源异题名」自动拆分，`&isbn13` 放开唯一索引。弃因：

- **跨馆归属不可靠**：同 ISBN 多 Book 时，他馆同卷题名因标点/写法差异归一化匹配不上 → 误拆新 Book；多命中时无法判定归属。
- **破坏性 schema 变更**：需放开 `&isbn13` 唯一索引。
- **与零人工路线相悖**：判定信号（题名）本身不可靠，自动决策在导入期不可控；人工审核把风险转移到确认环节，与选书帮既有工作流一致。
- 保留价值：`parseVolumeFromTitle` 对 A 同样有用；卷号一致可作为未来「自动转套装」的辅助信号。
