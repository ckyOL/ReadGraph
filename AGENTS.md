# Repository Guidelines

ReadGraph is a **pure-frontend** personal reading archive: users import library/Libby borrow-export files (JSON/CSV), which normalize into `Book`, `CatalogRecord`, and `BorrowCycle` entities stored in the browser (IndexedDB). All data stays client-side; there is no backend.

## AI Agent Exploration Budget

Keep repository exploration shallow unless the user explicitly asks for a deep audit, debugging session, implementation, or code review.

Default exploration budget:

- Run at most 5 shell commands before answering.
- Prefer `git status --short`, `git log --oneline -5`, `README.md`, `package.json`, and directly relevant files.
- Do not scan the whole repository with broad `find`, broad `rg`, recursive `cat`, or multi-package file walks unless necessary.
- Do not inspect more than 3 recent commits unless the user asks about history or release context.
- Do not inspect generated, vendored, build, cache, or dependency directories.

Stop criteria:

- Stop exploring and answer once there is enough evidence for a useful response.
- If more context would be helpful but not essential, state the assumption instead of continuing to call tools.
- If a request is ambiguous, ask a concise clarification instead of expanding the search.

For proactive, background, suggestion, title-generation, or recommendation tasks:

- Use at most 3 shell commands.
- Prefer current git status, the last 5 commits, and obvious untracked files.
- Generate suggestions from visible high-signal context only.
- Do not perform test coverage audits unless the user explicitly asks for test recommendations.
- If the task cannot be completed with shallow context, return fewer suggestions or no suggestions.

Preferred targeted commands:

- `git status --short`
- `git log --oneline -5`
- `ls`
- `rg --files <specific-dir>`
- `sed -n '1,120p' <specific-file>`

## Project Structure & Module Organization

```
ReadGraph/
├─ docs/                 # Specs, design decisions, data models (source of truth)
├─ docs/specs/           # Feature specs: ui-navigation, data-layer, import-pipeline, reading-profile, settings
├─ docs/tasks/           # Milestone task breakdowns (e.g. ui-unified-batch)
├─ docs/metadata/        # Entity schemas: book, catalog-record, borrow-cycle, source, internal-schema
├─ docs/metadata/parsers/  # Parser design + contribution guide
├─ szlib_scraper/        # Standalone Python tool fetching Shenzhen Library borrow history
└─ src/                  # Vite + React 19 + TS app (planned; see docs/app-spec.md)
```

Design intent lives in docs before code. Read [README.md](README.md), [docs/design-decisions.md](docs/design-decisions.md), and [docs/ai-agent-workflow-rules.md](docs/ai-agent-workflow-rules.md) before changing behavior.

> Directory layout and scaffold plan are maintained in [docs/app-spec.md §3](docs/app-spec.md); if the tree above drifts, app-spec is authoritative.

## Build, Test, and Development Commands

The frontend uses **pnpm 11** with a locked supply chain (see [pnpm-workspace.yaml](pnpm-workspace.yaml) and [.npmrc](.npmrc)):

```bash
pnpm install --frozen-lockfile   # CI-required; never plain install
pnpm dev                          # Vite dev server
pnpm build                        # type-check + production build
pnpm test                         # Vitest unit/integration tests
pnpm verify                        # 安装(frozen) + 供应链策略复校验
pnpm audit --audit-level=high     # security audit

> 任务期间启动的进程（`pnpm dev`、Playwright、Puppeteer/headless Chrome 等）必须在任务完成时立即关闭并释放端口，禁止遗留残留进程；完整规矩见 [docs/ai-agent-workflow-rules.md §3](docs/ai-agent-workflow-rules.md)。
> 并行 worktree 开发时每个 worktree 必须显式分配互不冲突的端口（`pnpm dev --port <N>`），禁止依赖默认端口或自动递增；规矩见 [docs/ai-agent-workflow-rules.md §4](docs/ai-agent-workflow-rules.md)。
```

For the scraper (Python >= 3.10, `uv` preferred):

```bash
cd szlib_scraper
uv venv && uv pip sync requirements.txt
uv run szlib_scraper.py
```

> Authoritative build/script contract and security baseline live in [docs/app-spec.md §4/§5](docs/app-spec.md) and [docs/npm-supply-chain-security.md](docs/npm-supply-chain-security.md); on conflict, those docs win. Full scraper setup details are in [szlib_scraper/README.md](szlib_scraper/README.md); this block is a quickstart.

## Coding Style & Naming Conventions

- TypeScript strict mode, React 19, Tailwind + shadcn/ui components, Dexie + Zod for data.
- 版本范围可用 `^`：pnpm 11 下 `pnpm-lock.yaml` frozen 提交 + `minimumReleaseAge: 10080`（7 天冷却）即真正的版本护栏；CI 必须 `--frozen-lockfile`。禁 `--force`/`--shamefully-hoist`。新增依赖仍走 [docs/npm-supply-chain-security.md](docs/npm-supply-chain-security.md) 审查清单。
- Times are stored as **UTC** ISO 8601; Parsers convert local time using `source.timezone` (e.g. `Asia/Shanghai`).
- Dedup physical copies by `sourceId + barcode`, merge books by `isbn13`, fall back to title+author (flag for review).
- UI 文案禁止硬编码：可见文本必须经 `react-i18next` 的 `t()` 取值，不得在 JSX 中直接写中英文字面量。

> These are one-line summaries. Canonical rules for UTC storage and dedup live in [docs/design-decisions.md](docs/design-decisions.md); supply-chain and version-range rules live in [docs/npm-supply-chain-security.md](docs/npm-supply-chain-security.md); i18n rules live in [docs/i18n-conventions.md](docs/i18n-conventions.md).

## Testing Guidelines

Follow **SDD + TDD** ([docs/ai-agent-workflow-rules.md](docs/ai-agent-workflow-rules.md)): agree on a spec first, write failing tests, then implement to green.

- Unit/integration: **Vitest**. E2E: **Playwright**.
- Run locally: `pnpm test`. New core logic must ship with test cases.

> The feature spec index and acceptance gates live in [docs/app-spec.md §6](docs/app-spec.md) and the per-feature specs under [docs/specs/](docs/specs/); the SDD+TDD workflow itself is authoritative in [docs/ai-agent-workflow-rules.md](docs/ai-agent-workflow-rules.md).

## Contributing a Parser

Parsers implement the `SourceParser` interface under `src/parsers/` and must run in-browser (no Node-only APIs). Base parse logic on **real captured data**, desensitize any mock data in PRs, and follow [docs/metadata/parsers/contributing-parser.md](docs/metadata/parsers/contributing-parser.md).

## Commit & Pull Request Guidelines

This repo uses **Conventional Commits**, seen in history as `feat:`, `docs:`, `refactor(scope):`, `fix:`. Keep messages short and scoped (e.g. `refactor(metadata): add metaIdKey`).

PRs should: reference the spec/issue, describe the data flow change, attach desensitized sample data for parser work, and confirm `pnpm install --frozen-lockfile`, `pnpm build`, and tests pass. Do not weaken security settings in [.npmrc](.npmrc) (registry/`strict-ssl`) or `pnpm-workspace.yaml` (`minimumReleaseAge: 10080`); any new dependency needs the supply-chain review checklist in [docs/npm-supply-chain-security.md](docs/npm-supply-chain-security.md).
