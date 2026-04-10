# Cursor Cloud agent instructions

These instructions apply specifically to Cursor Cloud Agent environments.

## Quick reference

| Task | Command |
|---|---|
| Install deps | `pnpm install` (from repo root) |
| Build frontend | `pnpm --filter @cpc/web build` |
| Build server | `pnpm --filter @cpc/server build` |
| Run web tests | `pnpm --filter @cpc/web test` |
| Run server tests | `pnpm --filter @cpc/server test` |
| Dev server (backend) | `pnpm --filter @cpc/server dev` (port 38830) |
| Dev server (frontend) | `pnpm --filter @cpc/web dev` (port 58830) |
| TypeScript check | `tsc -b` in each app directory |

## Secrets setup

The server reads `~/.secrets/cpc.env` at startup via a custom `loadEnv()`.
If the file is missing, the server still starts but auth-protected routes
return 500 ("Not configured"). Public health endpoints work without secrets.

For Cloud Agent VMs, create `~/.secrets/cpc.env` with at least a placeholder:
```
TELEGRAM_BOT_TOKEN=dev-placeholder-token
ALLOWED_TELEGRAM_USERS=
```

The SQLite database auto-creates at `~/data/cpc-voice.db`; just ensure
`~/data/` exists (`mkdir -p ~/data`).

## Gotchas

- No ESLint is configured; TypeScript compilation (`tsc -b`) is the
  primary static check. `pnpm lint` (via turbo) is a no-op.
- The Vite dev server uses `base: "/dev/"` so the local URL is
  `http://127.0.0.1:58830/dev/` (not just `/`).
- The Vite dev server proxies `/api` and `/ws` to the backend at port 38830,
  so the backend must be running for API calls to succeed during frontend dev.
- Outside Telegram WebView, the frontend shows an auth screen
  ("Telegram auth unavailable"). This is expected behavior.
- `better-sqlite3` requires a native build step (handled by `pnpm install`
  via `onlyBuiltDependencies` in `pnpm-workspace.yaml`).
