# Phase Super-Swarm Review — PR #306 (head d707da8)

## SUMMARY
NEEDS_FIXES. The integrated phase is close, but `/pm_dobot` does not actually preserve its stated phase-1 read-only invariant, and the new frontmatter stripper can hide legitimate markdown content. I would hold merge until the non-default-session write path is removed; the pathname-alias brittleness is smaller but should be fixed in the same pass.

## HIGH severity findings

1. `apps/web/src/components/action-bar/ActionBar.tsx:422`, `apps/web/src/components/action-bar/CommandsSheet.tsx:16`, `apps/server/src/routes/terminal/slash-commands.ts:73`
   `/pm_dobot` is described in the phase brief as a read-only terminal view, but the shipped integration still exposes mutating controls for any non-default session. The restricted palette wires `Esc`, digits, `^B`, `/compact`, and `/reload-plugins` to the viewed session, and the backend explicitly accepts a client-picked `session` on `/send-keys`, `/compact`, and `/reload-plugins`. That means opening `/pm_dobot` can actively drive the pm-dobot tmux session instead of only viewing it. Suggested fix: add a true read-only mode end-to-end for non-writable sessions used by route aliases like `/pm_dobot` (hide or disable the command palette in the UI, and reject mutating session-targeted requests server-side for read-only routes/sessions), then add an integration test that `/pm_dobot` cannot send keys or slash commands.

## MEDIUM severity findings

1. `apps/web/src/components/MarkdownViewer.tsx:27`
   `extractFrontmatter()` accepts any whitespace-prefixed line as valid YAML continuation, so a normal markdown document that starts with a thematic break and an indented block gets stripped as metadata. Repro: `extractFrontmatter("---\n  npm install\n---\n# Heading")` currently returns `{ metadata: "  npm install\n", body: "# Heading" }`, which hides real content behind the metadata pill. Suggested fix: require at least one top-level `key:` line before allowing indented/comment continuation lines, or use a real frontmatter parser; add negative tests for indented code/list blocks that are not actually YAML frontmatter.

## LOW severity findings

1. `apps/web/src/lib/app-routing.ts:72`
   Alias resolution is exact-path only, so `resolveInitialAppState("/dev/pm_dobot", "")` and `resolveInitialAppState("/pm_dobot/", "")` both fall back to the default terminal session. That makes the new alias unavailable in the documented browser dev view under `/dev/` and brittle under any trailing-slash rewrite/canonicalization. Suggested fix: normalize the pathname before lookup (strip a leading `/dev` base and trim one trailing slash), and extend the routing tests for prefixed and slash-suffixed alias paths.

## Cross-cutting observations

- Locale-proof tmux session parsing looks solid. The pipe separator change preserves pipe-bearing pane commands and rejects spoofed session rows cleanly.
- Repo discovery’s new depth-2 coverage is exercised well for namespace dirs, symlinks, scan caps, and cache timing. The main remaining integration risk in this phase is behavioral drift around route/session semantics, not missing test scaffolding there.
```
