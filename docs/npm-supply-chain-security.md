# npm 供应链安全规范

> **适用范围**: ReadGraph 项目全体贡献者与 AI 编码代理  
> **生效日期**: 2026-06-15  
> **最后更新**: 2026-06-15  
> **严重等级**: 🔴 强制执行

---

## 1. 威胁模型概述

npm 生态系统已进入「高后果」威胁阶段。以下是当前活跃的主要攻击向量：

| 攻击类型 | 机制 | 真实案例 | 危害 |
|:---|:---|:---|:---|
| **恶意安装脚本** | `preinstall` / `postinstall` 在 `npm install` 时自动执行任意代码 | Shai-Hulud 蠕虫 (2025-2026) | 窃取凭证、环境变量、SSH 密钥；下载二阶段载荷 |
| **账户劫持** | 攻击者获取维护者账号，向合法包注入恶意代码 | Axios 劫持事件 (2026.03) | 影响所有下游依赖者，波及面极广 |
| **拼写仿冒 (Typosquatting)** | 注册与热门包名称相似的恶意包 | 持续性大规模活动 | 开发者一次拼写错误即可中招 |
| **依赖混淆 (Dependency Confusion)** | 在公共注册表发布与内部包同名的包 | 企业级攻击活动 (2026.05) | CI/CD 环境自动拉取恶意公共包 |
| **蠕虫式传播** | 自动化入侵维护者账户 → 注入恶意代码 → 重新发布 | Shai-Hulud | 链式感染，指数级扩散 |

> [!CAUTION]
> 传递依赖 (transitive dependencies) 中深层嵌套的恶意包同样会在安装时执行脚本。你明确信任的顶层包并不能保证其 **整棵依赖树** 的安全。

---

## 2. 强制安全配置

### 2.1 项目级 `.npmrc`

项目根目录**必须**存在以下 `.npmrc` 配置，且**禁止**被 `.gitignore` 排除：

```ini
# ===================================================
# ReadGraph npm 安全加固配置
# 本文件受版本控制，未经安全审查不得修改
# ===================================================

# [关键] 禁止安装脚本自动执行
# 防止 preinstall / install / postinstall 脚本运行任意代码
ignore-scripts=true

# [关键] 强制精确版本锁定
# 防止 caret (^) 范围允许自动升级到恶意版本
save-exact=true

# [关键] 新包冷却期 — 7 天
# 绝大多数恶意包在发布后数小时至数天内被社区发现并移除
# 此设置拒绝安装发布不满 7 天的包版本
min-release-age=7d

# [重要] 启用安全审计
audit=true
audit-level=high

# [重要] 仅使用官方 npm 注册表
registry=https://registry.npmjs.org/

# [安全] 强制 HTTPS
strict-ssl=true

# [安全] 禁止从 git URL 直接安装依赖
# 防止绕过注册表安全检查
# allow-git=false  # npm v12+ 默认生效
```

> [!IMPORTANT]
> **`.npmrc` 文件不得包含任何认证令牌 (token)**。认证信息必须通过环境变量注入，且 `.npmrc` 中的认证相关行必须使用 `${NPM_TOKEN}` 占位符语法。

### 2.2 `package.json` 安全字段

```jsonc
{
  // 锁定 Node.js 和 npm 版本范围
  "engines": {
    "node": ">=20.0.0",
    "npm": ">=11.16.0"
  },
  "engineStrict": true,

  // npm v12+ 脚本白名单（仅允许已审计的包执行脚本）
  // 在升级到 npm v12 后启用
  // "allowScripts": {
  //   "<package-name>": true
  // }
}
```

---

## 3. Lockfile 安全规范

### 3.1 基本规则

| 规则 | 说明 |
|:---|:---|
| ✅ **必须提交** | `package-lock.json` 必须纳入版本控制 |
| ✅ **CI 使用 `npm ci`** | CI/CD 管线**必须**使用 `npm ci` 而非 `npm install` |
| ✅ **审查 lockfile diff** | PR 中 lockfile 的变更必须作为**安全敏感变更**进行人工审查 |
| ❌ **禁止手动编辑** | 不得直接修改 lockfile 内容 |

### 3.2 Lockfile 校验

每次 CI 构建**必须**执行 lockfile 完整性校验：

```bash
# 校验 lockfile 完整性
npx lockfile-lint \
  --path package-lock.json \
  --allowed-hosts npm \
  --validate-https \
  --validate-integrity
```

### 3.3 lockfile 异常告警信号

在审查 PR 中的 lockfile 变更时，以下情况**必须**触发安全审查：

- `resolved` 字段指向非 `https://registry.npmjs.org/` 的源
- 版本号异常跳跃（如从 `1.2.3` 直接升到 `9.0.0`）
- 出现从未在 `package.json` 中声明的新包
- `integrity` 校验哈希发生意外变化

---

## 4. 依赖管理工作流

### 4.1 添加新依赖 — 安全审查清单

在引入**任何**新依赖前，**必须**完成以下检查：

```markdown
## 新依赖安全审查清单

- [ ] **必要性验证**: 该功能是否可以用已有依赖或原生 API 实现？
- [ ] **包名验证**: 确认包名拼写正确，与 npm 官方页面一致
- [ ] **维护者验证**: 检查包的维护者信息、发布频率、GitHub 仓库活跃度
- [ ] **下载量检查**: 周下载量是否合理？异常低可能是仿冒包
- [ ] **依赖树检查**: 运行 `npm explain <package>` 查看传递依赖数量
- [ ] **安装脚本检查**: 检查包及其依赖是否包含 lifecycle 脚本
- [ ] **行为分析**: 在 socket.dev 查看包的行为分析报告
- [ ] **许可证检查**: 确认许可证与项目兼容
- [ ] **发布时间**: 最新版本发布时间是否超过 7 天？
```

### 4.2 操作命令规范

```bash
# ✅ 正确: 添加新依赖
npm install <package-name> --save-exact --ignore-scripts

# ✅ 正确: CI/CD 环境安装
npm ci --ignore-scripts

# ✅ 正确: 安全审计
npm audit --audit-level=high

# ✅ 正确: 查看依赖树
npm ls --all

# ❌ 禁止: 使用 npm install 安装（CI 环境中）
# npm install

# ❌ 禁止: 使用 latest 标签
# npm install <package>@latest

# ❌ 禁止: 从任意 git URL 安装
# npm install git+https://random-repo.example.com/pkg.git

# ❌ 禁止: 使用 --force 或 --legacy-peer-deps 跳过检查
# npm install --force
```

### 4.3 更新依赖 — 安全流程

```
1. 创建专用分支: git checkout -b deps/update-<package-name>
2. 更新目标包:   npm install <package-name>@<specific-version> --save-exact
3. 执行安全审计:  npm audit
4. 执行 lockfile 校验: npx lockfile-lint ...
5. 运行测试套件:  npm test
6. 提交 PR 并标记为「安全敏感」进行审查
7. 审查 lockfile diff，关注异常信号（见 3.3 节）
```

---

## 5. AI 编码代理约束

> [!WARNING]
> 本节对所有为 ReadGraph 项目生成代码的 AI 编码代理（包括但不限于 Gemini、Claude、Copilot）具有**强制约束力**。

### 5.1 禁止事项

| # | 约束 | 理由 |
|:---|:---|:---|
| 1 | **禁止**建议安装未经审查的第三方包 | 防止引入恶意或不必要的依赖 |
| 2 | **禁止**使用 `^` 或 `*` 版本范围 | 防止自动升级到被劫持的版本 |
| 3 | **禁止**建议运行 `npm install --force` | 防止跳过安全和完整性检查 |
| 4 | **禁止**在代码中 `require()` 或 `import` 未在 `package.json` 中声明的包 | 防止隐式依赖引入不安全的幽灵依赖 |
| 5 | **禁止**建议修改 `.npmrc` 安全配置 | 防止弱化安全基线 |
| 6 | **禁止**建议使用 `eval()`、`Function()` 动态执行来自外部的代码 | 防止代码注入 |
| 7 | **禁止**建议禁用 `strict-ssl` 或切换到非 HTTPS 注册源 | 防止中间人攻击 |

### 5.2 推荐实践

- 优先使用 **Web 标准 API** 和 **Node.js 内置模块**，减少外部依赖
- 如确需第三方依赖，优先选择：
  - 零依赖 (zero-dependency) 的包
  - npm 官方推荐 / OpenJS 基金会维护的包
  - 在 socket.dev 上无告警的包
- 生成的 `package.json` 必须使用精确版本号

---

## 6. `.gitignore` 安全规则

以下文件**必须**被 `.gitignore` 排除，防止泄露敏感信息：

```gitignore
# 依赖目录 — 禁止提交
node_modules/

# 环境变量文件 — 可能包含令牌
.env
.env.*
!.env.example

# 用户级 npm 配置 — 可能包含认证令牌
# 注意: 项目级 .npmrc (不含 token) 必须提交
~/.npmrc
```

> [!IMPORTANT]
> 项目级 `.npmrc`（位于项目根目录）**必须提交**到版本控制，但其中**不得包含任何认证令牌**。

---

## 7. 应急响应流程

### 7.1 发现可疑依赖时

```
                    ┌──────────────────┐
                    │ 发现可疑依赖/行为 │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  立即停止开发工作  │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │  断开网络连接     │
                    │  (如已执行脚本)   │
                    └────────┬─────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼──────┐ ┌────▼──────┐ ┌─────▼──────┐
     │ 检查环境变量   │ │ 审查进程   │ │ 检查网络   │
     │ 是否被读取     │ │ 列表      │ │ 连接记录   │
     └────────┬──────┘ └────┬──────┘ └─────┬──────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼─────────┐
                    │ 轮换所有可能泄露  │
                    │ 的凭证和密钥      │
                    └────────┬─────────┘
                             │
                    ┌────────▼─────────┐
                    │ 从已知安全的       │
                    │ lockfile 恢复     │
                    └──────────────────┘
```

### 7.2 快速检查命令

```bash
# 检查是否有包包含安装脚本
npm query ':attr(scripts, [preinstall]), :attr(scripts, [install]), :attr(scripts, [postinstall])'

# 审计已知漏洞
npm audit

# 查看完整依赖树
npm ls --all --depth=Infinity

# 检查异常网络连接 (macOS)
lsof -i -P | grep node

# 检查当前 npm 配置是否安全
npm config list
```

---

## 8. 定期安全维护

| 频率 | 任务 |
|:---|:---|
| **每次 PR** | 审查 lockfile diff；对新增依赖执行安全审查清单 |
| **每周** | 运行 `npm audit`；检查是否有已知漏洞的依赖 |
| **每月** | 审查完整依赖树；移除未使用的依赖；评估是否可替换为原生 API |
| **每季度** | 更新 Node.js / npm 版本；审查本规范是否需要更新 |

---

## 9. 推荐安全工具

| 工具 | 用途 | 集成位置 |
|:---|:---|:---|
| `lockfile-lint` | lockfile 完整性校验 | CI pipeline |
| `socket.dev` | 行为分析，检测「CVE-less」威胁 | PR review / GitHub App |
| `npm audit` | 已知 CVE 漏洞扫描 | CI pipeline / 本地 |
| `npm query` | 查询包含安装脚本的依赖 | 本地开发 |
| `Renovate` / `Dependabot` | 自动化依赖更新 (配合冷却期) | GitHub Actions |

---

## 附录 A: 安全配置速查

```bash
# 一键验证当前项目安全配置是否合规
echo "=== npm 安全配置检查 ==="
echo "ignore-scripts: $(npm config get ignore-scripts)"
echo "save-exact: $(npm config get save-exact)"
echo "audit: $(npm config get audit)"
echo "strict-ssl: $(npm config get strict-ssl)"
echo "registry: $(npm config get registry)"
echo "min-release-age: $(npm config get min-release-age)"
echo "========================="
```

## 附录 B: 参考资料

- [npm v12 Breaking Changes — GitHub Blog](https://github.blog)
- [Socket.dev — 包行为分析](https://socket.dev)
- [lockfile-lint — npm](https://www.npmjs.com/package/lockfile-lint)
- [Shai-Hulud Worm Analysis — Palo Alto Networks](https://paloaltonetworks.com)
- [npm 安全最佳实践 — npm Docs](https://docs.npmjs.com)
