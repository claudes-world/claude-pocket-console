# Session Triage Matrix

The action sheet often summarizes multiple sessions. Tables need GFM alignment,
inline formatting, and escaped pipes to render consistently.

| Session | State | Last line | Priority |
| :--- | :---: | --- | ---: |
| `alpha` | connected | **ready** for `pnpm test` | 1 |
| `deploy-web` | paused | waiting on `cpc.service` restart | 2 |
| `docs-sync` | active | copied `foo \| bar` from a plan table | 3 |
| `voice-notes` | failed | transcript contains `<kbd>Ctrl</kbd>` text | 4 |

| Path | Owner | Notes |
| --- | --- | --- |
| `apps/web/` | frontend | Telegram WebView constraints apply |
| `apps/server/` | backend | Hono routes, auth, and static serving |
| `docs/` | shared | Progressive discovery, not a dumping ground |

Trailing prose verifies paragraph flow after a block table. The next renderer
should preserve table cells with code, emphasis, escaped pipes, and raw-looking
text without collapsing the surrounding content.

