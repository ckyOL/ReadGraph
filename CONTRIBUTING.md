# Contributing to ReadGraph

**English** · [简体中文](./CONTRIBUTING-zh.md)

Thanks for taking the time to contribute. ReadGraph is a pure-frontend personal reading archive: import borrow/return exports from your library or e-book platform, and get a reading profile with charts — all data stays in your browser.

This guide explains how to report issues, request features, and submit changes. It is the contract for every contribution: spec first, tests first, privacy first.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [How to Contribute](#how-to-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Requesting Features](#requesting-features)
  - [Contributing a Parser](#contributing-a-parser)
  - [Documentation & Translations](#documentation--translations)
- [Development Workflow: SDD + TDD](#development-workflow-sdd--tdd)
- [Coding Conventions](#coding-conventions)
- [Testing & Verification](#testing--verification)
- [Dependencies & Supply Chain](#dependencies--supply-chain)
- [Privacy & Data Handling](#privacy--data-handling)
- [Commit Message Conventions](#commit-message-conventions)
- [Pull Request Checklist](#pull-request-checklist)
- [Review Process](#review-process)
- [License](#license)

## Code of Conduct

Be respectful, constructive, and inclusive. By participating in this project you agree to uphold our [Code of Conduct](./CODE_OF_CONDUCT.md). Reports of unacceptable behavior should be directed to the maintainers via a private email or DM; see the Code of Conduct for details.

## Getting Started

### Prerequisites

- Node.js ≥ 20 (`engines.node` is enforced)
- pnpm 11 — the repo pins `packageManager: pnpm@11.9.0` and must never be installed with a different package manager

### Install & run

```bash
pnpm install --frozen-lockfile   # required — never plain install
pnpm dev                         # Vite dev server → http://localhost:5173
```

> Never run plain `pnpm install`, `pnpm install --force`, or `--shamefully-hoist` — see [Dependencies & Supply Chain](#dependencies--supply-chain).

### Useful scripts

| Command | Purpose |
|---------|---------|
| `pnpm dev` | Dev server (Vite) |
| `pnpm build` | Type-check + production build |
| `pnpm preview` | Preview the production build |
| `pnpm test` | Unit / integration tests (Vitest) |
| `pnpm test:e2e` | End-to-end tests (Playwright) |
| `pnpm lint` | Lint (oxlint) |
| `pnpm verify` | Frozen install + supply-chain re-check |
| `pnpm audit --audit-level=high` | Security audit |
| `pnpm generate:notices` | Regenerate `THIRD_PARTY_NOTICES.md` |
| `pnpm generate:cities` | Regenerate the tzdb city list |
| `pnpm check:classification-data` | Validate the classification JSON |

Scraper tooling (Python ≥ 3.10, uv): `cd szlib_scraper && uv sync && uv run szlib_scraper.py`.

### Repository layout

```
src/            App code: parsers/, db/, lib/, routes/, components/
docs/           Specs & conventions — read before changing behavior
  specs/          Feature specs (import pipeline, OPAC enrichment, …)
  metadata/       Data model & parser guides
e2e/            Playwright end-to-end tests
tests/          Vitest unit/integration tests
szlib_scraper/  Python scraper for Shenzhen Library borrow history
scripts/        Codegen & validation scripts
```

## How to Contribute

### Reporting Bugs

Open an issue using the [bug report template](./.github/ISSUE_TEMPLATE/bug_report.md). A good report includes:

1. Steps to reproduce (imported file shape, actions taken).
2. Expected vs. actual behavior.
3. Environment: browser & version, OS, app version/commit.
4. Data source (which library / platform the export came from).

**Privacy before anything:** never attach raw exports or screenshots containing reader card numbers, IPs, or real names. Desensitize first — see [Privacy & Data Handling](#privacy--data-handling).

### Requesting Features

ReadGraph is **spec-driven (SDD)**: no feature gets implemented without an agreed specification. When requesting a feature:

1. Describe the problem you're trying to solve, not just a desired UI.
2. Outline the proposed behavior, and for UI work include layout / interaction notes.
3. Reference related specs in [docs/specs/](./docs/specs/) if any.

The maintainers will help you shape a spec in the issue before any code is written. See [Development Workflow](#development-workflow-sdd--tdd).

### Contributing a Parser

New library/platform parsers are the most impactful contributions — the project aims to support libraries worldwide. Follow the dedicated guide: [docs/metadata/parsers/contributing-parser.md](./docs/metadata/parsers/contributing-parser.md).

Requirements in short:

- **Real captured data only** — no imagined or "ideal report" shapes; capture real API responses via the browser Network panel.
- Browser-only implementation of the `SourceParser` contract — no Node-only APIs (`fs`, …).
- Convert local times to UTC ISO 8601 via `source.timezone`.
- Register the parser and add a source template for one-click use.
- Attach **desensitized** sample data as unit test fixtures.

### Documentation & Translations

- Behavior changes must update the relevant spec in `docs/specs/`.
- User-facing changes must update both [README.md](./README.md) and [README-zh.md](./README-zh.md).
- Keep docs consistent with the existing conventions; a second convention beside an existing one is prohibited.

## Development Workflow: SDD + TDD

Every code change follows this loop:

1. **Spec** — agree on the specification (a `docs/specs/` doc or a detailed issue) including UI design notes for frontend work. Read the existing design intent first: `docs/design-decisions.md`, `docs/app-spec.md`.
2. **Tests (Red)** — write failing tests first: Vitest for unit/integration, Playwright for e2e/UI. Verify they fail against the current code, proving they can catch regressions.
3. **Code (Green)** — implement the minimal change that makes the tests pass.
4. **Refactor** — clean up (DRY, naming, performance) under the protection of a green suite; never break existing tests.

This workflow is detailed (with process/port hygiene rules) in [docs/ai-agent-workflow-rules.md](./docs/ai-agent-workflow-rules.md).

## Coding Conventions

- **Stack:** TypeScript (strict), React 19, Tailwind CSS v4 + shadcn/ui, Dexie over IndexedDB, Zod for schemas.
- **i18n:** all UI text goes through `react-i18next` `t()` — never literal strings in JSX.
- **Times:** UTC ISO 8601 everywhere; parsers convert local time via `source.timezone`.
- **Dedup:** physical copies by `sourceId + barcode`; merge books by `isbn13`, fallback title+author (flag for review).
- **Parsers:** implement `SourceParser` under `src/parsers/`, in-browser only.
- **Patterns:** reuse existing conventions; explore shallowly (`read`/`grep`/`glob`) before designing.

## Testing & Verification

Before submitting a PR:

1. `pnpm build` — type-check + production build must pass.
2. `pnpm test` — the full Vitest suite must pass; new behavior needs its own tests.
3. `pnpm test:e2e` — run the affected e2e specs (Playwright starts its own build/preview).
4. `pnpm lint` — oxlint clean.

Process hygiene (from [docs/ai-agent-workflow-rules.md](./docs/ai-agent-workflow-rules.md)):

- Kill every process you started (`pnpm dev`, Playwright servers, headless Chrome) when done; confirm ports are released (`lsof -iTCP:<port> -sTCP:LISTEN`).
- Parallel worktrees must use explicit unique ports (`pnpm dev --port 5174`, …) — never rely on Vite auto-increment or reuse an occupied port.

## Dependencies & Supply Chain

The project hardens its supply chain with pnpm 11. Non-negotiable rules:

- `pnpm install --frozen-lockfile` only; commit `pnpm-lock.yaml`.
- `minimumReleaseAge: 10080` (7-day release cooldown) applies to all deps — new packages under 7 days old are rejected.
- **Never** weaken `.npmrc` (`registry`, `strict-ssl`) or `pnpm-workspace.yaml` (`minimumReleaseAge`, `allowBuilds`, `blockExoticSubdeps`); never `--force` or `--shamefully-hoist`; no git-URL/direct-tarball deps.

Any new dependency must complete the review checklist in [docs/npm-supply-chain-security.md](./docs/npm-supply-chain-security.md) and record the outcome in the PR: necessity, package-name spelling (typosquatting), maintainer health, download stats, dependency tree (`pnpm why`), build scripts, behavior scan (socket.dev), license, and release age. Lockfile diffs are security-sensitive — review them manually.

## Privacy & Data Handling

This project is strict about personal data:

- **Never commit** reader card numbers (`cardno`), IP addresses, or real names — in fixtures, samples, screenshots, or raw exports (`bugfile/`, Libby JSON).
- Fixtures/samples from real captures **must be desensitized**: scrub `cardno`/IPs and fictionalize titles, authors, and branch names — while keeping the structural features parsers exercise (subtitles, parallel titles, volumes, author delimiters).
- When in doubt, leave the data out.

## Commit Message Conventions

- Conventional Commits, short and scoped; subject and body in English.
- Examples: `feat(import): support Libby JSON export`, `fix(db): dedupe borrow cycles by barcode`, `refactor(metadata): add metaIdKey`.
- One logical change per commit/PR.

## Pull Request Checklist

- [ ] Behavior change references its spec (`docs/specs/` or the linked issue).
- [ ] Failing tests were written first and pass now; new contracts are covered.
- [ ] `pnpm build`, `pnpm test`, `pnpm lint` pass locally; affected e2e specs pass.
- [ ] No new dependencies — or all went through the supply-chain checklist, with the outcome recorded.
- [ ] Lockfile diff reviewed; no weakened security settings.
- [ ] No personal data committed; fixtures desensitized.
- [ ] Docs updated: relevant spec, README and/or README-zh as needed; `THIRD_PARTY_NOTICES.md` regenerated (`pnpm generate:notices`) if runtime deps changed.
- [ ] PR description explains the change and, for parser work, the data flow.

## Review Process

- Maintainers review every PR; expect questions and requested changes.
- Address all feedback; keep the branch rebased on `main`.
- Parser PRs must include the library/platform name, a short guide to reproducing data capture, and desensitized samples (used as unit tests).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE), the same license as the project.
