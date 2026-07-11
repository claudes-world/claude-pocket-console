# Phase Super-Swarm Synthesis R2 — PR #314 (head c2b98ee)

**Round:** 2 (post-fix-round re-review)
**Models run:** Codex 5.4 ✓ | Codex 5.5 ✓ | Codex 5.6-sol ✓ | Codex 5.6-terra ✓ | Gemini 3.1 Pro (agy) ✓ | Cursor gpt-5.3-codex-high ✓ | Claude Sonnet 5 (direct) ✓
**Skipped (not dispatched, per requesting instruction — do not retry):** Cursor Claude Opus leg — Cursor Max Mode is off on this subscription, config-gated not transient. Same gap noted in round 1.
**7 of 7 dispatched reviewers completed.** No failures this round (round 1's flag-parse and quota issues did not recur — `--flag=value` form held for the claude CLI dispatch, agy landed on the second-known output-path-drift gotcha — file materialized at `~/claudes-world/docs/reviews/...` instead of the repo path, moved into place manually, content unaffected).

**Phase:** dev-cpc-features → dev integration gate, re-review after fix round addressing round-1's 3 HIGH findings + 3 cheap-tier items
**Mergeable status:** `MERGEABLE` (was `CONFLICTING` in round 1 — the dev-merge that round 1 flagged as a risk (H1) has since landed)
**Prior round:** `docs/reviews/pr314-synthesis.md` (3 HIGH: H1 FIFO-DoS regression risk, H2 audio cross-file send, H3 staged-file TOCTOU handoff)

## Summary

**Verdict: NEEDS_FIXES (non-blocking) — safe to merge on the security/correctness axis.** All three round-1 HIGH findings are **independently confirmed CLOSED by all 7 reviewers**, each citing concrete line-level evidence and, in most cases, new regression tests (FIFO rejection test, cross-file audio-send test, single-staged-open + fd-based-read test). Zero new HIGH-severity findings surfaced from any reviewer's fresh full-diff pass — this held even though the brief explicitly asked reviewers to distrust the PM's fix claims and hunt for fix-round regressions (fd leaks/double-close, partial file-scoping coverage, merge-conflict-resolution artifacts). None were found.

What remains is a set of MEDIUM/LOW findings almost entirely **carried over verbatim from round 1** — the fix round scoped itself to the 3 HIGHs + 3 named cheap-tier items (slug extension guard, partial-write loop, return-to-pending UI restore, all independently confirmed closed too) and did not touch the MEDIUM backlog. The single highest-consensus finding this round is **M3 (7/7): the `shareInFlightRef` global lock silently no-ops a Share tap on file B for up to 30s if a prior publish on file A is still in flight** — every reviewer independently flagged this, and Claude Sonnet 5 additionally found that the existing regression test resolves the first request before the second click, so it never exercises the race (false coverage). M1 (icon TOCTOU) and M5 (raw `gh` stderr leak) also hit 7/7.

One genuinely new (not round-1-carryover) finding: Claude Sonnet 5 traced a distinct bug where `readingListCheckSeqRef` is bumped by the global `READING_LIST_CHANGED_EVENT` (fired whenever *any* reading-list item is deleted anywhere in the app, since `ReadingList.tsx` stays mounted), which can spuriously fail an in-flight save's own completion check and flash the button back to "unsaved" even though the server save succeeded. Low severity (self-healing on next render, `ON CONFLICT DO UPDATE` makes a redundant re-save harmless) but worth tracking — no other reviewer caught it, plausibly because it requires reasoning about a cross-component global event, not just the file-scoping pattern the brief primed everyone to check.

Recommended action: merge is viable now; a scoped follow-up (R3, optional) closing the 7/7 and 6/7 consensus MEDIUMs (M3, M1, M5, M2, M8, M4) before Liam's greenlight would close out essentially the entire remaining backlog in one more pass. PM/orch discretion on sequencing.

## Round-1 fix verification (all 7 reviewers)

| Finding | Status | Consensus |
|---|---|---|
| H1 — FIFO-DoS regression risk (merge w/ dev) | **CONFIRMED CLOSED** | 7/7 — `openAllowedForRead()` retains `O_RDONLY\|O_NONBLOCK` + fstat-reject at `path-allowed.ts:149-160`; FIFO regression test present (`path-allowed.test.ts:269-293`); merge also preserved `App.tsx` session-picker + file-open sequencing and `index.ts`'s both `shareRoute`/`isAssetLikePath` imports |
| H2 — audio cross-file send | **CONFIRMED CLOSED** | 7/7 — generate-completion, auto-send, and manual send all bound to `audioOpPathRef`/`viewedFilePathRef` (`ActionBar.tsx:413-521`); dedicated regression test at `ActionBar.test.tsx:507-562` |
| H3 — staged-file TOCTOU handoff | **CONFIRMED CLOSED** | 7/7 — staged file created once with `O_EXCL`/`0600`, written+synced through the same handle, passed to `publish-shared` as inherited fd `/dev/fd/3` (`share.ts:147-185`); no fd leak/double-close found on any traced error path (6 branches traced by claude-sonnet-5) |
| Cheap-tier: slug extension guard | **CONFIRMED CLOSED** | 7/7 — `derivePublishSlug()` now extension-aware |
| Cheap-tier: partial-write loop | **CONFIRMED CLOSED** | 7/7 — `writeFully()` loops on `bytesWritten`, rejects zero-progress writes |
| Cheap-tier: return-to-pending UI restore | **CONFIRMED CLOSED** | 7/7 — per-path in-flight state restored on file revisit (`ActionBar.tsx:89-176`) |

## MUST-LOOK — multi-model consensus (carried-over MEDIUM, not new regressions)

| # | File:line | Models | Severity | Finding |
|---|---|---|---|---|
| M3 | `apps/web/src/components/action-bar/ActionBar.tsx:582-621,948-960` | 7/7 (all MEDIUM) | MEDIUM | `shareInFlightRef` is a single global boolean; reopening Share for file B after a prior publish on file A is still in flight leaves B's buttons tappable-but-dead for up to 30s (the request timeout) with zero UI feedback. Claude Sonnet 5: the existing test resolves A before clicking B, so it doesn't exercise this path (false coverage). Fix: scope the lock by file path/sequence (mirror `readingListInFlightRef`'s `Set<string>` pattern) or `AbortController` the stale request on reopen. |
| M1 | `apps/server/src/routes/prs.ts:517-543` (`readRepoIcon`) | 7/7 (6 MEDIUM + gemini LOW) | MEDIUM | Still `existsSync`→`realpathSync`→`statSync`→`readFileSync`, reopening by name after validation — same by-name TOCTOU shape H1 exists to close, just not yet applied here. `repoPath` originates from server-side `discoverRepos()` (not client input), narrowing the threat model vs. H1's `/tmp`, but same-UID write access to `~/code` remains a real precondition on this shared-tenancy host. Fix: route through `openAllowedForRead`/pinned-fd read with a byte cap. |
| M5 | `apps/server/src/routes/prs.ts:163-166,663-665` (`GET /issues`) | 7/7 (5 MEDIUM + 2 LOW) | LOW-MEDIUM | Raw `gh` CLI stderr returned straight to the browser on failure — can leak local paths/config context. Log server-side, return a fixed client message. |
| M2 | `apps/server/src/routes/share.ts:124` + `path-allowed.ts:67-71` | 6/7 | MEDIUM | `/api/share/publish` still authorizes against the full viewer-only `ALLOWED_FILE_ROOTS` (includes `/tmp`, other agent lanes' working dirs) — broader than what should be publishable to an external URL. Add a narrower `ALLOWED_SHARE_ROOTS`. |
| M4 | `apps/web/src/App.tsx:107-109` | 6/7 (5 MEDIUM + gemini LOW) | MEDIUM | `decodeURIComponent()` on the file deep-link fragment still runs unguarded during render — a malformed `#files&file=%` throws and blanks the app before any recovery UI can render. Now more reachable via the new audio/share deep-link surfaces. Mirror the adjacent guarded session-fragment parser. |
| M8 | `apps/server/src/routes/share.ts:139-160` | 6/7 | MEDIUM | The 50MB cap is only checked via a pre-copy `fstat`; the copy loop itself has no running byte counter, so a source file that grows after the check can still be staged past the limit before the child-process timeout catches it. Enforce the cap inside the copy loop. |
| M6 | `apps/web/src/components/action-bar/ActionBar.tsx:560-581` | 6/7 (2 MEDIUM + 4 LOW) | LOW-MEDIUM | Round-1 M6 only half-fixed: the "return to pending" UI restore landed, but `haptic.success()/error()` and `setStatus(...)` on reading-list save settle still fire unconditionally, not gated by the same seq check protecting `setReadingListSaved`. A late-resolving save for file A can pop a stale status/haptic while the user is now viewing/saving B. Contrast with the sibling `handlePublishShared`, which correctly guards its entire settle branch. |

## SHOULD-LOOK (lower consensus, still real)

| # | Models | Finding |
|---|---|---|
| M9 | codex-5-5, codex-5-6-sol, codex-5-6-terra (3/7 MEDIUM) | `share.ts` slug is deterministic to one second — two concurrent same-basename publishes in the same second collide on one destination; `publish-shared`'s `cp` clobbers, last-writer-wins content on a single URL. Add collision-resistant entropy or atomic destination reservation. |
| M7 | codex-5-6-sol, codex-5-6-terra, cursor (LOW); claude-sonnet-5 (MEDIUM, elevated + confirmed independently exploitable) | `/api/prs/issues?force=1` bypasses the 5-min cache with no independent server-side rate limit — client-side `refreshing` React state is trivially bypassed by calling the endpoint directly. Repeated calls can burn `gh`'s GitHub API rate limit across every discovered repo. |
| M10 | codex-5-5, codex-5-6-sol, codex-5-6-terra, gemini (4/7 LOW) | `audio.ts` sibling-transcript lookup hardcodes `.mp3$` — native `.ogg` recordings never resolve a transcript, silently fall back to the raw audio link. |
| M11 | codex-5-6-sol, codex-5-6-terra (LOW), gemini (MEDIUM) | `readRepoIcon` does synchronous `fs` calls (up to 14 candidates × N repos) on the main event loop on cache misses — latency spike risk under concurrent load. Distinct concern from M1 (TOCTOU); switch to `fs.promises`. |

## NEW this round (not a round-1 carryover)

- **N1 — claude-sonnet-5 only, 1/7.** `apps/web/src/components/action-bar/ActionBar.tsx:148-204` — `readingListCheckSeqRef` is bumped on every re-run of the file-viewing effect, including re-runs triggered only by the global `readingListRefreshVersion` (fired by `emitReadingListChanged()` whenever *any* reading-list item is deleted anywhere in the app, since `ReadingList.tsx` stays mounted). If a save for file A is in flight when an unrelated item is deleted elsewhere, the resulting seq bump makes A's own completion check (`seq === readingListCheckSeqRef.current`) fail — the save succeeded server-side and `readingListInFlightRef` is correctly cleared in `finally`, but the button briefly re-renders as unsaved/tappable. A second tap is harmless (`ON CONFLICT ... DO UPDATE`) but redundant; no test covers this path. LOW severity, genuinely missed by the other 6 reviewers — worth noting as a good example of a fresh-eyes catch on a cross-component interaction the round-1 brief's file-scoping framing didn't prime anyone else to look for.

## DEFER (LOW, unchanged from round 1, no reviewer escalated)

- Icon MIME trust is extension-based, not content-sniffed (inert today, `<img src>`-only consumption).
- Audio deep-link uppercase-extension fallback (`note.MD` beside `note.mp3`) — known, accepted, case-sensitive-filesystem limitation.
- `share.ts:39` — `openAllowedForRead()` runs before containment validation; missing→404 vs. out-of-root→403 creates an authenticated filesystem-existence oracle. Collapse to one response.
- `PrTicker.tsx` issue fetches lack an `AbortSignal` — stale requests keep running post-unmount/toggle.
- `share.ts`'s `execFileAsync` spreads `process.env` into the `publish-shared` child — matches existing trust model, awareness only.

## SKIP (false positive / out of scope)

- None identified this round — no finding was assessed as a false positive after cross-referencing against code at head.

## FEATURE-SUGGESTION → Plane items

- None this round. Every finding across all 7 completed reviews stayed scoped to the existing surface under review (hardening/bug-fix/test-gap on code already shipped), not a new capability. No Plane items filed.

## Per-model verdicts

- **codex-5-4**: NEEDS_FIXES — 0 HIGH, 5 MEDIUM, 2 LOW. H1/H2/H3 confirmed closed with an explicit fd-leak/double-close check on H3 finding none.
- **codex-5-5**: NEEDS_FIXES — 0 HIGH, 8 MEDIUM, 1 LOW. Broadest MEDIUM list this round (adds M9 slug-collision explicitly).
- **codex-5-6-sol**: NEEDS_FIXES — 0 HIGH, 7 MEDIUM, 0 LOW (folds several LOW-tier items into a "remaining round-1 items" note instead of itemizing).
- **codex-5-6-terra**: NEEDS_FIXES — 0 HIGH, 7 MEDIUM, 4 LOW. Most complete round-1 fix-verification table (with line ranges + specific test file references) and the only reviewer to explicitly flag the sandbox's `mkfifo`-denied test-suite caveat (does not contradict source-level H1 verification).
- **gemini-3-1-pro**: **CLEAN — merge recommended.** 0 HIGH, 4 MEDIUM, 5 LOW. Outlier on verdict label (others said NEEDS_FIXES) but substantively agrees — same H1/H2/H3-closed conclusion, same M3 top-remaining-concern call, just a more lenient MEDIUM/LOW severity split (e.g. M1 icon TOCTOU rated LOW here vs. MEDIUM by 6 others).
- **cursor-gpt-5-3-r2**: NEEDS_FIXES — 0 HIGH, 5 MEDIUM, 2 LOW. Tightest, most concise write-up; explicit per-finding fix suggestions.
- **claude-sonnet-5**: NEEDS_FIXES (non-blocking) — 0 HIGH, 8 MEDIUM, 0 LOW. Only reviewer to surface a genuinely new bug (N1) and the only one to note the M3 test-coverage gap (existing test doesn't exercise the race it's meant to cover).

## Cross-model overlap stats

- H1/H2/H3 (all round-1 HIGHs): **7/7, independently verified true — treat as fully confirmed closed.**
- M3 (share in-flight lock global no-op): **7/7 — highest-consensus remaining finding.**
- M1 (icon TOCTOU): 7/7 (6 MEDIUM + 1 LOW).
- M5 (raw gh stderr leak): 7/7 (5 MEDIUM + 2 LOW).
- M2 (share roots too broad): 6/7.
- M4 (malformed deep-link decode): 6/7.
- M8 (share size-cap race): 6/7.
- M6 (reading-list haptic half-fix): 6/7 (2 MEDIUM + 4 LOW).
- M7 (force=1 rate-limit gap): 4/7.
- M10 (ogg transcript fallback): 4/7.
- M9 (slug collision): 3/7.
- M11 (icon sync-fs event-loop block): 3/7.
- N1 (reading-list cross-component seq bump): 1/7 — new this round, not noise (traced with specific evidence).

## Decision

**No blocking issues.** All three round-1 HIGHs are unanimously confirmed closed with concrete evidence (line numbers + new regression tests) and zero new HIGH findings emerged from a skeptical, fix-round-aware fresh pass by all 7 reviewers. This PR is safe to merge on the security/correctness axis as-is.

Two paths, PM/orch discretion (merge doctrine: only orch merges to `dev`, only Liam merges to `main`, and this integration branch requires Liam's explicit greenlight regardless):

**Path A — merge now, fast-follow ticket for the MEDIUM backlog.** File M1/M2/M3/M4/M5/M6/M8 (the 6/7+ consensus items) as a single scoped follow-up PR; M7/M9/M10/M11/N1 as lower-priority tickets. Lowest latency to `dev`.

**Path B — one more scoped fix round (R3, ~30-40 min) closing M3/M1/M5/M2/M8/M4 before requesting Liam's greenlight**, then a lighter re-verification pass (not necessarily a full 7-reviewer swarm — these are all well-understood, already-diagnosed MEDIUM items with clear fixes, not open questions). This closes out essentially the entire remaining backlog in one more pass, leaving only the 3-4/7 items (M7, M9, M10, M11) and N1 as accepted residual debt.

Given M3's 7/7 unanimous consensus and the fact that it's a real, user-visible dead-button bug (not just theoretical), Path B is the stronger recommendation if there's time budget — but this is not a hard block, and Path A is defensible given zero security/data-corruption findings remain.

**PR #314 stays OPEN regardless of this verdict, per the requesting instruction.** Merge to `dev` remains orch's call; merge to `main` remains Liam-only, per standing merge doctrine.
