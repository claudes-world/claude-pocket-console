# Super-Swarm Review — PR #314 (head f208ccf)

## SUMMARY

NEEDS_FIXES. Authentication and the share route's pinned-fd pathname hardening are sound, but cross-file audio state can target the wrong file, two publish paths retain race/data-integrity holes, and the icon reader reopens a validated pathname. The branch also conflicts with current `dev`; do not merge until these are fixed, the conflict is resolved additively, and all suites are rerun.

## HIGH severity findings

CLEAN — no findings

## MEDIUM severity findings

- `apps/web/src/components/action-bar/ActionBar.tsx:413` — The sequence token versions audio checks, not generation results. If generation for A is running, the user closes the sheet, opens B, and taps Audio, B's check returns early on the global in-flight lock; A then completes and unconditionally installs A's path at line 434, so B's sheet exposes a manual Send action for A. Keep auto-sending the initiated A result, but commit `audioStatus` only if the viewed path/token still owns the UI, then check the current file after the operation; add this navigation transition to the tests.

- `apps/server/src/routes/share.ts:53` — The 50 MB check precedes an uncapped stream. A mutable allowed file can grow after `fstat`; `createReadStream()` then copies beyond the limit (or indefinitely if a writer stays ahead), filling the staging filesystem before the later `execFile` timeout even starts. Enforce `MAX_SHARE_BYTES` in the pipeline with a counting/limiting transform and fail once byte `MAX+1` is observed; test a file that grows during copying.

- `apps/server/src/routes/share.ts:72` — The API invokes `publish-shared` without a slug, while the helper derives `<basename>-<timestamp-to-the-second>` and uses clobbering `cp`. Concurrent shares of distinct same-named files in one scope can therefore return the same URL while last-writer-wins changes its content. Pass a cryptographically unique slug (or make destination creation atomic/non-clobbering) and cover concurrent same-basename publishes.

- `apps/server/src/routes/prs.ts:530` — `readRepoIcon()` validates a canonical pathname, then `statSync()` and `readFileSync()` reopen it by name. Replacing that in-repo pathname with a symlink after validation can make `/api/prs/icons` return up to 64 KB from outside the repository. Open once, validate `/proc/self/fd/<fd>` beneath the real repo root, `fstat`, and read the same descriptor; add a swap regression test.

- `apps/server/src/index.ts:29`, `apps/web/src/App.tsx:138` — The branch has real content conflicts against `origin/dev` (`31e4949`). Resolution must preserve both `shareRoute` and dev's `isAssetLikePath` fallback hardening, and combine `resolveSessionPickerProps` with the new `fileOpenRequest`/callback-ownership state; choosing either side regresses a previously gated fix or breaks this feature. Rebase/merge `dev`, resolve additively, and rerun server/web tests, typechecks, and builds on the resolved tree.

## LOW severity findings

- `apps/web/src/App.tsx:107` — File deep-links call `decodeURIComponent()` during render without the guard already used for session deep-links below. A crafted/truncated `#file=%` URL throws and blanks the app. Parse once under `try/catch` (or use tolerant `URLSearchParams`) and ignore malformed values.

- `apps/server/src/routes/share.ts:39` — `openAllowedForRead()` opens before containment validation, and the route maps missing to 404 but an existing readable out-of-root path to 403 (other open failures become 500), creating an authenticated filesystem-existence oracle. Collapse these failures to one external response while retaining detailed server-side diagnostics.

## Cross-cutting observations

The new audio/share/PR routes remain behind the global Telegram allowlist middleware; no unauthenticated action trigger was found. Audio links percent-encode the path and downstream file reads revalidate it, while Reading List v2 preserves per-user storage and uses sequence-bound UI callbacks. The merge conflict is the only drift artifact found, but it touches two previously hardened paths and needs explicit regression coverage after resolution.
