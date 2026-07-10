# Phase Super-Swarm Synthesis — PR #306 (head 9e1b505, R1 verification pass)

**Models run — R0 (head d707da8):** Codex 5.4 ✓ | Codex 5.5 ✓ | Codex 5.6-sol ✓ | Codex 5.6-terra ✓ | Gemini 3.1 Pro ✓ | Cursor gpt-5.3-codex ✓ | Opus 4.6 ✗ | Opus 4.7 ✗ | Opus 4.8 ✗ | Sonnet 5 ✗ (Claude MAX monthly spend limit)
**Models run — R1 (head 9e1b505, this pass):** Opus 4.6 ✓ | Opus 4.7 ✓ | Opus 4.8 ✓ | Sonnet 5 ✓ (subscription re-logged ~12:00 ET; all 4 completed cleanly, ~4 min total)

**Phase:** dev-cpc-ui (world-os#218) — 6 member PRs (#295, #296, #297, #298, #303, #304), 17 commits, +1 fix-review commit (9e1b505)
**Diff size (R0, full phase diff):** 1467 lines · **Diff size (R1 fix commit alone):** ~640 lines across 6 files (verified directly via `gh api repos/.../commits/9e1b505`)

## Summary

**Verdict: NEEDS_FIXES** — downgraded from the R0 read but NOT clean. The R1 fix commit correctly and completely resolves 5 of the 6 items from the R0 synthesis (H1 decode guard, H2 scan-cap-after-filter, M1 async repo discovery, M3 poll coalescing, M4 render-phase side effect) — this is confirmed both by direct diff inspection and by independent trace from all 4 fresh Claude reviewers; no new races or regressions were introduced by the concurrency refactor.

However, the R0 synthesis's disputed H3 item (`/pm_dobot`'s "read-only" claim) was **not actually resolved** by the PR-body wording change that landed alongside R1. Two of the four fresh reviewers (Opus 4.8 MEDIUM, Sonnet 5 HIGH) independently traced the actual compact-modal code path and found a real, concrete gap — **and I verified it myself directly against source at head 9e1b505**: `/pm_dobot`'s "Prompt for Continuity" flow sends a fully free-text, user-authored message (with no `/compact` prefix at all) as literal keystrokes into the pm-dobot tmux session, and the server's `/compact` route (`slash-commands.ts`) performs **zero content validation** on `body.message` — it isn't a "fixed verb," it's an arbitrary string. This means the newly-added PR-body language ("fleet-wide fixed-verb palette ... reachable by design") does not match the shipped implementation. This is bounded by Telegram-allowlist auth (not an external vuln), but it is a genuine invariant break, not a documentation nitpick, and it deserves Liam's explicit decision before merge — likely with a small code fix, not just a wording confirmation.

M2 (MarkdownViewer frontmatter heuristic, both directions) remains unresolved — confirmed untouched by the R1 diff and independently reproduced by 3 of 4 fresh reviewers with concrete before/after examples.

## MUST FIX / NEEDS LIAM'S DECISION

| # | File:line | Status | Models | Finding |
|---|---|---|---|---|
| **H3-revised** | `apps/web/src/components/action-bar/{ActionBar,CommandsSheet,CompactModals}.tsx`, `apps/server/src/routes/terminal/slash-commands.ts:132-151` | **NOT resolved — verified real, code-confirmed** | R0: codex-5.4 HIGH vs codex-5.5/cursor-5.3 "safe by design". R1: opus-4.8 MEDIUM, sonnet-5 HIGH (both independently re-found it); opus-4.6/opus-4.7 still read it as safe (did not trace the modal payload path) | **Verified directly against source, not just reviewer claims.** `CommandsSheet.tsx`'s `/compact` button renders unconditionally regardless of `restricted` (unlike `/new`/`/resume`/`/branch`/`/rename`, which are correctly hidden). Tapping it → `CompactConfirmModal` → either (a) `CompactFocusModal`, which prefixes `/compact ` client-side (bounded), or (b) `ContinuityNotesModal`, whose `onSubmit` sends `continuityMsg` — a hardcoded template string plus an **unprefixed, unbounded** `Additional context from user: "<free text>"` fragment — straight to `handleCompact()` → `sendCompactCommand()` → `POST /api/terminal/compact`. Server-side, `slash-commands.ts`'s `/compact` handler takes `body.message` as a bare string with **no shape/prefix/length validation whatsoever** and sends it verbatim via `tmux send-keys -l -- message` + Enter to the resolved session (any existing session, by design, per the file's own doc comment referencing "Liam voice msg 1188"). Net effect: an authenticated Telegram user viewing `/pm_dobot` can type arbitrary free text that gets delivered, keystroke-for-keystroke, as an instruction-shaped message into the pm-dobot tmux session — not a "fixed verb," a genuine free-text channel. The terminal WS render itself stays correctly read-only (`disableStdin: true`, no keyboard input) — the gap is specifically in the REST-side compact/continuity flow. **This resolves the R0 dispute in favor of codex-5.4's original HIGH; the R1 wording change did not fix the underlying code.** **Needs Liam's decision:** (a) if "phase 1 read-only/fixed-verb" is meant literally, fix by constraining `body.message` server-side (e.g. reject anything not exactly `/compact` or `/compact <template>` for non-default sessions) and/or removing the free-text `ContinuityNotesModal` path when `targetSession` is set, plus an integration test that `/pm_dobot` cannot deliver attacker-chosen text; (b) if the narrow-UI + trusted-Telegram-auth model is the actually-intended phase-1 scope, no code change is needed, but the PR-body "fixed-verb palette" language should be corrected to something accurate (e.g. "restricted command palette, content not currently constrained server-side, gated by Telegram auth only"). |
| M2 | `apps/web/src/components/MarkdownViewer.tsx:39-41` | **NOT resolved** — confirmed untouched by the R1 diff (file not in the commit's changed-file list) | R0: 2/6 (codex-5.4 over-strip direction, codex-5.6-sol+gemini under-recognize direction). R1: 3/4 (opus-4.7, opus-4.8, sonnet-5) independently reproduce the under-recognize direction with the concrete repro `extractFrontmatter("---\ntags:\n- cpc\n---\nBody")` → `{ metadata: null, body: "---\ntags:\n- cpc\n---\nBody" }` (raw frontmatter leaks into rendered doc). Opus 4.6 examined a narrower single-line variant and called that instance "not a bug," but did not test the exact mixed `key:`+`- item` repro the other 3 reproduced. | `hasYamlShape`'s regex accepts `key:` lines, `#comment` lines, and any whitespace-indented continuation, but rejects root-level indentless YAML sequence entries (`- cpc`) — and since the check requires *every* non-empty line to match, one such line anywhere in the block causes the *entire* frontmatter (including valid `key:` lines) to be left unstripped. Separately (over-strip direction, not retested this round but not touched by R1 either) a doc opening with `---\n  indented non-YAML\n---\n# Heading` gets wrongly swallowed as metadata via the bare `^\s` branch. Fix: replace the partial-grammar heuristic with a minimal real frontmatter/YAML-shape check (accept `^- ` sequence lines; require ≥1 top-level `key:` line before accepting continuation-only lines), with regression tests for both directions. Deferred is reasonable given display-only impact (no crash), but flagging as still-open, not silently dropped. |

## CONFIRMED FIXED — verified against the R1 diff, not just reviewer claims

| # | Prior finding (R0) | Verification |
|---|---|---|
| H1 | Unguarded `decodeURIComponent(fileMatch)` in `app-routing.ts:43` (3/6 R0) | **Fixed.** Diff shows a `try { file = decodeURIComponent(fileMatch); } catch { /* treat as absent */ }` wrapper (app-routing.ts). Regression test added: `"treats a malformed file hash value as absent"`. Independently confirmed by all 4 R1 reviewers. |
| H2 | Namespace scan cap applied before filtering to real repos, silent truncation (4/6 R0) | **Fixed.** Diff shows `childRepos` is now filtered via `existsSync(.git)` *before* the `NAMESPACE_SCAN_CAP` slice, with `console.warn` naming the namespace + dropped count when truncation actually occurs. New test asserts the warning fires with `dropped 1` and the correct namespace path. Independently confirmed by all 4 R1 reviewers. |
| M1 | Sync `execFileSync` blocking the Node event loop in `discoverRepos` (2/6 R0, severity split MED/HIGH) | **Fixed.** `discoverRepos`/`scanRepos` now use a promisified `execGit` wrapper over `execFile`, batched at `GIT_SCAN_CONCURRENCY = 8` via `Promise.all`. No more sync subprocess calls on the WS event loop. |
| M3 | Concurrent `pollOnce()` / repo-scan race, no in-flight guard (1/6 R0) | **Fixed.** Both `discoverRepos()` (`repoScanInFlight`) and `PrPoller.pollOnce()` (`pollInFlight`) now coalesce concurrent callers behind one shared promise, cleared via `.finally()` on both success and failure paths. New tests explicitly exercise the coalescing behavior for both. All 4 R1 reviewers independently traced the microtask ordering and found no stale-cache/lost-update race. |
| M4 | React render-phase side effect (`window.history.replaceState` in `useState` initializer) (1/6 R0) | **Fixed.** Moved into a `useEffect` keyed on `initialRoute.redirectPath`; `resolveInitialAppState` in the initializer is now pure. |

## DEFER (LOW) — carried forward + new this round

- `apps/web/src/lib/app-routing.ts` alias resolution exact-path-only (`/pm_dobot/`, `/dev/pm_dobot` fall back to default) — R0: codex-5.4; R1: opus-4.7, opus-4.8 confirm still present. Low real-world impact, follow-up.
- **New (opus-4.8):** `apps/server/src/routes/prs.ts` depth-2 child-symlink guard asymmetry — namespace-level symlinks are correctly skipped via `lstatSync().isSymbolicLink()`, but the child-repo filter doesn't mirror that check, so a symlinked child inside a real namespace could get scanned. Trusted local filesystem, output still gated by `parseGitRemote` (github.com-only) — no data escapes. Worth a one-line comment or symmetry fix.
- **New (opus-4.7, sonnet-5):** `PrPoller.start()` calls `void this.pollOnce()` with no `.catch()`. Latent only — `runPollOnce` cannot currently reject (every internal path is caught) — but worth a defensive top-level `.catch()` so a future edit can't introduce an unhandled rejection.
- **New (opus-4.7):** the >50-repo namespace-cap slice order is `readdirSync` order (not sorted), so which 50 repos survive is filesystem/host-dependent. Cosmetic-only; sort before slicing if determinism matters.

## SKIP (false positive / out of scope)

- None identified across either round.

## Per-model verdicts

**R0 (head d707da8):**
- codex-5.4: NEEDS_FIXES — 1 HIGH (/pm_dobot), 1 MED (frontmatter over-strip), 1 LOW (alias routing).
- codex-5.5: CLEAN — asserted /pm_dobot safe-by-design (now shown incomplete — didn't trace the compact-modal payload).
- codex-5.6-sol: NEEDS_FIXES — 4 MED (decode guard, frontmatter, sync event-loop block, poll race), 1 LOW.
- codex-5.6-terra: NEEDS_FIXES — 1 MED (decode guard), 1 LOW.
- gemini-3.1-pro: NEEDS_FIXES — 1 HIGH (sync event-loop block), 3 MED.
- cursor-gpt-5.3: CLEAN — asserted /pm_dobot safe-by-design (same gap as codex-5.5).

**R1 (head 9e1b505):**
- **opus-4.6**: CLEAN (soft) — confirmed all 5 R1 fixes correct; 1 LOW (frontmatter over-strip only). Read `/pm_dobot` at the target-session-validation level and called it matching design — **did not trace the compact-modal free-text payload**, so missed H3-revised.
- **opus-4.7**: NEEDS_FIXES (1 MEDIUM: frontmatter) — confirmed all 5 R1 fixes correct via deep concurrency trace; 3 LOW. Also read `/pm_dobot` as matching the now-stated design — **did not trace the compact-modal free-text payload**, so also missed H3-revised.
- **opus-4.8**: NEEDS_FIXES (1 MEDIUM: H3-revised, correctly identified) — confirmed all 5 R1 fixes correct; explicitly re-surfaced the R0 dispute and traced it to `body.message` being unvalidated free text, but capped severity at MEDIUM given the trusted-Telegram-auth bound. 5 LOW.
- **sonnet-5**: NEEDS_FIXES (1 HIGH: H3-revised) — confirmed all 5 R1 fixes correct; did the deepest trace of the four, citing exact modal component names/lines and an ActionBar.tsx code comment that self-acknowledges the non-default-target reachability, explicitly declaring the R0 dispute resolved in codex-5.4's favor. Also flagged M2 as unresolved (confirmed untouched by R1 diff). 1 MEDIUM (M2), 3 LOW.

## Cross-model overlap stats (combined R0+R1)

- H1 (decode guard): flagged 3/6 in R0, confirmed-fixed 4/4 in R1.
- H2 (scan-cap truncation): flagged 4/6 in R0, confirmed-fixed 4/4 in R1.
- M1 (sync event-loop block): flagged 2/6 in R0, confirmed-fixed 4/4 in R1.
- M3 (poll race): flagged 1/6 in R0, confirmed-fixed 4/4 in R1.
- M4 (render-phase side effect): flagged 1/6 in R0, confirmed-fixed 4/4 in R1.
- **H3-revised (/pm_dobot free-text gap): 1/6 in R0 (codex-5.4) → 2/4 in R1 independently re-find the identical underlying mechanism (opus-4.8, sonnet-5), 2/4 still miss it (opus-4.6, opus-4.7) → verified directly against source by this orchestrator as real. Net: 3 independent reviewers (across two rounds) plus direct source verification, vs. 4 reviewers who read it as safe without tracing the actual payload path.**
- M2 (frontmatter, under-recognize direction): 2/6 in R0 → 3/4 in R1 reproduce it; untouched by R1 diff, confirmed still open.

## Decision

**Recommend a small, targeted R2 fix-round before merge to `dev`, gated on Liam's read of H3-revised:**

1. **H3-revised — Liam's decision first, code likely needed.** The free-text `/compact`+"Prompt for Continuity" channel into any client-picked session (not just the intended fixed-verb set) is verified real at the code level, not just a reviewer artifact. If phase-1 is meant to be genuinely read-only/fixed-verb: constrain `body.message` server-side for non-default sessions (allow only `message === "/compact"` or a server-templated continuity string, no user-supplied free text) and remove or gate the free-text `ContinuityNotesModal` input when `targetSession` is set; add an integration test proving `/pm_dobot` cannot deliver attacker-chosen text. If the current behavior is judged acceptable given trusted Telegram-auth gating, no code change is required, but correct the PR-body language, since "fixed-verb palette" is not an accurate description of what ships today.
2. M2 (frontmatter heuristic) — small, mechanical fix; can ride in the same pass or fast-follow given display-only impact.
3. The 3 new LOW items (symlink-guard asymmetry, uncaught pollOnce rejection, non-deterministic cap-slice order) are cheap, optional hardening — bundle if convenient, otherwise file as follow-ups.

Total R2 budget: ~15-20 min codex for item 1's code path (if Liam wants the fix) + ~10 min for M2; item 1's Liam-decision has no time cost either way but is the actual blocker for merge confidence.

**The user decision needed:** Whether `/pm_dobot`'s current free-text "Prompt for Continuity" channel is acceptable as-is (trusted-Telegram-auth-bounded design choice) or needs a server-side content constraint before this phase can be called done. This is now a verified code fact, not a reviewer disagreement — the swarm did its job by surfacing a real discrepancy between the newly-stated PR intent and the actual shipped behavior.
