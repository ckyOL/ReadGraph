# ReadGraph

Pure-frontend personal reading archive: import library/Libby borrow-export files (JSON/CSV) →
`Book`, `CatalogRecord`, `BorrowCycle` entities in IndexedDB. No backend; all data stays in the browser.

## Rules of thumb

- Explore shallowly by default: targeted `read`/`grep`/`glob` first; stop once you have enough evidence.
- Design intent lives in `docs/` before code. Read `docs/design-decisions.md` and
  `docs/ai-agent-workflow-rules.md` before changing behavior; `docs/app-spec.md` owns layout/scaffold (§3).
- Times are UTC ISO 8601; parsers convert local time via `source.timezone`.
- Dedup physical copies by `sourceId + barcode`; merge books by `isbn13`, fallback title+author (flag for review).
- UI text MUST go through `react-i18next` `t()` — never literal strings in JSX.
- SDD + TDD: agree on a spec, write failing tests, then implement to green.

## Commands

```bash
pnpm install --frozen-lockfile   # required; never plain install
pnpm dev                          # Vite dev server
pnpm build                        # type-check + production build
pnpm test                         # Vitest unit/integration tests
pnpm verify                       # frozen install + supply-chain re-check
pnpm audit --audit-level=high     # security audit
```

Scraper (Python ≥3.10, uv): `cd szlib_scraper && uv venv && uv pip sync requirements.txt && uv run szlib_scraper.py`

## Conventions

- Stack: TS strict, React 19, Tailwind + shadcn/ui, Dexie + Zod. pnpm 11 with
  `minimumReleaseAge: 10080` is the version guard; `--force`/`--shamefully-hoist` forbidden;
  new deps need the supply-chain checklist (`docs/npm-supply-chain-security.md`).
- Commits: Conventional Commits, short and scoped (e.g. `refactor(metadata): add metaIdKey`).
- Parsers: implement `SourceParser` under `src/parsers/`, in-browser only (no Node-only APIs),
  built on real captured data — see `docs/metadata/parsers/contributing-parser.md`.
- Canonical rules: `docs/design-decisions.md` (times, dedup), `docs/i18n-conventions.md`,
  `docs/ai-agent-workflow-rules.md` (SDD+TDD, process/port hygiene), `docs/app-spec.md` (§4 scripts, §5 security, §6 spec index).
- PRs: reference the spec, describe the data flow, attach desensitized samples for parser work;
  never weaken `.npmrc` (registry/`strict-ssl`) or `pnpm-workspace.yaml` (`minimumReleaseAge`).
