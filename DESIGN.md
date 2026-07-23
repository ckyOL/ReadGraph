# DESIGN.md — ReadGraph

> ReadGraph 是一款纯前端个人阅读档案：从图书馆、Libby 等来源导入 JSON/CSV 借阅数据，在浏览器内生成书目、编目记录与借阅周期，并可视化阅读画像。
> 本设计文档以 `awesome-design-md-jp` 中 **代官山 蔦屋書店（Daikanyama T-SITE）** 为主要气质参考，辅以中川政七商店、&Premium、Casa BRUTUS 的 CJK 排版与纸墨感；`awesome-design-md` 仅作为 DESIGN.md 结构参考。色号来自《日本传统色辞典》（[日本の伝統色 和名カラー辞典](https://www.benricho.org/colors/color-wamei/)）。

---

## 1. 视觉主题与氛围

- **设计方向**：书库终端（Library OPAC Terminal）+ 阅读图谱。
- **密度**：中高。书库、时间线、导入向导以表格/列表为主，可排序、可筛选；阅读画像页以图表为主。
- **关键词**：蔦屋書店、手工纸、编目卡、书库终端、数据密集、可扫读、无阴影、完全直角、瑠璃紺、白群、CJK 留白。
- **主要参考**：
  - **主气质**：代官山 蔦屋書店 — 书店/文化复合、 craft paper 米色背景、完全直角、无阴影、信息密度。
  - **纸墨/和风**：中川政七商店 — 和纸余白、游ゴシック正文 + 明朝展示标题、灰阶。
  - **CJK 排版**：&Premium — 杂志式 line-height 1.7–1.8、轻字重（300）、欧文先头字体栈。（其正文 letter-spacing 实为 normal，宽松感来自行高与字重；其全局 palt 手法本项目不采用。）
  - **对比/组件**：Casa BRUTUS — 白地 + 1px 细罫线的 square outline CTA、欧文先头字体栈、彻底扁平。（其本体实为纯白×纯黑；本项目采用纸白×铁黑是自主决策，贴近蔦屋 craft paper 方向。）
- **氛围**：安静、克制、工作向。让书籍本身成为主角，UI 退居背景。

---

## 2. 配色与角色

所有颜色均通过 shadcn/ui CSS 变量提供，Tailwind v4 通过 `@theme inline` 引用。禁止在组件中手写 `dark:` 覆盖。

### 2.1 品牌/主色

| 令牌 | 亮色模式 | 暗色模式 | 色名 |
|-------|----------|----------|------|
| `--primary` | `#27477A` | `#73B3C1` | 瑠璃紺 / 白群 |
| `--primary-foreground` | `#FFFFFF` | `#1F1F1D` | — |
| `--selection` | `rgba(39,71,122,0.18)` | `rgba(115,179,193,0.28)` | 瑠璃紺 18% / 白群 28% |

- `#27477A`（瑠璃紺）让人联想到图书馆书脊与蓝染，沉稳且具书卷气。
- 暗色模式下切换为 `#73B3C1`（白群），保证暖黑底上的可读性。
- `::selection` 使用主色低透明度面，不用系统默认蓝。

### 2.2 背景/纸面

| 令牌 | 亮色 | 暗色 | 色名 |
|-------|------|------|------|
| `--background` | `#F9F7F2` | `#1F1F1D` | 生成纸白 / 暖黑 |
| `--card` | `#FFFFFF` | `#2A2A2A` | 白 / 铁黑 |
| `--popover` | `#FFFFFF` | `#2A2A2A` | — |
| `--secondary` | `#F0EDE5` | `#343434` | 浅生成 / 墨 |
| `--muted` | `#EAE0D5` | `#343434` | 生成 / 墨 |
| `--input` | `#FFFFFF` | `#2A2A2A` | — |
| `--border` | `#E8E4DC` | `#3A3A38` | — |
| `--overlay` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.6)` | 模态/抽屉遮罩 |

- 背景采用接近蔦屋書店 `#f6f6f3` 但稍暖的 `#F9F7F2`（生成纸白）。
- 暗色背景不用冷纯黑，而用 `#1F1F1D`（暖黑）。

### 2.3 文字

| 令牌 | 亮色 | 暗色 | 色名 |
|-------|------|------|------|
| `--foreground` | `#2A2A2A` | `#F0EDE5` | 铁黑 / 暖白 |
| `--card-foreground` | `#2A2A2A` | `#F0EDE5` | — |
| `--muted-foreground` | `#666F68` | `#A99F96` | 深利休鼠 / 浅茶鼠 |

- 文字不用纯黑 `#000000`，而用 `#2A2A2A`（铁黑），更贴合纸面。
- `#666F68` 在 `#F9F7F2` 上对比度 4.86:1，满足 WCAG AA 普通文字（原 `#6E7972` 仅 4.23:1，故加深，仍在利休鼠色域内）。

### 2.4 辅助/状态色

| 用途 | 亮色 | 暗色 | 色名 |
|------|------|------|------|
| 成功 / 二级强调 | `#61764B` | `#A9C087` | 松叶 / 若叶 |
| 信息 / 三级 | `#576D79` | `#8A9DA8` | 蓝鼠 / 提亮蓝鼠 |
| 破坏 / 错误 | `#AD3140` | `#D96A75` | 臙脂 / 浅臙脂 |

- 分类号芯片、来源徽章、状态标签等使用这些低饱和语义色，不抢主色。
- 亮色成功色取 `#61764B`：白字徽章对比度 5.0:1，满足 WCAG AA（原 `#687E52` 仅 4.47:1，仅降明度不改色相）。

### 2.5 图表色板

ECharts 薄适配层读取 `--chart-1..5` 与上述语义变量。

| 令牌 | 亮色 | 暗色 |
|-------|------|------|
| `--chart-1` | `#27477A` | `#73B3C1` |
| `--chart-2` | `#61764B` | `#A9C087` |
| `--chart-3` | `#576D79` | `#8A9DA8` |
| `--chart-4` | `#AD3140` | `#D96A75` |
| `--chart-5` | `#998D86` | `#B0A89E` |

> `--chart-3` 暗色 `#8A9DA8` 是 `#576D79`（蓝鼠）在暖黑底上的提亮近似；`--chart-5` 暗色 `#B0A89E` 是 `#998D86`（茶鼠）的提亮。

### 2.6 圆角

| 令牌 | 值 |
|-------|----|
| `--radius` | `0px`（完全直角，蔦屋書店式） |

---

## 3. 字体规则

### 3.1 字体栈

不加载网络字体，仅使用本地系统字体（符合隐私与离线可用原则）。

**无衬线（UI 主体、标题、正文）**

```css
font-family:
  ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI",
  "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
  "Noto Sans CJK SC", "Noto Sans SC",
  "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP",
  sans-serif;
```

- 欧文由开头的系统无衬线字体负责，和文自动回退到后面的 CJK 字体。
- 上表为中文优先顺序。`html[lang^="ja"]` 时必须切换为日语优先栈（和字与汉字骨格不同，不可仅靠回退顺序）：

```css
html[lang^="ja"] body {
  font-family:
    ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
    "Segoe UI",
    "Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP",
    "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
    "Noto Sans CJK SC",
    sans-serif;
}
```

**展示用明朝（书名、H1、编目卡标题）**

中川政七商店式的书体对比：正文/UI 用黑体，书名与展示标题用明朝，强化书卷气。仅限展示场景，禁止用于表单、表格、按钮。

```css
.font-display {
  font-family:
    "Songti SC", "Noto Serif CJK SC", "Noto Serif SC", "SimSun",
    "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP",
    serif;
  font-weight: 600;
}
```

- `html[lang^="ja"]` 时将 `"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP"` 提至栈首。

**等宽（编目卡数据）**

`metaId`、`barcode`、分类号、ISBN 等使用等宽字体。

```css
font-family:
  ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,
  "Liberation Mono",
  "Noto Sans Mono CJK SC", "Noto Sans Mono", monospace;
```

### 3.2 字号与字重

| 角色 | 字号 | 字重 | 行高 | 字间距 |
|------|------|------|------|--------|
| H1 | 24px | 700 | 1.3 | CJK 0.02em / 欧文 normal |
| H2 | 20px | 700 | 1.3 | CJK 0.02em / 欧文 normal |
| 展示标题（明朝 `.font-display`） | 同 H1/H2 | 600 | 1.4 | CJK 0.04em / 欧文 normal |
| 正文 | 14px | 400 | CJK 1.7 / 欧文 1.5 | CJK 0.02em / 欧文 normal |
| 标签 / 说明 | 12px | 500 | 1.4 | CJK 0.04em / 欧文 normal |
| 等宽代码 | 13px | 400 | 1.5 | normal |

- 正文基准不用蔦屋書店式的 10px，而采用 14px，兼顾工作向可读性。
- 标题与正文通过 700 vs 400 形成明确对比。

### 3.3 行高与字间距

- CJK 正文：`line-height: 1.7`、`letter-spacing: 0.02em`。
- 欧文正文：`line-height: 1.5`、`letter-spacing: normal`。
- 短 CJK 标签/按钮：`letter-spacing: 0.04em`（缓解拥挤）。
- 不全局使用 `palt`；仅在大标题尝试使用，且不支持时自动回退。

### 3.4 和欧混植（数值・记号的组法）

- **数字一律半角**：ISBN、分类号、日期、数量、价格均用半角数字，禁止全角数字。
- **日期格式**：表格内 ISO `YYYY-MM-DD`；详情/卡片用本地化长格式 `2026年5月8日`（ja 界面可附全角曜日：`2026年5月8日（金）`——半角数字 + 全角括弧，蔦屋書店式）。
- **表格数字列**加 `font-variant-numeric: tabular-nums`，保证等宽对齐。
- **CJK 与欧文/数字混排**：不加手工空格；渐进增强使用 `text-autospace: normal` 自动产生和欧间间隔，不支持时自然密排。
- **约物压缩**：不使用 `palt`；渐进增强使用 `text-spacing-trim: space-start`（行头约物半角化，无 `palt` 的字宽副作用）。
- **日文折行**：`html[lang^="ja"]` 可渐进增强 `word-break: auto-phrase`（短语级折行）。
- **纵书**：不使用，仅横排。

### 3.5 禁则与折行

```css
/* 正文 / 标题 */
overflow-wrap: break-word;
word-break: normal;
line-break: strict;

/* 长条码 / ID */
.break-code {
  word-break: break-all;
}
```

- 行头禁止：`）」』】〕〉》」】、。，．・：；？！`
- 行末禁止：`（「『【〔〈《「【`
- 行头小假名（ゃゅょっ等）与长音（ー）由 `line-break: strict` 依 JIS X 4051 自动处理，无需手工列表。

### 3.6 语言切换

```css
html[lang^="en"] body {
  line-height: 1.5;
  letter-spacing: normal;
}

html[lang^="zh"], html[lang^="ja"], html[lang^="ko"] body {
  line-height: 1.7;
  letter-spacing: 0.02em;
}
```

- 通过 `use-locale` 同步 `index.html` 的 `lang` 属性（已落地）。

---

## 4. 组件样式

### 4.1 按钮

**主按钮**
- 背景：`#27477A`（瑠璃紺） / 暗色：`#73B3C1`（白群）
- 文字：`#FFFFFF` / 暗色：`#1F1F1D`
- 圆角：0px
- 内边距：8px 16px
- 字号：14px / 字重 500

**次按钮**
- 背景：`#F0EDE5` / 暗色：`#343434`
- 文字：`#2A2A2A` / 暗色：`#F0EDE5`
- 圆角：0px

**幽灵/链接按钮**
- 背景：透明
- 文字：`#2A2A2A` / 暗色：`#F0EDE5`
- 悬停：下划线或背景 `#EAE0D5` / 暗色：`#343434`
- 圆角：0px

### 4.2 输入框

- 背景：`#FFFFFF` / 暗色：`#2A2A2A`
- 边框：1px solid `#E8E4DC` / 暗色：`#3A3A38`
- 圆角：0px
- 内边距：8px 12px
- 聚焦：边框 `#27477A` / 暗色：`#73B3C1`，ring 同色

### 4.3 卡片 / 表格

- 背景：`#FFFFFF` / 暗色：`#2A2A2A`
- 边框：1px solid `#E8E4DC` / 暗色：`#3A3A38`
- 圆角：0px
- 阴影：无
- 表头：背景 `#F0EDE5` / 暗色：`#343434`，底部边框 1px

### 4.4 徽章 / 芯片

- 分类号芯片：背景 `#EAE0D5`，文字 `#2A2A2A`，圆角 0px
- 来源徽章：背景 `#F0EDE5`，文字 `#576D79`
- 借阅中状态：背景 `#61764B`，文字 `#FFFFFF`
- 已归还状态：背景 `#6E7972`，文字 `#FFFFFF`
- 错误：背景 `#AD3140`，文字 `#FFFFFF`

### 4.5 交互状态

所有状态仅通过颜色/不透明度/边框变化表达，不使用阴影或动效。

- **聚焦（Focus）**：`outline: 2px solid var(--primary)`，`outline-offset: 1px`。
- **悬停（Hover）**：背景切换至 `--secondary`（亮色）/ `--muted`（暗色）；文字链接使用下划线。
- **选中（Selected）**：主色背景 + 主前景色，或 1px 主色边框。
- **禁用（Disabled）**：`opacity: 0.5`，`cursor: not-allowed`，不另改颜色。
- **加载（Loading）**：骨架屏使用 `--muted` / `--muted-foreground`，禁止动画渐变。

### 4.6 文本截断

- 书名：最多 2 行，超出用 `-webkit-line-clamp: 2` 省略。
- 作者、出版社、来源等单行元信息：1 行 `text-overflow: ellipsis`。
- 分类号、ISBN、条码：不截断，使用 `.break-code` 折行（见 3.5）。
- 省略处提供 `title` 属性或 Tooltip 显示全文。

---

## 5. 布局原则

### 5.1 应用外壳

- 左侧窄边栏 + 右侧主内容。
- 边栏宽度：240px（桌面）/ 移动端使用 Drawer。
- 边栏/顶栏分隔：`border-right: 1px solid #E8E4DC` / 暗色：`#3A3A38`。

### 5.2 容器与间距

- 最大宽度：1280px
- 水平内边距：16px（移动端）/ 32px（桌面）
- 间距体系：4 / 8 / 12 / 16 / 24 / 32 / 48 / 64 px

### 5.3 网格

- 书库表格：移动端 1 列、平板 2 列、桌面 4 列以上的卡片网格。
- 阅读画像：全幅图表 + 侧边统计卡片。
- 间距：16px 标准，24px 用于区块之间。

---

## 6. 层级与海拔

ReadGraph 以**完全扁平**为基础。与蔦屋書店、中川政七商店一致，不用阴影或圆角制造立体。

| 层级 | 表现 | 用途 |
|------|------|------|
| 0 | 背景色 + 1px 边框 | 绝大多数元素 |
| 1 | 面色差异（`#FFFFFF` vs `#F0EDE5` / `#2A2A2A` vs `#343434`） | 卡片/区块分离 |
| 2 | 反转面（主色背景 + 白文字） | 导航选中、强调带 |

- `box-shadow` 仅允许用于模态、抽屉、sticky 顶栏，且为 `0 1px 2px rgba(0,0,0,0.08)` 等极弱阴影。
- 边框为装饰性分隔，对背景对比度约 1.2:1，低于 WCAG 非文字元素 3:1 的建议值。组件识别不依赖边框（聚焦有 2px 主色 outline、输入框聚焦变色兼底），这是与蔦屋書店（`#dadada` 同样低对比）一致的有意取舍，勿当作缺陷“修正”。

---

## 7. 响应式

| 断点 | 宽度 | 行为 |
|------|------|------|
| 移动端 | ≤ 767px | 边栏变为 Drawer，表格横向滚动或紧凑显示 |
| 平板 | 768–1023px | 2 列网格，边栏可折叠 |
| 桌面 | ≥ 1024px | 固定边栏，展示完整功能 |

- 触摸目标最小：44px × 44px
- 移动端 H1 24px → 20px，正文 14px 保持不变。

---

## 8. 推荐与禁止

### 推荐

- 背景使用 `#F9F7F2`（生成纸白），暗色使用 `#1F1F1D`（暖黑）。避免纯白/纯黑。
- 仅使用单一主强调色 `#27477A`（瑠璃紺），暗色模式下切换为 `#73B3C1`（白群）。
- 所有面元素统一使用 `border-radius: 0px`。
- CJK 正文使用 `line-height: 1.7`、`letter-spacing: 0.02em`。
- 仅使用系统字体，不加载网络字体。
- 分类号、ISBN、条码使用等宽字体。
- 书名与展示标题使用明朝（`.font-display`），与黑体正文形成书体对比。
- 数字一律半角；表格数字列使用 `tabular-nums`。
- 影不用或极少使用，用面色与 1px 边框构建层级。
- 根据语言切换更新 `html[lang]`，应用 CJK 排版。
- 列表/表格优先支持扫读：用字号与字重区分书名、作者、日期、状态，不过度依赖颜色。
- 保持业务工具密度：8px 基础间距、44px 最小触摸目标、表单与表格严格对齐。

### 禁止

- 不使用 pill 型或大圆角按钮。
- 不使用多个高饱和品牌色。
- 不在组件内直接写 `dark:` 覆盖。
- 不全局对 CJK 正文使用 `palt`。
- 不强制折断长条码/ID 导致布局崩坏（使用 `break-all` 或 `overflow`）。
- 不装饰性使用渐变、霓虹、大阴影。
- 不使用大型营销式 hero 或装饰性插图，避免分散对书籍数据的注意力。
- 不在表单、表格、按钮中使用明朝体（`.font-display` 仅限书名/展示标题）。
- 不使用全角数字。
- 不依赖边框颜色传达可交互性（边框为装饰性分隔，见第 6 节）。

---

## 9. 给 AI 的速查

生成 ReadGraph 风格 UI 时，可输入以下关键信息：

```
Brand: ReadGraph（个人阅读档案 / 图书馆 OPAC 终端）
主参考：代官山 蔦屋書店（Daikanyama T-SITE）— 书店、craft paper、完全直角、无阴影
辅助参考：中川政七商店、&Premium、Casa BRUTUS

主色：#27477A（瑠璃紺） / 暗色 #73B3C1（白群）
背景：#F9F7F2 / 暗色 #1F1F1D
文字：#2A2A2A / 暗色 #F0EDE5
次级：#F0EDE5 / 暗色 #343434
弱化：#EAE0D5 / 暗色 #343434
强调：#61764B / 暗色 #A9C087
破坏：#AD3140 / 暗色 #D96A75
边框：#E8E4DC / 暗色 #3A3A38（装饰性分隔，不依赖其对比度）
遮罩：rgba(0,0,0,0.5) / 暗色 rgba(0,0,0,0.6)
选区：rgba(39,71,122,0.18) / 暗色 rgba(115,179,193,0.28)

圆角：0px
阴影：无（扁平设计）
正文：14px；CJK 行高 1.7、字间距 0.02em；欧文行高 1.5、字间距 normal
字体栈：system sans + PingFang SC / Hiragino Sans GB / Microsoft YaHei / Noto Sans CJK SC / Hiragino Kaku Gothic ProN / Yu Gothic
等宽：SF Mono / Menlo / Noto Sans Mono CJK SC
明朝（.font-display，仅书名/展示标题）：Songti SC / Noto Serif CJK SC / Hiragino Mincho ProN / Yu Mincho；ja 时和文明朝提至栈首
ja 时无衬线栈切换为 Hiragino Kaku Gothic ProN / Yu Gothic / Noto Sans JP 优先
不加载网络字体，不使用 dark: 覆盖，全部使用 CSS 变量。
Focus: 2px solid var(--primary) / outline-offset 1px
Hover: 背景 --secondary / --muted；链接下划线
Disabled: opacity 0.5
Touch target: min 44px × 44px
数字半角；表格数字 tabular-nums；书名 2 行 clamp，元信息 1 行省略
渐进增强：text-autospace / text-spacing-trim / ja 时 word-break: auto-phrase；不全局 palt
```
