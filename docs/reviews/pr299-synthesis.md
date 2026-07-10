# Phase Super-Swarm Synthesis — PR #299 (head 5cf377e)

**Models run:** Codex 5.4 ✓ | Codex 5.5 ✓ | Codex 5.6-sol ✓ | Codex 5.6-terra ✓ | Opus 4.6 ✓ | Opus 4.7 ✓ | Opus 4.8 ✓ | Sonnet 5 ✓ | Gemini 3.1 Pro ✓ | Cursor gpt-5.3-codex ✓
**All 10 reviewers completed.** (Codex 5.4 and Codex 5.5 were dispatched with `--sandbox read-only`, which correctly blocked their write step — their full review text was captured from the run log and manually placed at the intended path; this is a dispatch-config note, not a reviewer failure.)

**Phase:** dev → main, v1.14.0 release gate (rolls 23 commits / 7 component PRs: #285 fit-screen latch, #286 fullscreen guard, #288 branch badge, #289 SPA fallback, #290 links cockpit, #291 multi-session terminal, #292 file-viewer view-only roots + TOCTOU hardening)
**Diff size:** 3639 lines
**Reason:** CPC v1.14.0 release PR (dev→main) — mandatory main-gate super-swarm on project state

## Summary

**Verdict: NEEDS_FIXES.** 7/10 reviewers returned NEEDS_FIXES, 3/10 (Opus 4.6, Opus 4.7, Cursor gpt-5.3) returned CLEAN. Only 2/10 reviewers independently caught any single HIGH finding — this is a low-overlap swarm, not a high-consensus one — but I read the actual source for every HIGH claim (including two direct reviewer-vs-reviewer contradictions) and **three distinct HIGH-severity bugs check out against the live code**: (1) `/telegram/send-to-chat` retains the pre-#292 name-based path check while now serving from a world-writable `/tmp` root, creating a deferred cross-process confused-deputy where an attacker can swap the file after the check but before an AI agent reads+acts on the Telegram-relayed path; (2) `createDownloadResponse` orphans a `FileHandle` whose raw fd is separately owned by `createReadStream(autoClose:true)` — Node's FileHandle GC finalizer can double-close or truncate an in-flight download; (3) the new multi-session `capture-pane` poll treats a `null` exit code (SIGTERM from the 5s timeout) as `code !== 0`, so any transient tmux hiccup force-disconnects non-default session viewers with a "Session ended" error even though the session is alive — this directly undercuts #291's headline reliability.

None of these are catastrophic (no live secrets exfiltrated in this diff, no data corruption), but #1 is a real security gap and #2/#3 are real production reliability bugs on the release's two newest surfaces (file viewer, multi-session terminal). Recommend a short, scoped fix round before tagging v1.14.0.

## MUST FIX — verified HIGH findings

| # | File:line | Models (raw) | My adjudication | Finding |
|---|---|---|---|---|
| H1 | `apps/server/src/routes/telegram.ts:12` (`isPathAllowed` + `path-allowed.ts` `/tmp` root) | 2/10 HIGH (codex-5-6-sol, codex-5-6-terra) + 1/10 same-issue-as-MEDIUM (sonnet-5) vs. 1/10 explicit dissent (opus-4-7: "not exploitable via a swap") | **Confirmed real — read the code myself.** `/send-to-chat` never reads file content in-process (opus-4-7 is right about that), but it validates the path once via the old by-name `isPathAllowed`, then embeds the raw pathname in a Telegram message instructing a downstream AI agent to "read it... act on it." `/tmp` is world-writable and now in `ALLOWED_FILE_ROOTS` (added by #292). A local process can pass an innocuous `/tmp/x`, then swap it for a symlink to e.g. `~/.ssh/id_rsa` before the agent gets around to reading it — an unbounded-window confused-deputy against a much more privileged reader than CPC itself. The `path-allowed.ts` docstring itself documents this exact risk class ("a real allowlist bypass once a WORLD-WRITABLE root (/tmp) is in the read list... (PR #292 codex HIGH)") but the fix (`openAllowedForRead`, fd-pinning) was applied to `files.ts`/`markdown.ts`/search and never migrated to `telegram.ts`. `reading-list.ts` has the identical gap but lower urgency (path only stored in SQLite, not relayed with an "act on it" instruction). |
| H2 | `apps/server/src/routes/files.ts:127-134` (`createDownloadResponse`) | 1/10 HIGH (opus-4-8) vs. 1/10 explicit dissent, same code (opus-4-6: "cosmetic log noise only") | **Confirmed real — verified against Node.js FileHandle semantics.** `getDownloadableFile` returns an open `FileHandle`; `createDownloadResponse` streams via the raw `file.handle.fd` through `createReadStream(..., {autoClose:true})` and never calls `file.handle.close()`. Two lifetimes now own one fd: the stream closes it on end/error, and the still-referenced `FileHandle` object will *also* attempt to close it on GC (documented Node behavior — a process warning at best, but on a live server with fd reuse this can (a) close the fd mid-stream if GC runs first → truncated/aborted large downloads, or (b) close an *unrelated*, already-reused fd on delayed GC → sporadic EBADF failures on a completely different request. This is on the normal `/download` path, not just an attack path. |
| H3 | `apps/server/src/routes/terminal-ws.ts:298-313` (`capture-pane` `close` handler) | 1/10 HIGH (gemini-3-1-pro) | **Confirmed exact — read the code, matches the claim precisely.** `spawn("tmux",["capture-pane",...],{timeout:TMUX_TIMEOUT_MS})` fires `close` with `code = null` (not 0) when the 5s timeout kills the child via SIGTERM. The handler's `if (code !== 0 && session !== TMUX_SESSION)` treats `null !== 0` as true, so a viewer on any non-default session gets force-disconnected with `4010 Session ended` on a single transient tmux slowdown — even though the session is still alive. #291's whole point is to make concurrently-viewed non-default sessions normal, so this converts a latent timeout edge case into a routine multi-viewer reliability problem. Fix: `if (code !== 0 && code !== null && session !== TMUX_SESSION)` or check `signal` explicitly. |

## SHOULD FIX (MEDIUM) — strong or moderate consensus

| # | Models | Finding |
|---|---|---|
| M1 | 5/10 touched this cluster (codex-5-4, codex-5-5, opus-4-7, opus-4-8, sonnet-5) | **SPA fallback / deploy-lockstep risk** (`apps/server/src/index.ts:200-228`) — two related sub-claims: (a) 3/10 (codex-5-5, opus-4-8, sonnet-5): the catch-all serves `200 text/html` for any missing GET including stale/missing hashed assets, instead of a clean 404 — directly relevant since this release's own deploy plan can run `@cpc/web` and `@cpc/server` slightly out of lockstep; (b) 2/10 (codex-5-4, opus-4-7): `index.html` is cached for the full process lifetime with no visible signal if a web-only rebuild skips the required `systemctl --user restart cpc.service` step. Given the deploy plan for *this exact release* explicitly calls out rebuilding both packages, this cluster deserves a fix or at minimum a loud runtime log line before/soon after tagging. |
| M2 | 3/10, same finding at different severities (codex-5-4 MED, codex-5-5 LOW, opus-4-8 MED) | Session picker deep-link stranding: `apps/web/src/App.tsx:513/521` gates the picker escape-hatch on `sessionList.length > 0`. When `/api/terminal/sessions` 500s (tmux down), a user who arrived via a stale `#terminal&session=<bad>` deep link is stuck on the WS error frame with no in-UI path back to default — the opposite of what the code's own comment claims. |
| M3 | 1/10 (opus-4-8), plausible + matches documented threat model in `path-allowed.ts` | `openAllowedForRead`'s `open(path,"r")` has no `O_NONBLOCK`. `/tmp` is world-writable and now a read root; a planted FIFO (`mkfifo /tmp/x`) blocks the open indefinitely on Node's 4-thread libuv pool — a handful of such paths could stall all file I/O server-wide. |
| M4 | 1/10 (opus-4-6), scoped to write-roots (lower exploitability) | `audio.ts` (`/generate`, `/send-telegram`) still uses the old `isPathAllowed`-then-read-by-name pattern, not migrated to `openAllowedForRead`. Scoped to `ALLOWED_WRITE_ROOTS` (excludes `/tmp`), so exploitation requires an attacker who already has equivalent write access — defense-in-depth gap, not a practical exploit path today. |
| M5 | 1/10 HIGH (sonnet-5) + 1/10 LOW, same underlying bug, disputed severity (opus-4-7) | `getPaneDimensions` (`terminal-ws.ts:20-36`) uses synchronous `execFileSync` inside the 500ms poll loop, blocking Node's single-threaded event loop for up to 5s if tmux is slow. Not new code (opus-4-7: predates #291), but #291's whole feature is to make concurrently-viewed sessions the norm, which multiplies how many of these blocking calls can be in flight — same root cause, worse blast radius after this release. |

## DEFER (LOW) — non-blocking, worth a follow-up ticket

- `reading-list.ts` shares H1's un-migrated `isPathAllowed` gap but is lower-urgency (path only stored in SQLite today).
- `/list` endpoint has no result cap and 500s on transient `ENOENT` during volatile-directory (`/tmp`) reads — filed to Plane, see below (pagination is scope-expanding, not a bug fix).
- `applyFitResize` still targets bare `TMUX_SESSION` instead of the new `=name:` exact-match convention used elsewhere in the same file post-#291 (cosmetic today; theoretical prefix-collision risk).
- `createDownloadResponse`/`getDownloadableFile` symlink-to-directory entries show as `type: "file"` in `/list` after the `lstat` migration (cosmetic UI icon only — security unaffected, `/read` still validates the target).
- Deep-link flicker showing the restricted palette for ~1 round-trip when a link literally names the default session (self-corrects, already a deliberate "safe either way" tradeoff per the code's own comment).
- File-search "jump to result" overwrites the whole URL hash rather than merging params like `onSelectSession` does, silently dropping an active non-default `session=` param.
- Stale docs: `apps/server/CLAUDE.md`'s file-access section and `docs/guides/deploying.md`'s manual-deploy instructions no longer match the shipped root list / `cpc.service` reality — directly undermines #288's own "report the real deployed version" guarantee if someone deploys via the stale doc.
- Missing integration-seam test coverage: no test exercises the combined deep-link → roster-refresh → picker → WS-remount flow, nor a FIFO/special-file through `openAllowedForRead`, nor the download handle lifecycle.

## SKIP (false positive / accepted-known / out of scope)

- **Fleet Cockpit link unusable inside Telegram (Cloudflare Access wall)** — flagged by codex-5-4 as a MEDIUM "broken headline feature," but this is an explicitly documented, deliberately-accepted limitation per the code's own comments ("shipped per Liam's instruction," per opus-4-6). Not a bug — a known tradeoff already tracked outside this PR.
- Anything scoped to `dev-cpc-ui` / `dev-cpc-features` integration branches — none of the 10 reviews surfaced anything there; confirmed out of scope per the release note.

## FEATURE-SUGGESTION → Plane items (Liam directive, DM voice 1207, 2026-07-09)

- **Per-user scoping gap** (sonnet-5 L-2: neither #291's session viewing nor #292's workspace browsing has per-user scoping; harmless today since `ALLOWED_TELEGRAM_USERS` allowlists exactly one ID, but becomes a cross-user visibility leak by design if that list ever grows) → filed as **WORLD-287** (`reviewer-suggestion` + `cpc` + `enhancement`) — this is a forward-looking architecture decision, not a bug in today's single-user deployment; reviewers review, they don't get to pre-design a multi-user model nobody asked for.
- **`/list` pagination / bounded concurrency on `/tmp`** (opus-4-7 M-1 + gemini's related ENOENT-crash note) → filed as **WORLD-288** (`reviewer-suggestion` + `cpc` + `enhancement`) — adding a cap/pagination contract is new endpoint behavior, not a fix to the endpoint's current contract; routed to Plane rather than folded into this fix round.

## Per-model verdicts

- **Codex 5.4** — NEEDS_FIXES (0 HIGH / 3 MED / 0 LOW). Focused entirely on the SPA-fallback lockstep risk, session-picker stranding, and the (accepted-known) Cockpit link issue. Sandboxed read-only; review recovered from log, not natively written.
- **Codex 5.5** — NEEDS_FIXES (0 HIGH / 1 MED / 1 LOW). Same SPA-fallback finding as 5.4, tighter scope. Also sandboxed read-only; recovered from log.
- **Codex 5.6-sol** — NEEDS_FIXES (1 HIGH / 0 MED / 1 LOW). Sole HIGH: the `/send-to-chat` confused-deputy (H1) — corroborated by 5.6-terra and my own read.
- **Codex 5.6-terra** — NEEDS_FIXES (1 HIGH / 0 MED / 0 LOW). Independently found the same H1 with near-identical reasoning to 5.6-sol.
- **Opus 4.6** — CLEAN (0 HIGH / 1 MED / 4 LOW). Thorough but underrated severity on two items that later checked out as real: dismissed the download fd issue as "cosmetic" (H2, contradicted by my Node-semantics read) and correctly flagged `audio.ts`'s TOCTOU gap as MEDIUM (M4).
- **Opus 4.7** — CLEAN (0 HIGH / 2 MED / 5 LOW). Most thorough investigation of H1 (explicitly traced the `/send-to-chat` code path) but reached the wrong conclusion by stopping at "it doesn't read the file itself" without weighing the deferred cross-process consumer risk. Strong on `/list` unbounded-listing and deploy-lockstep observations.
- **Opus 4.8** — NEEDS_FIXES (1 HIGH / 3 MED / 3 LOW). Sole reviewer to catch H2 (download fd double-ownership) and the FIFO/`O_NONBLOCK` DoS (M3) — both hold up on inspection. Best per-finding technical depth of the batch.
- **Sonnet 5** — NEEDS_FIXES (1 HIGH / 4 MED / 3 LOW). Broadest coverage (10 distinct items across severities); sole reviewer on the `execFileSync`-in-poll-loop finding (M5) and the stale-docs operational risk; independently flagged the same `isPathAllowed`-migration gap as H1 (telegram.ts + reading-list.ts) but rated it MEDIUM rather than HIGH.
- **Gemini 3.1 Pro** — NEEDS_FIXES (1 HIGH / 2 MED / 0 LOW). Sole reviewer on H3 (tmux `capture-pane` null-exit-code disconnect) — verified exact against the live code, a genuinely sharp catch. Also flagged a real `lstat`-on-deleted-file 500 in `/list`.
- **Cursor gpt-5.3-codex** — CLEAN (0 HIGH / 0 MED / 1 LOW). Single-pass review as directed; correctly characterized the overall integration as coherent but didn't dig into either contested-HIGH code path deeply enough to catch H1/H2.

## Cross-model overlap stats

- **Verdict split:** 7/10 NEEDS_FIXES, 3/10 CLEAN.
- **HIGH findings:** low raw overlap (max 2/10 on any single item — H1), but this swarm's value came from **breadth, not consensus** — 5 different reviewers each caught a *different* real HIGH-adjacent bug (H1: 5.6-sol+5.6-terra+sonnet-5-as-MED; H2: opus-4-8; H3: gemini), and ground-truth code reads confirmed all three clusters. Two direct reviewer-vs-reviewer contradictions (opus-4-7 vs. codex-5.6-sol/terra on H1; opus-4-6 vs. opus-4-8 on H2) were resolved in favor of the HIGH-rating reviewer in both cases after reading the actual source.
- **MEDIUM cluster M1 (SPA fallback/deploy-lockstep):** 5/10 — the strongest raw-count signal in the whole swarm, and it lands directly on this release's own deploy runbook.
- **Cross-phase pattern:** the `path-allowed.ts` docstring shows this exact TOCTOU class ("world-writable root in the read list") was *already* flagged as a "PR #292 codex HIGH" during that component PR's own review and fixed for `files.ts`/`markdown.ts`/search — but the fix didn't propagate to the two sibling consumers of the same `ALLOWED_FILE_ROOTS` constant (`telegram.ts`, `reading-list.ts`). This is a textbook silo'd-fix regression: a security fix scoped to "the files it touched" rather than "every consumer of the constant it changed." Worth a permanent guard (e.g. a lint rule or grep-based CI check flagging any `isPathAllowed(` callsite reading `ALLOWED_FILE_ROOTS` without going through `openAllowedForRead`) rather than relying on the next release-gate swarm to catch the next sibling gap.

## Decision

Recommend a scoped fix round before tagging v1.14.0:

1. **H1** — Fix `/telegram/send-to-chat`: either exclude `/tmp` from the roots that endpoint accepts, or migrate it to `openAllowedForRead` and create an fd-derived immutable snapshot before emitting the Telegram message. Add a symlink-swap regression test for this route (also touch `reading-list.ts` while in the area — same root cause, lower urgency).
2. **H2** — Fix `createDownloadResponse`: stream via `file.handle.createReadStream({autoClose:true})` instead of extracting the raw fd, or explicitly `handle.close()` on the stream's `close`/`error` event. Add a download test asserting no fd leak/double-close.
3. **H3** — Fix the `capture-pane` close handler: `if (code !== 0 && code !== null && session !== TMUX_SESSION)` (or check `signal` explicitly) so a timeout-driven SIGTERM doesn't force-disconnect a live non-default session.
4. **M1 (recommended, not blocking)** — either restrict the SPA fallback to document navigations (`Accept: text/html`, no file extension) so stale hashed-asset requests 404 cleanly, or add a boot-time log line surfacing the loaded `index.html`'s mtime so a lockstep-deploy miss is diagnosable from server logs.
5. **M2 (recommended, not blocking)** — render a default-session picker chip even when the roster fetch fails, so a stale deep link never fully strands the user.

Total fix-round budget: ~35-50 min codex (3 small, well-localized HIGH fixes + tests; M1/M2 can ride the same round or defer to a fast follow-up PR without re-tagging).

**The user decision needed:** whether M1/M2 ship in this same fix round (delays the tag slightly further) or as an immediate v1.14.1 follow-up once H1-H3 are fixed and this PR is re-verified.
