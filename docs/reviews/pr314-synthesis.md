# Phase Super-Swarm Synthesis — PR #314 (head f208ccf6)

**Models run:** Codex 5.4 ✓ | Codex 5.5 ✓ | Codex 5.6-sol ✓ (retry 1) | Codex 5.6-terra ✓ | Cursor GPT-5.3-codex ✓ | Claude Sonnet 5 (direct) ✓ (retry 2, first two attempts hit a bad `--add-dir`/`--allowedTools` space-form flag parse bug + then an Anthropic Max session-limit wall that cleared ~15:15 ET) | Gemini 3.1 Pro (agy) ✓ (retry 2, first two attempts hit "Individual quota reached") | Gemini 3.5 Flash (agy) ✗ quota exhausted, no reset-window retry landed | Cursor Claude Opus 4.8 ✗ "Max Mode Required" (Cursor account config gap, not a transient failure — Max Mode is off on this subscription) | Cursor GPT-5.5-high ✗ same Max Mode gap (superseded by the GPT-5.3-codex leg, which doesn't require Max Mode)

**7 of 9 dispatched reviewers completed** — good cross-family spread (4 Codex variants, 1 Cursor-routed GPT, 1 direct Claude, 1 Gemini). The Claude-via-Cursor Opus leg is the one real gap this round (config-gated, not capacity — flag for Liam: enabling Max Mode on the Cursor subscription would restore that leg for future full swarms).

**Phase:** dev-cpc-features → dev integration gate (six merged sub-features: audio deep-link + auto-send, publish-shared w/ TOCTOU-hardened server route, PR-screen manage/issues/icons cluster, Reading List v2 UI)
**Diff size:** 4147 lines / 25 files
**Mergeable status:** `CONFLICTING` against `dev` (confirmed via `gh pr view` — see H1, this is not incidental)

## Summary

**Verdict: NEEDS_FIXES — do not merge as-is.** Two independently-verified HIGH findings block merge: (H1) the branch is missing a FIFO-DoS hardening fix that already shipped on `dev` (PR #299), and the new `share.ts` publish route calls exactly the un-hardened function against an allowlist that includes world-writable `/tmp` — if the real GitHub merge conflict against `dev` gets resolved by mechanically picking `dev-cpc-features`'s version of `path-allowed.ts` (or the PR merges before rebasing), that already-fixed DoS regresses silently. (H2) Audio generation/send state in `ActionBar.tsx` has no per-file ownership guard — verified via direct code read that `handleGenerateAudio`/`handleSendAudio` apply completions unconditionally regardless of which file is currently being viewed, so a user can unknowingly send the wrong file's audio to Telegram. Everything else in the integration (pinned-fd share reads, PR/reading-list/issues stale-async guards, session-picker interplay) is solid — five reviewers independently traced the seq-token pattern and found it correctly applied everywhere except the audio path.

Recommended action: rebase/merge `dev-cpc-features` onto current `dev` FIRST (resolving `path-allowed.ts`, `App.tsx`, and `index.ts` conflicts additively — see H1 for the exact preservation requirements), fix H2 and H3, then a scoped fix round on the top MEDIUMs, then re-run the full swarm before Liam's greenlight.

## MUST FIX — multi-model consensus (verified against code at HEAD)

| # | File:line | Models | Severity | Finding |
|---|---|---|---|---|
| H1 | `apps/server/src/lib/path-allowed.ts` (`openAllowedForRead`) + `apps/server/src/routes/share.ts:39` | claude-sonnet-5 (HIGH), codex-5-6-sol (MED), codex-5-6-terra (LOW, same root cause independently) — **3/7, verified directly against code by this synthesis** | **HIGH** | `dev` hardened `openAllowedForRead` (PR #299 round-2) to open `O_RDONLY\|O_NONBLOCK` and `fstat`-reject non-regular files (FIFO/socket/device) — comment explains this closes a threadpool-exhaustion DoS via a FIFO planted under the world-writable `/tmp` read root. **Confirmed via `git show`: `dev-cpc-features` (this PR's head) still has the pre-fix plain `open(path, "r")` with no fstat gate**, and the brand-new `share.ts` `/api/share/publish` route calls this exact function with `ALLOWED_FILE_ROOTS` (confirmed to include `/tmp`). Any co-tenant WorldOS lane (same UID) can `mkfifo` under `/tmp` and hang a libuv threadpool thread via this route. PR is `CONFLICTING` against `dev` on precisely this file — a careless "resolve conflicts" pass that keeps `dev-cpc-features`'s version reintroduces a fix that was already reviewed and shipped. **Fix:** rebase/merge onto current `dev` tip; verify the `O_NONBLOCK`+`fstat` guard survives in `path-allowed.ts`; add a regression test asserting `openAllowedForRead` on a FIFO path returns `denied` instead of hanging. Also verify `App.tsx`'s `resolveSessionPickerProps` (dev) composes correctly with this PR's `fileOpenRequest` sequencing fix on the same lines — mechanically picking one side loses the other. |
| H2 | `apps/web/src/components/action-bar/ActionBar.tsx` (`handleGenerateAudio`, `handleSendAudio`, `sendAudio`) | codex-5-4 (HIGH), gemini-3-1-pro (HIGH), codex-5-6-sol (MED) — **3/7, verified directly against code by this synthesis** | **HIGH** | `audioInFlightRef` is a single global boolean lock, not scoped per file, and `audioCheckSeqRef` is only consulted inside `handleCheckAudio` — **confirmed by reading the function bodies: neither `handleGenerateAudio`'s completion (`setAudioStatus`, then auto-`sendAudio`) nor `handleSendAudio` checks that the viewed file still matches the file the operation was started for.** Repro (codex-5-4): start generating audio on `A.md`, close the sheet, open `B.md`, reopen Audio — the sheet now shows `B`'s UI but a pending "Send to Telegram" action can still fire on `A`'s audio path. This is an external side-effect (a real Telegram send) triggered against stale file identity, not just a UI glitch. **Note:** claude-sonnet-5's review explicitly traced the seq-token pattern across all five call sites and asserted it was "correctly applied everywhere" except one already-caught reading-list issue — it missed this one. Cross-model catch exactly as designed. **Fix:** version audio ops by file path/sequence like the share/reading-list flows do; drop both auto-send completions and manual sends when the owning file is no longer current. |
| H3 | `apps/server/src/routes/share.ts:61-77` (staged-file → `publish-shared` handoff) | claude-sonnet-5 (HIGH), codex-5-4 (MED) — 2/7 | HIGH | The pinned-fd fix (`openAllowedForRead` → `handle.stat()` → `createReadStream()`) closes the TOCTOU on reading the *source* file, but after streaming into `mkdtemp()` and closing that handle, the route calls `publish-shared` with the staged file **by path string** — the external helper necessarily reopens it by name, reintroducing check-then-act one hop downstream. `mkdtemp`'s `0700` mode limits this to same-UID actors, but every WorldOS lane on this host runs as the same UID, so that's not a materially smaller threat population. **Fix:** keep the staged file open and hand the helper `/proc/self/fd/<n>`, or fold the publish copy into the route so `publish-shared` never reopens a mutable temp path by name. Confirm whether the referenced follow-up issue (#308) actually covers this staged-file gap specifically, not just the external helper's own open-time race. |

## SHOULD FIX (MEDIUM)

| # | Models | Finding |
|---|---|---|
| M1 | claude-sonnet-5, codex-5-6-sol (MED); gemini-3-1-pro (HIGH, disagreement — see resolution below) | `prs.ts` `readRepoIcon()`: `existsSync`→`realpathSync`→`statSync`→`readFileSync` is the same TOCTOU shape `openAllowedForRead` exists to close, just reimplemented ad hoc. **Verified:** `repoPath` originates only from `discoverRepos()` scanning `~/code`, not client input — narrower than gemini's "local attacker" framing implies (requires local *write* access to `~/code`, a real but stronger precondition than the trivially-reachable `/tmp` FIFO in H1). Rated **MEDIUM** (agreeing with claude-sonnet-5/codex-5-6-sol) — real, same-UID-exploitable given this host's shared-tenancy model, but gated behind filesystem write access an attacker doesn't automatically have from the client side. Still, the size-cap check happens *before* the read that could be swapped post-check, so an OOM read is plausible — fix via `openAllowedForRead`/pinned-fd read, add a symlink-swap regression test. |
| M2 | claude-sonnet-5, codex-5-4 | `share.ts` reuses the broad view-only `ALLOWED_FILE_ROOTS` (includes `/tmp`, other agent lanes' working dirs under `.worldos/lanes`) to gate what can be published to a public/private URL. Recommend a narrower `ALLOWED_SHARE_ROOTS`. |
| M3 | cursor-gpt-5-3 | `handlePublishShared()`'s in-flight lock (`shareInFlightRef`) is global and survives sheet close/file switch — reopening Share for a different file while an older publish is pending makes new publish taps silently no-op. Scope ownership to request sequence/file, or add cancellation. |
| M4 | codex-5-6-terra (MED), codex-5-6-sol (LOW) | `App.tsx:107` — `decodeURIComponent()` on the file deep-link runs unguarded during render; a malformed `#file=%` fragment (now directly reachable via the new audio deep-link surface) throws and blanks the app. Wrap in `try/catch` like the adjacent session-fragment parser. |
| M5 | codex-5-6-terra | `prs.ts` `/issues`: raw `gh` stderr is embedded in the error returned to the browser — can leak local paths/config context. Log server-side, return a fixed message. |
| M6 | claude-sonnet-5 | `ActionBar.tsx` reading-list save: `haptic.success()/error()` and `setStatus(...)` fire unconditionally on settle, not seq-guarded like the sibling share flow — a late-resolving save for file A can pop a stale status while the user is now viewing/saving B. |
| M7 | claude-sonnet-5 | `/api/prs/issues?force=1` bypasses the 5-min cache TTL with no independent server-side rate limit — narrower than "unbounded fan-out" since it needs valid auth + a real discovered repo, but still an uncalled-out residual gap. |
| M8 | codex-5-6-sol | `share.ts:53` — the 50MB size check precedes an uncapped stream; a file that grows after `fstat` can be copied past the limit before the `execFile` timeout starts. Enforce the cap in the copy pipeline itself. |
| M9 | codex-5-6-sol | `share.ts:72` — no slug passed to `publish-shared`, which derives `<basename>-<second>` with clobbering `cp`; concurrent shares of distinct same-named files can collide on one URL with last-writer-wins content. |
| M10 | gemini-3-1-pro | `audio.ts` sibling-transcript lookup hardcodes `/\.mp3$/i` — native `.ogg` recordings (per `VoiceRecorder`/`ActionBar.test.tsx`) never resolve a transcript and silently fall back to the raw audio link. |
| M11 | gemini-3-1-pro | `prs.ts` `/icons`: synchronous `fs` calls (up to 14 candidates × N repos) block the Node event loop on cache misses. Switch to `fs.promises`. |

## DEFER (LOW)

- `prs.ts` `ICON_MIME` trust is extension-based, not content-sniffed — inert today (only consumed via `<img src>`), flag for the future (claude-sonnet-5).
- Audio deep-link uppercase-extension fallback (`note.MD` beside `note.mp3`) is a known, accepted limitation on case-sensitive filesystems (claude-sonnet-5).
- `share.ts`'s `execFileAsync` explicitly spreads `process.env` into the `publish-shared` child — matches existing codebase trust model, just the first *explicit* spread; no action, awareness only (claude-sonnet-5).
- `share.ts:39` — `openAllowedForRead()` runs before containment validation; missing→404 vs. existing-but-out-of-root→403 creates an authenticated filesystem-existence oracle. Collapse to one external response (codex-5-6-sol).
- `PrTicker.tsx` issue fetches lack an `AbortSignal` — rapid view-toggling leaves stale requests consuming the concurrency pool (gemini-3-1-pro).

## SKIP (false positive / out of scope)

- None identified this round — no reviewer finding was assessed as a false positive after verification; the one disagreement (icon TOCTOU severity, M1) was resolved by direct code inspection rather than dropped.

## FEATURE-SUGGESTION → Plane items

- None this round. Every finding across all 7 completed reviews was scoped to the existing surface under review (bug fix / hardening / test-gap), not a new capability. No Plane items filed.

## Per-model verdicts

- **claude-sonnet-5** (direct): NEEDS_FIXES — 2 HIGH (H1 merge-conflict/FIFO-DoS regression risk, H3 staged-file TOCTOU), 4 MEDIUM, 3 LOW. Most thorough on the merge-conflict analysis (used actual `git show`/`git merge-base` against both branches); missed H2 (audio cross-file bug) despite explicitly tracing the seq-token pattern.
- **codex-5-4**: NEEDS_FIXES — 1 HIGH (H2, with a concrete repro), 2 MEDIUM (H3, M2).
- **codex-5-5**: CLEAN — no findings. Outlier; reviewed via `git show` at HEAD but surfaced nothing others didn't also independently catch or the mechanisms weren't present at the specific lines it checked.
- **codex-5-6-sol**: NEEDS_FIXES — 0 HIGH, 5 MEDIUM (H1-adjacent conflict note, M1, M8, M9, H2-as-MEDIUM), 2 LOW.
- **codex-5-6-terra**: NEEDS_FIXES — 0 HIGH, 2 MEDIUM (M4, M5), 1 LOW (independently corroborates H1's FIFO mechanism from a different angle).
- **cursor-gpt-5-3**: NEEDS_FIXES — 0 HIGH, 1 MEDIUM (M3).
- **gemini-3-1-pro**: NEEDS_FIXES — 2 HIGH (H2, and M1 rated HIGH — disagreement resolved to MEDIUM above), 2 MEDIUM (M10, M11), 1 LOW.

## Cross-model overlap stats

- H1 (FIFO-DoS regression / merge-conflict risk): 3/7 explicit + independently verified true against code — **treat as confirmed, not just consensus**.
- H2 (audio cross-file overwrite): 3/7 (2 HIGH + 1 MEDIUM) + independently verified true against code — **treat as confirmed**.
- H3 (staged-file TOCTOU handoff): 2/7, mechanism verified plausible against code, not independently reproduced.
- M1 (icon TOCTOU): 3/7 with a severity split (2 MEDIUM, 1 HIGH) — resolved to MEDIUM after verifying `repoPath` provenance.
- M2 (ALLOWED_FILE_ROOTS too broad for publish): 2/7.
- All other MEDIUM/LOW findings: 1/7 each — logged per doctrine, not dropped as noise.

## Decision

Recommend a **Path A fix round (R1)** before this PR can be re-gated:

1. Rebase/merge `dev-cpc-features` onto current `dev` tip; resolve `path-allowed.ts` (keep `O_NONBLOCK`+`fstat` guard), `App.tsx` (combine `resolveSessionPickerProps` with `fileOpenRequest` sequencing), `index.ts` (keep both `shareRoute` and `isAssetLikePath`) additively. Add the FIFO-rejection regression test.
2. Fix H2: scope audio generate/send completion + auto-send by file path/sequence, matching the share/reading-list pattern.
3. Fix H3: hand `publish-shared` a live fd (`/proc/self/fd/<n>`) instead of a re-openable staged path, or fold the copy into the route.
4. Fix top MEDIUMs at PM discretion by risk: M2 (narrower `ALLOWED_SHARE_ROOTS`) and M1 (pinned-fd icon read) are the two with real same-UID exploitability on this host; M3-M11 can be scoped/deferred by the PM's judgment.
5. Re-run ALL 9 reviewers (not just the ones that found something) once fixes land — a fix round has historically surfaced new findings from previously-clean reviewers.

Total fix-round budget: ~45-60 min engineering + one more full swarm pass (~25-35 min wall clock given today's capacity turbulence).

**the user decision needed:** none blocking — this is squarely PM/fix-round territory. Flag for Liam separately (not blocking): the Cursor subscription's Max Mode is off, which drops the Opus-via-Cursor leg from every swarm until enabled — worth a one-time toggle if that reviewer's coverage matters going forward.

PR #314 stays OPEN regardless of this verdict, per the requesting instruction.
