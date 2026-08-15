# 供应链安全规范（pnpm 11）

> **适用范围**: ReadGraph 项目全体贡献者与 AI 编码代理  
> **最后更新**: 2026-07-29　**严重等级**: 🔴 强制执行  
> **工具栈**: pnpm 11（`packageManager: pnpm@11.9.0`），`pnpm-lock.yaml`，无构建脚本。

pnpm 11 已把供应链的**技术执行**内化（见 §1 指针）。本规范只保留 pnpm 不替代的部分——**人工审查、AI 代理约束、应急与维护**。详细 pnpm 能力见 [缓解供应链攻击](https://pnpm.io/zh/supply-chain-security)、[设置](https://pnpm.io/zh/settings)。

---

## 1. pnpm 11 已自动覆盖的（无需手动配置，不得关闭）

| 能力 | pnpm 11 默认 | 配置入口（如需调）|
|:---|:---|:---|
| 阻断依赖构建脚本 | 默认禁用，`allowBuilds` 白名单逐包放行；`strictDepBuilds` 默认 `true` | `pnpm-workspace.yaml: allowBuilds` |
| 阻断异源传递依赖 | `blockExoticSubdeps: true`（拦截 git URL / 直链 tarball） | 同上 |
| 新发布版本延迟安装 | 本项目 `minimumReleaseAge: 10080`（7 天，对所有依赖含传递生效） | `pnpm-workspace.yaml: minimumReleaseAge` |
| 强制 HTTPS 注册表 | `strictSsl: true`；`.npmrc: strict-ssl=true` | `.npmrc` |
| 官方注册表锚定 | `.npmrc: registry=https://registry.npmjs.org/`（pnpm 11 仍读 `.npmrc` 的注册表/认证类） | `.npmrc` |
| 安装时整树复校验 | `pnpm install --frozen-lockfile` 会对每条 lock 项重跑冷却/信任策略 | — |

> ⚠️ `.npmrc` 是 pnpm 11 **唯一仍读**的配置文件（仅注册表/认证类）。`ignore-scripts`/`save-exact`/`min-release-age`/`audit` 等键 pnpm 不再读取，写入即假合规，禁止保留为「安全加固」。

---

## 2. 版本范围策略：`^` 可用

pnpm 11 下，`pnpm-lock.yaml` 提交并用 `--frozen-lockfile` 安装时，**实际安装版本由锁文件精确钉死**，manifest 里的 `^` 不生效。`^` 仅在 `pnpm update`/非 frozen 重解析时才浮升，而该次解析受 `minimumReleaseAge: 10080`（7 天冷却）门控。因此：

- ✅ `package.json` 允许 `^` / `~` 范围（新装/更新依赖可直接 `pnpm add`，无需 `-E`）。
- ✅ 已有的精确版本可保留（无害且更稳，不必回改）。
- 🔴 但 `pnpm-lock.yaml` **必须**提交、CI **必须** `pnpm install --frozen-lockfile`。否则 `^` 在每次安装浮升、绕过锁文件保护。
- 🔴 新增依赖仍须走 §3 审查清单（冷却、维护者、行为分析等）。

---

## 3. 新依赖安全审查清单（人工控制，pnpm 不替代）

引入**任何**新依赖前，必须完成并在 PR 归档结论：

```markdown
- [ ] 必要性：能否用已有依赖或 Web 标准 / Node 内置 API 实现？
- [ ] 包名拼写：与 npm 官方页面逐字核对（防 typosquatting）
- [ ] 维护者：活跃度、发布频率、GitHub 仓库健康度（防账户劫持后投毒）
- [ ] 下载量：周下载量是否合理（异常低警惕仿冒）
- [ ] 依赖树：`pnpm why <pkg>` 查传递依赖面（依赖最小化原则）
- [ ] 构建脚本：包或其依赖是否含 lifecycle 脚本？若有需在 `allowBuilds` 显式放行
- [ ] 行为分析：在 socket.dev 查报告
- [ ] 许可证：与本项目兼容
- [ ] 发布时间：`pnpm view <pkg> time` 确认目标版本发布 ≥ 7 天（否则等冷却或排除）
```

操作命令：

```bash
pnpm add <pkg>            # runtime；^ 范围可，经审查清单后
pnpm add -D <pkg>         # devDependency
pnpm install --frozen-lockfile --ignore-scripts   # CI 安装 + 整树供应链复校验
pnpm audit --audit-level=high
pnpm why <pkg>            # 查传递依赖
pnpm view <pkg> time      # 发布时间（确认冷却期）
pnpm dlx shadcn@latest add <name>   # 按需生成 shadcn 组件：dlx 临时下载 CLI，不入 lockfile/manifest

# ❌ 禁止
# pnpm install --force              # 跳过检查
# pnpm install --shamefully-hoist   # 破坏依赖隔离
# pnpm add <git+https://...>        # 异源安装（blockExoticSubdeps 默认已拦）
# 设 dangerouslyAllowAllBuilds: true 或关闭 blockExoticSubdeps/strictDepBuilds
```

> `pnpm dlx shadcn@latest add <name>` 只是临时下载 CLI、运行后即弃，不写入 `package.json` / `pnpm-lock.yaml`，因此新增组件**不是**依赖事件、无需走上方清单；但生成的组件源码仍按仓库规则人工审查。

更新带构建脚本的受信任包时尤其谨慎（账户劫持投毒窗口，见 [nx 案例](https://socket.dev/blog/nx-packages-compromised)）。

---

## 4. Lockfile 纪律

- `pnpm-lock.yaml` **必须**提交；PR 的 lockfile diff 作为安全敏感变更人工审查。
- CI **必须** `pnpm install --frozen-lockfile --ignore-scripts`（内置整树供应链复校验）。
- 审查 lockfile diff 异常信号：出现注册表外 resolution（已被 `blockExoticSubdeps` 默认拦截，出现即异常）、版本异常跳跃、未声明的新包、`integrity` 意外变化。
- CI 报 `ERR_PNPM_TRUST_*` / `ERR_PNPM_MINIMUM_RELEASE_AGE`：有人本地在更宽松策略下生成了「受污染」lockfile，先排查最近改动，必要时 `pnpm clean --lockfile` 后重建。禁手动编辑 lockfile。

---

## 5. AI 编码代理约束

> [!WARNING] 对所有为 ReadGraph 生成代码的 AI 编码代理（含 Gemini、Claude、Copilot 等）有**强制约束力**。

| # | 约束 | 理由 |
|:---|:---|:---|
| 1 | 禁止建议安装未经 §3 审查清单的第三方包 | 防引入恶意/不必要依赖 |
| 2 | 版本范围 `^`/`~` 可用；但**不得**弱化 `--frozen-lockfile` CI 安装或 `minimumReleaseAge: 10080` | 锁文件 + 冷却才是版本护栏；离了它们 `^` 即裸露 |
| 3 | 禁止 `pnpm install --force` / `--shamefully-hoist` | 跳过检查 / 破坏依赖隔离 |
| 4 | 禁止 import 未在 `package.json` 声明的包 | pnpm 严格隔离已兜底，仍不得引入幽灵依赖 |
| 5 | 禁止弱化 `pnpm-workspace.yaml` 的 `minimumReleaseAge` / `.npmrc` 的 `registry`+`strict-ssl` | 防弱化安全基线 |
| 6 | 禁止设 `dangerouslyAllowAllBuilds: true`、关闭 `blockExoticSubdeps`/`strictDepBuilds` | 防绕过构建白名单与异源拦截 |
| 7 | 禁止 `eval()` / `Function()` 动态执行外部代码 | 防代码注入 |

推荐：优先 Web 标准 API 与 Node 内置模块；确需第三方时选零依赖、OpenJS/官方维护、socket.dev 无告警的包。

---

## 6. 完整策略设置（`pnpm-workspace.yaml`）

```yaml
minimumReleaseAge: 10080  # 7 天冷却（分钟）；一旦显式配置，minimumReleaseAgeStrict 默认 true
minimumReleaseAgeExclude:  # 个别平台二进制需即时安装，按需排除
  - '@oxlint/binding-darwin-arm64@1.72.0'
  # ...
  - oxlint@1.72.0
```

`.npmrc`（pnpm 11 仅读注册表/认证类）：

```ini
registry=https://registry.npmjs.org/
strict-ssl=true
```

`package.json`：`packageManager: pnpm@11.9.0`、`engines.node: >=20.0.0`。认证令牌一律经环境变量注入，禁止写入 `.npmrc`。

可选增强 `trustPolicy: no-downgrade`（防信任降级版被装）：实测对本仓库会拒掉 `semver@6.3.1`（旧传递依赖缺 provenance），启用须配 `trustPolicyExclude` 并先跑 frozen 安装确认。

---

## 7. 应急响应

发现可疑依赖/已执行恶意安装脚本：立即停止开发 →（如已执行）断网 → 检查环境变量/进程/网络连接 → 轮换可能泄露的凭证 → 从已知安全的 `pnpm-lock.yaml` 恢复。

快速排查：

```bash
pnpm audit --audit-level=high
pnpm ls --all --depth Infinity       # 完整依赖树
pnpm why <pkg>                       # 传递路径
lsof -i -P | grep node               # 异常网络连接 (macOS)
pnpm config get registry             # 当前生效注册表
```

---

## 8. 定期维护

| 频率 | 任务 |
|:---|:---|
| 每次 PR | 审查 `pnpm-lock.yaml` diff；新增/升级依赖走 §3 清单（发布 ≥ 7 天） |
| 每周 | `pnpm audit --audit-level=high` |
| 每月 | 审查完整依赖树、移除未使用依赖、评估改用原生 API |
| 每季度 | 升级 pnpm/node；复核本规范与 [pnpm 供应链文档](https://pnpm.io/zh/supply-chain-security) 是否需更新 |

---

## 参考

- [pnpm — 缓解供应链攻击](https://pnpm.io/zh/supply-chain-security) · [设置](https://pnpm.io/zh/settings) · [从 v10 迁移到 v11](https://pnpm.io/zh/migration)
- [Socket.dev](https://socket.dev)（行为分析）· [nx 被攻陷案例](https://socket.dev/blog/nx-packages-compromised)