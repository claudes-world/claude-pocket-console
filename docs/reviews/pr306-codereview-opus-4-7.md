# Phase Super-Swarm Review -- PR #306 (head 9e1b505)

## SUMMARY
NEEDS_FIXES (one MEDIUM). R1 landed the swarm's consensus fixes: `execFileSync` is gone from `discoverRepos`, both `discoverRepos` and `PrPoller.pollOnce` coalesce concurrent callers behind one in-flight promise, the namespace cap now applies **after** filtering to real repos and warns on truncation, the malformed `file=` deep link is guarded, and the render-phase `window.history.replaceState` was moved into a `useEffect` keyed on `redirectPath`. The one real remaining defect is a partial-grammar YAML heuristic in `extractFrontmatter` that still rejects the very common indentless block-sequence form (`tags:\n- cpc`) — that leaks raw frontmatter into the rendered document instead of stripping it. Recommend a small R2 (one regex + a test) before merge.

## HIGH severity findings

CLEAN -- no findings.

The pre-R1 HIGH candidates are all resolved at head:

- `apps/server/src/routes/prs.ts:84-176` -- `scanRepos` runs `execFile` asynchronously with `GIT_SCAN_CONCURRENCY = 8`, and `discoverRepos` shares a single `repoScanInFlight` promise; the sync event-loop-block risk (Gemini HIGH) is gone.
- `apps/web/src/App.tsx:107-117` -- `replaceState` moved to a `useEffect` deps'd on `initialRoute.redirectPath`; the render-phase side effect (Gemini MEDIUM) is fixed.
- `/pm_dobot` write surface: the PR body explicitly restates the fleet-wide fixed-verb palette (`send-keys`/`compact`/`reload-plugins`) as reachable **by design** per Liam voice msg 1188, and reads the WS view as read-only. Confirmed by the code shape — terminal WS remains capture-pane only; the palette is a small, allowlisted mutating surface separate from the WS. Codex 5.4's HIGH was flagged against an earlier read of the PR contract; against the now-stated contract the implementation matches. Not a bug at this head.

## MEDIUM severity findings

**M1. `apps/web/src/components/MarkdownViewer.tsx:39-42` -- YAML shape heuristic rejects valid indentless block sequences, so frontmatter using the standard `tags:\n- cpc` form leaks into the rendered document.**

The `hasYamlShape` check requires every non-empty metadata line to match `/^\s|^#|^[A-Za-z0-9_.\$-]+\s*:(\s|$)/`. That accepts `key:` / `#comment` / `\s`-indented continuations, but a root-level indentless sequence entry like `- cpc` matches none of those (no leading whitespace, no `#`, no `:` — the `-` in the char class doesn't help because there's no colon). Result: a very ordinary CPC/claudes-world frontmatter block such as

```
---
title: Hidden metadata
tags:
- cpc
- do-box
---
# Visible title
```

falls through the `hasYamlShape` gate, is returned untouched (`metadata: null`), and the raw `---`/`title:`/`tags:` lines render inline instead of collapsing into the metadata pill. Repro: `extractFrontmatter("---\ntags:\n- cpc\n---\nBody")` currently returns `{ body: "---\ntags:\n- cpc\n---\nBody", metadata: null }`.

**Suggested fix.** Extend the regex to accept indentless sequence entries: `/^\s|^#|^-(\s|$)|^[A-Za-z0-9_.\$-]+\s*:(\s|$)/`, and add negative/positive tests: `tags:\n- cpc` frontmatter must strip; `---\n- shopping list\n---\n# body` (already-legal non-YAML) must stay unstripped because its first line is a sequence but no prior `key:` line justifies treating it as YAML — the safer stronger rule is "require at least one `key:` line AND allow `-` continuations only after one." Either the loose or strict form fixes the reported miss.

## LOW severity findings

**L1. `apps/server/src/routes/prs.ts:135` -- when a namespace holds >50 child repos, which 50 survive is filesystem-order-dependent and silent to operators.**

The warning fires with a count (`dropped N candidate repos`), but the surviving slice is `childRepos.slice(0, 50)` — order comes from `readdirSync`, which is not sorted on Linux. Same numbers, different repos surviving between hosts/mounts. Small defer-OK item: sort `childRepos` before slicing (deterministic pick), and consider raising the cap once async concurrency has proven itself in prod.

**L2. `apps/web/src/lib/app-routing.ts:74-77` -- alias resolution is exact-path-equality only.**

`resolveInitialAppState("/pm_dobot/", "")` (trailing slash) and `resolveInitialAppState("/dev/pm_dobot", "")` (dev prefix) both fall through to the DEFAULT_STATE. This was raised in R0 by Codex 5.4 and is confirmed still present at head. Low real-world impact for the current dev tunnel (Telegram opens without trailing slash), but brittle if a reverse-proxy or dev route ever canonicalizes. Follow-up: normalize `pathname` (`.replace(/^\/dev/, "").replace(/\/$/, "") || "/"`) before the lookup and cover both shapes in `app-routing.test.ts`.

**L3. `apps/server/src/routes/prs.ts:178-192` -- `scanRepos` rejection would poison the shared promise for both `pollOnce` and `currentBranchScope`.**

In practice `scanRepos` catches every per-candidate failure and returns `[]` on missing/unreadable `~/code`, so it does not reject. If a future edit accidentally lets an error escape `scanRepos`, both waiters resolve to a rejection they cannot recover from until the in-flight slot clears in `.finally`. Not a bug now, worth a one-line comment on the invariant so it isn't broken later.

## Cross-cutting observations

- **Coalescing correctness.** Both new in-flight guards (`repoScanInFlight` in `discoverRepos`, `pollInFlight` in `PrPoller.pollOnce`) are single-threaded-safe: JS microtask ordering means the check-and-set pair cannot interleave with concurrent async callers, `.then` runs before `.finally`, and the next event-loop caller sees `repoCache` populated before `repoScanInFlight` is cleared. No stale-cache or lost-update race introduced by R1. Tests explicitly exercise the coalescing path (`prs-routes.test.ts` lines 282-307, 342-362) and pass.
- **Locale-safe tmux parsing.** The `|` separator + `SESSION_NAME_RE` filter on pane rows is the right shape: `|` is outside the session-name allowlist so a real session's first pane row always precedes a `real|suffix` impostor's row alphabetically; the `fields.length !== 3` guard on `list-sessions` output rejects the spoof rows cleanly. New tests cover impostor rows, allowlist-failing pane rows, and pane commands containing pipes.
- **`/pm_dobot` matches the now-stated design.** WS remains view-only (capture-pane); the mutating palette is a small allowlisted set (`send-keys`/`compact`/`reload-plugins`) and the paletteSession pessimism in `App.tsx:133` conservatively treats a deep-linked name as non-default until the session list proves otherwise. That's consistent with "phase 1: view + narrow palette by design" as PR metadata; full steering is explicitly phase 2.
- **Middle-truncate + surrogate-pair handling** in `FileViewer.middleTruncatePath` is thoughtful — hard cuts move inward on surrogate boundaries and the `maxLength` guarantee is preserved. Tests cover both boundaries.
- **Namespace scan tests** cover depth-1, depth-2, symlinked namespace non-descent, cap-with-warning, coalescing, and cache-TTL-after-slow-scan. Good regression fence.
- **Not covered by tests but low risk:** the ordering-nondeterminism of the >50 cap (L1) and the unnormalized alias lookup (L2).
