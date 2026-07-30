# ECharts 6 升级评估

> 评估日期: 2026-07-30　现版本: echarts 5.6.0 → 目标: 6.1.0
> 决策依据: [Apache ECharts 6 Upgrade Guide](https://echarts.apache.org/handbook/en/basics/release-note/v6-upgrade-guide/) · DESIGN.md §2.5 §11.3 · `src/lib/echarts-theme.ts`

---

## 1. 当前用法面

仓库内 echarts 接触面**仅限一层纯函数适配**，无任何图表实例化调用：

| 位置 | 形态 | 是否触碰 v6 breaking |
|------|------|----------------------|
| `src/lib/echarts-theme.ts` `buildTheme()` | 纯函数：shadcn CSS 变量 → `EChartsTheme` 对象（`color`/`backgroundColor`/`axis`/`tooltip`） | 否 |
| `src/hooks/use-theme.tsx` `useEChartsTheme()` | hook，因主题变化重建 theme 对象 | 否 |
| `src/lib/echarts-theme.test.ts` / `use-theme.test.tsx` | 单元测试断言 `color` 数组与字段 | 否 |

全仓 `import 'echarts'`、`echarts.init()`、`setOption()`、按需导入 `echarts/charts` 等均**零命中**。意味着迁移成本与风险都被这层薄适配隔离在 theme 对象字段层面。

## 2. v6 breaking changes vs 本项目

| v6 变更 | 影响本项目 | 说明 |
|---------|-----------|------|
| 默认主题配色改版 + 组件默认位置调整（legend 默认移到底部） | 🟡 低 | theme 色板由 `buildTheme` 的 `color` 字段显式覆盖，不依赖 v5 默认色；但**将来落地图表实例化时**，legend 默认位置变化会显现，需在 `option.legend` 里显式 declarative 锚定 |
| `echarts/src/theme/light.ts` → `echarts/theme/rainbow.js` | 🟢 无 | 未从该路径 import |
| grid 坐标系 `axisName`/`axisLabel` 默认开启外溢与重叠规避，轴位可能微移 | 🟢 无 | theme 适配层未配置 `axisName`；后续如加轴标题，设 `grid.outerBoundsMode: 'none'` 或 `xAxis.nameMoveOverlap: false` 可回旧行为 |
| rich text label 继承 plain label 的字体/阴影样式 | 🟢 无 | 未使用 rich text |
| zrender 5.6.1 → 6.1.0 | 🟢 无 | runtime-only 渲染引擎，无对外 API；`pnpm why zrender` 仅经 echarts 传递 |

## 3. 引擎 / 打包兼容

- `echarts@6.1.0`：`peerDependencies` 空、无 `engines` 约束，Node ≥20 不受影响。
- v5、v6 同为 ESM（`type: module`，入口 `index.js`），与 Vite 8 / `@vitejs/plugin-react@6` 兼容，无需调整打包配置。
- 体积：v6 tree-shaking 策略未变，按需导入路径不变。

## 4. 供应链门控（pnpm 11）

- 6.1.0 发布 2026-05-19，距今 >7 天，过 `minimumReleaseAge: 10080` 冷却。
- MAJOR 升级不限 `^` 浮升范围，需改 `package.json` 写 `^5.6.0 → ^6.1.0`，重跑 `pnpm install` 生成新 lockfile，提交并人工审 `pnpm-lock.yaml` diff（zrender 跃迁、无新增注册表外 resolution 即正常）。
- CI 仍走 `pnpm install --frozen-lockfile --ignore-scripts`；无构建脚本白名单新增项。

## 5. 迁移步骤（建议）

1. 本仓当前**未实例化图表**，可立即升而无需任何代码改动：

   ```bash
   pnpm add echarts@^6.1.0
   pnpm install --frozen-lockfile
   pnpm test            # echarts-theme.test / use-theme.test 应全绿
   pnpm build           # tsc -b + vite build
   ```

2. `EChartsTheme` 接口字段保持不变（`color`/`backgroundColor`/`axis`/`tooltip` 均为 v6 仍支持的 theme 对象字段），无需调整。
3. **将来落地图表实例化时**（阅读画像页实现期），新增两点约束写入对应 spec：
   - `option.legend.top/bottom` 显式声明，不依赖默认位置（规避 v6 的 legend 到底默认变化）。
   - 若使用 `axisName`，显式定 `grid.outerBoundsMode`，保证轴布局稳定。

## 6. 结论

| 维度 | 评级 |
|------|------|
| 迁移成本 | 🟢 低（适配层为纯函数，无实例化调用） |
| 视觉回归风险 | 🟡 推迟到图表实例化时处理（legend 默认位置） |
| 供应链门控 | 🟢 已过 7 天冷却 |
| 即时决策 | **当前可升**；MAJOR 升级建议跟图表实现任务同 PR，单独升无回归面可验证。

> 与 design-decisions 一致：DESIGN.md §2.5 `--chart-1..5` 与 §11.3 薄适配层未与 v6 任何 breaking 冲突，色板与 tooltip/axis 语义变量路径不变。