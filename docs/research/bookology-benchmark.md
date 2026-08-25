# Bookology 竞品调研与借鉴分析

> 调研日期：2026-08-22。对象：[Bookology: Book Tracker](https://bookology.app/)（iOS，开发者 Empty Studio）。
> 证据来源：App Store 元数据（iTunes lookup API, id 6747273681）、官网 bookology.app、App Store 官方截图（10 张 iPhone + 6 张 iPad）、官网宣传图（Track/Organize/Timer/Stats/Goals 五张）、App Store 评价摘录（搜索快照）、开发者 r/iosapps 发帖摘要（搜索快照，原帖 403 无法直读）。
> 本文是**调研文档，不是功能规格**；落地任何借鉴点前须按 SDD + TDD 流程先补 [specs/](./specs/) 对应章节。

## 1. 产品概览

| 项 | 事实 |
|----|------|
| 名称 / 开发者 | Bookology: Book Tracker / Empty Studio（[App Store](https://apps.apple.com/us/app/bookology-book-tracker/id6747273681)） |
| 平台 / 形态 | iOS 17+，iPhone/iPad 通用，免费 + Bookology Pro 订阅（IAP） |
| 版本节奏 | 首发 2025-07-11；当前 1.12.3（2026-08-07）；约 1 月 1 版 |
| 评分 / 量级 | 4.77★（549 条）；宣传口径「200K+ reading sessions」「5M+ views on TikTok」（截图文案） |
| 语言 | EN / ZH（简体） |
| 定位 | 「All your books. All your notes. One place.」「The book tracker built for lifelong readers.」 |

**商业模式**：免费核心 + Pro 订阅（云端备份/跨设备同步、无限书单、高级统计与历史数据、无限阅读会话记录、书架装饰、Goodreads 导入）。

**核心循环与 ReadGraph 的根本差异**：Bookology 是**手动录入 + 阅读会话计时**的习惯养成工具（扫码/搜索/手动建书 → 计时器记每次阅读 → 会话数据驱动统计/连击/目标）；ReadGraph 是**导入驱动 + 借阅周期**的阅读档案系统（图书馆导出 → 借还配对 → 借阅周期驱动画像）。两者的「时间」语义不同——Bookology 的统计主体是**阅读时长/会话**（`Reading time 6h23m`），ReadGraph 的统计主体是**借阅周期**（时长分布、借阅量）。借鉴时须始终以「我们能从 BorrowCycle 派生什么」为界，不能照搬其会话模型。

## 2. 功能清单（App Store 描述 + 截图）

1. **书库管理**：扫码添加、在线搜索、手动录入；阅读状态（想读/在读/读完/弃读/搁置）；自定义书单；分类与丛书管理。
2. **可视化书架**：拟物书架（书脊/封面两种模式）、装饰摆件自定义、书架云同步。
3. **阅读计时器**：会话自动落日志；Live Activities 锁屏实时；开始/暂停/继续；**文学钟**（按当前时刻显示文学作品摘句）；倒计时聚焦。
4. **进度追踪**：按页数或百分比记进度；**阅读日历**。
5. **笔记与回顾**：摘句/想法；图片与导出；书评打分；**每日笔记回顾**（按日精选历史笔记）。
6. **多平台导入**：Kindle / Apple Books / 微信读书 / DiMo Reader 笔记导入；Goodreads 书库导入（Pro）；自动去重。
7. **统计洞察**：阅读时长与会话模式；载体（纸书/电子/有声）；月度/年度总结；**年度书单展示**；最常读统计。
8. **Widgets**：主屏进度 widget、阅读连击 widget。

## 3. 界面与数据可视化观察（截图证据）

官网宣传图按五大支柱展开：**Track / Organize / Timer / Stats / Goals**。

- **Track（Reading 页）**：当前在读书横向轮播（封面 + 题名/作者 + 进度 `121/416`），主按钮「Start timer」（黄底药丸）+ 次按钮「Book details」；底部 4 tab（Reading/Bookshelf/Stats/Settings）。新版本截图显示 5 tab（Reading/Library/Notes/Stats/Settings），并出现「Timer running」进行态按钮。
- **Organize（书架）**：集合视图（如「Best Books About Design / 7 books」）方形封面列表；拟物书脊书架（「2026 Finished / 97 books」，3D 书脊 + 古典胸像摆件，金色点缀，黑底）。按「年份 + 状态」命名书架是其主要组织方式。
- **Timer**：全屏计时器 `00:00:25` + 书名标签，X/✓ 收尾，底部 笔记/暂停 圆钮；背景为当前书封面高斯模糊（文案「Every minute adds up.」）。
- **Stats**：**月历热力图，每天一格填当天在读的书的封面**；All/Month/Year 分段；汇总卡「Reading time 6h23m」「Read days 30」。
- **Goals**：年度目标数字步进器（「12 books」）；「Finished books / 6 books to go」封面网格，未达标槽位用**编号占位**（7、8、9…）。
- **Notes**：摘句 + 想法 + 页码 + 章节 + 「Scan text」（OCR 扫描）表单；可从正文选区一键 Insert（文案「Save highlights in seconds.」）。

**已知痛点**（App Store 评价摘录）：「the lack of filtering/search features for the library」——书库缺少筛选/搜索。这一点 ReadGraph 已领先：书库筛选/排序状态 URL 化（`q/source/status/sort/dir`，见 [ui-navigation §3](./specs/ui-navigation.md#3-各功能页布局与空状态)），正好印证本项目书库规格方向。

## 4. 与 ReadGraph 定位对照

| 维度 | Bookology | ReadGraph |
|------|-----------|-----------|
| 数据来源 | 手动录入为主 + 平台笔记导入 | 图书馆/Libby 导出文件导入 |
| 核心数据 | 阅读会话（时长）、进度、笔记 | BorrowCycle（借还配对） |
| 组织方式 | 自定义书单 + 书架 + 阅读状态 | 物理副本 × 书目合并 × 多分类法（CLC/DDC） |
| 统计口径 | 阅读时长、连击、读完数 | 借阅量、借阅时长、分类分布、馆藏价值 |
| 目标能力 | 年度/月度目标（本数/页数/时长/天数/连击） | 未实现（design-decisions 已列「阅读目标」为未来扩展） |
| 笔记 | 摘句/想法/OCR/每日回顾 | 未实现（design-decisions 已列「阅读笔记/批注」为未来扩展） |
| 平台约束 | 云同步 + 订阅（有后端） | 纯前端零后端（[design-decisions §核心原则 1](../design-decisions.md)） |

## 5. 可借鉴点（按优先级）

> 原则：只借鉴「能由现有实体（Book/CatalogRecord/BorrowCycle）纯函数派生的呈现与交互」，不引入新实体、不引入新依赖、不破坏方向 A 编目终端 / 方向 B 阅读图谱的视觉语言。

### P0 直接可落地（落在现有 /profile 只读画像架构内，零新实体）

**5.1 借阅日历热力图（对应 Bookology Stats 月历）** — ✅ 已落地（2026-08-22）
- 借鉴点：月历格 = 当天有「在借」的书的封面（Bookology 用封面填充每天）；All/Month/Year 分段切换；汇总卡「借阅天数」。
- ReadGraph 映射：日历格 = 当天 `BorrowCycle` 处于在借期（`[borrowedAt, returnedAt)` 与该 UTC 日相交）的独立 Book 计数；汇总卡「借阅天数」= 有在借周期的去重 UTC 天数（含设备排除）。详见 [reading-profile §2.6](./specs/reading-profile.md)（聚合契约）、§4（UI）、§6/§7（验收与测试）。
- 落地形态：/profile 第 6 个图表 tab「借阅日历」，概览行第 5 卡「借阅天数」；聚合契约 `computeProfileStats` 新增 `calendar` 维度（纯函数、UTC 桶、深等价、复用 Worker 阈值与空态退化）。
- 实现选择：ECharts `heatmap` series（GitHub 贡献图式年网格 + 月网格；格色 = `--chart-2` 松叶色按在借数分阶；tooltip 列书名与封面缩略图），零新依赖。
- 语义边界：Bookology 的日历是「读过/在读」的**阅读行为**日历；ReadGraph 只有**借阅周期**，日历是「手上有书」的借阅日历——文案一律「借阅」口径（`profile.calendar.*`/`profile.summary.borrowDays`），避免误导。

**5.2 年度阅读目标（对应 Bookology Goals）**
- 借鉴点：年度目标数字步进器 + 「已完成 N 本，还差 M 本」+ 完成书封面网格，未达标槽位编号占位。
- ReadGraph 映射：目标维度只支持「**年内读完/借阅的独立 Book 数**」（`borrowedAt ∈ 本年` 的去重 Book 计数，语义随数据而定，须在规格中定死）。Bookology 支持的本数/页数/时长/天数/连击目标中，**页数/时长/连击无数据支撑，明确不支持**（见 §6 边界）。
- 落地形态：/profile 概览行新增「年度目标」窄卡片（进度 + 差量）；目标值落 `readgraph:preferences`（`UserPreferences` schema 需增量扩展，见 [data-layer §8 用户偏好](./specs/data-layer.md#8-用户偏好)，走设置页编辑）；进度由纯函数从 BorrowCycle 派生。
- 交互参考：Bookology 的「编号占位」完成网格（第 7、8 本…灰色占位）适合画报式年度回顾页，作为卡片微缩版即可，不必照搬大网格。
**承接状态（2026-08-25）**：口径已由 [reading-profile §2.7 年度切片契约](../specs/reading-profile.md#2-统计维度与聚合契约) 承接（本书 §6 语义边界决策：年内曾借出、UTC 左闭右开、设备排除、独立 Book 去重、进度 = `yearSlice.bookCount`）；目标卡为纯本地功能（不依赖 AI），排期独立；UI 落点 = 年度视图静态骨架（[ai-features §9.1](../specs/ai-features.md)）。

**5.3 年度回顾方向（对应 Bookology「Annual book showcase」/「2026 Finished」书架）**
- 借鉴点：按年组织「今年借过的书」+ 最常读排行；Bookology 的「年份 + 状态」命名书架是低成本高感知的组织模式。
- ReadGraph 映射：/profile 时间范围已有年粒度（[reading-profile §2.3](./specs/reading-profile.md) 数据跨度 > 2 年自动切年）；「年度回顾」= 年粒度借阅量的叙事化呈现（年度书单、最常借 Top N）。与 design-decisions 未来扩展「社交分享——阅读报告图片（纯前端 Canvas）」衔接，先做页内呈现、分享图留待扩展。
**承接状态（2026-08-25）**：方向已承接为年度视图 `/profile/$year`（新路由）静态骨架 + AI 叙事区（[ai-features §9.1](../specs/ai-features.md)、[ui-navigation §2 路由预留](../specs/ui-navigation.md#2-路由树)）；页内呈现先行，分享图仍留扩展。

### P1 记录为未来扩展参考（不进入 v1 规格）

**5.4 笔记模型（对应 Bookology Notes）**
- 借鉴点：笔记 = 摘句 + 想法 + 页码 + 章节 + 来源书页选区，支持图片与导出；「每日笔记回顾」是差异化亮点。
- 落点：design-decisions 已列「阅读笔记/批注」未来扩展；本文档记录 Bookology 的表单字段模型与「每日回顾」交互，作为未来 notes 规格的外部参考。v1 不动。

**5.5 自定义书单（对应 Bookology custom booklists）**
- 落点：design-decisions 未来扩展无此项；自定义书单是「手动组织」概念，与导入档案定位兼容度中等，需新实体（书单 + 成员关系）。记录为候选，不立项。

### P2 明确不借鉴（附原因，防止未来重复评估）

| 项 | 不借鉴原因 |
|----|-----------|
| 阅读计时器/会话记录 | 需新实体 + 手动补录 UI，与「导入档案」定位冲突；借阅数据无法派生阅读时长（[app-spec §1.2](../app-spec.md) 非目标） |
| 拟物书架/装饰/文学钟 | 与方向 A「编目终端」密实克制气质、零阴影直角语言冲突（[design-decisions UI 设计方向](../design-decisions.md)）；纯装饰无数据价值 |
| 云端同步 / 订阅 | 违反纯前端零后端核心约束（design-decisions §核心原则 1） |
| Widgets / Live Activities | iOS 原生能力，Web v1 不可用；PWA 仅预留（[ui-navigation §6](./specs/ui-navigation.md#6-数据契约与边界)） |
| 手动阅读状态（想读/在读/读完…） | 借阅档案无「想读」数据；引入即新增人工维护面，v1 非目标 |
| 阅读平台笔记导入（Kindle/微信读书等） | 纯阅读平台（无借还）不在系统范围（design-decisions §5 约束），与现有 SourceParser 架构边界冲突 |

## 6. 目标口径的语义边界（落规格前必须定死）

> **状态（2026-08-25）**：本节语义边界已由 [reading-profile §2.7 年度切片契约](../specs/reading-profile.md#2-统计维度与聚合契约) 承接（含「年内曾借出」推荐决策），落地以该契约为准，本节保留为决策依据记录。

Bookology 目标口径是**阅读行为**（读了多少页/分钟）；ReadGraph 能提供的只有**借阅行为**。若做年度目标，必须在 [specs/reading-profile.md] 规格中明确：

1. 「年内完成」定义：`borrowedAt ∈ [本年 1 月 1 日, 下年 1 月 1 日)`（UTC，左闭右开）且 `status='returned'` 的**独立 Book** 计数？还是含在借？——推荐取「年内曾借出的独立 Book 数」（与 `borrowedValue` 口径一致，见 [reading-profile §2.5](./specs/reading-profile.md)），避免依赖归还状态引入语义抖动。
2. 设备书（`materialType='device'`）一律排除（复用 §2.0 排除总则）。
3. 目标值持久化扩展 `UserPreferences`（Zod schema + 迁移，[data-layer §8](./specs/data-layer.md#8-用户偏好)），非法值降级同现有 locale 处理。
4. 不引入新依赖：日历用 ECharts heatmap 或 CSS grid，目标卡为纯文本/网格，均无新包。

## 7. 结论

可直接借鉴 3 条，全部落在现有「只读画像页」架构内、零新实体、零新依赖：

1. **借阅日历热力图**（月历格 = 在借书封面，All/Month/Year，借阅天数汇总）→ /profile 新增 tab。✅ 已落地（2026-08-22，[reading-profile §2.6](../specs/reading-profile.md)）。
2. **年度目标卡片**（目标 = 年内借出的独立 Book 数，进度 + 差量，值落 UserPreferences）→ 概览行。✅ 口径已承接（2026-08-25，[reading-profile §2.7 年度切片](../specs/reading-profile.md#2-统计维度与聚合契约)），纯本地功能、排期独立。
3. **年度回顾方向**（按年组织 + 最常读，衔接未来阅读报告分享）→ 年度视图（`/profile/$year`）静态骨架 + AI 叙事区（[ai-features §9.1](../specs/ai-features.md)）。

其余（笔记模型、自定义书单）记录为未来扩展外部参考；计时器、拟物书架、云同步、widgets、手动状态明确不借鉴。Bookology 的书库缺筛选搜索恰为 ReadGraph 已有优势（URL 化筛选/排序），调研结论与现有规格方向互相印证。

落地任何一条前，先按 SDD + TDD 补 [reading-profile.md](./specs/reading-profile.md)（或独立新规格）对应章节：用户故事、聚合契约、测试清单。
