# 年度分享图调研记录（阅读报告分享图 · 阶段 0 调研）

> 本文是「阅读报告分享图（纯前端 Canvas）」的**调研记录**，承接 [bookology-benchmark §5.3](./bookology-benchmark.md#53-年度回顾方向对应-bookology-annual-book-showcase-2026-finished-书架) 与
> [profile-annual-view-batch §E 后置阶段](../tasks/profile-annual-view-batch.md#e-后置阶段不在本批次)。
> 结论已裁定（2026-09-03）：**UI/UX 规格落 [reading-profile §4.1](../specs/reading-profile.md#41-年度分享图profileyear-新增)**；实现任务见 [annual-share-card-batch.md](../tasks/annual-share-card-batch.md)。
> 调研对象：音乐（Spotify Wrapped）、运动（Strava Year in Sport）、金融（Monzo Year in Monzo）、阅读垂类（Bookology 年度书架、微信读书/豆瓣年度报告）、纯前端图片生成技术（Canvas/html-to-image/html2canvas）。

## 1. 调研结论摘要

1. **分享欲来自「人格化」，不来自「数据全」**。Spotify Wrapped 的成功要素被归结为两条：个性化 + 可分享性（Shopify 案例分析）；Monzo 更极端——用户不愿分享裸的支出数字，但乐于分享「Social Butterfly Era」这类人格化标签。**年度报告分享图的主体不是数字堆叠，而是一个可以转述的自我形象**。
2. **一张卡片一个事实**。Wrapped 把年度拆成 bite-size 的视觉故事卡片流，每张卡片只承载一个洞察；分享场景里「一眼读完一个事实」远胜「一张图塞下全部统计」。
3. **封面/书脊是阅读垂类的视觉母语**。Bookology 的「2026 Finished」拟物书架、微信读书年度报告的书封墙、Bookology Goals 的编号占位网格——阅读类产品的年度分享几乎全部以封面/书脊为第一视觉元素，而不是图表。
4. **对照产生传播**。Strava Year in Sport 把个人数据放进社区分布里（你超过了多少跑者）；ReadGraph 无社区，可退化为**自我对照**（今年 vs 去年）或**绝对事实陈述**（borrowed 23 books）。
5. **隐私是本产品的分享前提**。ReadGraph 的立身之本是本地隐私（[design-decisions](../design-decisions.md) §核心原则 1）；分享图是「用户主动公开的出口」，设计必须让用户**显式选择**分享什么，且默认不携带任何可识别信息（无 cardno/条码/馆名；书目字段仅题名/作者/封面——与 AI 白名单同构）。

## 2. 调研记录

### 2.1 Spotify Wrapped（标杆参照）

**证据**：[Shopify 12 Creative Social Media Campaign Examples](https://www.shopify.com/in/blog/social-media-examples)（§1）、[Man of Many: Spotify Wrapped 2025](https://manofmany.com/entertainment/spotify-wrapped-2025-preview)、[DesignersForest: Why is Spotify Wrapped so popular](https://www.designersforest.com/why-is-spotify-wrapped-so-popular/)（UDG 心理学分析）。

- **成功归因**（Shopify）：「biggest flex is its easily shareable format and bite-size chunks of data repurposed into visual stories」；56% 消费者在个性化体验后产生复购（引 Segment 报告）。
- **形态**：Instagram Stories 竖版（9:16）卡片流，每张卡一个洞察（Top Artist / Top Song / 分 Genre 占比 / Listening Age / Clubs 归属），用户逐张滑、逐张分享。
- **2025 增量**（Man of Many）：**Clubs**（按情绪六社群归属 + 角色名：Leader/Scout/Archivist…）、**Listening Age**（听觉年龄）、**Fan Leaderboard**（全球排名）、**Top Albums**。共同点：把统计数字**翻译成身份**。
- **可迁移**：
  - 9:16 竖版单卡（社交平台原生比例）+ 一卡一事实；
  - 「身份标签」机制（如「跨馆巡读者」「重借大队长」——由数据派生的称号）；
  - 年份大字 + 强对比色的「节日感」视觉锚。

### 2.2 Strava Year in Sport（社区对照参照）

**证据**：[Shopify 案例 §2](https://www.shopify.com/in/blog/social-media-examples)。

- 把个人数据放进全球用户分布（百分位）制造对照感；社区归属是分享动力。
- **可迁移（降级）**：ReadGraph 无多用户数据源，不做百分位对照（无数据支撑，不虚构）；退化为**历年自我对照**（2025 vs 2024 的 Δ）或绝对事实陈述。

### 2.3 Monzo Year in Monzo（敏感数据人格化参照）

**证据**：[Shopify 案例 §4](https://www.shopify.com/in/blog/social-media-examples)。

- 用户不愿分享裸支出数字，但愿意分享 tongue-in-cheek 的角色标签（「Starbucks 最大的粉丝」「Social Butterfly Era」）。
- **可迁移**：借阅数据里「敏感」的部分（价值/花费）**不上分享图**；用分类画像、复借行为做轻度人格化（称号候选经评审裁定 v1 不做，见 [reading-profile §4.1](../specs/reading-profile.md#41-年度分享图profileyear-新增) 裁定记录）。

### 2.4 Bookology（阅读垂类直接参照，已在 benchmark 内）

**证据**：[bookology-benchmark §3/§5.2/§5.3](./bookology-benchmark.md)。

- Goals「Finished books」封面网格 + **未达标槽位编号占位**（7、8、9…灰色占位）——画报式年度页的低成本高感知形态；
- 「年份 + 状态」命名书架（「2026 Finished / 97 books」）——按年组织的书架语义；
- Stats 月历格 = 当天在读书的封面——「日历即封面」。
- **可迁移**：封面网格/书脊行作为分享图主视觉；编号占位语义（目标差量可视化）；
- **不迁移**：拟物书架/装饰摆件/金色点缀（benchmark §5.2 P2 明确否决：与方向 A 密实克制气质冲突）。

### 2.5 微信读书 / 豆瓣年度报告（中文语境参照）

**证据**：Web 检索快照（36氪《在快消时代，你还读书吗?》、ifanr 年度回顾盘点；产品细节基于公开报道记忆，标注 `[INFERENCE]`）。

- 微信读书年度报告 = H5 卡片流（时长/在读书/陪伴语），末页生成可保存分享海报；海报以**书封墙 + 一句总结**为主体。
- 豆瓣年度书影 = 1:1/竖版海报，TOP 影书封面拼贴 + 大数字 + 一句人格化文案（「你的年度关键词」）。
- **可迁移**：中文语境的「年度关键词/一句总结」传统；封面拼贴 + 少量大字的版式密度。
- **不迁移**：H5 多页沉浸叙事（工程重、与 ReadGraph「页内生成、即点即存」的轻量定位不符）。

### 2.6 纯前端图片生成技术（实现层调研）

**证据**：[MDN: CORS enabled image](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image)、[npm-compare: html-to-image vs html2canvas](https://npm-compare.com/html-to-image,html2canvas)、[dom-to-image-more](https://www.npmjs.com/package/dom-to-image-more)。

| 方案 | 原理 | 优点 | 缺点 | 结论 |
|------|------|------|------|------|
| A. 手写 Canvas 2D 绘制 | 代码逐元素 `drawImage`/`fillText` | 零依赖；渲染完全确定；导出无 CORS 问题（自绘） | 版式开发效率低；文本换行/字体度量要手写 | **已裁定（A）** |
| B. html-to-image（DOM→SVG→Canvas） | 序列化 DOM 为 SVG 内嵌 dataURL 再栅格化 | 保真高（浏览器原生渲染）；API 简单 | **新依赖**；外部封面图需 CORS 允许（OpenLibrary 封面域名无 CORS 头时图块空白/tainted canvas 抛 SecurityError）；npm 上游 2 年未发版（维护存疑，供应链审查难过 §3 清单） | 否决 |
| C. html2canvas | JS 重绘 DOM 到 Canvas | 生态最大 | 新依赖；CSS 还原差（伪元素/现代布局丢失）；同样 CORS 受限 | 否决 |

- **CORS 关键事实**（MDN）：跨域图未经 CORS 批准绘入 canvas → canvas tainted → `toBlob()/toDataURL()` 抛 `SecurityError`。OpenLibrary covers（`covers.openlibrary.org`）与 Libby 封面 CDN 均不保证 `Access-Control-Allow-Origin`，方案 B/C 在封面场景**不可靠**。
- **方案 A 规避路径**：封面仅在有 CORS 头时绘入（`crossOrigin='anonymous'` 试加载，失败 → 降级为占位块显题名首字符，与页内 `year-book-grid` 占位语义一致）；无封面/加载失败不阻断出图。分享图作为「用户创作物」，封面缺失是可接受的降级而非错误。
- **裁定记录**：R1 裁定方案 A（零依赖，C4 对齐；封面 CORS 使 B/C 不可靠）。裁定清单见 [reading-profile §4.1](../specs/reading-profile.md#41-年度分享图profileyear-新增)。

## 参考来源

- Shopify: 12 Creative Social Media Campaign Examples（Spotify Wrapped §1 / Strava §2 / Monzo §4）— https://www.shopify.com/in/blog/social-media-examples
- Man of Many: Spotify Wrapped 2025 Preview — https://manofmany.com/entertainment/spotify-wrapped-2025-preview
- DesignersForest: Why is Spotify Wrapped so popular — https://www.designersforest.com/why-is-spotify-wrapped-so-popular/
- MDN: CORS enabled image — https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image
- npm-compare: html-to-image vs html2canvas — https://npm-compare.com/html-to-image,html2canvas
- dom-to-image-more (npm) — https://www.npmjs.com/package/dom-to-image-more
- Buffer: Instagram Image Size Guide — https://buffer.com/resources/instagram-image-size/
