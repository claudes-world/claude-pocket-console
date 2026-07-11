# Super-Swarm Review — PR #314 (head f208ccf)

## SUMMARY

NEEDS_FIXES. The protected routes, pinned-FD publish copy, and async state guards compose well, but malformed audio deep links can crash the app and the new issues route reflects raw `gh` diagnostics. Do not merge until the MEDIUM findings are fixed.

## HIGH severity findings

CLEAN — no findings.

## MEDIUM severity findings

- `apps/web/src/App.tsx:107` — `decodeURIComponent()` runs during render without a decode guard. A malformed `#files&file=%` (or any invalid percent escape) throws before the Files UI can load; this is now directly reachable through the audio deep-link surface. Parse once in `try/catch`, as the adjacent `session` parser does, and treat bad input as no file. Add a malformed-`file` fragment test.

- `apps/server/src/routes/prs.ts:163-165,663-665` — `execGh()` embeds raw `stderr` in its error, then `/issues` returns that error to the browser. `gh` failure output can disclose local paths, GitHub/API diagnostics, or configuration context; this diverges from the new share route's generic client errors. Log the diagnostic server-side and return a fixed 502 message. Cover the failure path.

## LOW severity findings

- `apps/server/src/routes/share.ts:39,53-55` — the regular-file gate occurs after `openAllowedForRead()`. A FIFO under the allowed, world-writable `/tmp` can block the default read-only `open()` indefinitely, so the `stat().isFile()` rejection is never reached and enough requests can consume filesystem workers. Open share candidates non-blocking (then fstat and reject non-regular files) or add a bounded open timeout.

## Cross-cutting observations

The publish path validates the opened inode, copies from that FD into private staging, and invokes a fixed executable with argv; its TOCTOU defense holds. Audio send and share are mounted behind the global Telegram auth middleware; audio paths are URI-encoded and the derived markdown path is allowlist-checked. No conflict markers or whitespace errors were found. Server/web typechecks and builds pass; feature-oriented web tests pass. The isolated server suite had two unrelated OTEL test failures because its database was read-only (361 tests passed).
