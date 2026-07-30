# 国际化（i18n）规范

> **适用范围**: ReadGraph 前端全体贡献者与 AI 编码代理
> **生效日期**: 2026-07-01
> **权威来源**: 本文档为 i18n 细规则的唯一权威；骨架见 [ui-navigation §5 国际化与本地化骨架](specs/ui-navigation.md#5-国际化与本地化骨架) 与 [docs/design-decisions.md 国际化选型](design-decisions.md)，冲突时以本文档为准。

ReadGraph 支持双语（`zh-CN` / `en`），方案为 `react-i18next`（纯前端、离线可用，见 [app-spec §1](app-spec.md) 约束）。新增或修改 UI 时**必须**遵守以下规则。

## 1. 禁止硬编码用户可见文本

- 不得在组件 JSX/TSX 中直接写中文或英文字符串（如 `<h1>书库</h1>`、`<Button>导入</Button>`）。
- 所有可见文本（标题、标签、按钮、空态、tooltip 等）经 `useTranslation()` + `t('key')` 取值。
- 唯一例外：写进 locale bundle 的字符串本体本身。

## 2. 翻译资源组织

- 资源放 `src/i18n/locales/<locale>/<ns>.json`，按命名空间（namespace）拆分，现有 `common` / `nav` / `pages`。
- 新增 namespace 需同时更新 `src/i18n/index.ts` 的 `resources` 与 `ns`，并在 `zh-CN` 与 `en` 两侧都补齐键。
- 缺键会回退到 `fallbackLng: 'zh-CN'`；新增键时两语必须同时补，避免运行时回退到回退语言。

## 3. 键命名

- 点分层级，与功能/路由对齐（如 `pages.library.title`、`nav.dashboard`、`common.app.name`）。
- 语言名等「自名名」在两个 bundle 中保持原语言写法（如 `简体中文` 始终写 `简体中文`），不随当前 locale 翻译。
- 其余键的 `en` 译文须为地道的英文，非机翻直译；中文键以 `zh-CN` 为权威来源。

## 4. locale 枚举与存储

- locale 仅 `zh-CN` / `en`，不预留 `zh-TW`（见 internal-schema `UserPreferences.locale` 收窄说明）。
- 新增语言需先扩 `src/lib/locale.ts` 的 `LOCALES` 联合类型并同步 internal-schema，再补翻译 bundle。
- 偏好落 `localStorage` key `readgraph:preferences` 的 `locale` 字段；读写走 `src/lib/locale.ts`（`getStoredLocale` 校验，非法值降级到浏览器语言再降级默认 `zh-CN`）。

## 5. 切换与渲染同步

- 通过 `useLocale()`（`src/hooks/use-locale.ts`）读写 locale：写偏好 + `changeLanguage`。
- 切换时同步 `document.documentElement.lang`；`index.html` `lang` 默认 `zh-CN`，随当前 locale 切换（[ui-navigation §5](specs/ui-navigation.md#5-国际化与本地化骨架)）。
- 一次切换必须在同一 `setLocale` 调用内完成「持久化 + `i18n.changeLanguage` + `<html lang>` 同步」，不得只改 store 不重建 UI 文本。

## 6. 静态文本自检

- 提交前运行 `rg "[\x{4e00}-\x{9fff}]" src/routes src/components src/hooks src/lib`，命中应**仅**来自：
  - `src/i18n/locales/zh-CN/**`（bundle 本体）；
  - 代码注释（可接受）。
- 若在 `.tsx`/`.ts` 内出现中文落字，须迁入 bundle 用 `t()` 取值。

## 7. 新增 i18n/l10n 依赖

- `react-i18next` / `i18next` 已在 `package.json` 锁定（见 `pnpm-lock.yaml`）。
- 如引入日期/排序等 l10n 库（如 `date-fns` locale 包、`Intl` polyfill），按 [docs/npm-supply-chain-security.md §3 审查清单](npm-supply-chain-security.md) 完成审查，并遵守 7 天冷却期（`pnpm-workspace.yaml: minimumReleaseAge: 10080`）。版本范围 `^` 可用，frozen 锁文件兜底。

## 8. 测试要求

- locale / `useLocale` 行为需有 Vitest 覆盖（对应 [ui-navigation §8 测试清单](specs/ui-navigation.md#8-测试清单)）：`getStoredLocale` 非法值降级、切换后 `<html lang>` 更新、偏好持久化后 reload 保留。
- 新增可见页面/组件的渲染测试应断言 `t()` 取值路径，不应断言具体中英文字面量（除非断言回退语言）。
