# Phase Super-Swarm Review R2 — PR #314 (head c2b98ee)

## SUMMARY

NEEDS_FIXES. H1, H2, and H3 are confirmed closed: FIFO hardening survived the merge, audio side effects are file-owned, and staging remains on one `O_EXCL` fd through child inheritance. No new HIGH issue was found, but the repo-icon TOCTOU and several share-path correctness gaps remain; fix or explicitly accept them before merge.

## HIGH severity findings

CLEAN — no findings.

## MEDIUM severity findings

- `apps/server/src/routes/prs.ts:517` — `readRepoIcon()` still validates and stats `realCandidatePath`, then reopens it with `readFileSync()` at line 540. A same-UID writer with repo access can swap the inode after the size/containment checks, enabling an out-of-repo read or an unbounded synchronous read. Open once, validate/fstat/read the same fd, and cap bytes while reading.

- `apps/server/src/routes/share.ts:139` — The 50 MB limit is only a pre-copy `fstat`; the loop at lines 158-160 has no byte counter. A file growing after `fstat` can exceed the limit or keep staging until disk exhaustion before the child timeout begins. Count staged bytes and abort at `MAX_SHARE_BYTES + 1`.

- `apps/server/src/routes/share.ts:18` — Slugs remain deterministic to one second. Concurrent shares with the same stem/scope generate the same destination, and `publish-shared` uses clobbering `cp`, so one successful URL can later contain the other request's bytes. Add cryptographic uniqueness or atomically reject destination collisions.

- `apps/server/src/routes/share.ts:124` — Publishing uses the viewer-wide `ALLOWED_FILE_ROOTS`, including `/tmp` and legacy lane paths. That is broader than a path allowed to become a public/private artifact; introduce a purpose-specific share allowlist.

- `apps/web/src/components/action-bar/ActionBar.tsx:583` — `shareInFlightRef` is global across files. Reopening Share for B invalidates A's result but does not release/cancel A's lock, so B's publish tap silently no-ops until A settles. Own/cancel the request by file and sequence.

- `apps/web/src/App.tsx:108` — `decodeURIComponent()` for `#file=` remains unguarded and can throw during render on malformed input such as `#files&file=%`. Mirror the adjacent guarded session decoder.

- `apps/server/src/routes/prs.ts:163` — `execGh()` embeds raw stderr in its error, and `/issues` returns that string at lines 663-665. Log details server-side and return a fixed client-safe error.

## LOW severity findings

- `apps/web/src/components/action-bar/ActionBar.tsx:570` — Reading-list save state is sequence-guarded, but late A success/failure still emits haptics and status while B is viewed.
- `apps/server/src/routes/prs.ts:646` — Authenticated callers can repeatedly use `force=1` to bypass the issue cache without a separate limiter or single-flight guard.
- `apps/server/src/routes/audio.ts:183` — Sibling-document lookup only rewrites `.mp3`; other accepted audio formats such as `.ogg` deep-link to the audio itself.
- `apps/server/src/routes/prs.ts:525` — Icon discovery performs up to 14 candidates per repo with synchronous filesystem calls on the server event loop.
- Round-1 defer items remain: extension-trusted icon MIME (`prs.ts:537`), uppercase `.MD` fallback (`audio.ts:188`), share existence oracle (`share.ts:124`), and non-aborted stale issue requests (`PrTicker.tsx:320`). The explicit child env and media-helper behavior match the existing trust model.

## Round-1 fix verification

| Item | Status | Evidence |
|---|---|---|
| H1 — FIFO DoS / merge regression | CONFIRMED CLOSED | `openAllowedForRead()` uses `O_RDONLY | O_NONBLOCK` and fstat-rejects special files (`path-allowed.ts:149-160`); `index.ts` retains both `shareRoute` and `isAssetLikePath`, and `App.tsx` retains session-picker plus sequence-keyed file opening. No conflict markers remain. |
| H2 — cross-file audio operations | CONFIRMED CLOSED | `audioOpPathRef`/`viewedFilePathRef` own check, generation, manual send, and auto-send; generation rechecks the viewed file before calling Telegram (`ActionBar.tsx:380-521`). Navigation/return tests cover both suppression and pending-state restoration. |
| H3 — staged publish TOCTOU | CONFIRMED CLOSED | The staged inode is created once with `O_CREAT | O_EXCL`, written/synced through that handle, and inherited by the child as fd 3 (`share.ts:147-185`). Source/staged handles and staging directory are cleaned in `finally`; no leak or double-close defect found. |
| Slug extension guard | CONFIRMED CLOSED | The exact media extension is checked and preserved (`share.ts:28-37`), including dotted stems. |
| Partial-write loop | CONFIRMED CLOSED | `writeFully()` advances by `bytesWritten` and rejects zero progress (`share.ts:50-60`); tests cover partial writes. |
| Return-to-pending UI | CONFIRMED CLOSED | Reading-list pending state is stored per path and restored on return (`ActionBar.tsx:167-179`); audio generation/send stage is likewise restored. |

## Cross-cutting observations

- Round-1 M1-M9 remain open except the three HIGH fixes and cheap-tier items above. M10 is still present but limited to non-MP3 callers; M11 remains an event-loop performance concern. No unresolved item was incidentally fixed beyond the claimed set.
- Focused web tests passed 105/105; server tests passed 69/70. The sole server failure was environmental (`spawnSync mkfifo EPERM` in the FIFO fixture), while the share/audio/PRS suites passed. Server and web typechecks passed.
- The fd-pinning implementation is materially sound; remaining publish risk is size enforcement, destination collision, and authorization breadth rather than descriptor identity/lifetime.
