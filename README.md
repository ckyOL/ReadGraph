<div align="center">

# ReadGraph

**A personal reading archive & analytics dashboard for your library borrowing history.**

Import borrow/return exports from your public library or e-book platform, and turn them into a reading profile with charts — pure frontend, your data stays in the browser, works fully offline.

![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-7-3178C6)
![Vite](https://img.shields.io/badge/Vite-8-646CFF)
![Tailwind CSS v4](https://img.shields.io/badge/Tailwind%20CSS%20v4-38BDF8)
![ECharts](https://img.shields.io/badge/ECharts-6-AA344D)
![IndexedDB](https://img.shields.io/badge/IndexedDB-Dexie-02569B)
![License](https://img.shields.io/badge/License-MIT-yellow)

**English** · [简体中文](./README-zh.md)

</div>

## Features

- **Import & dedup** — single-screen import wizard; JSON/CSV from multiple sources (Shenzhen Library OPAC first); encoding detection; cross-file merge with dedup by barcode → ISBN → title+author.
- **Library & editing** — filter, sort, and deep classification badges in the book list; unified edit dialog on the detail page; merge / split books; set-volume handling.
- **OPAC enrichment** — auto-fill missing book metadata (translators, ISBN-10, description, cover…) from library catalogs, with field-level old/new compare before applying.
- **Classification** — Chinese Library Classification (CLC) hierarchy with breadcrumb drill-down; classification data is supplied by you as a JSON file, nothing bundled in the repo.
- **Reading profile** — stats and ECharts visualizations: reading rhythm, timeline, treemap, money spent & price distribution. Device borrows (e-readers) are tracked but excluded from stats.
- **Settings** — timezone-aware city picker (tzdb), zh-CN / English UI, backup & restore, full reset, debug mode (`?debug=1`).

## Getting Started

### Prerequisites

- Node.js ≥ 20
- pnpm 11

### Install & run

```bash
pnpm install --frozen-lockfile   # required — never plain install
pnpm dev                         # dev server
```

### Build & test

```bash
pnpm build                       # type-check + production build
pnpm preview                     # preview the production build
pnpm test                        # unit / integration tests (Vitest)
pnpm test:e2e                    # end-to-end tests (Playwright)
pnpm audit --audit-level=high    # security audit
```

## Data Sources

- The app ships with a parser for **Shenzhen Library (深圳图书馆)** exports — `szlib_scraper/` fetches your borrowing history from the library's mobile API.
- Any other source (public library OPAC, Libby, …) implements the `SourceParser` contract — see [contributing-parser.md](./docs/metadata/parsers/contributing-parser.md).
- All data is imported manually from files you own; nothing is fetched at runtime by the app itself (except optional OPAC enrichment you trigger per book).

## Tech Stack

| Layer | Choice |
|-------|--------|
| Framework | React 19 + TypeScript (strict) |
| Build | Vite 8 |
| Routing | TanStack Router (file-based, typed) |
| Storage | Dexie.js over IndexedDB + Zod schemas |
| UI | Tailwind CSS v4 + shadcn/ui |
| Charts | ECharts |
| i18n | i18next (zh-CN / English) |
| Testing | Vitest + Playwright |

## Documentation

| Doc | What it covers |
|-----|----------------|
| [docs/app-spec.md](./docs/app-spec.md) | App spec skeleton & feature-spec index |
| [docs/specs/](./docs/specs/) | Feature specs: import pipeline, OPAC enrichment, classification, reading profile, editing, settings, … |
| [docs/metadata/](./docs/metadata/) | Data model: `Book` / `CatalogRecord` / `BorrowCycle` / `Source`, internal IndexedDB schema |
| [docs/design-decisions.md](./docs/design-decisions.md) | Design decisions & constraints (time handling, dedup, privacy) |
| [DESIGN.md](./DESIGN.md) | Visual design system (theme, typography, components) |
| [AGENTS.md](./AGENTS.md) | Repo conventions & commands (incl. notes for AI coding agents) |

## Privacy & Security

- **Pure frontend** — all data lives in your browser's IndexedDB; nothing is uploaded to any server.
- **Offline-capable** — statically deployable, works without network.
- **Supply-chain hardening** — pnpm 11 with 7-day release cooldown (`minimumReleaseAge`), frozen lockfile, strict SSL; see [docs/npm-supply-chain-security.md](./docs/npm-supply-chain-security.md).
- **No real personal data in the repo** — reader card numbers / IPs must never be committed; fixtures are desensitized.

## License

MIT — see [LICENSE](./LICENSE). Third-party notices for bundled runtime dependencies: [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).

## Contributing

SDD + TDD workflow: agree on a spec (see [docs/ai-agent-workflow-rules.md](./docs/ai-agent-workflow-rules.md)), write failing tests, then implement. All new dependencies go through the supply-chain checklist. PRs reference the relevant spec and attach desensitized samples for parser work.
