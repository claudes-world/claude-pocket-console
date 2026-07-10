# Phase Super-Swarm Review -- PR #299 (head 5cf377e)

## SUMMARY
NEEDS_FIXES. The release mostly hangs together, and the file-viewer TOCTOU hardening is coherently applied across the primary read surfaces, but there are still two integration-level regressions: the new session deep-link flow can strand the user on an unknown/view-only session when the roster call fails, and the shipped Fleet Cockpit link is knowingly unusable inside Telegram because it lands on Cloudflare Access. There is also a non-trivial deploy lockstep risk from the new in-memory SPA shell cache.

## HIGH severity findings
CLEAN -- no findings

## MEDIUM severity findings
1. `apps/web/src/App.tsx:172` and `apps/web/src/App.tsx:521` -- The multi-session deep-link recovery path is incomplete. The comment says a stale `#terminal&session=...` link should "always leave the user a pill to click back to the default instead of stranding them on the error frame", but the render gate still requires `sessionList.length > 0`. When `/api/terminal/sessions` returns `500` (which it explicitly does when tmux is down or missing in `apps/server/src/routes/terminal/sessions.ts:109`), `fetchSessions()` silently keeps `sessionList` empty, the picker disappears, and a user who opened an invalid/stale session deep link is stuck on the WS error view with no in-app path back to the default session. Suggested fix: if `activeSession !== null`, render a fallback picker chip for the default session even when the roster request fails, or proactively clear invalid deep-linked sessions after a failed roster fetch.

2. `apps/web/src/components/Links.tsx:58` -- The new Fleet Cockpit feature is shipping in a knowingly broken state for the primary environment. The code comment says `cockpit.claude.do` "currently sits behind Cloudflare Access, which a Telegram WebView cannot pass" and that the in-app link therefore hits the Access wall. That means the new release headline feature is not just degraded; inside the actual Telegram Mini App it does not reach the product. Suggested fix: hide or externalize the link until the auth lift lands, or route it through a destination that can authenticate from Telegram today.

3. `apps/server/src/index.ts:203` -- The SPA fallback now caches `index.html` for the full server process lifetime. That is acceptable only if web build + server restart always happen in lockstep, but this release also adds more client-routed entry points and version-display logic, which makes drift nastier: rebuilding `@cpc/web` without restarting the server can leave client-routed requests serving a stale HTML shell that references removed hashed assets, while `/api/terminal/cpc-branch` and `__APP_VERSION__` can simultaneously report different deployment identities. Suggested fix: either stop caching `index.html`, or make the deploy contract explicit and enforced so web-only rebuilds cannot occur.

## LOW severity findings
CLEAN -- no findings

## Cross-cutting observations
- The highest-risk security change (#292) looks coherent in the main file-reading surfaces: `files.ts` and `markdown.ts` moved from check-then-use to fd-pinned reads, `/search` now walks through validated fds, `/list` switched to `lstat`, and write endpoints are correctly held to `ALLOWED_WRITE_ROOTS`. I did not find a release-gate bypass that reopens the original `/tmp` symlink hole in the shipped read paths.
- The multi-session terminal work is internally consistent on the happy path: WS session validation, session-targeted restricted commands, and default-session-only fit/restart boundaries line up.
- I could not run Vitest in this environment because the workspace is mounted read-only and Vite/Vitest fails trying to write `.vite-temp` config bundles (`EROFS` in both `apps/server` and `apps/web`).
