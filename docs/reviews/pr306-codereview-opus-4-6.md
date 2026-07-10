# Phase Super-Swarm Review — PR #306 (head 9e1b505)

## SUMMARY
CLEAN. The R1 fix commit resolves all consensus findings from the prior review round (decode guard, scan-cap-after-filter, async repo discovery, poll coalescing, render-phase side effect). Concurrency patterns are correct — coalescing, error propagation, cache timing, and batch boundaries all verified. The `/pm_dobot` command surface exposes a narrow fixed-verb palette (send-keys, `/compact`, `/reload-plugins`) for non-default sessions, which the PR description now explicitly states is by design per Liam voice msg 1188 — this matches the implementation. One cosmetic-only frontmatter heuristic edge case remains. Merge recommendation: safe to merge after Liam's greenlight; no code changes required.

## HIGH severity findings
CLEAN — no findings.

## MEDIUM severity findings
CLEAN — no findings.

## LOW severity findings

1. **`apps/web/src/components/MarkdownViewer.tsx:40` — frontmatter `hasYamlShape` heuristic overly permissive on indented non-YAML text**
   The `^\s` branch of the YAML-shape regex accepts any whitespace-prefixed line as a valid continuation. Input like `"---\n  npm install\n---\n# Heading"` is incorrectly stripped as frontmatter because `  npm install` starts with whitespace. Impact is cosmetic only — the content remains accessible via the collapsed metadata pill, and the edge case requires a document starting with `---`, followed by indented non-YAML text, followed by `---` on its own line, which is unusual in practice. The opposite-direction concern (bare YAML list items like `- item` being rejected) is NOT a bug at this head: `- item` correctly fails all three regex branches and the block is left as body. **Suggested fix (defer-OK):** tighten `^\s` to require the preceding line to be a recognized YAML key or sequence entry, or replace the heuristic with a minimal frontmatter parser. File as a follow-up.

## Cross-cutting observations

### R1 fix verification — all prior consensus findings resolved

| Prior finding | Status at head 9e1b505 |
|---|---|
| H1: Unguarded `decodeURIComponent(fileMatch)` in `app-routing.ts:43` | **Fixed.** Wrapped in try/catch (line 45-49), regression test added (`"treats a malformed file hash value as absent"`). |
| H2: Namespace scan cap applied before filtering candidates | **Fixed.** `childRepos` is now filtered first via `existsSync(.git)` check (prs.ts:128-129), then capped at `NAMESPACE_SCAN_CAP`, with a `console.warn` on truncation (prs.ts:130-134). Test confirms junk entries don't consume the budget. |
| M1: Sync `execFileSync` blocking the Node event loop | **Fixed.** `discoverRepos()` is now async, using `execGit()` (Promise wrapper around `execFile`) with `GIT_SCAN_CONCURRENCY = 8` batched concurrency (prs.ts:96-100, 144-173). |
| M3: Concurrent `pollOnce()` race | **Fixed.** `pollInFlight` promise coalescing added (prs.ts:350-355). `.finally()` clears the guard on both success and failure. |
| M4: Render-phase `replaceState` side effect | **Fixed.** Moved to `useEffect` in App.tsx (line 107-114). `resolveInitialAppState` in the `useState` initializer is pure computation only. |

### Concurrency correctness (R1 deep trace)

- **`repoScanInFlight` coalescing (prs.ts:185-193):** `.finally()` unconditionally clears the in-flight promise. Rejected scans propagate to all waiters (`.then()` has no rejection handler, so rejections pass through). Cache is not updated on failure (correct). No dangling-promise or stale-cache risk.
- **`pollInFlight` coalescing (prs.ts:350-355):** Same `.finally()` pattern. A failed poll clears the guard and allows the next trigger to retry. No stuck-poller risk.
- **Cache TTL timing:** `cachedAt` is set inside `.then()` (prs.ts:187). In single-threaded JS, the `.then()` microtask completes before any new macrotask can call `discoverRepos()`, so there is no TOCTOU window between scan completion and cache-write.
- **Batch boundaries (prs.ts:144-145):** `Array.slice(index, index + 8)` naturally handles partial final batches. No off-by-one.

### `/pm_dobot` command surface — matches stated design intent

The PR description now states the fixed-verb palette is reachable by design per Liam voice msg 1188. Verified implementation:

- **ActionBar.tsx:36-38, 163-182:** `restrictedSession` enables a restricted mode for non-default sessions. `handleCompact` and key-sending functions target the restricted session.
- **CommandsSheet.tsx:49-74:** Restricted mode hides `/new`, `/resume`, `/branch`, `/rename`. Still renders: `/compact`, `/reload-plugins`, and key-sending buttons (Esc, digits, Shift-Tab, Ctrl-B).
- **slash-commands.ts:73-82:** `resolvePaletteTarget()` accepts any charset-valid session for `/send-keys`, `/compact`, `/reload-plugins`. Destructive commands (`/restart-session`, `/resize-terminal`) are hardwired to the default session only.
- **terminal-ws.ts:368:** WebSocket `fit` message is explicitly blocked for non-default sessions.

This is a narrow write-allowlist (3 verbs only), not free-form steering. The "phase 1, view-only" label in the PR body is imprecise — the implementation is "view + narrow fixed palette," consistent with Liam's stated directive.

### Locale-safe tmux parsing

The `|` separator change (sessions.ts:17-20, 105-116) is clean. The parser correctly handles:
- Pipe-bearing pane commands via first-`indexOf` split (line 55-57)
- Pipe-name impostor rows via `SESSION_NAME_RE` validation before `firstPaneCommand` insertion (line 61)
- Spoof list rows via exact field-count check (`fields.length !== 3`, line 69)
- Sort-order guarantee: all characters in `SESSION_NAME_RE` are below `|` (0x7c), so a real session's first pane row always precedes impostor rows in `list-panes -a` output

### App routing refactor

`resolveInitialAppState` (app-routing.ts:80-96) is a pure function with clean separation: path aliases resolve first, hash deep links override when present, Telegram hashes (`#tgWebAppData=...`) are correctly ignored via `isAppDeepLink` filtering (line 73-76). Test coverage is thorough (15 cases including edge cases for malformed hashes, Telegram params, cross-alias hash overrides, and unknown paths).

### Test coverage

The R1 commit adds strong coverage for the new concurrency patterns: in-flight promise coalescing for both `discoverRepos` and `PrPoller.pollOnce()`, cache-TTL-starts-after-completion for slow scans, and namespace-scan-cap-after-filtering with truncation warning. Combined with the existing suite (355 server, 301 web, typecheck + build green), integration seams are well-exercised.
