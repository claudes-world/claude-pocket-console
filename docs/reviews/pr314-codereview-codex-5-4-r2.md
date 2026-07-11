# Phase Super-Swarm Review R2 — PR #314 (head c2b98ee)

## SUMMARY
NEEDS_FIXES. The three round-1 HIGH findings are genuinely closed at `c2b98ee`: the `openAllowedForRead()` FIFO hardening is present, audio generate/send completion is now file-owned, and the share route keeps the staged file pinned to a live fd for the `publish-shared` handoff. The cheap-tier fixes called out in the brief are also in place. Remaining concerns are all below HIGH, but there are still a few real edge-case bugs and hardening gaps in the share/PR/deep-link seams, so I would not merge until those are addressed.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- `apps/web/src/App.tsx:107-109` — `initialFile` still runs `decodeURIComponent()` during render with no `try/catch`. A malformed deep link like `#files&file=%` throws before the app mounts and blanks the Mini App. This is now more reachable because the new audio/share flows emit `#file=...` links. Fix by mirroring the guarded session parser directly below it.

- `apps/web/src/components/action-bar/ActionBar.tsx:583-620,948-955` — the stale-result guard for Share is fixed, but the in-flight lock is still global. If publish A is pending, then the user closes the sheet, opens file B, and taps `Share`, the UI resets via `++shareSeqRef.current`, but `shareInFlightRef.current` stays `true`, so B's `Public`/`Private` buttons silently no-op until A settles. Scope the lock by file/seq or abort the old request on reopen.

- `apps/server/src/routes/share.ts:139-160` — the 50 MB cap is only enforced on the initial `stat()`. A regular file that grows after that check is still streamed in full to the staged file and then published, so the route can exceed its advertised limit and spend unbounded extra I/O on a moving target. Track bytes during the copy loop and fail once the written count crosses `MAX_SHARE_BYTES`.

- `apps/server/src/routes/prs.ts:517-543` — `/icons` still does an `existsSync()`/`realpathSync()`/`statSync()` check and then reopens the candidate by name with `readFileSync()`. That reintroduces the same by-name TOCTOU shape the rest of the server is moving away from, and the post-`stat()` read can still be swapped to a different/larger file before the read. Reuse `openAllowedForRead()` or open once and read through the pinned fd.

- `apps/server/src/routes/share.ts:124` with `apps/server/src/lib/path-allowed.ts:67-71` — the publish route still authorizes against the full read allowlist, which includes `/tmp` and `.worldos/lanes`. That is broader than the public/private share surface needs, and it preserves the ability to publish transient or cross-lane artifacts that the user can name but did not intend to expose via a share URL. Add a narrower `ALLOWED_SHARE_ROOTS`.

## LOW severity findings
- `apps/server/src/routes/prs.ts:163-166,663-665` — `/issues` still returns raw `gh` stderr to the browser on failures. That can leak local path/config context from the CLI. Log the detailed error server-side and return a fixed client message.

- `apps/web/src/components/action-bar/ActionBar.tsx:565-576` — reading-list save ownership is fixed for button state, but not for haptics/status text. A late save for file A can still flash `Saved to reading list` or `Failed: ...` while the user is already on file B. Gate those side effects on the same per-file ownership check used for button state.

## Round-1 fix verification
- `H1` — CONFIRMED CLOSED. `openAllowedForRead()` keeps the `O_RDONLY | O_NONBLOCK` open plus post-open special-file rejection in [apps/server/src/lib/path-allowed.ts](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/server/src/lib/path-allowed.ts:149). Head also carries both the session-picker merge and the file-view sequencing fix in [apps/web/src/App.tsx](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/web/src/App.tsx:139) and [apps/web/src/App.tsx](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/web/src/App.tsx:168).

- `H2` — CONFIRMED CLOSED. Audio generate/send is now owned by `audioOpPathRef` plus `viewedFilePathRef`, so stale completion no longer paints or auto-sends from another file in [apps/web/src/components/action-bar/ActionBar.tsx](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/web/src/components/action-bar/ActionBar.tsx:413) through [apps/web/src/components/action-bar/ActionBar.tsx](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/web/src/components/action-bar/ActionBar.tsx:522).

- `H3` — CONFIRMED CLOSED. The share route stages into an `O_EXCL` temp file, keeps that handle open, and invokes `publish-shared` through `/dev/fd/3` instead of reopening the staged path by name in [apps/server/src/routes/share.ts](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/server/src/routes/share.ts:147) through [apps/server/src/routes/share.ts](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/server/src/routes/share.ts:185). I do not see an fd leak or double-close in the current success/error paths.

- `Slug extension guard` — CONFIRMED CLOSED. `derivePublishSlug()` now preserves only recognized raw-media extensions in [apps/server/src/routes/share.ts](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/server/src/routes/share.ts:18).

- `Partial-write loop` — CONFIRMED CLOSED. `writeFully()` loops until the full buffer is written in [apps/server/src/routes/share.ts](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/server/src/routes/share.ts:50).

- `Return-to-pending UI restore` — CONFIRMED CLOSED. Reading-list save state is now tracked per path and restored when the user navigates back to a still-pending file in [apps/web/src/components/action-bar/ActionBar.tsx](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/web/src/components/action-bar/ActionBar.tsx:89), [apps/web/src/components/action-bar/ActionBar.tsx](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/web/src/components/action-bar/ActionBar.tsx:167), and [apps/web/src/components/action-bar/ActionBar.tsx](/home/claude/.world/groups/do-box/cpc-features/workspace/cpc/apps/web/src/components/action-bar/ActionBar.tsx:560).

- `Round-1 MED/LOW recheck` — still open or only partially improved: icon by-name read (`M1`), broad share roots (`M2`), global share in-flight lock (`M3`), malformed `#file=` crash (`M4`), raw `gh` stderr leak (`M5`), stale reading-list save status/haptics (`M6`), and the share-size cap race (`M8`).

## Cross-cutting observations
- Targeted tests passed on current head: server `share`/`audio`/`prs-routes` (`47/47`) and web `ActionBar`/`App`/`PrTicker`/`ReadingList` (`96/96`).
- The fix round materially improved the risky surfaces. At this point the blockers are mostly edge-case ownership/hardening gaps rather than the round-1 merge/security regressions.
