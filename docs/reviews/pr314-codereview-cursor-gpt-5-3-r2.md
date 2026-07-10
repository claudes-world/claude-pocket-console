# Phase Super-Swarm Review R2 — PR #314 (head c2b98ee)

## SUMMARY
NEEDS_FIXES. Round-1 HIGH findings H1/H2/H3 are confirmed closed at `c2b98ee` (FIFO hardening preserved, audio ops scoped by file ownership, staged-file publish handoff pinned to an inherited fd). No new HIGH issues surfaced in this fix round, but several medium-risk items remain open in adjacent paths (`prs` icon read TOCTOU, broad share roots, cross-file share lock behavior, malformed hash crash, and raw stderr propagation). Recommendation: do not merge yet; close the remaining medium items or explicitly accept/track them.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- **Icon read path still has TOCTOU window and stale size check** (`apps/server/src/routes/prs.ts:517`): `readRepoIcon()` still performs `existsSync`/`realpathSync`/`statSync` and then re-opens by name via `readFileSync`, so a same-UID attacker with repo write access can swap the inode between check and read (including a larger file after stat). **Suggested fix:** switch to a pinned-fd flow (`openAllowedForRead` + fstat + fd-bound read) and enforce byte cap while reading.
- **Share publish still accepts overly broad read roots** (`apps/server/src/routes/share.ts:124`): `/publish` gates `path` with `ALLOWED_FILE_ROOTS` (includes `/tmp` and legacy lane paths), which is wider than what should be publishable to share URLs. **Suggested fix:** introduce a dedicated `ALLOWED_SHARE_ROOTS` allowlist and keep it narrower than viewer reads.
- **Share in-flight lock still leaks across file context** (`apps/web/src/components/action-bar/ActionBar.tsx:583`): `handlePublishShared()` still drops publishes when `shareInFlightRef` is true, even after switching files/reopening Share, so a pending publish on A can make publish on B silently no-op. **Suggested fix:** scope lock ownership by file/request id and cancel/replace stale in-flight requests on context switch.
- **Malformed `#file=` hash can still crash initial render** (`apps/web/src/App.tsx:108`): `decodeURIComponent(...)` for `initialFile` remains unguarded, so malformed percent encoding (e.g. `#files&file=%`) throws during render. **Suggested fix:** mirror the guarded `try/catch` pattern already used for `session`.
- **`/issues` still returns raw `gh` stderr text to clients** (`apps/server/src/routes/prs.ts:664`): error bodies include host-local stderr fragments from `gh failed: ...`, leaking operational details to authenticated clients. **Suggested fix:** log detailed stderr server-side, return a fixed client-safe error string.

## LOW severity findings
- **`force=1` still bypasses cache without an independent limiter** (`apps/server/src/routes/prs.ts:646`): authenticated callers can repeatedly force expensive `gh issue list` calls.
- **Reading-list success/failure status is still not seq-guarded** (`apps/web/src/components/action-bar/ActionBar.tsx:570`): late completion for file A can still emit status/haptic while user is on file B (state correctness is preserved, but UX signal can be stale).

## Round-1 fix verification
- **H1 (FIFO-DoS regression risk): CONFIRMED CLOSED.** `openAllowedForRead()` uses `O_RDONLY | O_NONBLOCK` and rejects non-file/non-directory via `handle.stat()` (`apps/server/src/lib/path-allowed.ts:149`, `apps/server/src/lib/path-allowed.ts:155`), and merge-sensitive routes in `index.ts` retain both `shareRoute` and `isAssetLikePath` (`apps/server/src/index.ts:29`, `apps/server/src/index.ts:30`).
- **H2 (audio cross-file send/generate): CONFIRMED CLOSED.** Audio ownership is now file-scoped (`audioOpPathRef`, `viewedFilePathRef`) and checked across generate completion, auto-send, and manual send paths (`apps/web/src/components/action-bar/ActionBar.tsx:77`, `apps/web/src/components/action-bar/ActionBar.tsx:413`, `apps/web/src/components/action-bar/ActionBar.tsx:449`, `apps/web/src/components/action-bar/ActionBar.tsx:503`).
- **H3 (staged-file TOCTOU handoff): CONFIRMED CLOSED.** Staged file is created with `O_CREAT|O_EXCL`, written through the same handle, and published through inherited fd `3` (`/dev/fd/3`) rather than reopen-by-name (`apps/server/src/routes/share.ts:149`, `apps/server/src/routes/share.ts:172`, `apps/server/src/routes/share.ts:184`).
- **Cheap-tier: slug extension guard: CONFIRMED CLOSED.** Extension logic is now specific and extension-aware (`apps/server/src/routes/share.ts:28`).
- **Cheap-tier: partial-write loop: CONFIRMED CLOSED.** `writeFully()` loops until all bytes are written and fails on zero-progress writes (`apps/server/src/routes/share.ts:50`).
- **Cheap-tier: return-to-pending UI restore: CONFIRMED CLOSED.** Reading-list pending state is path-owned and restored when revisiting an in-flight file (`apps/web/src/components/action-bar/ActionBar.tsx:96`, `apps/web/src/components/action-bar/ActionBar.tsx:176`).

## Cross-cutting observations
- Targeted seam tests pass at head: server (`share`, `audio`, `prs-routes`) and web (`ActionBar`, `App`) suites all green.
- No fd leak/double-close defect found in the H3 fix path under reviewed control flow; cleanup paths close source/staged handles defensively.
- Remaining risk is mostly in adjacent hardening debt, not in the three previously-blocking HIGH paths.
