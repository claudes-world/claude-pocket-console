# Phase Super-Swarm Review -- PR #299 (head 5cf377e)

## SUMMARY
NEEDS_FIXES. The integration of multi-session terminal capabilities (#291) introduced a reliability flaw where view-only sessions disconnect completely if the tmux server experiences a transient delay, severely degrading UX on a busy host. There are also a couple of medium-severity operational issues with unhandled readdir deletions and an architecturally inconsistent targeting omission in the fit-screen fix (#285).

## HIGH severity findings
**`apps/server/src/routes/terminal-ws.ts` in `terminalWsRoute` (capture-pane `close` handler): tmux timeout disconnects view-only sessions**
The multi-session terminal adds a `timeout: TMUX_TIMEOUT_MS` to the `spawn("tmux", ["capture-pane", ...])` call. If the tmux server is wedged or under load and the 5-second timeout expires, Node.js kills the child process with `SIGTERM` and emits the `close` event with `code = null`. The `close` handler's check `if (code !== 0 && session !== TMUX_SESSION)` evaluates to true because `null !== 0`. Consequently, a transient delay in tmux causes the WebSocket to disconnect with a misleading `4010 Session ended` error for any non-default session, forcing the user to manually reconnect.
*Suggested fix:* Update the condition to ignore `null` exit codes caused by signals: `if (code !== 0 && code !== null && session !== TMUX_SESSION)` (or explicitly check `signal`).

## MEDIUM severity findings
**`apps/server/src/routes/terminal-ws.ts` in `applyFitResize`: bare TMUX_SESSION risks prefix collisions**
The integration of #291 updated tmux targeting in `sendToTmux` and `terminal-ws` to use exact-match `=...:` targets (e.g. `=${session}:`) to prevent tmux's default prefix-matching from targeting the wrong session. However, the `applyFitResize` fix (#285) was not updated to match this architectural shift and still uses bare `TMUX_SESSION` for both `resize-window` and `set-option`. While currently scoped to the default session, this is architecturally inconsistent and leaves the default session vulnerable to prefix collisions if other similarly named sessions exist.
*Suggested fix:* Change `"-t", TMUX_SESSION` to `"-t", "=${TMUX_SESSION}:"` in both `applyFitResize` calls.

**`apps/server/src/routes/files.ts` in `/list`: endpoint 500s on transient file deletion**
The `/list` endpoint maps over directory entries using `lstat` inside a `Promise.all`. Since this now processes the highly volatile `/tmp` directory (added in #292), files will frequently be created and deleted mid-read. If a file is deleted between `readdir` and `lstat`, `lstat` throws an `ENOENT` error. Because the mapping function does not catch this, the entire directory listing fails with a 500 error, making the file viewer brittle on volatile roots.
*Suggested fix:* Add a `try/catch` or `.catch(() => null)` block around the `lstat` call inside the map function, and filter out `null` results in the final array.

## LOW severity findings
CLEAN -- no findings.

## Cross-cutting observations
- The security architecture around the file viewer's `openAllowedForRead` (race-safe fd pinning) correctly neutralizes TOCTOU symlink attacks even when world-writable paths like `/tmp` are added. BFS traversal and `lstat` metadata queries operate safely without leaking targets.
- SPA fallback and the Fleet Cockpit deep-link passthrough correctly integrate without overlapping conflict. The fallback appropriately ignores API routes.
