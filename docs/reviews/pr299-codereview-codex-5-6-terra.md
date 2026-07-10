# Phase Super-Swarm Review -- PR #299 (head 5cf377e)

## SUMMARY

NEEDS_FIXES. The file-viewer read-root expansion reintroduces the TOCTOU issue through the pre-existing send-to-chat integration: `/tmp` paths are checked by name and later handed to a separate consumer to read. The direct file-viewer reads, downloads, listings, search walks, session state, fit-latch release, SPA fallback, and deployed-version reporting are coherent; do not merge until the cross-process handoff is made race-safe.

## HIGH severity findings

- `apps/server/src/routes/telegram.ts:12` -- `send-to-chat` still uses `isPathAllowed(filePath, ALLOWED_FILE_ROOTS)` and subsequently sends the pathname at line 23 with instructions to read it. PR #292 adds world-writable `/tmp` to those roots (`apps/server/src/lib/path-allowed.ts:67`), so a local attacker can make `/tmp/share` point to an allowed file for the check, swap it to (for example) `~/.ssh/id_rsa`, then let the Telegram-side consumer open the supplied pathname. This bypasses the new fd-pinning hardening because the protected operation occurs after the check and in another process. Do not forward a mutable pathname: send the validated fd's bytes as a Telegram document, or copy the pinned content to a private immutable handoff before emitting it. Add a symlink-swap regression test for this route.

## MEDIUM severity findings

CLEAN -- no findings.

## LOW severity findings

CLEAN -- no findings.

## Cross-cutting observations

- The direct #292 surfaces are correctly aligned: `/read`, `/download`, `/list`, `/search`, and markdown summarization use fd-validated reads; upload/paste/audio remain on write roots; `/list` uses `lstat` for entry metadata.
- #291 keeps the selected session stable during roster refresh, uses exact tmux targets, and hides default-session-only actions for a view-only session. Its API evolution is tolerant of web/server rollout skew.
- #285's resize then `window-size latest` ordering is correct and latch-release failure is surfaced distinctly. #286 guards fullscreen by Telegram version and exceptions.
- #289 excludes both bare and nested API/WS paths; #290's in-app navigation is gated by actual initData and preserves modified-click behavior. #288 reads the running process checkout and supports detached tags.
- Verification: `pnpm build` passed; package tests passed (346 server, 267 web); `git diff --check` passed. No end-to-end test covers the `/tmp` -> send-to-chat handoff, which is the missing regression above.
