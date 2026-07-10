# Phase Super-Swarm Review -- PR #299 (head 5cf377e)

## SUMMARY

**NEEDS_FIXES** (nothing merge-blocking-severe, but one real reliability bug on a core path). The 7 features integrate cleanly at their seams — the read/write root split is threaded consistently (audio + upload/paste correctly gated to `ALLOWED_WRITE_ROOTS`; fit is default-session-only so multi-session adds zero new write surface), the TOCTOU hardening is sound (fd-pinned `/proc/self/fd` validation), and #288's `process.cwd()` approach matches the verified `cpc.service` `WorkingDirectory=…-prod`. Top concern: the download path streams from a raw fd while the owning `FileHandle` is never closed (fd double-close / mid-stream close). Secondary: `openAllowedForRead` now `open()`s client-named paths under world-writable `/tmp` with no `O_NONBLOCK`, so a planted FIFO can wedge the libuv threadpool. Recommend fixing the download handle lifecycle before tagging; the FIFO item can ship with a follow-up if time-boxed.

## HIGH severity findings

### H-1 — Download streams from a raw fd while the `FileHandle` is orphaned (double-close / truncated downloads)
`apps/server/src/routes/files.ts:127-134` (`createDownloadResponse`)

`getDownloadableFile` returns an open `FileHandle`; `createDownloadResponse` does `createReadStream("", { fd: file.handle.fd, autoClose: true })` and **never calls `file.handle.close()`**. Two lifetimes now own the same fd:
- `createReadStream(..., autoClose:true)` closes the raw fd on stream end/error.
- The `FileHandle` is dropped out of scope with the fd still "open" from its perspective. Node's `FileHandle` finalizer will later close that fd on GC ("Closing file descriptor N on garbage collection" warning).

If GC runs while the stream is still reading (large downloads, up to `DOWNLOAD_MAX_BYTES`), the fd is closed underneath the stream → truncated/aborted download. If GC runs after `autoClose` already closed it and the fd number was recycled by another `open()`/socket accept, the finalizer closes an **unrelated** fd → EBADF on a different request. This is on the normal `/download` path, not just an attack path.
**Fix:** stream via the handle so lifetimes are unified — `file.handle.createReadStream({ autoClose: true })` — or pass `autoClose:false` and `file.handle.close()` on the stream's `close`/`error`. Add a download test that asserts no fd leak/double-close.

## MEDIUM severity findings

### M-1 — `openAllowedForRead` blocking-`open()` on world-writable `/tmp` is a FIFO/special-file DoS
`apps/server/src/lib/path-allowed.ts:123` + callers in `files.ts` (`/read`, `/search`, `readdirAllowedEntries`) and `markdown.ts`

The TOCTOU fix replaces name-based `isPathAllowed` (which only `realpath`ed, never opened) with `open(resolve(absPath), "r")` — no `O_NONBLOCK`. `/tmp` is now a read root and world-writable. A local process can plant a FIFO (`mkfifo /tmp/x.md`); `open()` for read on a writerless FIFO **blocks indefinitely**, and fs ops run on the 4-thread libuv pool — a handful of such paths stalls all file I/O server-wide. `handle.readFile()` on a pipe is likewise unbounded. Note this is exactly the "any local process can plant a file in /tmp" threat model the fix itself cites.
**Fix:** open with `O_NONBLOCK` (`fs.constants.O_RDONLY | O_NONBLOCK`) then `fstat` and reject non-regular files (`!isFile()`), or `openAllowedForRead` should stat-gate to regular files before any read. Add a FIFO test fixture.

### M-2 — Session picker is hidden when the roster is empty, stranding a stale deep-link
`apps/web/src/App.tsx:513` (render guard `… && sessionList.length > 0`)

The comment claims the picker always renders "so a stale deep link always leaves the user a pill to click back to the default instead of stranding them on the error frame." But the `&& sessionList.length > 0` conjunct means when the `/api/terminal/sessions` fetch fails or tmux is down (empty roster), a user who arrived via `#terminal&session=<bad>` gets the WS error frame with **no picker and no way back to default** — the opposite of the stated intent. 
**Fix:** when `activeSession !== null`, render the picker even with an empty roster (synthesize a default pill), or auto-clear `activeSession` on an empty-roster + unknown-session condition.

### M-3 — SPA fallback returns `200 index.html` for missing hashed assets
`apps/server/src/index.ts:17-29`

`serveStatic` calls `next()` on a miss, so a request for a stale/missing `/assets/<hash>.js` (common when `@cpc/web` and `@cpc/server` deploy slightly out of lockstep — explicitly called out in the deploy plan) falls through to the catch-all and returns `text/html` with status 200. The browser then tries to execute HTML as a module → opaque console errors instead of a clean 404 the client could handle. Only `/api` and `/ws` are excluded.
**Fix:** exclude a static-asset prefix (e.g. `/assets/`) or paths with a file extension from the SPA fallback so real asset misses 404.

## LOW severity findings

- **L-1 — `cpc-branch` depends on `process.cwd()` being the checkout.** `terminal/git.ts:96` returns 500 if the service is ever started without `WorkingDirectory` set to the checkout. Verified the prod `cpc.service` sets it to `…-prod`, so correct in the intended deploy — but a manual `node dist/index.js` from `$HOME` now silently breaks the badge (previously hardcoded to work). Acceptable; document the `WorkingDirectory` dependency in the deploy guide.
- **L-2 — `applyFitResize` targets bare `TMUX_SESSION`, not `=name:`.** `terminal-ws.ts:168,174` uses the un-prefixed name while all other multi-session tmux calls use exact-match `=${session}:`. Harmless (default session, session-target command, canonical name) but inconsistent with the file's own new convention; a fleet name that is a prefix of the default could in theory fnmatch. Cosmetic.
- **L-3 — Missing test coverage on the integration seams flagged above:** no test exercises a special/FIFO file through `openAllowedForRead` (M-1), the download handle lifecycle (H-1), or the empty-roster + deep-link picker state (M-2). The per-feature suites are otherwise thorough.

## Cross-cutting observations

- **Root split is coherent.** `ALLOWED_WRITE_ROOTS` (pre-expansion list) vs `ALLOWED_FILE_ROOTS` (superset + `/tmp` + legacy lanes) is threaded correctly everywhere: `audio.ts` → write roots, `/upload` + `/paste` → `isWritePathAllowed`, all reads → `openAllowedForRead`. No path writes into a view-only root. Verified.
- **#285 latch × #291 multi-session** don't collide: fit is rejected server-side for any non-default session *before* `applyFitResize` (hardwired to `TMUX_SESSION`) is reachable, and the `FitLatchReleaseError` loud-error path is well-tested (`terminal-ws-fit.test.ts`).
- **#292 TOCTOU** design is sound: fd opened following symlinks, then validated against the opened inode's `/proc/self/fd` realpath; `/list` correctly switched to `lstat` (no symlink-target metadata leak) and `/search` walks every dir via a pinned fd. The download ticket flow re-opens+re-validates on GET, so the POST→GET window is not a TOCTOU. Only the *handle lifetime* (H-1) and *special-file open* (M-1) are gaps, not the allowlist logic.
- **#290 Fleet Cockpit link** correctly discriminates "inside Telegram" by `initData` truthiness (not SDK presence) and preserves rel/modified-click passthrough. Note the shipped-anyway Cloudflare-Access wall is documented in-code — not a code defect.
- **Deploy out-of-lockstep:** old-web/new-server and new-web/old-server both degrade gracefully (missing `?session=` → default; missing `/api/terminal/sessions` → picker hidden). The only lockstep-sensitive surface is M-3 (asset 404s), which is cosmetic.
