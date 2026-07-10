# Phase Super-Swarm Review — PR #306 (head d707da8)

## SUMMARY
NEEDS_FIXES. The phase is cohesive, and no high-severity auth, command-injection, or write-path regression was found. Fix malformed file deep links and valid indentless YAML sequences before merge; also harden the expanded PR poller against event-loop stalls and overlapping polls.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
- `apps/web/src/lib/app-routing.ts:43` — `decodeURIComponent(fileMatch)` is unguarded, so a user-controlled hash such as `#files&file=%` throws `URIError` during initial rendering and takes the app to its root error boundary. The adjacent `session=` path already handles the same trust boundary correctly. **Suggested fix:** catch file decode failures, treat the parameter as absent, and add a `resolveInitialAppState()` regression test.

- `apps/web/src/components/MarkdownViewer.tsx:39` — the YAML-shape heuristic rejects valid indentless block sequences, including the common `tags:\n- cpc` form, because `- cpc` matches none of the accepted line shapes. Those files expose raw frontmatter instead of the collapsed metadata pill. **Suggested fix:** accept indentless sequence entries (and test them), or use a proper frontmatter/YAML parser rather than a partial grammar.

- `apps/server/src/routes/prs.ts:105` — depth-2 expansion can add up to 100 synchronous git subprocesses per namespace (remote plus branch), all on the Node process that services terminal WebSockets. A cold scan therefore freezes terminal/API processing; timeout cases compound serially, and there is no global namespace/repository cap. **Suggested fix:** make discovery asynchronous with bounded concurrency and share one in-flight scan promise.

- `apps/server/src/routes/prs.ts:309` — the larger discovered repo set makes a poll more likely to exceed the fixed 30-second interval, but `start()` and `POST /refresh` can call `pollOnce()` concurrently with no in-flight guard. Competing runs can multiply `gh` traffic and publish snapshots out of order. **Suggested fix:** coalesce concurrent calls behind one promise or schedule the next poll only after completion; add a delayed-`gh` concurrency test.

## LOW severity findings
- `apps/server/src/routes/prs.ts:155` — the cap applies to the first 50 raw directory entries, so non-repositories consume the budget and later repositories disappear silently from PR and branch-scope views. **Suggested fix:** cap after filtering candidates and emit a truncation warning/metric.

## Cross-cutting observations
- SPA fallback, Telegram auth, server-side session allowlisting, exact tmux targeting, and default-session write restrictions remain intact.
- Changed server tests passed (27/27), web tests passed (301/301), and both typechecks passed. The full server run's only failures here were unrelated readonly-SQLite OTEL tests in the sandbox.
