# Phase Super-Swarm Review R2 — PR #314 (head c2b98ee)

## SUMMARY
Verdict: CLEAN (no remaining HIGH severity findings). H1, H2, and H3 from Round 1 are all confirmed closed: the `dev` branch hardening in `path-allowed.ts` was preserved during the merge, audio operations in `ActionBar.tsx` are now securely bound to the file sequence, and the staged file is passed by file descriptor (`/dev/fd/3`) instead of by name. The most pressing remaining issue is M3 (the global `shareInFlightRef` lock blocking consecutive publishes), but the security and invariant risks are mitigated. Merge recommended.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- `apps/web/src/components/action-bar/ActionBar.tsx` (M3 from R1): `shareInFlightRef` lock survives sheet close. If a publish times out or is slow, closing the sheet and opening another file's Share sheet leaves the publish button silently dead because the global boolean is still `true`. Fix by scoping the lock to `shareSeqRef.current` or using an `AbortController` bound to the sheet lifecycle.
- `apps/web/src/components/action-bar/ActionBar.tsx` (M6 from R1): `handleSaveToReadingList` unconditional side effects. The UI button state was properly guarded with `readingListCheckSeqRef`, but `haptic.success()` and `setStatus(...)` still fire unconditionally on completion, which can randomly overwrite the status bar while the user is viewing a different file.
- `apps/server/src/routes/prs.ts` (M11 from R1): `readRepoIcon` blocks the event loop on cache miss via `readFileSync`/`statSync` iterating over candidates for every repo. Since this runs on the main thread, it introduces latency spikes for concurrent API calls.
- `apps/server/src/routes/share.ts` (M8 from R1): `MAX_SHARE_BYTES` (50MB) is only checked on initial `stat`. A file growing concurrently after `stat` will stream unconditionally into `stagedPath`, bypassing the limit and consuming disk space until the child process times out. Cap the stream bytes during the `writeFully` loop.

## LOW severity findings
- `apps/web/src/App.tsx` (M4 from R1): `decodeURIComponent` in file deep-link runs unguarded. A malformed URL fragment throws and blanks the app.
- `apps/server/src/routes/prs.ts` (M5 from R1): `/issues` raw `gh` stderr is leaked to the browser.
- `apps/server/src/routes/audio.ts` (M10 from R1): Transcript lookup strictly checks `/\.mp3$/i`, breaking for native `.ogg` recordings.
- `apps/server/src/routes/prs.ts` (M1 from R1): The icon lookup pattern relies on check-then-use (stat -> read) instead of pinned FD reads.
- `apps/web/src/components/PrTicker.tsx` (M7 from R1): Issue fetching loop lacks an `AbortSignal`, leaving requests active after unmount.

## Round-1 fix verification
- **H1 (FIFO-DoS regression)**: CONFIRMED CLOSED. `share.ts` imports and safely uses `openAllowedForRead`, and the absence of `path-allowed.ts` in the PR diff confirms the `dev` branch's `O_NONBLOCK` + `fstat` hardening survived the merge intact. `App.tsx` resolves both the sequencing fix and the `sessionPicker` fix.
- **H2 (Audio cross-file sends)**: CONFIRMED CLOSED. Both `handleGenerateAudio` and `handleSendAudio` now validate completion state and auto-send execution against `viewedFilePathRef.current`, safely dropping responses for stale files.
- **H3 (Staged-file TOCTOU)**: CONFIRMED CLOSED. The file is pinned with `O_CREAT | O_EXCL` in a new `mkdtemp` directory and passed to `publish-shared` safely as an inherited file descriptor (`/dev/fd/3`).
- **Cheap-tier (Slug extension)**: CONFIRMED CLOSED. Handled cleanly in `derivePublishSlug` with `RAW_MEDIA_EXTENSIONS`.
- **Cheap-tier (Partial-write loop)**: CONFIRMED CLOSED. `writeFully` reliably loops over bytesWritten.
- **Cheap-tier (Reading-list UI)**: CONFIRMED CLOSED. `pathChanged` accurately drops previous "Saving" / "Saved" UI states.

## Cross-cutting observations
- The `share.ts` API route correctly awaits the completion of the `publish-shared` child process, so the parent process (`share.ts`) retains the `stagedHandle` fd for the entire lifecycle, preventing early close.
- Error handling in `share.ts` `finally` block successfully guards against double-close conditions by leveraging `handleClosed`.
