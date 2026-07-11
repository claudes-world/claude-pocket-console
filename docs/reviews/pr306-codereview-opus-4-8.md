# Phase Super-Swarm Review — PR #306 (head 9e1b505)

## SUMMARY

**NEEDS_FIXES (soft)** — no HIGH-severity blockers. The integrated phase is cohesive and the R1 fix-round landed correctly: the `decodeURIComponent(file=)` guard, the render-phase-side-effect move to `useEffect`, the scan-cap-after-filtering fix, and the async/bounded-concurrency repo discovery with shared in-flight coalescing are all present and correct at head. The async refactor introduced **no** new races, cache-poison, or error-propagation bugs. The one item that genuinely needs Liam's read is the `/pm_dobot` "view-only" claim: the UI palette is narrow and fixed as designed, but the server does **not** enforce that narrowness — the `send-keys`(literal) and `/compact` endpoints accept free-form text against any allowlist-valid, existing session (incl. `pm-dobot`), so "view-only + narrow fixed palette" is true of the client only, not the trust boundary. Gated behind trusted Telegram-allowlist auth, so MEDIUM not HIGH. **Merge recommendation: hold for Liam's greenlight per merge doctrine; resolve the pm_dobot design question, the rest is defer-OK.**

## HIGH severity findings

CLEAN — no findings.

## MEDIUM severity findings

**M1 — `/pm_dobot` "view-only" is a UI convention, not enforced server-side**
`apps/server/src/routes/terminal/slash-commands.ts:84,132` (send-keys literal path + compact); reached via `App.tsx:133` (`paletteSession`) → `ActionBar.tsx:425-434` → `CommandsSheet.tsx:49-66`.
The server correctly validates the client-supplied `session` for charset (`SESSION_NAME_RE`) and existence (`resolvePaletteTarget`/`tmuxSessionExists`), uses exact `=name:` targeting, and runs via `execFile` with no shell — so there is **no command injection and no arbitrary-session escape** beyond the allowlist. However, the `send-keys` *literal* branch and `/compact` only check that `keys`/`message` is a non-empty string, then send it verbatim **+ Enter**. A crafted HTTP request (bypassing the React palette) can therefore drive `pm-dobot` with arbitrary free-form text, not just the fixed `Esc/digits/^B/compact/reload-plugins` verb set. That is exactly the "free-form steering" the phase brief asks us to rule out. It matches the PR's own "narrow fixed palette by design (Liam msg 1188)" framing only if "narrow" is understood as a UI affordance; the backend contract is the same free-form writability the default session already had, now extended to any named session. **Impact is bounded**: only an authenticated `ALLOWED_TELEGRAM_USERS` member (already trusted, already able to write the default session) can reach it — so this is a design-intent/defense-in-depth clarification, not an external vuln. **Decision for Liam:** if "phase 1 read-only / fixed verb set" is meant literally, add a server-side payload allowlist (or a per-session read-only flag) that constrains literal `keys`/`message` when `session !== TMUX_SESSION`, plus an integration test that `/pm_dobot` cannot free-form send; if the narrow-*UI* + trusted-auth model is the intended phase-1 scope, no code change is needed and only the "read-only" wording should be tightened. This is the same cross-model split codex-5.4 (HIGH) vs codex-5.5/cursor-5.3 (safe-by-design) surfaced; my read lands it at MEDIUM and squarely in Liam's court.

## LOW severity findings

**L1 — depth-2 child symlinks are not guarded (asymmetry with the namespace guard)**
`apps/server/src/routes/prs.ts:127-128`. The depth-1 walk skips symlinked *namespace* dirs via `lstatSync().isSymbolicLink()`, but the child filter `existsSync(join(repoPath, childName, ".git"))` follows symlinks with no such check, so a symlinked child inside a real namespace dir (`~/code/ns/evil -> /outside`) becomes a candidate and gets `git -C` run against it. Local, trusted filesystem; output is still gated by `parseGitRemote` (github.com-only), so no data escapes. Worth a one-line comment noting the asymmetry, or mirroring the depth-1 `lstat` guard for symmetry.

**L2 — frontmatter heuristic over-strips indented leading blocks**
`apps/web/src/components/MarkdownViewer.tsx:39-41`. A document opening with `---\n  npm install\n---\n# Heading` matches `hasYamlShape` via the `^\s` alternative and is hidden inside the collapsed metadata pill. Display-only (content is shown raw in the pill, not lost; no crash). Narrow trigger.

**L3 — frontmatter heuristic under-recognizes indentless YAML sequences**
`apps/web/src/components/MarkdownViewer.tsx:39-41`. `tags:\n- cpc` (root-level, unindented `- item`) fails all three regex alternatives → the whole block leaks into the body and renders as garbage (rule + paragraph + bullet). Display-only, no crash, but visually worse than L2. Both L2/L3 stem from the same partial-grammar heuristic — a minimal real frontmatter/YAML shape check (accept `^- ` and require ≥1 top-level `key:`) would close both directions; otherwise file as a fast follow-up.

**L4 — `PrPoller.start()` fires `void this.pollOnce()` without `.catch`**
`apps/server/src/routes/prs.ts` (`start()` + `setInterval`). Latent only: today `runPollOnce` cannot reject (`discoverRepos` won't reject, every `execGh` is caught per-repo), so no unhandled rejection occurs. It becomes a real gap only if a future edit introduces a throw outside the per-repo try/catch. Cheap to harden with a trailing `.catch`.

**L5 — bot-path alias resolution is exact-path only**
`apps/web/src/lib/app-routing.ts` (`BOT_PATH_ALIASES` lookup). `/pm_dobot/` (trailing slash) and `/dev/pm_dobot` fall back to the default terminal session. Low real-world impact (dev-prefix + trailing-slash edge); normalize the pathname before lookup if the alias needs to survive `/dev/` browser preview. Defer-OK.

## Cross-cutting observations

- **R1 regressions: none.** `discoverRepos()` caches with a fresh `Date.now()` inside `.then` (TTL starts at completion, correct), only writes `repoCache` on the fulfillment path (no cache poison on reject), and `.finally` clears `repoScanInFlight` on both paths (no stuck in-flight). `pollOnce()` coalescing serializes `runPollOnce` bodies, so no out-of-order snapshot publication and no overlapping `gh` bursts from concurrent `start()`/`refresh`. Bounded-concurrency batching contains per-candidate `execGit` failures via per-item try/catch returning `null`, so `Promise.all` over each slice cannot reject.
- **Scan-cap fix confirmed:** `NAMESPACE_SCAN_CAP` now applies to the `.git`-filtered `childRepos` list, not raw dir entries, and `console.warn` fires only when `droppedCount > 0` — the prior "cap-before-filter silently drops real repos" finding is resolved. Test coverage for this (`dropped 1` warning, 50-length result) is present and good.
- **Locale-proof tmux parsing is solid.** `|` separator is outside `SESSION_NAME_RE`, list rows with `!== 3` fields are dropped (spoof-hardening), pane commands split on the *first* `|` only so pipe-bearing commands survive, and first-pane-wins + the below-`0x7c` sort ordering correctly defeats `real|suffix` impostor rows. Strong test coverage.
- **Deep-link boundary (R1):** both `file=` and `session=` decodes are now try/catch-guarded and the `replaceState` redirect runs in a committed `useEffect` keyed on `redirectPath` (dev host excluded). `resolveInitialAppState` is pure. Good seam coverage in `app-routing.test.ts`.
- **`middleTruncatePath`** correctly preserves directory boundaries and avoids splitting UTF-16 surrogate pairs at hard cuts; well tested.
- **Test coverage** on the integration seams (discovery depth-2/symlink/cap/coalesce/TTL, poll coalescing, tmux spoof rows, routing redirects, frontmatter edge cases) is genuinely thorough. The one uncovered seam is an integration test asserting `/pm_dobot` cannot free-form steer its session server-side (M1) — worth adding once the design question is settled.
