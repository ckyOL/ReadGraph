# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Borrow calendar heatmap** — new 6th chart tab on the reading profile page
  (adaptation of the Bookology Stats calendar, see `docs/bookology-benchmark.md`
  §5.1): each day cell counts distinct books held in borrow that day (UTC day
  buckets, device borrows excluded); month/year views with navigation, borrow-day
  summary in the overview row ("Borrow days", 5th card), and a per-day tooltip
  listing titles with cover thumbnails. Aggregated by a new pure `calendar`
  dimension in `computeProfileStats` (open-ended cycles anchored to a
  caller-supplied "today"); rendered with the ECharts heatmap series — no new
  dependencies.
- **Classification badge tooltip** — replaced the native `title` tooltip with a
  Radix-powered styled tooltip (paper-ink: square corners, theme popover colors,
  per-line breadcrumb with mono codes; partial-tree hint and auxiliary segment
  kept, now visually distinct).

### Planned

- Full PWA support: installable app manifest and offline-first data layer (service
  worker) so the archive works fully offline.
- Versioned data migrations with a documented upgrade path between releases.
- Further CWV budget enforcement (LCP/INP/CLS) and performance regression gates in CI.

## [1.0.0] - 2026-08-18

First stable release. ReadGraph is a pure-frontend personal reading archive: import
borrow/return exports from your public library or e-book platform, and turn them into
a reading profile with charts. No backend, no accounts — all data stays in the browser.

### Added

- **Pure-frontend SPA** — React 19 + TypeScript (strict) + Vite + Tailwind CSS v4 +
  shadcn/ui component set, with TanStack Router file-based routing and IndexedDB
  persistence through Dexie.
- **szlib import pipeline & parsers** — multi-step import wizard accepting JSON/CSV
  from Shenzhen Library (`szlib`) and Libby; encoding detection; borrow/return cycle
  synthesis across files, cross-file deduplication by barcode → ISBN → title+author,
  and UTC timezone normalization with IANA timezone handling (`@vvo/tzdb`).
- **OPAC enrichment** — page-by-page catalog lookups that auto-fill missing metadata
  (translators, ISBN-10, description, cover, owning branch) with field-level
  old/new compare before applying.
- **Classification** — Chinese Library Classification (CLC) hierarchy with breadcrumb
  drill-down and deep classification badges; classification data is supplied by the
  user as a JSON file (nothing bundled in the repo).
- **Reading profile & charts** — ECharts 6 visualizations: reading rhythm timeline,
  treemap drill-down with breadcrumbs, Gantt-style viewport, and money stats
  (spending and price distribution). Device (e-reader) borrows are tracked but
  excluded from stats.
- **Library management** — responsive three-tier list with card grid, sorting,
  filtering, deep classification badges; unified book/catalog editing with manual
  review for placeholders and set volumes.
- **Settings** — timezone-aware city picker, zh-CN / English UI switching, backup &
  restore, system reset, and debug mode.
- **Tooling** — GitHub Actions CI with verify/lint/build/test/e2e/audit gates;
  szlib scraper (`szlib_scraper/`) with mocked pytest coverage; third-party notices
  generator; tz-cities and CLC-tree data generators.

### Changed

- Reading-profile stats are computed in a Web Worker (`computeProfileStats`) with a
  reactive hook (`useProfileStats`) so charts never block the main thread.
- Import report is a single-screen wizard with stacked stat cards and row-level
  status; useless rows are filtered before preview and storage.
- Chart theme and design tokens centralized per `DESIGN.md` (density, scan-reading,
  CJK composition and contrast guidance).
- ECharts upgraded 5.6 → 6.1, TypeScript upgraded to 7, remaining runtime and E2E
  dependencies bumped to range ceiling (pnpm 11 with `minimumReleaseAge` guard).

### Fixed

- Borrow-cycle synthesis: open cycles are closed by later return rows, cycles survive
  re-import, empty-barcode cycles pair by metaId, same-ISBN batch books merge, and
  fuzzy title+author matches are flagged for review.
- Import integrity: all-invalid files are rejected, filtered rows are tracked,
  referential integrity is validated, and existing catalogs are preserved across
  cross-file imports.
- Enrichment robustness: missing title/isbn keys report `not_found`, string `'0'`
  metaId is rejected, HTML entities are decoded, status-write failures are contained,
  and parenthesized prices / year suffixes parse correctly.
- Data layer: classCodes are derived on every write path with legacy backfill and
  self-healing on read; boolean index cleanup; publishDate normalization centralized.
- Profile/UI polish: chart dates formatted in the right timezone, worker failure
  overlay, invalid-currency crash fixed, mobile stat-card stacking, filters kept
  across detail round-trips.

### Security

- MIT license added with generated third-party notices (`THIRD_PARTY_NOTICES.md`);
  npm supply-chain baseline migrated to pnpm 11 native controls (`minimumReleaseAge`)
  with a hardened `.npmrc` (strict registry/SSL, advisories patched).
- **Content-Security-Policy** meta injected into the production build
  (`default-src 'self'`, strict `script-src`, `connect-src` limited to the OPAC
  origin) plus `referrer-policy: strict-origin-when-cross-origin`; dev server is
  intentionally left unconstrained.
- **External-link scheme whitelist** — `isSafeExternalUrl` permits `https:` only;
  the render layer refuses anything else (defense-in-depth against `javascript:`-style
  injection from future URL-constructing providers).
- Scraper masks card numbers in logs and refuses partial writes; raw exports
  containing live card numbers/IPs are never committed.

### Accessibility

- WCAG 2.2 Level AA: labeled filter controls, validated inverted date ranges,
  localized error messages (3.3.1/3.3.3), localized component accessible names
  (3.1.2), chart alt text and keyboard list-view drill (1.1.1/2.1.1), aria-busy/live
  status announcements and 24px touch targets (4.1.3/2.5.8), and localized list
  separators via `Intl.ListFormat`.

### Docs

- Bilingual documentation: English-primary README with 简体中文 counterpart,
  bilingual contribution guide and code of conduct, issue/PR templates.
- Spec-driven development: `docs/app-spec.md` hub with section specs (data layer,
  import pipeline, reading profile, settings/backup, UI navigation), design
  decisions, metadata/parser contributor guides, and AI-agent workflow rules
  (SDD+TDD, process and port hygiene).
