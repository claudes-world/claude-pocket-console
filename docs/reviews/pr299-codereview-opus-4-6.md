# Phase Super-Swarm Review -- PR #299 (head 5cf377e)

**Reviewer:** Claude Opus 4.6 (release-gate super-swarm)
**Branch:** dev -> main (v1.14.0)
**Scope:** 23 commits / 7 PRs (#285 fit-screen latch, #286 fullscreen guard, #288 cpc-branch, #289 SPA fallback, #290 Fleet Cockpit link, #291 multi-session terminal, #292 file-viewer view-only roots + TOCTOU)

---

## SUMMARY

**Verdict: CLEAN -- merge recommended.**

The seven component PRs integrate cleanly. No cross-cutting bugs were found at feature seams. The TOCTOU hardening (#292) is thorough across all content-reading routes (files, markdown, search, download), with fd-pinned `openAllowedForRead` consistently applied. The multi-session terminal (#291) correctly restricts write operations (fit, restart, resize) to the default session and validates session names identically on client and server. The only substantive gap is that `audio.ts` still uses the pre-hardening check-then-use pattern -- mitigated by its scope to user-owned write roots (no `/tmp`), making it non-blocking for this release.

---

## HIGH severity findings

CLEAN -- no findings.

---

## MEDIUM severity findings

### M-1. `audio.ts` not migrated to fd-pinned TOCTOU pattern

**Files:** `apps/server/src/routes/audio.ts:91-98`, `:156`, `:175-204`

Three instances of the old `isPathAllowed(path)` + filesystem-by-name pattern survive in `audio.ts`:

1. **`/generate`** (line 91-98): `isPathAllowed(resolvedPath)` then `readFileSync(resolvedPath)` -- classic TOCTOU.
2. **`/generate`** (line 156): `writeFileSync(audioPath, buffer)` without `O_NOFOLLOW` -- a symlink in a write root could redirect the mp3 output.
3. **`/send-telegram`** (line 175-204): `isPathAllowed(audioPath)` then `existsSync(audioPath)` then the path is interpolated into a curl `-F audio=@${audioPath}` command.

**Mitigation:** `audio.ts` scopes to `ALLOWED_WRITE_ROOTS` (line 25-27), which excludes `/tmp` and other world-writable directories. Exploitation requires the attacker to create/swap files in user-owned directories (`~/claudes-world`, `~/code`, etc.), at which point they already have equivalent access. The risk is defense-in-depth inconsistency, not a practical exploit path.

**Recommendation:** File a follow-up issue to migrate `audio.ts` to `openAllowedForRead` for reads and `O_NOFOLLOW` for writes, matching the standard established by the #292 hardening. Non-blocking for v1.14.0.

---

## LOW severity findings

### L-1. `createDownloadResponse` orphans FileHandle after extracting raw fd

**File:** `apps/server/src/routes/files.ts:107-112`

`createDownloadResponse` extracts the raw fd via `file.handle.fd` and passes it to `createReadStream("", { fd: ..., autoClose: true })`. The ReadStream's `autoClose` closes the fd at the OS level when streaming completes, but the `FileHandle` wrapper object is never explicitly closed. On GC, Node.js may attempt a second close (harmless EBADF) or emit a resource warning depending on version.

**Fix:** Use `handle.createReadStream()` instead of extracting the raw fd, or explicitly close the handle in a stream `end`/`error` handler.

**Impact:** Cosmetic log noise only; no fd leak, no data correctness issue.

### L-2. Fleet Cockpit link loses React state on return

**File:** `apps/web/src/components/Links.tsx:43`

`window.location.assign("https://cockpit.claude.do")` navigates the WebView away from CPC. When the user returns (via Telegram's back gesture), the SPA reloads from scratch -- active tab, terminal WS connection, file viewer state are lost. The user lands on the terminal tab instead of the links tab they were on.

**Mitigation:** The cockpit link is documented as behind Cloudflare Access (line 65-68) and shipped per Liam's instruction. Tab restoration could be improved with `sessionStorage`-based tab memory, but this is a polish issue for v1.15.

### L-3. Symlinks in /list appear as type "file" after lstat migration

**File:** `apps/server/src/routes/files.ts:257`

The `lstat` call correctly prevents metadata leaks (size/mtime of out-of-root symlink targets), but symlinks-to-directories inside allowed roots now appear as `type: "file"` in listings (Dirent's `isDirectory()` returns false for the link itself). Clicking such an entry triggers `/read` which follows the symlink via `openAllowedForRead` and validates the target, so security is unaffected. The UI impact is minor -- such entries show a file icon instead of a directory icon.

### L-4. Brief restricted-palette flash on default-session deep link

**File:** `apps/web/src/App.tsx:137`

A deep link naming the default session literally (e.g. `#terminal&session=claudes-world`) sets `activeSession` to that name. Until the first session-list fetch resolves `defaultSession` (~30s max), `paletteSession` is non-null, so the ActionBar shows the restricted command set. Self-corrects automatically; the restricted palette is a strict subset of the full palette, so no wrong action is reachable.

---

## Cross-cutting observations

### Integration seams verified clean

| Seam | Verdict |
|------|---------|
| Multi-session terminal (#291) x TOCTOU hardening (#292) | Independent; no shared state |
| SPA fallback (#289) x Fleet Cockpit link (#290) | SPA correctly serves index.html on return from external navigation |
| Fit-screen latch (#285) x fullscreen guard (#286) | Independent; fullscreen is Telegram UI chrome, fit is tmux window dimensions |
| Fit-screen latch (#285) x multi-session terminal (#291) | Fit blocked for non-default sessions before `applyFitResize` is reachable |
| `/cpc-branch` (#288) x deploy ordering | `process.cwd()` correctly reports the running deployment, not checkout |

### SESSION_NAME_RE consistency

The regex `^[A-Za-z0-9_.-]{1,64}$` is identical in:
- Server: `apps/server/src/routes/utils.ts:16`
- Client: `apps/web/src/App.tsx:20`

No mismatch.

### TOCTOU hardening coverage map

| Route | Pattern | Status |
|-------|---------|--------|
| files `/list` | `openAllowedForRead` + `readdir` via fd | Migrated |
| files `/read` | `openAllowedForRead` + `handle.readFile()` | Migrated |
| files `/search` scope | `openAllowedForRead` + `handle.stat()` | Migrated |
| files `/search` BFS walk | `readdirAllowedEntries` (fd per dir) | Migrated |
| files `/download` | `openAllowedForRead` + `createReadStream` via fd | Migrated |
| files `/download-ticket` | `openAllowedForRead` + handle closed after validation | Migrated |
| files `/upload` | `isWritePathAllowed` + `O_EXCL\|O_NOFOLLOW` atomic write | Correct (write path) |
| files `/paste` | `isWritePathAllowed` + `O_EXCL\|O_NOFOLLOW` atomic write | Correct (write path) |
| markdown `/summarize` | `openAllowedForRead` + `handle.readFile()` | Migrated |
| audio `/generate` | `isPathAllowed` + `readFileSync` | **Not migrated** (M-1) |
| audio `/send-telegram` | `isPathAllowed` + path to curl | **Not migrated** (M-1) |
| telegram `/send-to-chat` | `isPathAllowed` -- path-only, no content read | N/A (no TOCTOU) |
| reading-list `/save` | `isPathAllowed` -- path-only, no content read | N/A (no TOCTOU) |

### Write-root / read-root split

`ALLOWED_WRITE_ROOTS` (upload, paste, audio) is a strict subset of `ALLOWED_FILE_ROOTS` (all read operations). View-only roots (`/tmp`, `~/.worldos/lanes`) appear only in `ALLOWED_FILE_ROOTS`. Verified: no code path allows writing to a view-only root.

### Operational risk

- **Deploy ordering:** The server serves web assets from `../web/dist`. A `systemctl restart cpc.service` picks up both new server code and new frontend. Partial rebuilds are backward-compatible in both directions: old frontend doesn't call new endpoints (picker hidden), new frontend gracefully handles missing new endpoints (fetch catch hides picker).
- **Rollback:** Clean -- revert to v1.13.0 tag, rebuild both packages, restart.
- **Lockstep dependency:** None. No new shared type between `@cpc/web` and `@cpc/server` that would break if only one side is deployed.

### Test coverage

Strong for individual features; no integration-level test spans multiple PRs' state simultaneously (e.g., no test exercises session picker + TOCTOU + SPA fallback together). This is acceptable for unit-tested feature boundaries but worth noting for regression risk.
