# 分类法层级解析规格（classification-hierarchy）

> **2026-08-12 重大修订：数据供给**。中图法数据（类目树/数据管线/缺口表）已整体外置至独立项目
> `数据侧`（迁移方案与执行记录见 [clc-split-repo 任务](../tasks/clc-split-repo.md)）。本规格自本节起仅保留
> ReadGraph 侧的**解析层契约**；数据侧内容（原 §2 数据源考察、§7 构建管线、§11/§12 纸本数据管线）已
> 迁至 `数据侧/docs/`。
> 关联：[app-spec](../app-spec.md)、[ui-navigation §3](../specs/ui-navigation.md#3-各功能页布局与空状态)、
> [reading-profile §4](../specs/reading-profile.md#4-ui-设计说明)。
> 返回 [app-spec.md](../app-spec.md)。

## 0. 数据供给（用户自备分类法 JSON）

本仓库**不携带任何分类法数据内容**。运行时从 `public/classification/` 拉取用户提供的契约 JSON
（Vite 原样 served；部署时与 index.html 同级放置）：

| 文件 | 内容 | 缺省降级 |
|---|---|---|
| `public/classification/clc-tree.json` | `ClcNode[]` 分类树 | 空数组 → 一级类目表兜底（`first-level`） |
| `public/classification/clc-overlay.json` | `{code: {name, source}}` 缺口修正 | 空表 `{}` |
| `public/classification/clc-auxiliary.json` | `{复分号: 类名}` 总论复分表 | 空表 `{}`（不拆复分号） |

- **数据契约（机器可执行权威）= `数据侧/schema/*.schema.json`**；校验器 `数据侧/tools/validate.py`
  （结构 + 内容门：顶层 22 字母类、去括号 id 唯一、desc 非空）。
- 加载器：`loadClcTree/loadClcOverlay/loadClcAuxiliary`（`src/lib/classification-path.ts`）——fetch 单例缓存，
  404/网络失败降级缺省值；体系键控注册表 `treeLoaders` 为 ddc/lcc/udc 留扩展位。
- 数据可获得渠道：数据侧 项目产物（release artifact）或用户自备任意来源 JSON（仅需满足契约）。

## 1. 问题与目标（保留）

- **目标**：分类号解析到子层级，解析到哪层就如实显示到哪层。可解析到叶的显示完整路径：

```
J 艺术 › J2 绘画 › J21 绘画技法 › J218 各种画技法：按用途分 › J218.2 漫画
```

查不到的解析到最深命中节点为止，剩余后缀如实显示、**不推测类名**（`tree-partial`）。
- 芯片主文本 = 最深已解析类名；tooltip = 完整面包屑；画像 treemap 支持子类下钻。
- 不改 `CatalogRecord` 落库 schema，不迁移 IndexedDB；纯前端、离线可用；解析为纯函数可单测。

## 2. 数据契约（跨仓库接口）

**权威 = `数据侧/schema/*.schema.json`**。本节的 TS 接口为同契约的历史来源表述：

```ts
interface ClcNode {
  id: string        // 分类号前缀；交替类目 '[J59]'；范围类目 'K833/837'
  desc: string      // 类名，领域数据不 i18n
  src?: string      // 溯源：'p<页>' | 'expansion:*' | 'print-absent'
                    //   | 'simulate:<宿主>' | 'by-table:<宿主>' | 'rule:<宿主>:<kind>:<目标>（<注记>）'
  status?: string   // 'alternate' 交替（宜入 redirect）| 'superseded' 停用（改入 redirect）
  redirect?: string // 形态目标码（印刷真值）
  children?: ClcNode[]
}

interface OverlayEntry { name: string; source: string }  // 缺口修正，空表起步
type OverlayData = Record<string, OverlayEntry>

type AuxiliaryData = Record<string, string>               // 总论复分表，key 含 '-'，如 '-39'
```

数据形态要点（产物实测，2026-08-12）：顶层 22 个字母类（无 L/M/W/Y）；`status` 仅 `alternate`
（`superseded` 不建树）；`redirect` 可不随 `status` 出现（73/886 实测）；`src` 前缀
`by-table/simulate/rule/expansion/p<页>`。

## 3. 解析结果类型（`src/lib/classification-path.ts`）

```ts
interface ClassificationPathSegment { code: string; name: string }
interface ClassificationPath {
  path: ClassificationPathSegment[]   // 根到叶，至少含一级；无命中为空数组
  depth: number
  source: 'overlay' | 'tree' | 'tree-partial' | 'first-level' | 'none'
  unresolvedSuffix?: string           // 仅 tree-partial：code 比最深命中节点长的剩余后缀
  auxiliary?: ClassificationPathSegment // 复分拆分兜底（§6）：{ code: '-39', name: '…' }，主类契约不变
}
```

## 4. 解析逻辑与降级链

### 4.1 前缀候选匹配 + 父指针回溯（兼容交错结构）

- 生成长度递减前缀候选，从长到短哈希查命中即最深节点；命中要求 id 存在且（完整 code 或下一字符为
  数字/点）——`QZ9` 之类字母嵌码在首字母处被拒。
- 树以**十进制挂载**建树（`K248` 直接挂 `K2`，无 `K23` 中间层）；真实父链由 build-tree 的 parent 覆盖 /
  最长十进制前缀决定，展示路径沿父链回溯到根。
- 范围类目（id 含斜杠，如 `K833/837`、`D221/227`）：段数组区间归属（`cmpSeg` 字典序，短前缀视为小、
  前导零位宽区分），展开号按字典序落入区间；位宽边界 `D93.5` 不误入 `D093/097`。
- 索书号斜杠后缀（`I247.5/123`）双形态各匹配一次，取解析更深、后缀更短者；剥斜杠形态不超越
  原形态的 tree 结果。

### 4.2 入参归一

大写、剥离括号复分 `(...)`、剥离时代区分号 `=…`（纸本「不作实际号码」，实证 `K833.135.72=6`）、
去交替类目方括号、去空白；斜杠保留（范围类目 id 本身带斜杠）。

### 4.3 降级链

```
overlay > tree / tree-partial > first-level > none
```

- overlay 优先于静态树；树内显式复分节点（`B81-09`）与 overlay 键完整命中即返回。
- first-level：一级类目表（`src/lib/classification.ts` 的 `CLC_FIRST_LEVEL`/`DDC_FIRST_LEVEL`）兜底，
  树空/加载前生效；形态门：首字符后仅数字/点。

## 5. buildClassificationChildren（treemap 下钻）

给定下钻节点 code 与桶内分类号集合：解析每条 code 的路径，按下钻节点的直接子段分组计数
（`{code, name, value}`）；路径止于下钻节点本身 / 未解析的条目跳过；下钻节点即主类最末段时，
复分号作为其子段计数（§6）。

## 6. 复分号（总论复分表）

- 签名：`resolveClassificationPath(system, code, tree, overlay?, auxiliary?)`——复分表与树/overlay 同为
  入参，保持纯函数。
- 算法：全码路径先行（overlay → 树）；全码未完整命中且含 `-` 时在**首个 `-`** 处拆 `main` + `aux`：
  主类按既有算法解析；`aux` 查复分表命中 → 挂 `auxiliary` 段；未命中 → 不造名，`-xx` 原文并入
  `unresolvedSuffix`（source 降为 `tree-partial`，保持「unresolvedSuffix 仅属 tree-partial」契约）。
- 效果（实证）：`K02-39` → `K › K0 › K02` + `{-39, 信息化建设、新技术的应用}`；`G898.3-64` → 主类
  `tree-partial` 止于 `G898` + `{-64, …}`；表外 `K02-99` → 主类 + `unresolvedSuffix='-99'`。
- 树内显式复分节点（`B81-09`）完整命中，`auxiliary` 缺省（不重复挂）。

## 7. 测试清单（Vitest，fixture 驱动）

`src/lib/classification-path.test.ts` 基于**内联 fixture 树**（模拟契约产物：src/status/redirect 字段、
十进制挂载、范围展开子级/保留容器、显式复分节点）；真实产物（45k+ 节点）由 `数据侧/tools/validate.py`
校验。断言覆盖（规格 §8 语义，fixture 口径）：

- `J218.2`/`J238.2` → `tree` 5 段（后者为纸本「仿J218分」注释收录形态）。
- `K248`/`K248.1`/`K252`/`G633.52` → 十进制挂载完整链（父指针回溯）。
- 范围：`K833/837` 输入 → 归属 `K › K81`；`K833.135.72` → 止于 `K833` + `.135.72`；`D221.5` → 容器区间
  兜底；`D93.5` 不误入 `D093/097`；`I247.5/123` 剥斜杠取完整解。
- 交替 `[J59]` 展示去括号；归一（小写/括号复分/`=` 时代区分号）。
- 降级链：overlay > tree > first-level > none（含树空场景）。
- 复分：`K02-39`/`B84-49`/`G898.3-64`/表外 `K02-99`/显式 `B81-09`/树空一级兜底。
- 懒加载：`classification-path.loader.test.ts` fetch 一次并缓存（mock `fetch`，404/网络失败降级）。

### E2E（Playwright）

- 书库/详情芯片 hover 出现完整面包屑（route 拦截 fixture：少量真实分类号，≤10 条手写、无 src）。
- treemap 点一级类目展开子类、面包屑回退一级。

## 8. React 性能规则引用

- 数据加载走 `fetch`（`public/classification/`），不入主 bundle。
- 芯片无路径时条件渲染仅 code；treemap 下钻查询走 `useDeferredValue`。
- 本规格不改 IndexedDB schema，无迁移。
