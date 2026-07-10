# Phase Super-Swarm Synthesis — PR #306 (head d707da8)

**Models run:** Codex 5.4 ✓ | Codex 5.5 ✓ | Codex 5.6-sol ✓ | Codex 5.6-terra ✓ | Opus 4.6 ✗ (Claude MAX monthly spend limit) | Opus 4.7 ✗ (same) | Opus 4.8 ✗ (same) | Sonnet 5 ✗ (same) | Gemini 3.1 Pro ✓ | Cursor gpt-5.3-codex ✓

**Note on this run:** the Claude Code process restarted mid-dispatch on the first attempt; no PR306 artifacts existed on disk or in the process table afterward, so this is a full fresh dispatch (not a resume). All 10 reviewers were re-dispatched with `disown` for restart-resilience. The 4 Claude-MAX reviewers (Opus 4.6/4.7/4.8, Sonnet 5) each failed **immediately and identically** with `You've hit your monthly spend limit · raise it at claude.ai/settings/usage` — this is an account-level hard stop, not a transient error, so no retry was attempted. 6/10 reviewers completed; synthesis proceeds on that basis per swarm doctrine (never block on a single reviewer, let alone a whole-family outage).

**Phase:** dev-cpc-ui (world-os#218) — 6 member PRs (#295, #296, #297, #298, #303, #304), 17 commits, 11 files, +1031/-70
**Diff size:** 1467 lines

## Summary

**Verdict: NEEDS_FIXES** — 5 of 6 completed reviewers flagged at least one real issue; only cursor-gpt-5-3 came back fully CLEAN. No reviewer found auth bypass, command injection, or data corruption. The two recurring cross-model findings are (1) an unguarded `decodeURIComponent` on the `file=` hash param that can white-screen the app on a malformed deep link (3/6), and (2) a silent 50-item cap on namespace repo discovery that drops repos with no diagnostic signal (4/6). A third, more consequential item is a **direct disagreement between reviewers** over whether `/pm_dobot` actually honors its PR-stated "phase 1, read-only view" invariant — Codex 5.4 says no (HIGH, mutating slash-commands reachable), while Codex 5.5 and Cursor 5.3 both explicitly reviewed the same command surface and call it safe/intentional. This needs Liam's read since it's a stated-goal-vs-implementation question, not a pure code bug.

Recommended action: fix the 2 consensus items (decode guard + truncation diagnostic) in a light R1 pass, and get Liam's explicit call on the `/pm_dobot` read-only disagreement before merge to `dev`.

## MUST FIX — multi-model consensus

| # | File:line | Models | Severity | Finding |
|---|---|---|---|---|
| H1 | `apps/web/src/lib/app-routing.ts:43` | 3/6 (codex-5.6-sol MED, codex-5.6-terra MED, cursor-5.3 MED) | MEDIUM (crash-class) | `resolveHashState()` calls `decodeURIComponent(fileMatch)` unguarded. A malformed hash (e.g. `#files&file=%`) throws `URIError` during initial render → white-screens the app before auth/session UI mounts. The adjacent `session=` param already has this guard; `file=` doesn't. Fix: wrap in try/catch, treat as absent on failure, add a `resolveInitialAppState()` regression test. |
| H2 | `apps/server/src/routes/prs.ts:155` | 4/6 (codex-5.6-sol LOW, codex-5.6-terra LOW, gemini-3.1-pro MED, cursor-5.3 LOW) | LOW-MED (ops visibility) | `NAMESPACE_SCAN_CAP` caps the first 50 raw directory entries **before** filtering to actual repos, so non-repo entries eat the budget and later real repos silently vanish from PR-poller and branch-scope views with zero diagnostic signal. Fix: cap after filtering candidates, or emit a warning/metric + expose a `truncated: true` diagnostics flag. |
| H3 | `apps/web/src/components/action-bar/ActionBar.tsx:422`, `CommandsSheet.tsx:16`, `apps/server/src/routes/terminal/slash-commands.ts:73` | 1/6 flagged as bug (codex-5.4 HIGH) — but **contradicted** by 2/6 (codex-5.5, cursor-5.3) who reviewed the same surface and called it "intentionally narrow by design" | DISPUTED — needs Liam's call | The PR body states `/pm_dobot` is "phase 1, read-only view." Codex 5.4 finds the palette still wires `Esc`/digits/`^B`/`/compact`/`/reload-plugins` to the viewed session, and the backend's `/send-keys`, `/compact`, `/reload-plugins` accept a client-picked session — i.e. `/pm_dobot` can actively drive the pm-dobot tmux session, not just view it. Codex 5.5 and Cursor 5.3 independently characterize the exact same surface as an intentional narrow write allowlist (keys/compact/reload-plugins only; restart/resize/git/rename/new/resume stay default-session-only) and call it safe. **This is a genuine cross-model split on the same code, not noise** — resolve by confirming with Liam whether "read-only phase 1" was meant literally (in which case H3 is a real scope bug) or whether the narrow allowlist was always the intended phase-1 scope (in which case the PR body wording is what's wrong, not the code). |

## SHOULD FIX (MEDIUM)

| # | Models | Finding |
|---|---|---|
| M1 | 2/6 (codex-5.6-sol, gemini-3.1-pro), disagree on severity (MED vs HIGH) | `apps/server/src/routes/prs.ts` `discoverRepos()` uses synchronous `execFileSync`/git subprocess calls (up to ~100 per full namespace scan) on the same Node event loop that services the terminal WebSockets. Gemini rates this HIGH (real-time latency/stutter risk); codex-5.6-sol rates it MEDIUM. Fix: convert to `execFileAsync` + bounded `Promise.all` concurrency, and share one in-flight scan promise across `repoCache` so concurrent triggers await the same scan (also closes part of the M3 poll-race below). |
| M2 | 2/6 (codex-5.4 over-permissive direction, codex-5.6-sol + gemini under-permissive direction — same function, opposite-direction bugs) | `MarkdownViewer.tsx` frontmatter heuristic (`extractFrontmatter`/`hasYamlShape`) has edge cases on both sides: codex-5.4 shows it over-strips (a doc starting with `---\n  npm install\n---\n# Heading` gets wrongly treated as frontmatter); codex-5.6-sol/gemini show it under-recognizes (root-level indentless YAML sequences like `tags:\n- cpc` fail the regex and leak raw frontmatter to the user). Both point at the same partial-grammar heuristic — worth replacing with a real minimal frontmatter parser rather than patching both directions individually. |
| M3 | 1/6 (codex-5.6-sol) | `apps/server/src/routes/prs.ts:309` — `start()` and `POST /refresh` can both invoke `pollOnce()` concurrently with no in-flight guard, multiplying `gh` API traffic and risking out-of-order snapshot publication. Fix: coalesce concurrent calls behind one promise, or gate next poll on prior completion. (Same root cause/fix family as M1's shared-scan-promise suggestion.) |
| M4 | 1/6 (gemini-3.1-pro) | `apps/web/src/App.tsx` — `window.history.replaceState` is called inside the `useState` initializer for `initialRoute`, a render-phase side effect. Not spec-pure; can misbehave under Strict Mode/Concurrent Mode double-invocation. Fix: move to a `useEffect` keyed on `initialRoute.redirectPath`. |

## DEFER (LOW)

- `apps/web/src/lib/app-routing.ts:72` (codex-5.4, 1/6) — alias resolution is exact-path only; `/dev/pm_dobot` and `/pm_dobot/` both silently fall back to default terminal session instead of resolving the alias. Low real-world impact (dev-only prefix + trailing slash), fine as a follow-up.

## SKIP (false positive / out of scope)

- None identified — no reviewer raised anything judged to be a false positive or clearly out-of-scope architecture drift in this run.

## Per-model verdicts

- **codex-5.4**: NEEDS_FIXES — 1 HIGH (/pm_dobot mutation surface), 1 MED (frontmatter over-strip), 1 LOW (alias routing).
- **codex-5.5**: CLEAN — no findings; cross-cutting notes explicitly assert the /pm_dobot write surface is intentionally narrow and safe (directly disagrees with codex-5.4's HIGH).
- **codex-5.6-sol**: NEEDS_FIXES — 0 HIGH, 4 MED (decode guard, frontmatter under-recognition, sync git-subprocess event-loop block, poll race), 1 LOW (cap-before-filter truncation).
- **codex-5.6-terra**: NEEDS_FIXES — 0 HIGH, 1 MED (decode guard), 1 LOW (truncation).
- **gemini-3.1-pro**: NEEDS_FIXES — 1 HIGH (sync execFileSync event-loop block), 3 MED (render-phase side effect, frontmatter under-recognition, truncation-visibility).
- **cursor-gpt-5.3**: CLEAN — no findings; cross-cutting notes match codex-5.5's language on /pm_dobot almost verbatim (independent confirmation the write surface is by-design-narrow).
- **opus-4.6 / opus-4.7 / opus-4.8 / sonnet-5**: ✗ FAILED — Claude MAX subscription monthly spend limit reached before any output was produced (`claude.ai/settings/usage`). Zero signal from this family this run.

## Cross-model overlap stats

- Namespace scan cap silently truncating repos: **4/6**
- Unguarded `decodeURIComponent` on `file=` hash: **3/6**
- Sync git-subprocess event-loop block in `discoverRepos`: **2/6** (severity split MED/HIGH)
- Frontmatter heuristic edge cases (opposite directions, same function): **2/6** distinct bugs, both real
- `/pm_dobot` read-only-invariant disagreement: **1/6 flags HIGH bug vs 2/6 explicitly assert safe-by-design** — the most consequential split in this run
- Concurrent poll race: **1/6**
- React render-phase side effect: **1/6**
- Alias exact-path brittleness: **1/6**

## Decision

Recommend a light **R1 fix-round** before merge to `dev`, scoped to the 2 true multi-model-consensus items plus the disputed `/pm_dobot` item resolved by Liam's read (not by more code):

1. Guard `decodeURIComponent(fileMatch)` in `resolveHashState()` (app-routing.ts:43) with try/catch + regression test — H1.
2. Fix namespace-scan cap to apply after filtering to real repos, or add a truncation diagnostic — H2.
3. Liam decision on H3 (`/pm_dobot`): is the current narrow write-allowlist (keys/compact/reload-plugins only) the intended phase-1 scope, or does "read-only" mean literally no session-mutating commands? If the latter, scope a follow-up fix; if the former, correct the PR body wording only (no code change needed).
4. Optional same-pass cleanup (cheap, same root cause as H2/M3): convert `discoverRepos`'s sync git calls to async + shared in-flight promise, which also closes the M3 poll-race and M1 event-loop-block concerns in one change.
5. M2 (frontmatter heuristic) and M4 (render-phase side effect) are real but lower urgency — can ride in the same R1 pass if cheap, otherwise file as fast follow-ups.

Total fix-round budget: ~20-30 min codex (items 1, 2, 4 are small, mechanical fixes; item 3 is a conversation with Liam, not code).

**The user decision needed:** H3 — whether `/pm_dobot`'s current narrow-write-allowlist behavior matches Liam's intended "phase 1, read-only" scope, before this can be called done regardless of what code changes (if any) land.

Also worth flagging: 4 of the planned 10 reviewers (the entire Claude-MAX family) were unavailable this run due to an account-level monthly spend cap — if a second opinion is wanted on the disputed H3 item specifically, it will need `--lineup no-claude` substitutes (codex/gemini/cursor only) or to wait for the MAX quota reset, since re-running the same family won't produce different results while the cap is in effect.
