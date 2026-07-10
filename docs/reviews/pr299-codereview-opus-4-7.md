# Phase Super-Swarm Review -- PR #299 (head 5cf377e)

## SUMMARY
**Verdict: CLEAN — merge recommended.** No HIGH findings on cross-cutting integration seams. The seven component PRs compose cleanly: the write/read root split (#292) is applied consistently across every write endpoint I could find, the multi-session terminal (#291) has zero write-surface widening because fit and REST session-bookkeeping are hard-gated to `TMUX_SESSION`, and the fit-latch release (#285) coexists with the fullscreen guard (#286) without shared state. A handful of MEDIUM/LOW polish items and one deploy-ordering note below, none blocking.

## HIGH severity findings
CLEAN -- no findings.

Verified specifically:
- **`/tmp` in the read allowlist + TOCTOU closure** — every content-touch of a client-supplied path in `files.ts`, `markdown.ts`, and the `/search` BFS goes through `openAllowedForRead` and reads from the returned fd or `/proc/self/fd/N`, never a name-based reopen. `/list` uses `lstat` on the fd-relative path, so a symlink entry cannot leak its target's size/mtime.
- **Write endpoints are correctly narrowed to `ALLOWED_WRITE_ROOTS`** in `files.ts` (`/upload`, `/paste`) and `audio.ts` (all handlers, including `/check`). Grepped the whole `apps/server/src/routes` tree for `isPathAllowed` callers — no other endpoint mutates disk against a client-supplied path.
- **Multi-session fit gating** — `applyFitResize` is hardwired to `TMUX_SESSION`; `onMessage` short-circuits `type: "fit"` with a distinct `fit-error` before validation when the connection views a non-default session (`terminal-ws.ts` fit branch). REST `/resize-terminal` and `/restart-session` never accept a `session` field (verified by `slash-commands-session.test.ts`).
- **Fit-latch release incident cannot self-reproduce silently** — the `FitLatchReleaseError` path is exercised by the new test (`terminal-ws-fit.test.ts` "reports a distinct loud fit-error"), the client-side handler in `Terminal.tsx` writes `msg.message` into the terminal, and the "resize applied but release failed" message is textually distinct from "Failed to resize tmux window".
- **`/telegram/send-to-chat` and `/tmp` interaction** — the endpoint sends a Telegram *message* containing the path string; it does not attach or read the file itself, so the still-name-based `isPathAllowed(filePath, ALLOWED_FILE_ROOTS)` gate is not exploitable via a swap. Called out here because the endpoint intentionally was NOT migrated to `openAllowedForRead`, which is the right call.
- **Fleet Cockpit link (#290) + SPA fallback (#289)** — `openInApp` gates on `initData` truthiness (matches `hasAuth()`), and modifier/middle-click passthrough is respected. SPA fallback's `/^\/(api|ws)(\/|$)/` regex still lets `/api/…` and `/ws/…` return 404 JSON; the fallback only fires on unknown non-API paths.

## MEDIUM severity findings

### M-1  `/list` has no result cap; `/tmp` may return a huge listing
`apps/server/src/routes/files.ts:224-296`. With `/tmp` newly reachable via the FileViewer chip, `readdir(fdDir)` returns every entry (no `.slice`, no pagination) and fans out one concurrent `lstat` per entry via `Promise.all(entries.map(...))`. On a busy host `/tmp` can have thousands of entries; the response JSON grows unbounded and the concurrent `lstat` fan-out spikes I/O. Not a NEW class of bug (any large allowed root had this), but `/tmp` is the first root where an outside process (the whole host) can grow the listing without CPC's knowledge. Suggested follow-up: cap at ~2000 entries with a truncation flag in the response, or bounded concurrency (`p-limit`) on the `lstat` fan-out. Deferrable — no user has hit it yet — but track as a v1.15 candidate.

**Failure scenario:** Attacker with a shell on the box creates 50k tiny files under `/tmp/spam/`; a CPC user browsing `/tmp` in the mini app receives a multi-MB JSON response and blocks the UI thread while React renders 50k rows.

### M-2  Deploy-plan lockstep is real: SPA fallback caches `index.html` for the process lifetime
`apps/server/src/index.ts:200-228`. `spaIndexHtml` is loaded once per process. The comment ("every deploy restarts the server") makes this explicit and matches `docs/guides/deploying.md`, but the release notes' deploy plan calls out "rebuild BOTH `@cpc/web` + `@cpc/server`". If someone rebuilds only `@cpc/web` and skips the `systemctl --user restart cpc.service` step, users will see the pre-rebuild SPA shell indefinitely with no obvious signal. Consider treating this as a small operational safeguard: log `spaIndexHtml` mtime alongside the "CPC server running on…" line at boot, so post-restart logs make the shipped SPA build visible.

**Failure scenario:** Operator runs `pnpm build` in `apps/web` on prod, forgets `systemctl --user restart cpc.service`; users continue receiving the previous SPA shell (with the old `main-<hash>.js` referenced) with no way to diagnose from server logs.

## LOW severity findings

### L-1  Client-side `SESSION_NAME_RE` mirrors the server; silent drift risk
`apps/web/src/App.tsx:16` mirrors `apps/server/src/routes/utils.ts:SESSION_NAME_RE` by hand. Server re-validates every request so this is defence-in-depth only, but if the server allowlist ever loosens (e.g. `:` for detached copies) the client will strip valid names before they reach the WS. File as a "keep in sync" comment or extract to a shared package if `packages/` is ever wired up.

### L-2  `reading-list.ts /save` still gates on `ALLOWED_FILE_ROOTS`, not `ALLOWED_WRITE_ROOTS`
`apps/server/src/routes/reading-list.ts:38`. Bookmarks a path into SQLite (no filesystem write), so allowing `/tmp` and legacy lane workspaces is defensible — you may genuinely want to bookmark a `/tmp/notes.md`. Flagging only so the intent is explicit: this is the ONE remaining callsite where a widening of the read allowlist widens what the endpoint accepts. Consider a one-line comment at the callsite documenting the choice.

### L-3  `getPaneDimensions` remains `execFileSync` (blocking) — improved by 5s timeout, not eliminated
`apps/server/src/routes/terminal-ws.ts:26-45`. With the multi-session picker, several WS viewers may tick the 500ms poll on different sessions; each `sendPaneContent` calls sync `execFileSync`, which serializes on the single event loop. A wedged tmux server no longer hangs forever (5s cap added), but a single hang blocks every other WS for up to 5s. Follow-up: promote to `execFileAsync` and cache dims across ticks. Not a regression from PR #291 — the sync call predates it.

### L-4  `App.tsx#onSelectSession` hash-rewrite is fragile if the hash is ever `#terminal` with no other params
`apps/web/src/App.tsx:184-195`. The current code path works (verified by inspection), but the string-slicing (`raw.slice(raw.indexOf("&") + 1)`) is unusual. If ever refactored, prefer routing through `URLSearchParams` on the whole hash after the tab prefix. Cosmetic.

### L-5  `git.test.ts` uses `vi.spyOn(process, "cwd")` in `beforeAll`
`apps/server/src/routes/__tests__/git.test.ts:82`. The comment correctly explains why `chdir` was rejected. The spy is restored via `vi.restoreAllMocks()` in `afterAll`, but if any future test in the same worker file relies on the true `cwd`, it will see `repoDir` instead. Not a live bug — every current git test passes a `-C repoDir` arg — just a note for whoever adds the next test.

## Cross-cutting observations

- **Zero interaction between #285 and #286.** Fit-latch release is a server-side tmux-option flip; the fullscreen guard is a Telegram Bot API 8.0 client-side capability check. They share no state.
- **Zero interaction between #291 multi-session and #292 file-viewer.** The session picker doesn't touch the file allowlist, and the file viewer doesn't touch tmux. Confirmed no shared globals.
- **#288 (`/cpc-branch`) uses `process.cwd()` correctly for the deploy-plan case.** On tag detachment (`HEAD` symbolic ref) it falls through to `git describe --tags --always`; tested via `git.test.ts` on `v-test.1`. This is what makes the prod-vs-checkout mismatch fix actually work.
- **Roll-out ordering is safe both ways.** Old-server + new-client: `/api/terminal/sessions` 404s, picker stays hidden, default session used. New-server + old-client: no `?session=` param on the WS → server treats as default. Deploy CAN cut over web and server independently without a broken window, though the release notes correctly recommend lockstep.
- **`/tmp` in the read roots is the highest-risk single change in the release**, and it is guarded by the deepest layer of defence (`openAllowedForRead` with fd-identity validation via `/proc/self/fd`). The tests in `path-allowed.test.ts` explicitly exercise the swap race and the outside-target symlink path. This is the right level of paranoia for the vector.
- **No missing integration test I would gate merge on.** `terminal-ws-session.test.ts` covers the fit rejection on view-only sessions, the has-session probe, and the unknown-session 4004; `slash-commands-session.test.ts` covers the palette-fanout charset+existence gates; `files-write-roots.test.ts` covers read-vs-write asymmetry end-to-end through the real `isPathAllowed`.

**Recommendation: ship v1.14.0.** File M-1 and M-2 as tracking issues for v1.15; the LOWs are notes for whoever next touches the surrounding code.
