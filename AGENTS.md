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
|------|---------|
| Install deps | `pnpm install` (from repo root) |
| Build all | `pnpm build` |
| Run tests (web) | `cd apps/web && pnpm test` |
| Run tests (server) | `cd apps/server && pnpm test` |
| Dev server (backend) | `cd apps/server && pnpm dev` (port 38830) |
| Dev server (frontend) | `cd apps/web && pnpm dev` (port 58830) |
| Both dev servers | `pnpm dev` (via turbo, runs both) |

### Gotchas

- **No lint scripts configured.** `pnpm lint` / `turbo lint` runs zero tasks. TypeScript checking happens via `tsc -b` during `pnpm build`.
- **Secrets file required for server start.** The server loads `~/.secrets/cpc.env` at startup via `loadEnv()`. If missing, it silently continues (no crash), but all auth-protected endpoints will fail. Create a minimal file with `TELEGRAM_BOT_TOKEN` and `ALLOWED_TELEGRAM_USERS` for dev.
- **SQLite data directory.** The server auto-creates `~/data/cpc-voice.db`, but `~/data/` must exist. Run `mkdir -p ~/data` before starting the server if it doesn't exist.
- **Vite base path.** In dev mode, Vite serves at `/dev/` (configured for Caddy reverse proxy). Access the frontend at `http://127.0.0.1:58830/dev/`. The `/api` and `/ws` prefixes are proxied to the backend on port 38830.
- **Telegram auth in browser.** Outside Telegram's WebView, the frontend shows "Telegram auth unavailable." This is expected. The public health endpoint (`/api/public/health`) is the primary dev verification target.
- **`better-sqlite3` native build.** Listed in `pnpm-workspace.yaml` under `onlyBuiltDependencies`. Requires a working C++ toolchain (gcc/g++). Usually "just works" with `pnpm install` on Linux with build-essential installed.
- **tmux session dependency.** The terminal viewer feature requires a running tmux session (default name: `claudes-world`). Not needed for basic server/frontend dev, but needed for the terminal tab feature.
