# OPAC 编目补全规格（多来源 Provider 架构）

> 本文件从 `docs/app-spec.md` §6 登记，遵循 SDD + TDD。实体字段语义以 [book](../metadata/book.md)、[catalog-record](../metadata/catalog-record.md)、[internal-schema](../metadata/internal-schema.md) 为唯一来源；导入管线/去重/书目标题解析见 [import-pipeline](import-pipeline.md)；**补全应用走统一编辑表单（[book-editing](book-editing.md)）**——API 抓取结果不直接写实体，而是以「建议改动 → 表单预填 → 用户审视保存」方式复用详情页编辑流程；来源差异（URL/参数/响应解析/空负载判定/候选键）收口在 **OpacProvider** 实现内，映射、预填、应用与状态机来源无关。本节定义「Provider 抽象与注册表、szlib 首个 provider 契约、字段映射与建议改动契约、执行模型（抓取/应用两阶段）、CORS 部署与降级、测试清单」。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 背景与动机

szlib 流通记录 JSON 只携带 `metaid`/`metatable` 与部分书目字段：`ISBN` 可能缺失，且**缺少作者、出版社、出版年、价格、关键词、封面**（[szlib-parser](../metadata/parsers/szlib-parser.md) 原始数据特征分析）。同一书目在深圳图书馆 OPAC 编目主表（`bibliosm`）有权威的完整编目。利用流通记录携带的 `metaid` 反查 OPAC，可补全缺失字段，完善 `Book` 与 `CatalogRecord`。

本设计在统一编辑表单（[book-editing §3](book-editing.md#3-编辑表单-ui-规格详情页-dialog)）落地后演进：补全**不再自动合并写库**，而是把抓取结果填入编辑输入框。收益：

1. **共用修改流程**：预填、审视、保存、校验（ISBN 唯一冲突预检、Zod 事务回滚）与普通编辑完全同构，不维护第二套写路径；保存动作天然表达「用户已确认」。
2. **可审视改动值**：建议值直接填入输入框，字段标签与输入框之间对照显示现有值（「现有：…」），用户当场决定替换或保留；导入期的错误值（截断题名、错位 ISBN）得以修正，不再被「只填空」静默保留。

**多来源泛化**：不同图书馆 OPAC 接口形态各异（URL/参数/响应字段/未找到判定/部署约束均不同），未来还可能接入 OpenLibrary 等按 ISBN 补全的源（[design-decisions 未来扩展](../design-decisions.md)）。补全层以 **provider 架构**应对（§2）：来源差异全部收口在 `OpacProvider` 实现内，映射（§5.2）、预填（§5.3）、应用（§7.2）、状态机（§6）与来源无关。该模式与既有 `SourceParser` 注册表（[source.md](../metadata/source.md)、[import-pipeline §2](import-pipeline.md#2-parser-接口与注册表)）同构，一份心智模型管两条管线。

**2026-08 交互重构（详情页逐本工作流，用户定案）**：批量补全初版存在两处交互缺陷——

1. **来源多样就乱套**：批量入口把全库候选按 provider 分组一次抓取——多来源并存时结果互相覆盖、结果项不区分来源/编目归属，同名 Book 的多来源记录无法区分；更根本的是**一本书对应多条编目（多来源合并），列表级批量抓取在编目粒度上无从表达**——勾选校验、来源分组、目标编目识别全部为此兜复杂度。
2. **批量后单条编辑返回丢状态**：结果面板是列表页组件 `useState`，进入 `/$bookId?edit=true` 编辑后返回，面板随组件卸载丢失，未应用项必须整批重新抓取；建议上下文经单槽 `setPendingEnrichment`/`takePendingEnrichment` 传递且**消费一次即清**——取消编辑即丢建议。

**重构决策：放弃列表批量补全**。书库列表不出现任何批量补全入口；补全收敛为**详情页逐本工作流**：

- 每条 CatalogRecord 卡自带其 provider 的「从 {provider.displayName} 补全」按钮——来源隔离天然成立（一个按钮 = 一个 provider = 一条编目），「多来源乱套」从入口上消灭；
- 详情页头部加**「‹ 上一个 / 下一个 ›」翻页**（按书库列表当前筛选/排序视图顺序），逐本补全不离开详情页上下文——编辑 Dialog（`search.edit=true`）与补全按钮同页，补全 → 编辑 → 保存 → 翻下一本全程无列表往返，「批量后返回丢状态」场景不存在；
- 单条上下文为详情页**组件态**（§7.3）：抓取成功入 state → Dialog 预填；取消保留（重开仍带建议）、「重新抓取」覆盖、刷新丢失（重抓即可）；
- 批量编排与批量面板**整体删除**（`enrichCatalogRecords`/候选集聚合函数/`EnrichBatchPanel`/会话 store），补全能力只保留单条路径（`enrichOneRecord`）。

设计依据的同类最佳实践：逐条处理编目记录（图书馆编目员工作流：一条 MARC 一条 MARC 过，相邻记录翻页）、审阅队列的「上一条/下一条」逐篇模式（邮件收件箱 / 审阅工具）。曾考虑「列表勾选驱动 + 跨来源校验阻止」（Gmail 批量条模式），因编目粒度问题放弃，见 §10 存档。

## 2. Provider 架构（泛化核心）

### 2.1 统一中间态 `OpacDetail`

provider 输出统一的**原始形态平铺字段**（MARC 风格），编目语义解析（parseTitle 结构化、publish 拆分、price 解析、classno 去后缀）全部留给来源无关的映射层 §5.2：

```ts
interface OpacDetail {
  title: string | null           // 编目正题名原文（可含并列题名串）
  author: string | null          // 责任者声明原文
  publish: string | null         // 出版地:出版社,出版年 原文
  page: string | null            // 页数原文文本（如 "198页"）
  price: string | null           // 定价原文（如 "CNY35.00"）
  subject: string | null         // 关键词原文（分隔串）
  classno: string | null         // 分类号原文（可含复分后缀）
  abstract: string | null        // 内容简介原文（可能为数组 → provider 按统一规则拼串）
  isbn: string | null            // ISBN 原文（可含连字符）
  img: string | null             // 封面图 URL
}
```

- 字段全部可空：provider 只填接口实际提供的字段，缺省为 null → 不产出对应 change（§5.2）。
- 不设 `series`/`callno` 等 `Book` 无对应字段的项；provider 可解析后丢弃（见 §3 szlib 处理）。

### 2.2 `OpacProvider` 接口与注册表

```ts
interface OpacProvider {
  /** 唯一标识 = Source.parserId（[source.md](../metadata/source.md) 二合一键），如 'szlib' */
  id: string
  /** UI 文案用显示名，如「深圳图书馆 OPAC」 */
  displayName: string
  /** 短名（徽标用，如「深图」）；缺省回退 displayName。多来源并存时字段级徽标/会话分区用它区分来源 */
  shortName?: string
  /** 候选键：以什么实体字段反查本来源 OPAC */
  lookupKey: 'metaId' | 'isbn13'
  /** 用户可访问的详情页外链（降级/溯源）；无 → null */
  detailUrl(record: CatalogRecord, book: Book): string | null
  /** 传输 + 响应解析 + 未找到判定（来源特有）；经传输基元 opac-client 发网络 */
  fetchDetail(record: CatalogRecord, book: Book, opts: { timeoutMs: number; signal?: AbortSignal }): Promise<OpacDetailResult>
}

type OpacDetailResult =
  | { ok: true; detail: OpacDetail; sourceUrl: string }
  | { ok: false; reason: 'parse_error' | 'not_found' }
```

- `src/enrich/opac-provider.ts`：`OpacProvider`/`OpacDetail`/`OpacDetailResult` 类型 + 注册表 `getProvider(parserId): OpacProvider | null`。未注册返回 null（**不抛错**：该来源无补全能力 → UI 隐藏入口），区别于 Parser 注册表的硬抛——补全是可选能力，导入是硬依赖。
- 分发依据 `Source.parserId`（不是 `Source.type`）：manual/Libby 等无 provider 的来源天然排除。
- 注册表默认注册 `szlibProvider`；其它 provider 按 §2.4 清单增量接入。

### 2.3 职责边界与传输基元

| 层 | 职责 | 落点 |
|----|------|------|
| provider | **来源怎么读**：URL 构造、请求参数、响应解析、未找到判定、detailUrl、CORS 事实 | `src/enrich/providers/<id>/` |
| 映射层 | **编目语义怎么理解**：parseTitle 结构化、publish 拆分、price/classno/subject 解析、fill/conflict 判定 | `src/lib/opac-mapping.ts`（来源无关）|
| 传输基元 | 超时/中止 fetch 封装、CORS `TypeError` 捕获（唯一接触网络处）| `src/enrich/opac-client.ts`，provider 复用 |

### 2.4 新 provider 接入清单（贡献指南）

1. 实测目标接口：URL/参数/响应形态/未找到判定/CORS 事实，产出脱敏样本（脱敏规则同 [contributing-parser](../metadata/parsers/contributing-parser.md)：虚构书名/作者/馆名，保留结构特征）。
2. 实现 provider：`fetchDetail`（经传输基元）+ 纯函数响应解析（§5.1，可单测）+ `detailUrl` + `lookupKey` 声明。
3. 单测：响应解析契约 + 注册表分发 + 候选集过滤（§12）。
4. 评估 CORS 部署形态，更新 §8 对照表与降级文案。
5. i18n：`enrich.*` 命名空间补 displayName/shortName 相关键；详情页按钮/徽标文案自动按 provider 显示。

## 3. 数据源契约：szlib（首个 provider 参考实现，已实测 2026-08-01）

> 本节 URL/参数/响应/判定/CORS 均为深圳图书馆接口实测，作为 provider 实现的参考样本；其余 provider 按 §2.4 清单各自评估，不套用本节细节。

### 3.1 详情页 URL（用户可访问、可外链）

```
https://www.szlib.org.cn/opac/searchDetail?tablename=bibliosm&recordid={metaid}
```

- `tablename=bibliosm`：编目主表，与流通记录 `metatable` 字段对应。
- 该页是 Vue SPA：直接 `fetch` 得到的原始 HTML 只是应用壳（无书目数据），页面由 JS 调用下方 JSON 接口渲染。**程序化补全不抓 HTML**，只走 §3.2 接口；此 URL 用于「在 OPAC 查看详情」外链与溯源。

### 3.2 JSON 数据接口（程序化补全使用）

```
GET https://www.szlib.org.cn/api/opacservice/getBookDetail?metaTable=bibliosm&metaId={metaid}&client_id=t1
```

- `metaTable`：取流通记录 `metatable` 字段，缺省回退 `bibliosm`。
- `client_id=t1`：站点固定参数，作为常量保留。
- 响应 `Content-Type: text/plain;charset=UTF-8`，体为 JSON 文本 → 解析先取 `text()` 再 `JSON.parse`（不依赖响应头）。

### 3.3 响应字段（实测样本，metaid=6092919 →《合成绘本甲》）→ OpacDetail 映射

| 响应字段 | 样本值 | OpacDetail 落点 |
|------|--------|------|
| `title` | `合成绘本甲=Synthetic story` | `title`（编目正题名 ISBD 串，含并列题名；`=` 两侧无空格，归一化在映射层）|
| `author` | `(日)合成作者著 　合成译者译` | `author`（责任者声明，组间分隔符「空格+全角空格」→ `;` 归一化在映射层）|
| `publish` | `北京:合成出版社,2023` | `publish`（出版地:出版社,出版年）|
| `publishyear` | `北京:合成出版社,2023` | 与 `publish` 重复（上游缺陷），忽略 |
| `callno` | `""` | 丢弃（本接口常空；真实索书号在馆藏列表）|
| `series` | `""` | 丢弃（`Book` 无对应字段）|
| `page` | `198页` | `page` |
| `price` | `CNY35.00` | `price` |
| `subject` | `漫画-连环画-日本-现代` | `subject` |
| `classno` | `J238.2(313)` | `classno`（CLC 分类号，含地区复分后缀 `(313)`，去后缀在映射层）|
| `abstract` / `abstracts` | `""` / `""` | `abstract`（多数为空；`abstracts` 可能为数组 → 数组按 `\n` join 后落 `abstract`）|
| `isPreloan` | `false` | 丢弃（预借标记）|
| `isbn` | `978-7-5217-4823-9` | `isbn`（带连字符，清洗在映射层）|
| `img` | `https://www.bookcovers.cn/index.php?client=szlib&isbn=978-7-5217-4823-9/cover` | `img`（bookcovers.cn 图床，可按 ISBN 直出）|
| `districtList` | `[...]` | 仅用于未找到判定（§3.4），不落 OpacDetail |
| `CanLoanBook` / `OnlyReadBook` / `BorrowedBook` | `[...]` | 丢弃（动态馆藏，v1 不落库）|

### 3.4 无效 metaid 行为（实测，provider 特有判定）

- metaid 不存在（如 `99999999`）→ **HTTP 200 + 全空负载**：`title`/`isbn`/`publish` 等全为 `""`，`districtList: []`。
- 「未找到」判定**不能看 HTTP 状态码**，看负载：`title === "" && isbn === "" && districtList.length === 0` → `{ ok: false, reason: 'not_found' }`。
- 说明：这是 szlib 特有判定；其他 provider 按各自接口行为实现（如 HTTP 404 亦可判 not_found）。

### 3.5 CORS 事实（szlib 实测，决定其部署形态）

- 响应头**没有** `Access-Control-Allow-Origin`（curl 带 `Origin` 头实测确认），且 `X-Frame-Options: DENY`。
- 跨源页面 `fetch`：请求可发出，但响应体被浏览器 CORS 拦截，**无法读取**。
- 封面图像（`bookcovers.cn`）不受 CORS 读取限制，可直接 `<img>` 展示。
- 部署策略见 §8。

## 4. 范围与依赖

**范围**：定义 provider 抽象与注册表（`OpacProvider`/`OpacDetail`）、来源无关的映射/预填纯函数契约（`mapOpacDetail` / `prefillFromChanges`）、szlib 首个 provider 的响应解析纯函数、抓取编排契约、建议改动模型（fill/conflict）、schema 增量（`CatalogRecord.opacEnrichment`）、UI 触发与降级。本里程碑**只交付纯函数与单测**；网络执行（provider `fetchDetail` / `enrich-service`）与 UI 归统一 UI 里程碑（[tasks/ui-unified-batch](../tasks/ui-unified-batch.md)），本节先锁契约。

**依赖**：**不新增运行时依赖**（原生 `fetch` + `AbortController`），无新包 → 不走 [npm-supply-chain-security](../npm-supply-chain-security.md) 审查门。

**代码落点**（规划）：

```
src/
├─ lib/
│  ├─ opac-mapping.ts       # mapOpacDetail(detail: OpacDetail, existing): { changes, warnings }（来源无关，纯函数）
│  │                        # + prefillFromChanges(book, record, changes): { bookPrefill, recordPrefill, applied }（纯函数）
│  ├─ library-view.ts       # 书库视图派生（列表页与详情页翻页共用，§10）：LibraryRow 构建 + filtered 过滤/排序
│  │                        #   （自 routes/library/index.tsx 抽出；filterBookByReviewType/sort 逻辑唯一来源）
│  └─ opac-mapping.test.ts
├─ enrich/
│  ├─ opac-provider.ts      # OpacProvider / OpacDetail / OpacDetailResult 类型 + 注册表 getProvider(parserId)
│  ├─ opac-client.ts        # 传输基元 fetchWithTimeout：超时/中止、CORS TypeError 捕获（唯一接触网络处）
│  ├─ providers/
│  │  └─ szlib/
│  │     ├─ detail.ts       # parseSzlibDetail(text): OpacDetailResult — 响应解析 + 空负载判定（纯函数）
│  │     └─ index.ts        # szlibProvider：URL 构造 + fetchDetail（metaTable/client_id）+ detailUrl + shortName
│  └─ enrich-service.ts     # 仅单条路径：enrichOneRecord（超时/重试/状态回写/产出上下文）+ 候选判定
│                           #   isEnrichmentCandidate / hasLookupKey（详情页按钮可见性用）；
│                           #   批量编排与候选集聚合（enrichCatalogRecords/collectCandidates/
│                           #   groupCandidatesByProvider/countPlaceholderExcluded）已删除（§1）
│  └─ opac-provider.test.ts / providers/szlib/detail.test.ts / enrich-service.test.ts
├─ routes/library/
│  ├─ index.tsx             # 无批量补全入口（§1）；行链接带当前视图 search 参数（q/source/status/sort/dir），
│  │                        #   详情页翻页据此延续筛选/排序上下文
│  ├─ $bookId.tsx           # 头部「‹ 上一个 / 下一个 ›」翻页（library-view 派生，§10）；
│  │                        #   search 扩展列表视图参数；「从 {provider.displayName} 补全」抓取成功 →
│  │                        #   context 入组件态（§7.3）→ 打开编辑 Dialog（search.edit=true）
│  ├─ -edit-dialog.tsx      # 补全预填（prefillFromChanges 初始化表单）+ 现有值对照 +「恢复现有值」+ 摘要条
│  │                        #   + 目标编目高亮与 provider 徽标（§10）
│  └─ -edit-actions.ts      # updateBookWithRecords 扩展可选 enrichment 载荷（同事务写 opacEnrichment，§7.2）
│                           #   （行为不变；无 applied 会话回调）
```

> 已删除文件：`src/enrich/enrich-session.ts`（单槽 → 会话 store 两版均废弃，详情页组件态取代）、`src/components/enrich-batch.tsx`（批量面板）。

## 5. 纯函数契约

### 5.1 provider 响应解析（szlib 示例：`parseSzlibDetail(text: string): OpacDetailResult`）

```ts
type OpacDetailResult =
  | { ok: true; detail: OpacDetail; sourceUrl: string }
  | { ok: false; reason: 'parse_error' | 'not_found' }
```

- `JSON.parse` 失败 → `{ ok: false, reason: 'parse_error' }`（不抛异常）。
- 空负载判定（§3.4，provider 特有）→ `{ ok: false, reason: 'not_found' }`。
- **HTML 实体解码（provider 解析层）**：响应文本可能含 HTML 实体（`&apos;`/`&amp;`/`&quot;` 等，与流通记录同源——szlib 导入 parser 已在 [szlib-parser §10.13](../metadata/parsers/szlib-parser.md) 对标题解码）；解析层对每个字符串字段（含 `abstracts` join 后）复用 `lib/encoding` 的 `decodeHtmlEntities` 统一解码——**与导入管线共用同一转码方法**，保证 OPAC 建议值与库中已解码值一致，`mapOpacDetail` 对照不误判 conflict。
- 成功 → 按 §3.3 表映射为统一 `OpacDetail`；空串 → null。
- 纯函数、无时钟、无 I/O；每个 provider 一个解析纯函数（可单测），`fetchDetail` 仅负责网络 + 调用它。

### 5.2 `mapOpacDetail(detail: OpacDetail, existing): { changes, warnings }`

`existing` = 当前 `Book` + `CatalogRecord`。输入是**统一 `OpacDetail`**（来源无关，任何 provider 产物均可），产出**建议改动集**——只描述「OPAC 建议什么、现状是什么」，**不做合并裁决**（裁决权在用户，§5.4）：

```ts
type EnrichmentChange = {
  /** 目标字段：BookDraft 可编辑字段名（book-editing §2.1）或 'classifications'（编目侧） */
  field: 'title' | 'subtitle' | 'parallelTitles' | 'authors' | 'translators'
       | 'publisher' | 'publishDate' | 'pages' | 'price' | 'subjects'
       | 'description' | 'coverUrl' | 'isbn13' | 'isbn10' | 'classifications'
  /** fill = 现有为空（或占位）→ 表单预填建议值，无对照；conflict = 现有非空且（规范化后）与建议值不同 → 表单同样预填建议值，并以「现有：…」对照 + 恢复按钮呈现（§5.3/§10） */
  kind: 'fill' | 'conflict'
  /** 现有值（表单同构形态；null = 空） */
  current: unknown
  /** OPAC 建议值（与表单字段同构，可直接写入表单状态） */
  proposed: unknown
}
```

字段映射表（解析规则为通用编目语义，与来源无关；`OpacDetail` 缺省 null 的字段不产出 change）：

| 落点 | 解析与填充规则 | 建议值判定 |
|------|---------------|-----------|
| `Book.title` / `subtitle` / `parallelTitles` | `detail.title` 归一化 `\s*=\s*` → `" = "` 后走 [import-pipeline §13 parseTitle](import-pipeline.md#13-书目标题结构化解析) 结构化 | 现有 title 为空/占位 → fill；非空且结构化回显串（title/subtitle/parallelTitles 组装）与建议不同 → conflict；相同 → 不产出 change |
| `Book.authors` / `translators` | `detail.author` 归一化 `　`/` 　` → `;` 后走 parseTitle 责任区解析 | `authors` 为空 → fill；非空且不同 → conflict |
| `Book.isbn13` / `isbn10` | `detail.isbn` 过 [lib/isbn 清洗](import-pipeline.md)（去连字符）| `isbn13` 为空 → fill；非空相同 → 不产出；非空不同 → conflict（预填建议值；若被他书占用，保存时由既有 ISBN 唯一冲突预检兜底报错，book-editing §4.2）|
| `Book.publisher` / `publishDate` | `detail.publish` 首个 `:` 后按 `[,，]` 拆；末段以 4 位年份开头（后不紧跟数字）→ `publishDate` 取年份（台版实测 `2019(民108)` 出版年后跟民国纪年括注，年份仍提取），其余 → `publisher` | 为空 → fill；非空不同 → conflict |
| `Book.pages` | `detail.page` 首个整数序列 | 为空 → fill；非空不同 → conflict |
| `Book.price` | `detail.price` 货币前缀（`¥` → CNY，否则大写字母串）+ 金额；无前缀默认 CNY；**台版等实测形态 `CNY110.00(TWD350.00,HKD117.00)`：括号前为主价（馆方定价口径），取主价，括号内原币种参考价丢弃** | 为空 → fill；非空不同 → conflict |
| `Book.subjects` | `detail.subject` 按 `-` 拆分、trim、去空 | 为空 → fill；非空且集合不同 → conflict |
| `Book.description` | `detail.abstract`（provider 已把数组拼串）| 为空 → fill；非空不同 → conflict |
| `Book.coverUrl` | `detail.img` | 为空 → fill；非空不同 → conflict |
| `CatalogRecord.classifications` | `detail.classno` 去 `(...)` 后缀 → `code`，`system: 'clc'` | 现有无同 `code + system` → fill（追加语义）；已有 → 不产出 |

- `classifications` 的 `system` 取 [source.library.classificationSystem](../metadata/source.md)（缺省 `'clc'`）——不同馆默认体系不同，如 DDC 馆。
- 无对应数据的字段（`edition`/`tags`）不产出 change。
- `warnings`：publish/page/price 不可解析等（复用 [ParseWarning 语义](import-pipeline.md#8-借还配对与错误警告模型)，type 取 `format_error`），与 changes 并列返回，UI 展示于摘要条。
- 占位书名（`isPlaceholder`，选书帮）对应 Book 不进入候选集（§7.1）。

### 5.3 `prefillFromChanges(book, record, changes): { bookPrefill, recordPrefill, applied }`

纯函数：把有建议值的 change（fill **与** conflict）落成表单初始预填值——输入框直接呈现建议值；kind 仅供 UI 决定对照与徽标展示（conflict 渲染「现有：…」对照 + 恢复按钮，§10）：

```ts
function prefillFromChanges(
  book: Book,
  record: CatalogRecord,
  changes: EnrichmentChange[],
): {
  bookPrefill: Partial<BookDraft>
  recordPrefill: { classifications: ClassificationEntry[] } | null
  applied: EnrichmentChange['field'][]
}
```

- 编辑表单初始化 = `bookToDraft(book) ∪ bookPrefill`；`recordPrefill.classifications` = 现有分类 ∪ 建议分类（按 code+system 去重）后的完整数组。
- `applied` = 实际发生预填的字段（fill 与 conflict 均计入），供 UI 标注「OPAC」徽标；conflict 项的现有值对照由表单结合 changes（`kind==='conflict'` 的 `current`）渲染，恢复动作回读初始 `book` 快照。

### 5.4 为什么「建议入框 + 现有值对照」而不是自动覆盖

`Book` 字段没有字段级编辑溯源（区分「用户手改」与「导入值」），盲覆盖会破坏 [book.md 字段优先级](../metadata/book.md)：用户手动编辑 > 图书馆编目 > 自动补全 API。补全以**建议入框**形态呈现，优先级由**用户决策**落实（而非合并规则）：

- **建议值入框（fill 与 conflict 一视同仁）**：抓取来的值直接填进输入框——补全的直觉就是「抓来的值出现在表单里」，保存即采纳；导入期的错误值（截断题名、错位 ISBN）由此可修正，补上旧设计「不修正导入错误值」的缺口。
- **现有值对照 + 一键恢复**：conflict 字段的现有值以「现有：…」对照文字显示在字段标签与输入框之间（低对比/删除线样式），并提供「恢复现有值」按钮——用户已有值不被静默覆盖；拒绝采纳 = 一键回退，采纳 = 直接保存。优先级「用户手动 > 编目 > API」由此以「保存 = 采纳、恢复 = 拒绝」实现。
- **表单即最终裁决**：保存时以用户当前输入为准（建议值、恢复后的旧值、还是手改第三值），走统一事务与校验。
- 字段级溯源（`sourceField` 标记）仍列为后续扩展，届时可升级为按来源标记的自动优先级。

## 6. Schema 增量

`CatalogRecord.opacEnrichment`（新可选字段，幂等/审计用）——在本规格上一版基础上增加 `providerId`（多来源审计）：

```ts
opacEnrichment: {
  providerId: string | null   // 补全来源（= Source.parserId），多 provider 场景审计与区分
  status: 'fetched' | 'not_found' | 'failed'
  fetchedAt: Date | null
  sourceUrl: string | null    // provider 详情页/数据 URL（§2.2 detailUrl 或响应来源）
} | null
```

- 默认 `null`；Zod `z.object({...}).nullable().default(null)` → 旧导出兼容，无迁移脚本（[data-layer §5](data-layer.md#5-迁移策略)）。
- **status 语义**：`'fetched'` = 用户已通过编辑表单**应用并保存**补全（保存时同事务写入，§7.2）；`'not_found'` / `'failed'` = 抓取阶段回写（§7）。抓取成功但未保存 → **不写任何状态**（下次可重新抓取）。
- 幂等依据不变：`status === 'fetched'` 的 CatalogRecord 不再抓取（§7）。

## 7. 执行模型

- **不进入 importPipeline**：管线是确定性纯函数（[import-pipeline §3](import-pipeline.md#3-纯函数-pipeline-契约)），网络补全非确定性，二者必须隔离。补全是导入后的**独立异步步骤**或用户按需触发。
- **两阶段模型**：**抓取**（自动编排、除状态回写外零写入）→ **应用**（用户驱动、复用统一编辑表单）。抓取成功 ≠ 已补全：只有用户保存才落实体与 `'fetched'` 状态。
- **候选集（provider 感知）**：`CatalogRecord` 满足——
  1. 其 `Source.parserId` 在 provider 注册表**命中**（未注册来源无补全能力，入口隐藏）；
  2. 命中 provider 的 `lookupKey` 对应字段满足：`'metaId'` → `metaIdKey` 非空且 `metaId !== 0`；`'isbn13'` → `Book.isbn13` 非空（如未来 OpenLibrary）；
  3. `opacEnrichment.status !== 'fetched'`；
  4. 其 `Book` 非占位。
- **抓取阶段**（`enrich-service.enrichOneRecord`）：按 provider 分派（`getProvider(source.parserId)`）；单请求超时 10s、失败指数退避重试（最多 2 次）；`not_found`/`failed` 立即回写状态（含 providerId）、**不触碰实体**；成功产出 `{ record, changes, warnings, sourceUrl }` 上下文（零写入；落点 = 详情页组件态，§7.3）。批量编排（`enrichCatalogRecords`/候选集聚合）已随批量入口删除（§1）。
- **应用阶段**（编辑表单）：预填 → 审视 → 保存（§7.2）。
- **重建/重放语义**：replay 重建（[settings §4](settings.md#4-重建模式对照)）后 `opacEnrichment` 归 `null`（重导后需重新触发补全）；snapshot 恢复保留已补全字段与状态。已应用字段视为人工值，重导后丢失（与人工编辑同一取舍，book-editing §2.3）。

### 7.1 占位 Book 记录（通用规则 + szlib 细节）

- **通用规则**：占位 Book（`needsReview=true` 且占位书名）**排除出补全候选集**——其书目身份未定，任何 provider 的抓取结果都无锚点。
- **szlib 细节**：选书帮占位记录的 `metaid` 在所有 barcode 间相同（[szlib-parser §5](../metadata/parsers/szlib-parser.md)），抓取结果不指向真实书目，会污染多个 Book。
- 补全入口对这些记录置灰并提示「占位书目，请在待审阅中手动补全」（其补全走编辑表单既有路径，book-editing §10.4）；「在 OPAC 查看」外链同样不提供。

### 7.2 应用阶段（编辑表单）

- **唯一路径 = 详情页单条**：详情页某 CatalogRecord 卡「从 {provider.displayName} 补全」→ 抓取成功 → 上下文存入详情页组件态（§7.3）并打开编辑 Dialog（`search.edit=true`）→ 表单按 §5.3 预填（建议值入框 + 现有值对照，§10）→ 保存走 `updateBookWithRecords`（见下）→ 成功 Dialog 关闭、`useLiveQuery` 自动刷新；**取消 → 实体与状态零改动，上下文保留在组件态**——重开编辑仍带建议，无需重新抓取；「重新抓取」按钮覆盖上下文。
- **保存钩子**：`updateBookWithRecords(db, bookId, bookDraft, recordDrafts, enrichment?: { recordId; providerId; status: 'fetched'; fetchedAt: Date; sourceUrl: string })`——可选载荷，**同一事务**写目标编目 `opacEnrichment`（Zod 失败整体回滚时状态一并回滚）；不传则行为与普通编辑完全一致。enrichment 载荷不参与字段合并（表单值即最终裁决）。
- **建议改动上下文不落 URL、不落库**（§7.3：仅存于详情页组件态；无批量场景，无跨页传递需求）。
- **needsReview 联动**：保存即 `needsReview=false`（book-editing §2.2 既有语义，保存 = 人工确认）；占位 Book 不在此流程（§7.1）。

### 7.3 单条上下文生命周期（详情页组件态）

> 批量方案废弃后（§1），无「批量结果面板跨页保留」需求；抓取结果只存在于**详情页组件态**。本小节定义其生命周期与取舍。

**生命周期**：

```
抓取成功 ──▶ context 入组件 state（enrichment）
              │
              ├─ 打开编辑 Dialog（search.edit=true）── 表单初始 state = 现有值 ∪ prefillFromChanges
              │      ├─ 保存 ──▶ 同事务写 opacEnrichment(status='fetched') → 成功关 Dialog
              │      └─ 取消 ──▶ 实体零改动，context 保留 → 重开编辑仍带建议
              ├─ 「重新抓取」──▶ 覆盖 context（旧建议丢弃）
              ├─ 翻页 / 离开详情页 ──▶ context 随组件卸载丢弃
              └─ 刷新 ──▶ context 丢失（不落 URL、不落库）
```

**约束与取舍**：

- **不落 URL、不落库**：建议上下文是瞬态操作态；落 URL 会与 `?edit=true` 纠缠（刷新后自动重开 Dialog 却带陈旧建议），落 IndexedDB 进备份/重建语义。**刷新丢失 = 重新抓取一次**（成本一次请求，可接受）。
- **组件态足够**：Dialog 是详情页内浮层（book-editing §4.1），详情页组件不因 Dialog 开合卸载——取消后 context 天然保留；「翻页/离开」卸载丢弃是显式离开该书上下文（与「点列表另一本书」行为一致），无需跨页保留。
- **不引入模块级 store / sessionStorage**（废弃方案对比）：批量场景的「结果面板跨导航/刷新保留」随批量入口一起删除；为单条场景引入 store 是过度设计——组件态已覆盖全部需求。
- **多编目书**：每编目卡独立抓取、独立 context；同一时间只处理一个编目的建议（Dialog 内目标编目高亮，§10），上下文互不干扰。
- **确定性**：同 `recordId` 重复抓取 → 覆盖；重复打开 Dialog → 同一 context 预填（`prefillFromChanges` 以打开时实体为准，表单即最终裁决，§5.4）。

## 8. 部署与降级（CORS）

| 运行形态 | 可行性 | 说明 |
|---------|--------|------|
| `pnpm dev`（Vite 开发） | ✅ 可用 | `vite.config.ts` 配 `server.proxy`：`/api/opacservice` → `https://www.szlib.org.cn`，同源消除 CORS |
| 同源反向代理部署 | ✅ 可用 | 用户自建 nginx/Caddy 反代 `/api/opacservice`（超出纯前端范围，文档指引即可）|
| 静态托管直连接口 | ❌ 不可读 | 无 `Access-Control-Allow-Origin` 头，浏览器拦截响应体（§3.5）|
| 降级外链（始终可用） | ✅ | 书目详情提供「在 {provider.displayName} 查看」新标签外链（provider `detailUrl`）|
| 封面图 | ✅ 不受限 | szlib 图床 `bookcovers.cn` 图片可直接 `<img>` 展示（无需 CORS）|

- 传输基元隔离（`opac-client.ts` 唯一接触网络），同源代理 / 直连切换不动 provider 与映射层；CORS 环境下传输基元捕获 `TypeError` → 记 `failed` 并提示降级。
- 上表为 **szlib provider 实测**；其余 provider 按 §2.4 清单第 4 步各自评估（接口可能带 `Access-Control-Allow-Origin`，或需自建代理），结论以 provider 文档为准。

## 9. 隐私与安全

- 仅向对应 provider 发送其 `lookupKey` 所需的最小公开标识（szlib：`metaId` + `metaTable` + 固定 `client_id`；未来 isbn13 型 provider 仅发 ISBN），**不发送**借阅记录、barcode、个人偏好或本地库内容。
- 不持久化接口原始响应：抓取结果只以会话内建议改动存在，落库的只有**用户确认后**的实体字段与补全状态。
- 补全为用户显式触发（详情页单条按钮），不做静默后台洪水请求（单请求超时/重试 §7）；抓取仅产出建议，不静默改库。

## 10. UI 设计说明（统一 UI 里程碑；依赖 book-editing 编辑表单）

- **书目详情页（补全唯一入口）**：含有效 `lookupKey` 的 CatalogRecord 显示「从 {provider.displayName} 补全」Button；点击 → 按钮 loading →
  - 成功：context 存入详情页组件态（§7.3）并自动打开编辑 Dialog（`search.edit=true`）；
  - `not_found` / `failed`：toast 提示（「馆内未找到该编目」/ 失败降级文案），状态已回写，**不打开 Dialog**。
- **翻页导航（「‹ 上一个 / 下一个 ›」，逐本工作流核心）**：
  - 详情页头部动作区（「编辑」旁）放「‹ 上一个 / 下一个 ›」按钮对（outline，编目终端气质）；边界禁用。
  - **顺序 = 书库列表当前视图**：详情页 `search` 扩展列表视图参数（`q`/`source`/`status`/`sort`/`dir`，与 [library/index.tsx 现有 search schema](ui-navigation.md) 同构）；列表行链接**携带当前筛选/排序**（`search={{ ...视图参数 }}`），从列表点进详情页后，翻页沿同一过滤/排序管线找相邻行——「继续处理我筛选出来的这批书」。直接 URL 打开（无参数）→ 全库默认视图（title asc）。
  - 派生逻辑抽公共模块 `src/lib/library-view.ts`（列表页与详情页共用，避免两处排序/过滤实现漂移）。
  - 翻页导航**不带 `edit=true`**（未保存的 Dialog 编辑随翻页放弃，与「点列表另一本书」一致）；翻页即显式离开当前书上下文，context 随组件卸载丢弃（§7.3）。
- **编辑 Dialog（复用 [book-editing §3](book-editing.md#3-编辑表单-ui-规格详情页-dialog) 表单）**：
  - **建议值入框**：表单初始 state = 现有值 ∪ `prefillFromChanges` 建议（§5.3）——fill 与 conflict 字段的输入框都直接呈现建议值，用户当场审视替换或保留。
  - **现有值对照**（conflict 字段，核心形态）：字段标签与输入框之间显示「现有：{current}」对照文字（低对比/删除线样式；长文本 `line-clamp` 截断 + 悬停 title 全文；数组字段以顿号分隔串回显）；输入框旁「恢复现有值」按钮——输入框值 ≠ 初始现有值时自动出现，点击回退初始值并隐藏。恢复后该字段等同「拒绝采纳」，其余字段不受影响。
  - **目标编目高亮**（多编目书的关键形态）：上下文指向的 CatalogRecord 卡加主色边框 + 「{provider.shortName} 补全目标」徽标——明确「这次建议作用于哪条编目」，保存只写该编目 `opacEnrichment`（其余编目不受影响）；Dialog 顶部提示「保存后仅标记 {来源} 编目为已补全」。
  - **provider 溯源徽标**：建议字段追加「{provider.shortName} OPAC」徽标（outline）；conflict 徽标警示色、fill 常规色，一眼区分「有旧值可对照」与「纯新增」——多来源建议可溯源；同书两条编目对同字段给出不同建议时按**顺序裁决**：先保存者成为后保存者的「现有：…」（对照文本即裁决现场）。
  - **摘要条**：Dialog 顶部一行「{provider.displayName} 建议：已填 N 项，M 项与现有不同」——全局兜底审视；逐条细节内联在字段，**不设独立建议面板**（同一信息只维护一处）。
  - **空值边界**：用户清空某字段保存 = 清空该字段（与普通编辑一致，`'' → null`）；「恢复现有值」可随时还原。
  - 保存流程与普通编辑完全一致（book-editing §3.4：前端校验、ISBN 冲突预检——conflict 预填的建议 ISBN 若被他书占用，保存时 `IsbnConflictError` 内联报错、整体回滚、状态不写；单事务保存 + enrichment 载荷）；取消不写任何状态（context 保留组件态，§7.3）。
  - **交互范式依据**（优秀设计检索，2026-08）：旧值就近低对比展示 + 变更字段自动出现 revert 按钮（[UX StackExchange 108938](https://ux.stackexchange.com/questions/108938/what-is-the-best-ui-for-overwriting-previously-saved-values) 高赞共识：字段直接可编辑、不搞双列布局、变更即出现还原）；建议内联、一键接受/拒绝（Google Docs / Word 修订「建议模式」）；源文/译文逐段对照审校（CAT 编辑器逐段接受机器翻译建议）；相邻记录翻页逐条处理（图书馆编目员逐条 MARC 工作流、邮件收件箱「上一条/下一条」）。
- **书库列表 / 导入完成页：无批量补全入口**（§1 定案）。列表行链接带视图参数供详情页翻页延续；「待完善」标记/筛选/徽标（book-editing §5）不变。
- **常驻外链**：详情页「在 {provider.displayName} 查看」新标签链接（provider `detailUrl`，降级与溯源）。
- 文案走 `t()`（[i18n-conventions](../i18n-conventions.md)），namespace `enrich.*`（字段标签复用 `edit.*` 键）。

### 10.1 存档：被否决的批量方案

| 方案 | 否决原因 |
|------|---------|
| 全量批量（按 provider 分组按钮 + 会话面板） | 结果互相覆盖、不区分来源；批量后单条编辑返回丢面板；**更根本：列表行 = Book（可含多来源多编目），批量抓取在编目粒度上无从表达**，需勾选校验/来源分组/目标编目识别整套兜复杂度 |
| 列表勾选驱动（Gmail 批量条：勾选书目才出现「从 OPAC 补全」+ 跨来源阻止提示） | 缓解而非根治：仍需跨来源校验与编目粒度映射；勾选态为瞬态，触发后结果仍落入批量面板，面板生命周期问题依旧；「减少抓取量」收益在详情页逐本工作流下天然获得（一次只抓一本的当前编目） |
| 会话 store + sessionStorage 持久化 | 为「批量结果面板跨页保留」服务；批量入口删除后无需求，组件态已覆盖单条场景，引入 store 是过度设计 |

**定案（2026-08-13 用户）：详情页逐本工作流**——补全入口收敛到详情页单条（来源隔离天然成立），翻页按钮解决逐本处理的导航成本，编辑 Dialog 同页；复杂度整体消失。

## 11. 用户故事与验收用例

1. 详情页某编目卡「从 {provider.displayName} 补全」→ 抓取成功 → 编辑 Dialog 自动打开：空字段已预填、非空差异字段预填建议值并对照显示现有值（title/authors/publisher/pages/price/subjects/coverUrl + classifications）→ 保存 → Book 落库、CatalogRecord 补 classifications、`opacEnrichment.status='fetched'` + `providerId='szlib'`、`sourceUrl` 正确。
2. 已应用记录再次触发（单条）→ 跳过（幂等，不重复请求；按钮隐藏）。
3. metaid 无效（§3.4）→ `status='not_found'` 立即回写，实体零改动，不打开 Dialog，UI 提示「馆内未找到该编目」。
4. 占位（选书帮）记录 → 不在候选集；UI 置灰并说明。
5. 现有字段非空且与 OPAC 不同（如导入 ISBN 与 OPAC ISBN 不一致）→ 输入框预填建议值，标签与输入框之间对照显示「现有：…」；直接保存 → 建议值覆盖（采纳）；「恢复现有值」后保存 → 旧值保留（拒绝采纳）；两种情形都写 `status='fetched'`（已审视即已确认，避免反复抓取）。
6. 抓取成功但用户取消 Dialog → 实体与状态零改动，**context 保留在详情页组件态**——重开该书编辑仍带建议（不重新抓取）；「重新抓取」按钮覆盖建议后仍是建议值入框。
7. 用户在预填基础上修改任意值再保存 → 以表单当前输入为准（表单即最终裁决）。
8. conflict 字段用户手改第三值（非建议值、非旧值）后保存 → 以手改值为准（表单即最终裁决）；「恢复现有值」可回退后再次手改。
9. CORS 拦截环境 → 补全失败提示 + 外链降级可用；`pnpm dev` 代理环境补全成功。
10. 无 provider 注册的来源（manual / Libby）→ 详情页不出现补全按钮；`getProvider` 返回 null 不报错。
11. （扩展）接入 isbn13 型 provider（如 OpenLibrary）→ 无 metaId 但有 ISBN 的记录出现补全按钮，补全流程与 szlib 完全同构（同表单、同对照、同状态机）。
12. **翻页逐本工作流**：书库列表按「来源=深图、最近借阅降序」筛选 → 点进某书 → 头部「下一个」→ 沿同一视图顺序到相邻书（筛选/排序上下文延续，URL 带视图参数）；首本「上一个」、末本「下一个」禁用；直接 URL 打开详情页（无视图参数）→ 全库默认排序翻页。
13. 翻页时编辑 Dialog 打开（`edit=true`）→ 点「下一个」→ 导航不带 `edit`（Dialog 关闭，未保存编辑放弃）；新书 context 为空 → 编辑为普通表单。
14. **书库列表无任何批量补全入口**（无按钮/无勾选）；导入完成页同样无补全入口——补全只能经详情页单条触发。
15. **多编目书**（同书深图 + 广图两条编目）：每条编目卡各自「从 {provider.displayName} 补全」按钮，独立抓取互不干扰；从深图编目补全 → Dialog 中该编目卡主色边框高亮 + 「深图 补全目标」徽标，广图编目卡无标记；保存只写深图编目 `opacEnrichment`。
16. 同书两条编目对同字段给出不同建议（跨来源建议冲突）→ **顺序裁决**：先保存者成为后保存者的「现有：…」对照；字段徽标带 provider 短名（`{shortName} OPAC`）可溯源。
17. 详情页刷新 → context 丢失（组件态，不落 URL/库）→ 重新点补全即可（一次请求成本）。

## 12. 测试清单（Vitest，mock fetch，夹具脱敏自 §3.3 实测样本）

**`src/enrich/opac-provider.test.ts`**
- 注册表：`getProvider('szlib')` 命中；未注册 id（如 'libby'、'manual'）→ `null` 不抛。
- `szlibProvider` 契约：`id='szlib'`、`lookupKey='metaId'`、`detailUrl` 含 metaid、`shortName` 非空（徽标用）。

**`src/enrich/providers/szlib/detail.test.ts`**
- 实测样本 JSON → 统一 `OpacDetail` 结构化正确（title/author/publish/page/price/subject/classno/isbn/img 映射，空串 → null）。
- 空负载（title/isbn 空 + `districtList: []`）→ `{ ok: false, reason: 'not_found' }`。
- 非法 JSON → `{ ok: false, reason: 'parse_error' }`，不抛。
- 防御转换：`abstracts` 数组按 `\n` join；缺失字段 → null。
- 确定性：同输入两次调用深等价。

**`src/lib/opac-mapping.test.ts`**（输入统一 `OpacDetail`，用 szlib 样本构造夹具）
- 全空 Book → 各字段产出 `kind='fill'` change，`proposed` 与 §5.2 解析一致（`title`/`author` 分隔符归一化后 parseTitle 产出与 [import-pipeline §13](import-pipeline.md#13-书目标题结构化解析) 样本一致：`合成绘本甲=Synthetic story` → title/parallelTitles；`(日)合成作者著 　合成译者译` → authors/translators）。
- 字段非空且值相同 → 不产出 change（isbn 归一化后相同亦不产出）。
- 字段非空且值不同（isbn 冲突、title 差异、pages 差异、subjects 集合差异）→ `kind='conflict'`，current/proposed 正确。
- `classno` 去 `(...)` 后缀；`classifications.system` 取来源 `classificationSystem` 缺省 `'clc'`；同 code+system 已有 → 不产出；不同 → fill（追加）。
- `publish` 解析：`北京:合成出版社,2023` → publisher/publishDate fill；不可解析 → warning + 无对应 change。
- `OpacDetail` 字段为 null → 对应字段不产出 change（来源无关性：缺字段的 provider 不产生建议）。
- 占位 Book 不入候选（与 §7.1 组合测试）。
- 确定性：同输入两次调用深等价。

**`prefillFromChanges`（opac-mapping.test.ts 内）**
- fill **与 conflict** 的建议值全部落入 bookPrefill / recordPrefill（classifications = 现有 ∪ 建议去重）；`applied` 含两者；kind 由 changes 保留供 UI 对照。

**`src/enrich/enrich-service.test.ts`（UI 里程碑补）**
- 候选判定（provider 感知：无 provider 来源排除；metaId 空/0 排除；isbn13 键 provider 按 Book.isbn13 过滤；已 fetched 排除；占位排除）；单条抓取：超时/网络错误 → `failed` 回写（含 providerId）且实体不变；重试退避；not_found 回写；成功产出 context（changes/warnings/sourceUrl）且**零实体写入、零状态写入**；幂等跳过（fetched 记录不触发）。批量编排与候选集聚合函数已删除（无测试）。

**`src/lib/library-view.test.ts`（新增，§10 翻页）**
- 视图派生与列表页过滤/排序等价（同一输入同序）；翻页相邻计算：首/末边界（prev/next 为 null）；携带视图参数（q/source/status/sort/dir）与缺省（全库 title asc）顺序正确；`edit` 参数不影响相邻计算。

**`src/routes/library/-edit-actions.test.ts`（增量）**
- `updateBookWithRecords` 带 enrichment 载荷 → 同事务写 `opacEnrichment`（providerId/status/fetchedAt/sourceUrl）；不带载荷 → 不触碰该字段；Zod 非法回滚时状态一并回滚（不残留）。

**`src/routes/library/-edit-dialog.test.tsx`（增量）**
- 带建议改动上下文打开 → fill 与 conflict 字段均预填建议值；conflict 字段渲染「现有：…」对照文字 + 警示徽标；「恢复现有值」回退初始值且按钮隐藏、再次手改后按钮复现；摘要条计数正确（N 已填 / M 冲突）；**目标编目卡高亮 + provider 徽标（shortName）；摘要条带 provider.displayName**；取消不触发保存、不写状态。

**`src/routes/library/$bookId.test.tsx`（增量）**
- 单条抓取成功 → context 入组件态并自动打开编辑 Dialog（`edit=true`）；取消后重开编辑仍带建议（不重新抓取）；「重新抓取」覆盖 context 后仍建议值入框；刷新/翻页后 context 为空（普通编辑）；**翻页**：视图参数延续、相邻书正确、边界禁用、导航不带 `edit`。

**`src/routes/library/index.test.tsx`（增量）**
- 列表无批量补全入口（无按钮/无勾选）；行链接带当前视图 search 参数（q/source/status/sort/dir + 可选 edit）。

## 13. React 性能规则引用

- 抓取为异步 I/O + 轻量纯函数映射（provider 解析 / `mapOpacDetail`），不阻塞主线程，无需 Worker（对照 [design-decisions 并发与性能](../design-decisions.md)）。
- 翻页派生复用列表页 `library-view.ts` 内存管线（books/catalogRecords/borrowCycles/sources 已全量加载），无新增查询；详情页翻页仅多一次全量派生，量级与列表页一致。
- 无批量面板/会话 store（已删除），无跨页订阅与 storage 写入负担。
- `bundle-barrel-imports`：详情页组件按需 import，避免 barrel 拉体积。
