# Phase Super-Swarm Review -- PR #299 (head 5cf377e)

## SUMMARY

NEEDS_FIXES. The integrated release leaves one high-severity `/tmp` TOCTOU/confused-deputy path in “Send to chat,” despite correctly hardening direct file reads, downloads, markdown reads, listings, and search walks. Fix that before merge; the remaining integration seams and builds look coherent.

## HIGH severity findings

- `apps/server/src/lib/path-allowed.ts:71`, `apps/server/src/routes/telegram.ts:12`, `apps/server/src/routes/telegram.ts:25` — Adding world-writable `/tmp` to `ALLOWED_FILE_ROOTS` also expands `/send-to-chat`. That endpoint only validates the pathname once, then sends the mutable lexical path to Claude with an instruction to read and act on it later. A local attacker can present a benign `/tmp/x`, let `isPathAllowed()` pass, then replace it with a symlink to an out-of-root secret or attacker-controlled prompt before the agent follows the message; the fd-pinning added to `/read`, `/download`, `/summarize`, and `/search` cannot protect this deferred consumer. Give sharing a narrower root set that excludes `/tmp`, or open+validate the file and create an fd-derived immutable snapshot under a trusted write root, then send the snapshot path.

## MEDIUM severity findings

CLEAN -- no findings.

## LOW severity findings

- `apps/web/src/App.tsx:114` — There is no App-level test covering the combined deep-link → roster refresh → picker selection → Terminal key/remount → restricted-palette flow. Component/server tests cover the pieces, but the shared state seam already needed a fix round (`activeSession` normalization caused remounts). Add one integration test proving roster refresh preserves the socket/component identity, an explicit default deep link becomes writable after roster load, and selecting a non-default session updates both WS targeting and the palette.

## Cross-cutting observations

- SPA fallback ordering is sound: real static assets win, `/api` and `/ws` misses remain non-HTML, and the external Fleet Cockpit navigation does not intersect the local fallback.
- Fit Screen remains default-session-only; resize then latch release is ordered correctly and latch-release failure is distinct. The multi-session palette cannot reach it.
- `/cpc-branch` matches the deployed checkout under the committed production unit's `WorkingDirectory=/home/claude/code/claude-pocket-console-prod`; the separately baked web version makes an out-of-lockstep build visible.
- Direct file content paths use fd validation and fd-based reads; `/search` revalidates each walked directory; `/list` uses non-following metadata. The write-root split is consistently used by upload, paste, and audio generation.
- Web tests passed (267/267); server tests passed 342 with two OTEL tests plus one suite failing because the sandboxed run opened the host SQLite DB read-only, unrelated to this diff. Both server and web production builds passed.
