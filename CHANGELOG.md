# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project adheres to [Semantic Versioning](https://semver.org/).

## [1.11.1] — 2026-04-12

### Highlights

- 83 new unit tests across files.ts, markdown.ts, and React components
- CSS design token migration — 325 inline hex colors replaced with custom properties
- TL;DR cache cleanup and Links.tsx code quality

### Infrastructure

- files.ts route tests — 40 tests covering 7 endpoints: roots, list, read, download-ticket, download, search, paste (#182)
- markdown.ts route tests — 21 tests covering /summarize endpoint with cache, CLI, and error paths (#183)
- React component tests — 22 tests for ErrorBoundary, FileViewer, PrTicker using @testing-library/react (#184)
- CSS custom properties — converted 325 inline hex colors to `var(--color-*)` tokens across 29 files (#49)
- Links.tsx — migrated inline `<style>` to Links.css file (#58)

### Fixes

- TL;DR cache — 30-day TTL cleanup on server startup prevents unbounded table growth (#82)

## [1.11.0] — 2026-04-12

### Highlights

- New PR Status Ticker tab — 5th tab showing live GitHub PR status across repos
- Changelog infrastructure for standardized release workflows

### Features

- PR Status Ticker Phase 1 — polls `gh pr list` every 30s, color-coded status dots (green/yellow/red/purple), current-branch filter, feature-flagged behind `VITE_FEATURE_PR_TICKER` (#194)
- Changelog infrastructure — `changelogs/unreleased/` fragment directory, `scripts/extract-release-section.sh` with semver validation + dot-escaping, README documenting the fragment workflow

## [1.10.1] — 2026-04-12

### Highlights

- 7 quality and security fixes from the v1.10.0 review cycle
- Centralized auth allowlist into a null-safe helper
- Consolidated path allowlist to single source of truth

### Fixes

- FileViewer double-tap download race — ref-based in-flight lock prevents concurrent downloads (#173)
- ErrorBoundary — handles non-Error throws (string, number, object) + `level` prop for tab-scoped fallback sizing (#29)
- Reading list — `c.req.queries()` for multi-path params (fixes comma-in-filename bug) + reject relative paths (#174)
- Early Hints — parse Vite `manifest.json` instead of regex on `index.html` for asset preload URLs (#142)

### Infrastructure

- Type safety — replaced `any` prop signatures with `ExtraProps` from react-markdown v10 in MarkdownViewer + CollapsibleHeading (#139)
- Security — consolidated `ALLOWED_FILE_ROOTS` to single source in `path-allowed.ts`, removed 4 inline copies (#155)
- Auth — centralized allowlist check into null-safe `isAllowedUser(userId)` helper across middleware + terminal-ws (#156)

## [1.10.0] — 2026-04-12

### Highlights

- Migrated the markdown renderer from `marked` to `react-markdown` with collapsible heading sections — fold/unfold document sections by tapping headings
- Added a reading list backend — save, list, check, and delete reading items via `/api/reading-list/*`
- File-type-specific icons in the file browser (Tokyo Night palette SVGs, same set used in search)
- Dev-only debug overlay for capturing and inspecting runtime errors
- 103 Early Hints + telegram.org preconnect for faster cold-start on Telegram WebView
- iOS-safe file downloads via a single-use download-ticket flow (no more popup-blocker issues)
- TLDR and audio generation now have in-flight guards preventing duplicate requests on double-tap
- Shared `InProgressAnimation` component for consistent loading states across modals
- First GitHub Actions CI workflow — unit tests run on every PR to `dev` and `main`
- Defense-in-depth hardening on server routes with `execFile` (no shell interpolation) and `isPathAllowed` guards

### Features

- Reading list v1 backend — save, list, batch-check, and delete endpoints with SQLite persistence (#134, #145, #154)
- Collapsible heading sections in the markdown viewer with accessible `<button>` toggle and `rehype-slug` integration (#131, #140)
- File-type icons in the file browser directory listing, reusing the existing `getFileIcon` helper from search (#144)
- Dev-only error overlay with `useSyncExternalStore`-backed capture, immutable entry state, and `prefers-reduced-motion` support (#130)
- 103 Early Hints response + `telegram.org` preconnect/dns-prefetch in the HTML head (#128)
- Download-ticket flow for iOS-safe popup downloads — POST creates a single-use ticket, GET redeems it without auth (#127)
- Bundle analyzer tooling via `rollup-plugin-visualizer`, gated behind `ANALYZE=true` (#123)

### Fixes

- TLDR + audio generation in-flight guards — `inFlightRef` prevents duplicate concurrent requests from rapid double-taps; shared `InProgressAnimation` component extracted for visual consistency (#121)
- File viewer header touch isolation — `stopPropagation` on header buttons so taps don't trigger the parent swipe gesture (#120)
- Auth hardening — `getUserId` now checks `user?.id` explicitly, preventing NaN/undefined bypass (#133)

### Infrastructure

- React-markdown migration — replaced `marked` (string HTML) with `react-markdown` (React tree, XSS-safe by default) + `remark-gfm` + `remark-breaks` + `rehype-slug` (#131)
- GitHub Actions CI test workflow on PR + push to dev/main (#122)
- Security test suite — 20 auth + file-upload tests covering HMAC tampering, null-byte filenames, path traversal (#129)
- `.world/ports.yml` with Option D project-sharded port allocation per ADR 0003 (#135)
- Root `pnpm test` wiring via Turbo + separate `test:unit` / `test:e2e` scripts (#122)

### Authentication & API Surface

All `/api/*` routes are protected by `telegramAuth` middleware, which validates Telegram Mini App `initData` (HMAC-SHA256 signature verification against the bot token). The only unauthenticated path is the download-ticket redemption flow (`GET /api/files/download?ticket=...`), which uses a time-limited single-use token instead of session auth to work around iOS WebView popup restrictions.

**Login flow:** User opens the mini app via Telegram → WebView loads with `initData` in the URL → every API request passes `initData` in the `Authorization: tma <initData>` header → server validates the HMAC signature + checks the user against the allowlist → request proceeds or returns 401.

**Error responses:** All server errors return structured JSON: `{ error: "<code>", message: "<human-readable>" }` with appropriate HTTP status codes. Unhandled exceptions are caught by the global error handler and return 500 with a generic message (no stack traces leaked).

### Known Limitations

This is **super early alpha hobby software**. I cannot make any security guarantees. The authentication layer relies on Telegram's `initData` signature + Cloudflare Access as the perimeter gate. If you're self-hosting, please responsibly secure your own VPS or VM — do not expose the API to the public internet without your own access controls.

- No rate limiting on API endpoints yet
- No automated E2E test coverage in CI (Playwright tests exist locally but aren't wired to the workflow)
- Reading list has no UI yet — backend only in this release

### What's Next

- Reading List v2 — UI layer for the backend shipped in this release (#149)
- CPC Load Speed Optimization continued — vendor chunk splitting, tab-based code splitting (#141)
- Server test coverage expansion — 6 recommendations from the coverage audit still open (#147)
- File viewer component split — the 1139-line god component needs decomposition (#157)

### Contributors

#### Creators

- **Liam** (Chaintail) — vision, direction, design decisions, UAT, and the voice note that started it all
- **Claude** (Anthropic Claude Opus 4.6) — co-equal design partner, orchestrator, and primary implementer of the tools, skills, hooks, and documentation patterns that make Claude's World work

#### Claude's World Team

- **Claude Code** — the orchestrator harness powering the agent workflow
- **Codex** (OpenAI gpt-5.4) — local + cloud code reviewer, autonomous fix agent via `@codex` GitHub integration
- **Gemini** (Google gemini-3-flash-preview) — local + GitHub Code Assist cloud reviewer
- **Cursor** — cloud code reviewer via Cursor Cloud integration

#### Planning

- **Claude** — primary architect for skills, hooks, ADRs, SOPs, and the agentic PM workflow
- **ChatGPT** — plan brainstorming, DA reviews, council sessions
- **Gemini** — adversarial plan reviews, architecture critique
- **Grok** — early ideation and concept exploration
- **Kimi** — planning assistance for inbox and infrastructure design
