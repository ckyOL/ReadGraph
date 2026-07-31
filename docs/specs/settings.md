# 设置与系统重置规格

> 本文件从 `docs/app-spec.md` §12 拆出，遵循 SDD + TDD。实体与存储契约以 [internal-schema](../metadata/internal-schema.md) 及 [数据层规格](data-layer.md) 为唯一来源；本节不重复抄录字段表与既有实现，只定义「设置页落点、确认流程契约、备份文件格式、重建模式对照、测试清单」。
> 返回 [app-spec.md](../app-spec.md)。

## 1. 范围与依赖

**范围**：定义设置页（`/settings`）的偏好持久化、导出备份与导入重建、系统重置的原子性与二次确认。底层逻辑已由 [数据层规格](data-layer.md) 落地：`resetDatabase`（[§6](data-layer.md#6-系统重置) 原子事务）、`exportDatabase`/`importDatabase`（[§7](data-layer.md#7-数据导出与重建) snapshot 模式）、`readPreferences`/`writePreferences`（[§8](data-layer.md#8-用户偏好) Zod 校验）。本里程碑补齐**备份文件序列化与文件名**纯函数（落 `src/db/backup.ts`）与测试；**UI 装配（S-2/S-3）** 归入统一 UI 里程碑（[tasks/ui-unified-batch](../tasks/ui-unified-batch.md) 阶段 4），不在本里程碑单独引入运行时依赖。

**依赖**：本里程碑**不新增运行时依赖**。备份序列化复用已落地的 `zod`（`exportDataSchema`，[data-layer §7](data-layer.md#7-数据导出与重建)）与 `exportDatabase`。UI 阶段（S-2）的响应式查询与下载/上传交互所需 `dexie-react-hooks` 等由统一 UI 里程碑 D-1 供应链审查门统一引入。

**代码落点**：

```
src/
├─ db/
│  ├─ backup.ts              # 备份文件名 + 序列化/反序列化纯函数（本里程碑新增）
│  └─ backup.test.ts         # Vitest（本里程碑 Red→Green）
└─ routes/
   └─ settings.tsx          # 设置页 UI（S-2，统一 UI 里程碑）
```

## 2. 偏好持久化

- 读写沿用 [data-layer §8](data-layer.md#8-用户偏好)：`readPreferences()` / `writePreferences(patch)`，走 `localStorage` key `readgraph:preferences`，`userPreferencesSchema` 校验（`locale: 'zh-CN'|'en'`、`theme: 'light'|'dark'|'auto'`、`displayTimezone: string`）。
- 主题应用由 `use-theme`（P0-1，统一 UI 里程碑）把 `theme` 套用到根 `<html class="dark">`；`auto` 监听 `prefers-color-scheme`。本规格不重定义 theme Provider 协议（见 [ui-navigation §4](ui-navigation.md#4-主题与暗色模式骨架)）。
- `locale` 沿用 `src/lib/locale.ts` + `use-locale`（已落地，[ui-navigation §5](ui-navigation.md#5-国际化与本地化骨架)），设置页语言切换已就位。
- `displayTimezone` 选择项：候选取 `@vvo/tzdb`（随 IANA tzdata 发版维护，含国家/主要城市/别名元数据），运行时经 Intl 计算各时区**当前**偏移（夏令时正确），本地化名称/偏移/国家名按当前 locale 由 Intl 生成；主城市标签（macOS 式「城市 · 国家」）zh 下取 CLDR `exemplarCity` 映射（`src/lib/tz-cities.json`，`pnpm generate:cities` 可再生成，与 macOS 同源），未覆盖回退 tzdb 英文主要城市；选择写入 `writePreferences({ displayTimezone })`；校验非空字符串，非法值降级默认（[data-layer §8](data-layer.md#8-用户偏好)）。
- UI 面禁止硬编码文案（[i18n-conventions](../i18n-conventions.md)），namespace `pages`（`settings.*`）：`settings.preferences.*` / `settings.language.*` / `settings.data.*` / `settings.reset.*` 子键在 S-2 接入时补双语 bundle。

## 3. 导出备份与文件格式

- 导出调用 `exportDatabase(db)`（[data-layer §7](data-layer.md#7-数据导出与重建)）得到 `ExportData`（`version='1'`，`Date` 对象透出）。
- **备份文件名**（`buildBackupFilename(exportedAt: Date): string`）：形如 `readgraph-backup-YYYYMMDD-HHmmss.json`，时间取 `exportedAt` 的 UTC 分量，保证跨本地时区命名一致。
- **序列化**（`serializeExportText(data: ExportData): string`）：把 `ExportData` 序列化为**确定性 JSON 文本**——所有 `Date` 转 ISO 8601 `Z` 串（由 `Date.prototype.toJSON` 产出），顶层键顺序固定（`version`→`exportedAt`→`sources`→`rawRecords`→`books`→`catalogRecords`→`borrowCycles`→`importLogs`），2 空格缩进（人可读备份）。`rawRecords` 与 `sources` 为必导项（[data-layer §7](data-layer.md#7-数据导出与重建)），序列化不得省略。
- **反序列化**（`parseExportText(text: string): ExportData`）：`JSON.parse` 后过 `exportDataSchema.safeParse`（[data-layer §7](data-layer.md#7-数据导出与重建)），`version` 不匹配或 rawRecords 缺失或字段非法时抛 `ZodError` 且不产出脏数据。供「导入备份」文件入口调用；`exportDataSchema` 已把 ISO 串 `.transform` 回 `Date` 实例。

## 4. 重建模式对照

恢复一份导出备份，UI 经 `importDatabase(db, data, { mode })`（[data-layer §7](data-layer.md#7-数据导出与重建)），两种模式：

| 模式 | 语义 | 落库内容 | 适用 |
|------|------|---------|------|
| `snapshot` | 直接恢复（快照模式） | 先 `resetDatabase`，再单事务 `bulkPut` 全部六类实体（逐实体过 Zod safeParse） | 同版本迁移、无需重算 |
| `replay` | 从 rawRecords 重建（重放模式） | 先 `resetDatabase`，再落 `sources + rawRecords`，按 `importLogId` 分组将每批 rawRecords 喂给对应 Parser 重跑 [import-pipeline](import-pipeline.md) 管线，得到新派生数据 | Parser 逻辑升级后用旧原始数据重新生成结果 |

- `snapshot` 已由 [data-layer §7](data-layer.md#7-数据导出与重建) 落地。
- `replay` 依赖 [import-pipeline](import-pipeline.md) 管线（纯函数，已落地）与 parser 注册表；**本里程碑不实现** replay 落库（保留 [data-layer §7](data-layer.md#7-数据导出与重建) 既有 deferral），UI 阶段（S-2）接入时补：按 `rawRecord.importLogId` 分组 → 各组取所属 `source.parserId` 从注册表取 parser → 按 `exportData.importLogs` 的 `importedAt`/`fileName`/`fileSize`/`detectedEncoding` 派生 `ImportMeta` → 累积 `ExistingState` 串接多批，避免跨批去重状态丢失。
- 重建确定性要求：同一 `(sources, rawRecords)` 输入重放产出深等价派生数据（对照 [import-pipeline §3](import-pipeline.md#3-纯函数-pipeline-契约) / internal-schema 重建确定性）；`replay` 模式不得读 `Date.now()`，时间锚取各批 `ImportLog.importedAt`。

## 5. 系统重置原子性与确认流程

- 重置调用 `resetDatabase(db, { clearPreferences? })`（[data-layer §6](data-layer.md#6-系统重置)）：单个 `rw` 事务清空全部六张表，任一失败整体回滚，绝无半清空；`clearPreferences` 为真时清 `readgraph:*` localStorage，否则保留偏好。
- **不可单次撤销**：本系统不提供按 ImportLog 撤销单次导入（[data-layer §6](data-layer.md#6-系统重置) / internal-schema「为什么不做单次撤销」）；设置页是**唯一的**批量删除入口。
- **二次确认（UI，S-2）**：重置前用 shadcn `AlertDialog`，文案明示「不可恢复」；以 `Checkbox` 勾选「已导出备份」作为继续门槛（未勾选时确认按钮禁用）；确认后调用 `resetDatabase({ clearPreferences: false })`（默认保留偏好，除非用户另选清偏好）。
- **强制备份**：确认对话框内提供「导出备份」按钮（调 `exportDatabase` + `serializeExportText` + `buildBackupFilename` 触发下载）；不强制完成下载文件，但须过确认勾选门槛，避免误触清空。
- 错误态：重置事务失败时整体回滚，UI 提示「未变更」，库保持完整；事务成功后各页回到 `Empty` 空态。

## 6. 来源归属

- `Source` 由**导入向导**创建：用户从 [source](../metadata/source.md) `SOURCE_TEMPLATES` 模板挑选（模板绑定 `parserId`，即 parser 适配的目标馆），或随 parser 适配预置；**设置页不提供来源管理**（不列、不编辑、不新建），来源管理与 parser 适配职责分离。
- 删除 `Source` 不级联清表（与「不单次撤销」一致）；全量删除由系统重置统一处理，避免 dangling `catalogRecord.sourceId`/`borrowCycle.sourceId` 引用。
- CRUD 契约仍属 [data-layer §4](data-layer.md#4-repository-接口)（`SourceRepository` + `sourceSchema`），本规格不新增接口。

## 7. UI 设计说明

> UI 装配（S-2）归入统一 UI 里程碑（[tasks/ui-unified-batch](../tasks/ui-unified-batch.md) 阶段 4）；本节约定设计方向，不实现代码。

- **布局**：设置页分两区——偏好区（主题/locale/displayTimezone）、数据区（导出备份 / 导入备份 / 系统重置）。各区以 `border-t` 分隔，不用嵌套卡片。
- **交互**：主题/locale 切换即时生效（走 `writePreferences`）；时区选择用 `Combobox`（Popover + Command：搜索框 + 按国家分组列表，macOS 式**城市 · 国家**主标签 + 当前偏移次要信息，DST 随季节变化，搜索城市或时区名）；导出为一次性 `onClick` 触发下载；导入备份走文件选择 + 模式选择（snapshot/replay）；系统重置入口先弹 `AlertDialog` 二次确认 + `Checkbox` 备份门槛。
- **状态**：重置执行中用 `Progress`（事务很快，主要为网络下载的导出等待）；导入备份解析中用 `Spinner`；错误态 toast 提示（version 不匹配 / 字段非法），不写库。
- **响应式**：移动端两区纵向堆叠。

## 8. 数据契约与边界

- **备份完整性**：`ExportData` 必含 `sources` + `rawRecords`（重建最小集）+ 全部派生实体；序列化日期为 ISO `Z` 串，反序列化由 `exportDataSchema` 的 `.transform` 归一回 `Date`。
- **snapshot vs replay 不可混用**：一次 `importDatabase` 调用只选一种模式；`replay` 模式需 `sources` 与 `rawRecords` 完整，缺一则拒绝。
- **版本兼容**：`ExportData.version` 不匹配时抛 `Error`，不写库；旧版本备份在 schema 升 version 时按 [data-layer §5](data-layer.md#5-迁移策略) 迁移或走「导出→重置→重导」流程。
- **偏好不随重置清除**（默认）：`resetDatabase({ clearPreferences: false })` 保留 `readgraph:preferences`；用户可在确认对话框内另选清偏好。

## 9. 用户故事与验收用例

1. 作为用户，在设置切主题 light/dark/auto → 根 `<html>` 的 `class="dark"` 变化，刷新后偏好保留（对照 [ui-navigation §4](ui-navigation.md#4-主题与暗色模式骨架)，P0-1 落地后）。
2. 作为用户，在设置切中英、切 `displayTimezone` → 偏好落 `readgraph:preferences`，刷新保留，非法值降级默认不崩（[data-layer §8](data-layer.md#8-用户偏好)）。
3. 作为用户，点「导出备份」→ 下载 `readgraph-backup-YYYYMMDD-HHmmss.json`，内容含 sources + rawRecords + 全部派生实体，`Date` 为 ISO `Z` 串。
4. 作为用户，点「导入备份」选文件 → snapshot 模式还原，库与导出前等价；`version` 不匹配/rawRecords 缺失/字段非法时拒绝并提示，不写库。
5. 作为用户，选 replay 模式（UI 阶段 S-2 后）→ 库按 rawRecords 重放重建，派生数据随当前 Parser 逻辑变化而非旧快照。
6. 作为用户，点「系统重置」→ `AlertDialog` 二次确认 + 备份勾选门槛，确认后清空全库为初始空态，事务失败则回滚不变。

## 10. 测试清单

**Vitest（`src/db/backup.test.ts`，本里程碑 Red→Green）**
- `buildBackupFilename`：固定 `exportedAt` UTC 得 `readgraph-backup-YYYYMMDD-HHmmss.json`；与运行机器本地时区无关。
- `serializeExportText`：`Date` 序列化为 ISO `Z` 串；顶层键顺序固定；rawRecords/sources 必在场；产出可被 `parseExportText` 回环等价。
- `parseExportText`：合法文本解析为 `ExportData`（`Date` 实例归一）；`version` 不匹配 / rawRecords 缺失 / 字段非法时抛 `ZodError` 且不产出脏数据。
- 回环：`parseExportText(serializeExportText(data))` 与原 `data` 深等价（`Date` 按 `getTime` 比较）。

**Vitest（UI 阶段 S-2/S-3 补）**
- 偏好读写/降级（对齐 `preferences.test.ts`）；重置原子性 + 二次确认不可单步撤销（对齐 `reset.test.ts`，补 UI 勾选门槛门）；导出后重置库为空。
- `replay` 重建：同 `(sources, rawRecords)` 两次重放深等价（UI 阶段实现 replay 后补）。

**Playwright（E2E，统一 UI 里程碑）**
- 切暗色 → reload 保留；切 locale → `html[lang]` 更新（对齐 [ui-navigation §8](ui-navigation.md#8-测试清单)）。
- 导出后清空系统：导出备份 → 重置确认流程完成 → 库为空（各页 `Empty`）。
- 导入备份文件 → 书库/时间线恢复可见。

## 11. React 性能规则引用

- `client-localstorage-schema`：`readgraph:preferences` 读写走 `userPreferencesSchema` 校验（[data-layer §8](data-layer.md#8-用户偏好)），避免脏值。
- `bundle-barrel-imports`：设置页组件按需 import（`AlertDialog`/`DropdownMenu`/`Select`/`Checkbox`），避免 barrel 拉 UI 体积。
- 导出/重置为一次性 `onClick` 微任务，避免阻塞渲染与导航。
