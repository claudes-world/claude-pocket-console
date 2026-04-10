# Overnight CPC Implementation Notes

## 1. Summary

The mobile console stayed usable while the web process restarted twice. The
highest value fix was keeping the file viewer readable in a narrow WebView.

## 2. Current Topology

- `apps/web` owns the React SPA.
- `apps/server` owns Hono routes and WebSocket transport.
- `~/bin/launcher-hook` owns Telegram keyboard buttons.
- `~/bin/session-history` owns forensic session lookup.

## 3. Important Constraints

Do not call `preventDefault()` on `touchstart`.
Use `stopPropagation()` only on targeted interaction zones.
Disable Telegram vertical swipes while a modal or sheet is open.
Re-enable Telegram vertical swipes on cleanup.
Do not edit the external Telegram plugin.

## 4. File Viewer Flow

1. User taps the Files tab.
2. The server returns a directory listing.
3. The UI shows file icons and path breadcrumbs.
4. A markdown file opens in the MarkdownViewer.
5. Wide code blocks must scroll horizontally.
6. Tables must not push the viewport wider than the app.

## 5. Manual Check Table

| Check | Command | Expected |
| --- | --- | --- |
| TypeScript | `pnpm --filter @cpc/web exec tsc -b` | clean |
| Unit tests | `pnpm --filter @cpc/web test` | snapshots pass |
| Build | `pnpm --filter @cpc/web build` | Vite emits `dist/` |
| Health | `curl -fsS localhost:38830/health` | ok |

## 6. Example Route Notes

The web app uses a base path from Vite. Static assets should keep working at
both `https://cpc.claude.do` and `https://cpc-dev.claude.do`.

```ts
export function buildAssetPath(baseUrl: string, name: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(name, base).toString();
}
```

## 7. Shell Recipe

```bash
set -euo pipefail
pnpm install --silent
pnpm --filter @cpc/web exec tsc -b
pnpm --filter @cpc/web test
pnpm --filter @cpc/web build
```

## 8. Failure Modes

> A sheet that forgets to re-enable vertical swipes makes Telegram feel broken.

> A wide code block without horizontal scrolling makes the terminal transcript
> unreadable on mobile.

> A raw HTML block silently stripped by a markdown renderer can hide operational
> instructions from the person holding the phone.

## 9. Task List

- [x] Confirm branch before edits.
- [x] Keep `marked` installed during the baseline setup.
- [ ] Swap the renderer in Wave 2.
- [ ] Document snapshot deltas in the migration PR.

## 10. Deep Link Candidates

### Session Selection

The future heading IDs may support direct links into long docs. Duplicate
headings need stable suffixes.

### Session Selection

This duplicate heading is intentional.

### Voice Recorder

The voice recorder uses file capture rather than `getUserMedia` because Telegram
WebView does not expose the browser media prompt consistently.

### Terminal

Terminal output can include long paths such as
`/home/claude/code/cpc-impl-react-markdown/apps/web/src/components/MarkdownViewer.tsx`.

## 11. JSON Payload

```json
{
  "kind": "SessionStart",
  "buttons": ["Actions", "Develop", "Voice"],
  "viewer": {
    "markdown": true,
    "mermaid": true,
    "rawHtml": "baseline-only"
  }
}
```

## 12. Closing Notes

Soft breaks appear here
as single newlines
inside one paragraph.

A blank line starts a new paragraph. The snapshot should make that distinction
obvious.

## 13. Appendix

The appendix exists mostly to make the fixture long enough to exercise file
loading, snapshot readability, and parser behavior on realistic content.

Keep the prose plain.
Keep commands copyable.
Keep the renderer honest.

