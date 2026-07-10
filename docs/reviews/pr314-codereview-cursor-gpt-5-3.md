# Super-Swarm Review — PR #314 (head f208ccf)

## SUMMARY
NEEDS_FIXES. Most of the integration hardening is solid: the publish-shared server path uses pinned-handle reads with allowlist enforcement, and stale-async guards are consistently applied across audio, reading-list, and issues views. I found one medium state-machine regression in the new Share flow where an in-flight publish for one file can silently block publishing a different file. Recommendation: fix that blocker, then re-run the relevant ActionBar share interaction tests before merge gating proceeds.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- **Share publish lock leaks across file/context and drops user action silently** (`apps/web/src/components/action-bar/ActionBar.tsx`): `handlePublishShared()` exits early when `shareInFlightRef.current` is true, but that lock is global and survives sheet close/file switch; reopening Share for a different file while an older publish is still pending makes new publish taps no-op until the old request resolves/times out. This is an integration seam bug (cross-file state ownership) and presents as an unresponsive Share UI under slow/hung publish requests. **Suggested fix:** scope in-flight ownership to request sequence/file and/or keep an `AbortController` ref so opening a new Share context can cancel the stale request, clear the lock, and let the new publish proceed deterministically (with explicit UI state if cancellation is not allowed).

## LOW severity findings
CLEAN — no findings.

## Cross-cutting observations
The cross-feature hardening goals are largely met: TOCTOU mitigation on share reads is materially improved, deep-link/audio and reading-list flows use monotonic sequencing to suppress stale callbacks, and issues-mode avoids poll-tick API fan-out by using on-demand fetch plus bounded concurrency.
