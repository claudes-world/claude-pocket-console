# Pre-merge review: `dev` → `main` (v0.10.0)

Consolidated review before merging `dev` to `main` and tagging **v0.10.0**. Four parallel perspectives were used (security, Telegram/WebView UI, server/API, tests/CI), with key claims cross-checked in source.

## Scope

- **Compared:** `main`…`dev` is a large delta (many features: search UX, markdown/collapsible, security tests, reading list, downloads, perf, CI wiring, etc.).
- **Method:** Parallel review passes + targeted verification against the **current `dev` tree** as the release candidate.

## Agent perspectives — quality and uniqueness

| Agent | Focus | Strengths | Weaknesses / limits |
|--------|--------|-----------|----------------------|
| **Security** | Auth surface, file/SQL/XSS, CORS, secrets | Strong on path hardening (`isPathAllowed`), parameterized SQL, markdown XSS defaults vs `rehype-raw`; flagged JWT in query and initData freshness | Some items are policy/deployment (empty allowlist) not code bugs |
| **Telegram / WebView UI** | Touch rules, sheets, scroll, markdown a11y | Caught project-rule violation (`preventDefault` on `touchstart` in `Terminal.tsx`); good modal vs BottomSheet swipe API gap | Nested scroll in markdown is hypothesis until device QA; SSR/hydration largely N/A for Vite SPA |
| **Server / API** | Hono routes, WS, validation, logging | Deepest on HTTP vs WebSocket auth parity; useful on git route status quirks, WS logging, reading-list edge cases | Incremental hardening items mixed with must-fix |
| **Tests / CI** | Scripts, workflows, Playwright | Clear CI vs local `pnpm test` gap; honest about weak screenshot/sleep specs vs stronger search/paste mocks | Does not replace manual Telegram Mini App smoke |

**Overlap:** Security and Server both flagged WebSocket session-token allowlist bypass — same root issue, high confidence.

**Divergence:** UI review emphasized gesture policy; security/server emphasized auth and abuse; tests review emphasized release process.

## Classified findings

### Must fix (before or immediately at release)

1. **`/ws/terminal` session-token auth ignores `ALLOWED_TELEGRAM_USERS` while HTTP does not**  
   - WS path sets auth from `validateSession` without allowlist check (`apps/server/src/routes/terminal-ws.ts`). HTTP middleware applies allowlist for the same session tokens (`apps/server/src/middleware.ts`).  
   - **Why:** With a non-empty allowlist, a user blocked from REST can still stream the terminal over WS if they possess a valid session token — inconsistent authorization.

2. **Policy violation: `preventDefault` on `touchstart` in read-only terminal overlay**  
   - `apps/web/src/components/Terminal.tsx` — violates CPC rule (never `preventDefault()` on `touchstart`).  
   - **Why:** Risks breaking Telegram gestures; fix or document a narrow reviewed exception.

### Should fix (strongly recommended for v0.10.0 or a fast v0.10.1)

3. **`POST /api/files/upload` buffers full file with no `bodyLimit` (unlike `/paste`)**  
   - **Why:** Authenticated but memory/DoS risk for large uploads; align with a sane max.

4. **Mini App `initData` has no `auth_date` freshness check** (unlike Login Widget path)  
   - **Why:** Defense-in-depth against replay of captured initData strings.

5. **JWT accepted via `?token=` on HTTP** (`apps/server/src/middleware.ts`)  
   - **Why:** URLs leak via Referer, logs, history; mitigate with short-lived JWTs, docs, or token exchange.

6. **Centered modals do not call `Telegram.WebApp.disableVerticalSwipes()`** (only `BottomSheet` does)  
   - **Why:** Users may swipe-minimize Telegram while dialogs are open.

7. **Operational leakage: `err.message` / verbose errors on several routes**  
   - **Why:** Can expose paths and internals; sanitize for production.

### Defer (new issue; not blocking if acknowledged)

- Permissive CORS — tighten when stable origin list exists.
- Application rate limiting — host or in-app quotas.
- WS `tmux capture-pane` interval — possible overlap under load; profiling/backpressure.
- `GET` vs `POST` git-status error semantics — API consistency.
- `POST /api/auth/telegram-widget` JSON parse — uniform error handling.
- Reading-list strict typing for `title` / `id`; delete-by-path edge cases.
- `routes/telegram.ts` curl via shell — prefer `execFile` for token hygiene.
- CI: run Playwright (server boot + browser install).

### Skip / false positive / accept risk

- Empty `ALLOWED_TELEGRAM_USERS` ⇒ any valid HMAC user — deployment contract; document in runbooks.
- Download ticket bypasses `telegramAuth` — intentional; depends on ticket secrecy/TTL.
- Mermaid `dangerouslySetInnerHTML` — mitigated by `securityLevel: "strict"`.
- Nested markdown scroll — verify on device; not proven here.

## Recommended next steps

1. Fix WebSocket allowlist parity for session tokens; add unit tests aligned with HTTP middleware.
2. Fix or replace Terminal overlay touch handling per project rules.
3. Add `bodyLimit` to `/api/files/upload` and document max size in UI.
4. Add `auth_date` check to `validateTelegramInitData` (documented max age).
5. Modal swipe policy: `disableVerticalSwipes` / `enableVerticalSwipes` for centered modals or a shared hook.
6. Release QA: full `pnpm test` with server up; Telegram Mini App smoke; iOS + Android spot checks.
7. File deferred items as GitHub issues (e.g. `post-v0.10.0` / `hardening`).

## Version label note

Some commits reference “v1.10.0”; release tag target is **v0.10.0** — align changelog and references when tagging.
