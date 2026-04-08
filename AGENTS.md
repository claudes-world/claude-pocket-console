# AGENTS.md — Claude Pocket Console (CPC)

> Telegram Mini App for mobile session management. Monorepo: `apps/web`
> (React/Vite) + `apps/server` (Hono). Port 38830. Tunnel: cpc.claude.do.

---

## 1. Project Identity

CPC is a Telegram Mini App that runs inside Telegram's WebView. It provides
a mobile command center for Claude Code sessions: live terminal, file browser,
voice recorder, and session management. The frontend is a React SPA built with
Vite; the backend is a Hono HTTP + WebSocket server. Both live in a pnpm
monorepo.

---

## 2. Critical Rules -- Never Violate

### Off-Limits: Telegram Plugin

The Telegram plugin lives at:
`~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram/`

**Never edit, move, or reconfigure any file in that directory.** It is managed
by the host, not by CPC. If it breaks, ask the user.

### Keyboard Buttons Are External

The Telegram keyboard (Actions / Develop / Voice buttons) is managed by
`~/bin/launcher-hook`. It is NOT part of CPC code, NOT part of the Telegram
plugin. Do not try to set or change keyboard buttons from CPC.

### Touch Handling in Telegram WebView

- **Never `preventDefault()` on `touchstart`** -- it breaks all Telegram
  gestures (swipe-to-close, scroll, everything).
- Use `stopPropagation()` on specific zones (header, ActionBar) to prevent
  tab-swipe interference.

### Vertical Swipe Control (Bot API 7.7+)

- Call `Telegram.WebApp.disableVerticalSwipes()` when opening a modal/sheet.
- Call `Telegram.WebApp.enableVerticalSwipes()` on close (cleanup in useEffect).
- If you skip this, Telegram will minimize the app when users swipe down.

### Git Safety

- **Never `git checkout`/`restore` uncommitted work.** Always commit first.
- **Always check `git branch` before making changes.** Never commit to `main`.
- Work on `dev` or `feat/*` branches. Use `/deploy` skill to ship to prod.

### Camera / Media

- `getUserMedia` does NOT work in Telegram WebView.
- Use `<input type="file" capture>` for camera/microphone access.
- `Camera` is absent from the MiniKit Permission enum.

---

## 3. Monorepo Layout

| Path              | Description                                |
|-------------------|--------------------------------------------|
| `apps/web/`       | React frontend (Vite, TypeScript)          |
| `apps/server/`    | Hono backend (TypeScript, WebSocket)       |
| `packages/`       | Shared packages (currently unused)         |
| `docs/`           | Progressive discovery documentation        |
| `archive/`        | Retired specs and outdated docs            |
| `tests/`          | Playwright E2E tests                       |
| `turbo.json`      | Turborepo config                           |

---

## 4. Progressive Discovery Index

Read what you need for your current task. Start with the closest AGENTS.md.

### Reference (architecture context)
- [Architecture](docs/reference/architecture.md) -- component ownership map
- [Telegram WebView Rules](docs/reference/telegram-webview-rules.md) -- platform constraints
- [Modal System](docs/reference/modal-system.md) -- ActionBar modals and BottomSheet

### Guides (how to do things)
- [Adding a Modal](docs/guides/adding-a-modal.md) -- step-by-step checklist
- [Deploying](docs/guides/deploying.md) -- build, restart, verify
- [Recovery](docs/guides/recovery.md) -- session-history, git reflog, keyboard restore

### Conventions (always applicable)
- [Gitflow](docs/conventions/gitflow.md) -- branching model and commit rules
- [Touch Handling](docs/conventions/touch-handling.md) -- three-zone model
- [Host Tools](docs/conventions/host-tools.md) -- ~/bin/ tools CPC depends on
- [Off-Limits](docs/conventions/off-limits.md) -- things agents must never modify

### Package-Level Instructions

| Path                  | Covers                                       |
|-----------------------|----------------------------------------------|
| `apps/web/AGENTS.md`  | React frontend, components, styles, telegram.ts |
| `apps/server/AGENTS.md` | Hono routes, auth, secrets, static serving  |

---

## 5. Environment

| Item               | Value                                        |
|--------------------|----------------------------------------------|
| Server port        | `38830`                                      |
| Prod tunnel        | `https://cpc.claude.do`                      |
| Dev tunnel         | `https://cpc-dev.claude.do`                  |
| Bot token env      | `TELEGRAM_BOT_TOKEN` in `~/.secrets/cpc.env` |
| OpenAI key         | `OPENAI_API_KEY` in `~/.secrets/openai.env`  |
| Allowed users      | `ALLOWED_TELEGRAM_USERS` in `~/.secrets/cpc.env` |
| Voice DB           | `~/data/cpc-voice.db` (SQLite, WAL mode)     |
| Credential loader  | `~/code/toolbox/hooks/common.sh`             |

---

## 6. Host Tools

| Tool               | Purpose                                                  |
|--------------------|----------------------------------------------------------|
| `~/bin/launcher-hook` | Sends keyboard to Telegram Bot API on SessionStart, cleans orphaned plugin processes |
| `~/bin/session-history` | Forensic CLI for JSONL session history (list, search, extract, diff) |
| `~/bin/transcribe`   | Whisper-based audio transcription via OpenAI API        |
| `/deploy` skill      | Build web, kill server, restart, verify health           |

---

## Cursor Cloud specific instructions

### Quick reference

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

### Secrets setup

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

### Gotchas

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
