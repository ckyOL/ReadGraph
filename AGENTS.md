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
- Open-source contributions follow the standard process: read `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md` before opening issues/PRs; issue/PR templates live in `.github/`.
- Privacy before commit: fixtures/samples from real captures must be desensitized — scrub
  reader `cardno` and IPs, and fictionalize titles/authors/branch names while keeping the
  structural features parsers exercise (subtitle/parallel-title/volume/author delimiters).
  Raw exports (e.g. `bugfile/`, Libby JSON) and anything containing live cardno/IP must never
  be committed.

## Commands

```bash
pnpm install --frozen-lockfile   # required; never plain install
pnpm dev                          # Vite dev server
pnpm build                        # type-check + production build
pnpm test                         # Vitest unit/integration tests
pnpm verify                       # frozen install + supply-chain re-check
pnpm audit --audit-level=high     # security audit
```

CI (GitHub Actions, `.github/workflows/ci.yml`): gates are verify/lint/build/test/e2e/audit — all must be green before merge.

Scraper (Python ≥3.10, uv): `cd szlib_scraper && uv sync && uv run szlib_scraper.py`

## Conventions

- Stack: TS strict, React 19, Tailwind + shadcn/ui, Dexie + Zod. pnpm 11 with
  `minimumReleaseAge: 10080` is the version guard; `--force`/`--shamefully-hoist` forbidden;
  new deps need the supply-chain checklist (`docs/npm-supply-chain-security.md`).
  The shadcn CLI is not a dependency: add new components on demand with
  `pnpm dlx shadcn@latest add <name>` — ephemeral, records no dependency;
  `components.json` is retained for component config.
- Commits: Conventional Commits, short and scoped (e.g. `refactor(metadata): add metaIdKey`), subject and body written in English.
- Parsers: implement `SourceParser` under `src/parsers/`, in-browser only (no Node-only APIs),
  built on real captured data — see `docs/metadata/parsers/contributing-parser.md`.
- Canonical rules: `docs/design-decisions.md` (times, dedup), `docs/i18n-conventions.md`,
  `docs/ai-agent-workflow-rules.md` (SDD+TDD, process/port hygiene), `docs/app-spec.md` (§4 scripts, §5 security, §6 spec index).
- PRs: reference the spec, describe the data flow, attach desensitized samples for parser work;
  never weaken `.npmrc` (registry/`strict-ssl`) or `pnpm-workspace.yaml` (`minimumReleaseAge`).

## Release

Releases are cut from the merged `main` branch only, after full verification:

1. **Bump version** — set `version` in `package.json` to the new SemVer (e.g. `1.1.0`).
   The version is not recorded in `pnpm-lock.yaml`; do not regenerate the lockfile for
   a bump alone.
2. **Update `CHANGELOG.md`** — move the corresponding entries out of `[Unreleased]`
   into a dated, versioned section (Keep a Changelog + SemVer).
3. **Gates green** — on the release branch run, in order:
   `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm audit`. All must pass before tagging.
4. **Commit & tag** — commit the bump (Conventional Commits, e.g.
   `chore(release): bump to 1.0.0`), then:
   `git tag -a v1.0.0 -m "v1.0.0"` (annotated tag on the release commit).
5. **Push tag** — `git push origin main --tags`.
6. **Create release** — `gh release create v1.0.0 --notes-file CHANGELOG.md`.

The tag must be annotated, the release notes must come from `CHANGELOG.md`, and the
tag version must match the `package.json` version.
