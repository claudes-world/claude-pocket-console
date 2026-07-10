# Phase Super-Swarm Review — PR #306 (head d707da8)

## SUMMARY
NEEDS_FIXES. The phase is cohesive overall (namespace repo discovery, locale-proof tmux parsing, bot-path routing, and UI polish integrate cleanly), but one startup-path regression can still crash the app on malformed deep links. I also see a low-severity operational visibility gap around namespace scan truncation that can hide repos silently in larger workspaces. Recommend fixing the malformed-file hash handling before merge; low item can be follow-up if needed.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- `apps/web/src/lib/app-routing.ts:43` — `decodeURIComponent(fileMatch)` is unguarded in `resolveHashState()`. A malformed attacker/user-controlled hash (for example `#files&file=%`) throws during first render, which can white-screen the app before auth/session UI even mounts. The same function already defends malformed `session=` values, so this is an inconsistent guard on the same trust boundary. **Suggested fix:** wrap file decode in `try/catch` (mirroring the `session` path) and fall back to `file: null` (or ignore the bad param) rather than throwing.

## LOW severity findings
- `apps/server/src/routes/prs.ts:155` — namespace scanning hard-caps at 50 children and silently drops the rest. This is intentional, but in larger namespace directories it can omit repos from both PR polling and branch-scope surfaces with no diagnostic signal, making the UI appear incomplete/non-deterministic to operators. **Suggested fix:** emit a warning/metric when truncation occurs and/or expose a `truncated: true` flag in diagnostics so missing repos are explainable.

## Cross-cutting observations
- Good integration coverage overall: tmux separator spoof-hardening tests and frontmatter parser edge-case tests are strong.
- Missing seam test for malformed `file=` percent-encoding in `resolveInitialAppState()`; adding that test would lock the medium fix and prevent regressions.
