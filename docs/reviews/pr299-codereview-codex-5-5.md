# Phase Super-Swarm Review -- PR #299 (head 5cf377e)

## SUMMARY
NEEDS_FIXES. The release is mostly coherent: the file-viewer read/write split is consistently applied, fd-validated reads cover the high-risk `/tmp` expansion, and the multi-session terminal keeps write actions scoped to the default or explicitly probed sessions. One integration/ops bug remains in the SPA fallback: it converts every missing GET, including missing hashed assets, into a 200 HTML app shell, which makes out-of-lockstep web/server deploys fail poorly. Fix before merging.

## HIGH severity findings
CLEAN -- no findings

## MEDIUM severity findings
[apps/server/src/index.ts](/home/claude/code/claude-pocket-console/apps/server/src/index.ts:211): The SPA fallback serves `index.html` for every non-API/non-WS missing GET, regardless of `Accept` or whether the path looks like a static asset. That means a stale client requesting an old hashed `/assets/*.js`, a missing icon, source map, etc. gets `200 text/html` instead of a real 404. In an out-of-lockstep deploy or cache race, browsers will report MIME/script parse failures against HTML, CDNs/proxies may cache a successful response for an asset URL, and the operator loses the clear signal that the asset is missing. Restrict the fallback to document navigations, e.g. `GET` with `Accept: text/html` and preferably paths without a file extension, while preserving JSON 404s for `/api`/`/ws`.

## LOW severity findings
[apps/web/src/App.tsx](/home/claude/code/claude-pocket-console/apps/web/src/App.tsx:521): A deep link to `#terminal&session=<name>` only renders the session picker escape hatch if `/api/terminal/sessions` has returned a nonempty roster. If tmux/session listing fails while the WS rejects the deep-linked session, the terminal can show an unknown-session/offline frame without an in-UI way back to the default session. This is not a merge blocker, but the stale-deep-link recovery path would be more robust if an active non-null session always rendered a default-session pill, even when the roster fetch fails.

## Cross-cutting observations
The #292 security-sensitive path work is internally consistent on the main file-viewer reads: `/list`, `/read`, `/download`, markdown summarize, and `/search` use open-then-validate fd identity before touching content, and `/list` uses `lstat` for entry metadata. Upload/paste/audio generation use `ALLOWED_WRITE_ROOTS`, so the `/tmp` and legacy lane workspace expansion is read-only.

The terminal/session integration is coherent: WS session names are regex-fenced and exact-matched, non-default sessions are existence-probed, fit-screen remains default-session-only, and the latch release failure is surfaced distinctly from generic resize failure. The ActionBar hides default-only actions while still routing the restricted palette to the viewed session.

Fleet Cockpit link behavior matches the stated intent: in-app navigation is gated on real Telegram `initData` truthiness and modified clicks fall through to normal anchor behavior.

I attempted targeted server/web Vitest runs for the security and terminal seams, but the read-only sandbox blocked Vitest startup when Vite tried to write `apps/*/node_modules/.vite-temp/vitest.config...mjs`.
