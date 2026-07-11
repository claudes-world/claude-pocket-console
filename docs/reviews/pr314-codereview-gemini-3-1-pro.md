# Super-Swarm Review — PR #314 (head f208ccf)

## SUMMARY
NEEDS_FIXES. The integration is structurally solid (especially the pinned-fd share implementation), but introduces a classic TOCTOU race in repo icon serving that allows arbitrary file read/DoS, and exposes a cross-file state overwrite in the audio action bar due to missing sequence guards.

## HIGH severity findings
- `apps/server/src/routes/prs.ts` (`readRepoIcon`): Hand-rolled path validation creates a TOCTOU race. The code calls `statSync(realCandidatePath)` followed by `readFileSync(realCandidatePath)` using the path string. A local attacker can swap `favicon.ico` for a symlink to a sensitive or massive file between these calls, leading to arbitrary file read (exfiltrated via base64) or an OOM DoS (since `readFileSync` buffers the whole file). **Fix:** Use the existing `openAllowedForRead` utility from `path-allowed.js` to pin the file descriptor, then verify size and read directly from the handle.
- `apps/web/src/components/action-bar/ActionBar.tsx`: `handleGenerateAudio` and `handleSendAudio` lack sequence bounds. If the user navigates to a new file while audio generation or sending is in flight, the background completion unconditionally overwrites `audioStatus` and clears `audioLoading`, leaving the new file stuck with the previous file's audio state. **Fix:** Capture `const seq = ++audioCheckSeqRef.current;` at the start of both functions, and verify `seq === audioCheckSeqRef.current` before applying state updates in `then`/`catch`/`finally`.

## MEDIUM severity findings
- `apps/server/src/routes/audio.ts`: Hardcoded `/\.mp3$/i` regex for sibling markdown resolution. If audio files are `.ogg` (e.g., native recordings from VoiceRecorder, as seen in `ActionBar.test.tsx`), their transcripts will not be found and deep-linked because the replace fails, falling back to the raw audio link. **Fix:** Use a broader regex like `/\.(mp3|ogg|wav)$/i`.
- `apps/server/src/routes/prs.ts` (`/icons`): Synchronous file I/O in a loop across all discovered repositories. `readRepoIcon` uses sync `fs` methods for up to 14 candidates per repo. On cache misses, this blocks the Node event loop, degrading server responsiveness. **Fix:** Switch to asynchronous `fs.promises` (`stat`, `readFile`) to yield the event loop.

## LOW severity findings
- `apps/web/src/components/PrTicker.tsx`: Issue fetches lack an `AbortSignal`. Rapidly toggling between PR and Issues views leaves obsolete network requests running in the background, needlessly consuming the 4-slot concurrency pool. **Fix:** Wire an `AbortController` into `fetchIssues` and abort on view mode switch.

## Cross-cutting observations
- The `share.ts` publish implementation correctly uses `createReadStream` on the pre-validated pinned file descriptor, successfully mitigating the check-then-act vulnerabilities seen in earlier iterations.
- The state machine design for `PrViewPrefs` correctly handles prototype pollution defensively via explicit `__proto__` checks and `hasOwnProperty`, demonstrating good architectural hygiene.
