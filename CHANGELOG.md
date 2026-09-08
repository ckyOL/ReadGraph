# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Annual share card** — a downloadable/shareable 1080×1440 PNG generated on
  `/profile/$year` from the same `computeYearSlice` slice as the rest of the
  annual view (`docs/specs/reading-profile.md` §4.1): Top-3 cover trio with the
  year's book count as the hero number, Top-3 borrow list, per-row category
  legend, previous-year delta line, and a plain-language summary — drawn on a
  constant light paper canvas (independent of the dark theme) by pure layout
  functions plus a hand-written Canvas 2D renderer (zero new dependencies).
  Covers load progressively with per-slot placeholder fallback; export via
  `canvas.toBlob` download or the Web Share API when supported. Fully local
  (no network, no persistence), field whitelist excludes goals/prices/
  barcodes/ISBN/library names, and all canvas-adjacent strings render through
  `t()` in both locales.
- **Annual share card v2: persona badge, 9:16 story variant, cover collage** —
  three extensions to the annual share card (`docs/specs/reading-profile.md` §4.2),
  all backward-compatible with the v1 3:4 layout (default path byte-identical,
  existing E2E untouched):
  - *Persona badge* — a pure-function derived title line above the summary
    ("《…》的重借大队长" when the top book was borrowed ≥ 3 times, "阅读加速中"
    when the year doubled the previous year's count; `null` otherwise — no
    fabricated titles). English copy is independently authored, not translated.
  - *9:16 story variant* — a `SegmentedControl` in the dialog switches between
    the classic 3:4 (1080×1440) and a Stories-tall 9:16 (1080×1920) layout with
    an enlarged hero segment; switching redraws through the same layout path and
    exports as `readgraph-annual-{year}-story.png` (the 3:4 filename is
    unchanged).
  - *Cover collage* — at bookCount ≥ 12 (threshold constant) the hero segment
    becomes a 4×2 grid of up to 8 covers with a "+K more" corner badge and the
    count sinks into the facts segment; placeholder and CORS-failure fallbacks
  match the trio layout, and cover loading stays a single progressive pass.
- **Import debug trace (dev builds only)** — gated by the build-time
  `__DEBUG_MODE__` constant (`pnpm dev` on; build/preview/vitest off, branch
  stripped from the bundle — zero string residue in production, see
  `docs/specs/debug-mode.md`): a deterministic per-row decision trace from the
  import pipeline (new/merged/skipped/filtered/error with entity IDs) printed
  to DevTools as a `[readgraph:import]` console group with `console.table`,
  `performance.mark/measure` timings, `filteredRowIndexes` assembly for
  rows cut by `filterRows`, and `window.__readgraphDebug` hooks to inspect,
  export or copy the last trace as JSON. A `localStorage['readgraph:debug'] =
  'verbose'` flag (no restart) adds entity deltas and ID-derivation strings.
  No in-app debug UI; DevTools is the only observation channel.

### Changed

- **AI insights streamed as Markdown** — profile AI insights switched from
  chunked JSON insight cards to a progressive Markdown text stream
  (`react-markdown` + `remark-gfm`, see `docs/specs/ai-features.md` §4.1): text
  renders word by word as it arrives, the final result is weakly validated
  (non-empty, length-capped) instead of the Zod insight schema, and new analysis
  sections need only a prompt addition — no UI changes. Dimension chips that
  jumped to chart tabs were removed with the structured output; AI cache key
  bumped to `all-v2` (old entries regenerate).
  SSE parsing is lenient (line-per-event, bare JSON lines, `message.content`
  fallback), so single-newline or buffered endpoints still stream progressively
  instead of showing a skeleton until the stream finishes.
- **Thinking models (qwen3-reasoning / deepseek-r1)** — `reasoning_content` is
  streamed through a separate channel and rendered as a gray thinking block
  (collapsed by default, expandable while streaming) while the model reasons;
  the chat timeout is now a TTFB/idle double window (reset on every received
  byte) so long reasoning streams are not aborted.
- **Streaming interactions borrowed from AI-native patterns** — a stop button
  on the in-flight bar aborts generation (partial output is kept as the
  result, no error toast); a static caret `▍` marks the streaming tail (no
  blinking, per the no-animation constraint); a copy button on the finalized
  result writes the markdown to the clipboard with a confirmation toast.
- **AI request attribution pair completed** — all AI requests now send
  `HTTP-Referer: <origin>` alongside the existing `X-Title: ReadGraph`
  (`docs/specs/ai-features.md` §5.2). OpenRouter requires the Referer header to
  create an app page and appear in rankings; the title alone does not, and the
  browser-supplied Referer is not reliable under `strict-origin-when-cross-origin`
  or stripping layers. The value is the runtime `location.origin` (never
  fabricated) and is omitted for opaque origins (`file://`, sandboxed iframes)
  and non-DOM environments.
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
- **Annual share card fixes** — the header title is now a proper localized annual
  title ("2026 年度借阅" / "2026 Year in Books") rendered from a plain year
  interpolation instead of `Intl.NumberFormat` (which grouped 2026 into
  "2,026"); the category bar now carries per-segment "name N%" labels so the
  colored strip is self-explanatory — each label is clamped to its own segment
  width (truncated with an ellipsis instead of colliding with the next label,
  labels skipped on segments too narrow to be readable); classification Top 3 is
  taken by descending value (the year slice emitted buckets in insertion order,
  so the "mostly …" summary could name a non-top category) with `__unclassified__`
  and zero-value buckets excluded, and the summary's category count is the real
  number of categories rather than the Top-3 cut size; the ReadGraph emblem
  (same vector as the favicon) is drawn in the header, optically aligned to the
  title's cap height. See `docs/specs/reading-profile.md` §4.1.

### Planned

- Versioned data migrations with a documented upgrade path between releases.
- Performance budget gates in CI (CWV measured green in real deployment
  scenarios; mobile-hosting budgets documented in the performance notes).
- Low-friction trace view beyond DevTools if ever needed (independent
  milestone; the import debug trace itself is dev-build-only).

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
