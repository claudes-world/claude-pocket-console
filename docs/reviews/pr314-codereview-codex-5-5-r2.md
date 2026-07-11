# Phase Super-Swarm Review R2 — PR #314 (head c2b98ee)

## SUMMARY
NEEDS_FIXES. H1/H2/H3 are confirmed closed at head: the FIFO guard survived the dev merge, audio Telegram side effects are file-owned, and publish-shared now receives a live fd path instead of a re-openable staged pathname. Remaining concerns are medium-risk carryovers around malformed deep links, broad publish authorization, share slug collisions, repo icon TOCTOU, and raw `gh` error exposure. Merge after fixing or explicitly accepting those medium items.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- `apps/web/src/App.tsx:108` — Malformed `#files&file=%` still throws during render because `decodeURIComponent()` is unguarded for `file`, unlike the adjacent guarded `session` parser. This is directly reachable via the new deep-link surface and blanks the app before recovery UI can render. Wrap file decode in `try/catch` and treat bad input as no file.

- `apps/server/src/routes/share.ts:124`, `apps/server/src/lib/path-allowed.ts:67` — `/api/share/publish` still uses broad viewer roots, including `/tmp` and legacy agent lanes, as the authorization boundary for creating external public/private URLs. Viewing and publishing are materially different permissions. Add an `ALLOWED_SHARE_ROOTS` policy or explicit per-root opt-in.

- `apps/server/src/routes/share.ts:18`, `apps/server/src/routes/share.ts:173` — The explicit slug preserves media extensions, but it is still only basename plus second-granularity timestamp. Two same-basename publishes in the same second still collide in `publish-shared`'s clobbering `cp`, yielding one URL with last-writer-wins content. Add a unique suffix or make destination creation atomic.

- `apps/server/src/routes/share.ts:139` — The 50 MB limit is checked before copying, but the copy loop does not count bytes. A file that grows after `fstat()` can exceed the intended limit before the helper timeout starts. Enforce the cap inside the `for await` copy loop.

- `apps/server/src/routes/prs.ts:517` — `readRepoIcon()` still does `realpathSync`/`statSync` and then reopens by pathname with `readFileSync()` at line 540. Same-UID writes under `~/code` can swap the file after validation, and cache misses do synchronous filesystem work on the event loop. Read through a pinned fd with a hard byte cap, preferably async.

- `apps/server/src/routes/prs.ts:663` — `/api/prs/issues` returns raw `gh` error text to the browser. That can leak local paths or CLI config details. Log the detailed error server-side and return a fixed failure message.

- `apps/web/src/components/action-bar/ActionBar.tsx:582` — Reopening Share for file B invalidates stale result display, but `shareInFlightRef` remains global; publishing B while A is still in flight silently no-ops until A resolves or times out. Abort the old request on reopen/file switch, or scope the in-flight lock by file.

- `apps/web/src/components/action-bar/ActionBar.tsx:560` — Reading-list save UI state is mostly file-scoped now, but success/error haptics and `setStatus("Saved to reading list")` still fire unconditionally after a stale save settles. Guard the whole settle branch by current sequence/path.

## LOW severity findings
- `apps/server/src/routes/audio.ts:183` — Non-`.mp3` audio paths still cannot resolve sibling markdown and fall back to the audio link. Impact is limited because server-generated TTS uses `.mp3`, but the send endpoint accepts other audio files.

- `apps/server/src/routes/prs.ts:646` — `force=1` still bypasses the issue cache without a dedicated rate limit. This is authenticated and repo-scoped, so defer is reasonable, but it remains an ops footgun.

- `apps/web/src/components/action-bar/ActionBar.tsx:471` — A completed generation for file A after navigating to B no longer auto-sends, but it still emits haptic success and a global status while B is visible. Harmless side-effect-wise, mildly confusing.

## Round-1 fix verification
- H1: CONFIRMED CLOSED. `openAllowedForRead()` opens with `O_RDONLY | O_NONBLOCK` and fstat-rejects special files (`apps/server/src/lib/path-allowed.ts:128-160`), the FIFO regression test is present, and `index.ts` kept both `shareRoute` and SPA fallback wiring.
- H2: CONFIRMED CLOSED. Audio ops now track `audioOpPathRef`/`viewedFilePathRef`; generate completion does not auto-send after navigation, and manual send status is guarded by file ownership (`apps/web/src/components/action-bar/ActionBar.tsx:413-520`).
- H3: CONFIRMED CLOSED. Share staging uses `O_EXCL`, writes through the staged handle, keeps that fd open, and invokes `publish-shared` with `/dev/fd/3` via `stdio[3]` (`apps/server/src/routes/share.ts:147-184`). Cleanup closes handles and removes the staging dir.
- Slug extension guard: CONFIRMED CLOSED. Raw media extensions are appended based on the specific source extension (`apps/server/src/routes/share.ts:28-37`) with tests for dotted stems.
- Partial-write loop: CONFIRMED CLOSED. `writeFully()` loops until the whole buffer is written and rejects zero-progress writes (`apps/server/src/routes/share.ts:50-60`).
- Return-to-pending UI restore: CONFIRMED CLOSED for the claimed button/loading state. Reading-list in-flight state is per path, and audio in-flight state is restored when returning to the owning file.
- Other round-1 MEDIUM/LOW items: M1, M2, M3, M4, M5, M6, M7, M8, M10, M11 remain open; M9 is only partially fixed because explicit slugs still collide within the same second.

## Cross-cutting observations
Protected routes remain behind Telegram auth, and I found no conflict markers or dropped `dev` security code. The fd lifecycle for H3 looks sound: no obvious leak or double-close on success/error paths, and `/dev/fd/3` matches the current `publish-shared` helper interface. I did not run tests in this review pass.
