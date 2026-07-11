# Phase Super-Swarm Review — PR #306 (head d707da8)

## SUMMARY
NEEDS_FIXES. The phase integrates cleanly across repository discovery, locale-safe tmux session parsing, bot-path routing, and file-viewer polish, but a malformed `file=` deep link crashes initial rendering. Fix that input-boundary regression before merge; the repository-scan visibility item is safe to defer.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- `apps/web/src/lib/app-routing.ts:43` — `resolveHashState()` calls `decodeURIComponent(fileMatch)` without a `try/catch`. A malformed user-controlled hash such as `#files&file=%` throws `URIError` during the initial render and white-screens the app. The adjacent `session=` parsing already handles this boundary defensively. **Suggested fix:** catch decode failures for `file=`, treat the parameter as absent, and add a regression test through `resolveInitialAppState()`.

## LOW severity findings
- `apps/server/src/routes/prs.ts:155` — scanning only the first 50 raw namespace entries silently omits all later repositories; non-repo entries can consume the entire cap. This makes PR polling and branch scope appear incomplete with no operational clue. **Suggested fix:** log/metric the truncation (and ideally report it in diagnostics), or cap discovered repositories after filtering directory candidates.

## Cross-cutting observations
- The tmux separator change preserves server-side session validation, exact lookup, and view-only fit enforcement; no new command-injection or default-session write path was found.
- Focused changed server tests passed (27), web tests passed (301), and both TypeScript checks passed. The full server suite's two unrelated OTEL failures were caused by a readonly SQLite database in this review environment.
