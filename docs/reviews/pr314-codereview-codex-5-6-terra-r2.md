# Phase Super-Swarm Review R2 — PR #314 (head c2b98ee)

## SUMMARY

NEEDS_FIXES. H1, H2, and H3 from round 1 are confirmed closed: the merged FIFO guard is present, audio send/generate completion is owned by its source file, and publishing retains one staging FD through the child handoff. The remaining concerns are the still-broad public-share root, an in-flight share for A that makes a B publish tap silently no-op, and several previously reported hardening gaps. Do not merge until the MEDIUM findings are dispositioned.

## HIGH severity findings

CLEAN — no findings.

## MEDIUM severity findings

- `apps/server/src/routes/share.ts:124` — Publishing accepts every `ALLOWED_FILE_ROOTS` entry, including `/tmp`, legacy lanes, and the broad `.claude`/workspace view roots. A protected user can turn any viewer-readable file into a public URL. Define a purpose-specific, least-privilege `ALLOWED_SHARE_ROOTS` and test denial of view-only roots.

- `apps/web/src/components/action-bar/ActionBar.tsx:583-584,951-955` — Opening Share for B invalidates A's result, but `shareInFlightRef` remains global until A settles. A B publish tap during that interval returns without feedback. Scope the lock to the selected path/sequence, or disable the B controls with an explicit “finishing A” state. The existing test only taps B after A resolves.

- `apps/web/src/App.tsx:108` — A malformed `#file=%` throws in render because file-fragment decoding is not guarded, unlike the adjacent session decoder. Treat decode failure as no initial file and add a regression test.

- `apps/server/src/routes/prs.ts:163-166,663-665` — `/issues` returns raw `gh` stderr to the browser. It can expose local paths or GitHub/config diagnostics. Log it server-side and return a fixed 502 error.

- `apps/server/src/routes/prs.ts:517-542` — Icon loading still checks `existsSync`/`realpathSync`/`statSync` then reopens by name with `readFileSync`. A local writer to a discovered repository can swap the candidate after the checks, causing a read outside the checked inode or an unbounded synchronous read. Open and validate a pinned descriptor, then bound the read from that descriptor.

- `apps/server/src/routes/share.ts:139-160` — The 50 MiB check is a pre-stream snapshot only. A source that grows while its pinned FD is streamed can exceed the publish limit. Count bytes during staging and fail/clean up once the limit is crossed.

- `apps/server/src/routes/share.ts:18-41` and `/home/claude/bin/publish-shared:120-131` — Two concurrent shares of same-named files in the same second derive the same slug; `cp` overwrites the destination. Include collision-resistant entropy or reserve the destination atomically.

## LOW severity findings

- `apps/web/src/components/action-bar/ActionBar.tsx:570-576` — A save for file A can still show haptics/status while B is viewed; only `readingListSaved` is sequence-guarded.
- `apps/server/src/routes/prs.ts:646-665` — `force=1` bypasses the five-minute cache with no server-side rate limit.
- `apps/server/src/routes/audio.ts:183-189` — Deep-link transcript discovery remains `.mp3`-only; `.ogg` siblings fall back to the audio path.
- `apps/server/src/routes/prs.ts:517-543` still does synchronous icon I/O; `apps/web/src/components/PrTicker.tsx:346-348` does not abort superseded issue fetches. Both are deferrable operational cleanup.

## Round-1 fix verification

| Finding | Status | Evidence |
| --- | --- | --- |
| H1 — FIFO DoS / merge preservation | CONFIRMED CLOSED | `openAllowedForRead()` uses `O_RDONLY | O_NONBLOCK` and immediately `fstat`s/rejects non-files at `path-allowed.ts:149-160`; the FIFO regression test is present at `path-allowed.test.ts:269-293`. The merge also retains both `shareRoute` and the SPA fallback plus App's session-picker/file-open sequencing. |
| H2 — cross-file audio send | CONFIRMED CLOSED | `ActionBar.tsx:413-521` binds generate, auto-send, and manual send to `audioOpPathRef` plus the current viewed path. A completion after navigating away does not call Telegram; the R2 test covers it at `ActionBar.test.tsx:507-562`. |
| H3 — staged-file handoff TOCTOU | CONFIRMED CLOSED | The staged file is created once with `O_EXCL`/`0600`, written and synced through that handle, then passed as inherited FD 3 to `publish-shared` (`share.ts:149-185`). Cleanup closes source/staged handles and removes staging in one `finally` block (`201-210`); tests assert one staged open and FD-based content read. |
| Slug extension guard | CONFIRMED CLOSED | `derivePublishSlug()` tests the actual media extension, and tests cover dotted stems plus uppercase media suffixes. |
| Partial staging writes | CONFIRMED CLOSED | `writeFully()` loops on `bytesWritten`, rejects zero-progress writes, and is used for every staged chunk (`share.ts:50-60,158-160`). |
| Return-to-pending UI restore | CONFIRMED CLOSED | File-change state restores the matching in-flight audio operation and stage (`ActionBar.tsx:148-166`); the navigate-away-and-back test verifies it. |

The other round-1 MEDIUM findings remain: M1 icon TOCTOU, M2 broad share roots, M3 share lock ownership, M4 malformed file deep link, M5 `gh` diagnostics, M6 stale reading-list status, M7 force-refresh rate limit, M8 growing-file cap, M9 slug collision, M10 non-MP3 deep links, and M11 sync icon I/O. Low-tier observations also remain: extension-derived icon MIME, uppercase `.MD` fallback, the authenticated existence oracle (`open` before containment response), explicit inherited environment for `publish-shared`, and no issue-fetch abort.

## Cross-cutting observations

Targeted server tests passed (47), and web tests passed (321); both typechecks and production builds pass. The full server suite is not green in this sandbox because `mkfifo` is denied (the FIFO tests cannot create their fixture) and two unrelated OTEL tests attempt to write a read-only SQLite DB; these do not contradict the source-level H1 verification. `git diff --check` is clean.
