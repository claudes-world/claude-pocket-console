# CPC Dockerization Plan

Stage 1 only: this document inventories the current CPC runtime and proposes the Docker/Coolify implementation shape. No Dockerfile, compose file, or application code has been added yet.

## 1. Inventory of Services to Dockerize

### Production deployable: combined CPC app

- Path: `apps/server` plus built assets from `apps/web`.
- Runtime: Node.js ESM, package manager `pnpm@10.28.1`, repo engine `node >=20.18.1`.
- Server framework: Hono using `@hono/node-server` and `@hono/node-ws`.
- Production entrypoint today: `node apps/server/dist/index.js` from `systemd/user/cpc.service`.
- Port: `PORT`, default `38830`; current production unit sets `PORT=38830`.
- Static frontend: `apps/web` is built with Vite into `apps/web/dist`; `apps/server/src/index.ts` serves that directory from the compiled server via `../../web/dist`.
- WebSocket: `/ws/terminal`, same HTTP server/port.
- Existing health routes: `GET /api/public/health` and `GET /api/health` return `{"status":"ok"}`.
- Missing Coolify route: `GET /health`.

### Build-time-only app: web frontend

- Path: `apps/web`.
- Runtime: Node/pnpm build toolchain only; not a separate production process.
- Dev port only: Vite dev server uses `58830`, binds to `127.0.0.1`, and proxies `/api` and `/ws` to `127.0.0.1:38830`.
- Production serving: static files are served by `apps/server`; no separate Nginx/Caddy/web container is needed for CPC itself.
- Build script: `pnpm --filter @cpc/web build` (`tsc -b && vite build`).
- Build-time env:
  - `ANALYZE=true` is optional and only emits bundle stats.
  - `git describe --tags --always` is used at build time for `__APP_VERSION__`; Docker builds should copy `.git` only if this version must match tags in image builds, or accept `dev` fallback.

### Current systemd units

- `systemd/user/cpc.service`:
  - Working directory: `/home/claude/code/claude-pocket-console-prod`.
  - Env: `PORT=38830`, `NODE_ENV=production`.
  - Exec: direct Node process, not `pnpm start`: `/home/claude/.local/share/fnm/aliases/default/bin/node apps/server/dist/index.js`.
  - Post-start waits for port `38830`.
- `systemd/user/cpc-dev.service`:
  - Working directory: `/home/claude/code/claude-pocket-console`.
  - Env: `PORT=38831`.
  - Exec: `pnpm dev`.
  - Development-only and not part of the production Docker target.

### Runtime env vars read by the server

Required for production auth:

- `TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_TOKENS`: token(s) used to validate Telegram Mini App initData, Login Widget sessions, and keyboard JWTs. `TELEGRAM_BOT_TOKENS` is comma-separated and takes precedence.
- `ALLOWED_TELEGRAM_USERS`: comma-separated Telegram user IDs. The code treats an empty allowlist as open/dev convenience, so Coolify production should require a non-empty value.

Required for feature parity:

- `OPENAI_API_KEY`: used by audio TTS and `~/bin/transcribe` workflows. Existing code can also read it from `$HOME/.secrets/openai.env`, but Coolify should inject it directly.
- `BOTTOKEN` and `TELEGRAM_CHAT_ID`, or a mounted compatible `~/code/toolbox/hooks/common.sh`: `/api/audio/send-telegram` and `/api/telegram/send-to-chat` currently call `getTelegramCreds()`, which shells out to `source "$HOME/code/toolbox/hooks/common.sh"; echo "$BOTTOKEN|||$TELEGRAM_CHAT_ID"`. This is a containerization risk because direct env injection alone is not yet consumed by this helper.

Required/important process configuration:

- `PORT`: default `38830`; compose should set `38830`.
- `NODE_ENV`: should be `production`.
- `HOME`: defaults to `/home/claude`; container should set `HOME=/home/claude` and preserve current hard-coded path expectations.
- `TMUX_SESSION`: optional, default `claudes-world`; must match `/^[A-Za-z0-9_.-]+$/`.

Optional feature/config env:

- `FILES_BASE_DIR`: default `/home/claude/claudes-world`, used as file browser default.
- `CPC_TLDR_MAX_BYTES`: default `512000`, maximum markdown bytes sent to summarization.
- `CPC_TLDR_MODEL`: default `claude-haiku-4-5`.
- `CPC_TLDR_PROMPT_VERSION`: default `1`, cache key component.
- `CPC_CLAUDE_BIN`: default `claude`, used by markdown TLDR route.
- `EARLY_HINTS`: set to `0` to disable HTTP 103 early hints.
- `OTEL_TRACES_SAMPLE_RATE`: default `0.1`.
- `npm_package_version`: used as OpenTelemetry service version when present.

Host filesystem/runtime dependencies to plan explicitly:

- SQLite voice/reading-list DB lives at `$HOME/data/cpc-voice.db`; with `HOME=/home/claude`, mount persistent host data to `/home/claude/data`.
- The file browser and markdown/audio routes allow paths under `/home/claude/claudes-world`, `/home/claude/code`, `/home/claude/bin`, `/home/claude/.claude`, `/home/claude/claudes-world/.claude`, and `/home/claude/.world`; these paths need read or read-write mounts depending on desired behavior.
- Terminal routes require `tmux` and access to the target tmux server/session. This likely requires mounting the tmux socket path and matching UID.
- Markdown TLDR requires the `claude` CLI and its auth/config if the feature should work inside the container.
- PR routes require the `gh` CLI and host GitHub auth if the feature should work inside the container.
- Audio send routes require `curl`.
- Voice transcription requires `~/bin/transcribe` and OpenAI credentials.

## 2. Per-Service Dockerfile Strategy

### Recommended production image: one `cpc` image

Use a single multi-stage Dockerfile at repo root. Build both workspace packages and run only the compiled server.

Base/build stage:

- Start from an official Debian-based Node image, preferably `node:22-bookworm-slim` or `node:20-bookworm-slim`.
- Prefer Debian slim over Alpine because `better-sqlite3` is a native dependency and Alpine/musl can create avoidable native-build friction.
- Enable Corepack and pin pnpm through the repo `packageManager` value.
- Install build prerequisites only in the build/deps stages as needed for native modules: `python3`, `make`, `g++`, and git if version stamping via `git describe` is desired.
- Copy `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `turbo.json`, and package manifests first for dependency caching.
- Run `pnpm install --frozen-lockfile`.
- Copy source.
- Run the production build, likely `pnpm build`, which builds `apps/web/dist` and `apps/server/dist`.
- Prune dev dependencies for runtime. Options:
  - Use `pnpm deploy --filter @cpc/server --prod /out` if it preserves the needed monorepo-relative `apps/web/dist` layout, or
  - Use a runtime stage with production `node_modules` plus `apps/server/dist`, `apps/server/package.json`, and `apps/web/dist`.

Runtime stage:

- Use the same Debian slim Node major as the build stage.
- Install only runtime OS packages needed by current features:
  - Required for core routes/features: `tmux`, `git`, `curl`, `ca-certificates`.
  - Consider `openssh-client` if `gh`/git workflows need SSH remotes.
  - Consider whether to install `gh` in image or mount/provide it from the host; installing it is more reproducible, but auth still must be injected/mounted.
  - Do not bake `claude` CLI or `~/bin/transcribe` secrets into the image; either mount host tools or add a separate operator-managed tool layer.
- Create a non-root user with an explicit UID/GID. Proposed default: UID/GID `1000:1000`, username `claude`, home `/home/claude`.
- Make UID/GID build args (`CPC_UID`, `CPC_GID`) so the image can be rebuilt to match the operator UID used for `/srv/world/secrets/` and host mounts.
- Set `WORKDIR` to the copied app root.
- Set `NODE_ENV=production`, `HOME=/home/claude`, `PORT=38830`.
- Use exec-form `CMD ["node", "apps/server/dist/index.js"]` so Node is PID 1 and receives SIGTERM directly. Do not wrap it in `sh -c`, `pnpm start`, or a shell script unless the wrapper uses `exec`.
- Add an init process only if Coolify/Compose will not run with `init: true`; `init: true` in compose is cleaner because it handles PID 1 child reaping without swallowing signals.
- Logs: write to stdout/stderr only. The current server uses `console.log/error/warn`, which is Docker log-driver friendly. Do not redirect logs to files.
- Secrets: no `ENV` values containing secrets in Dockerfile; all secrets injected at runtime by Coolify or mounted read-only from `/srv/world/secrets`.

Signal handling notes:

- The current OpenTelemetry module registers SIGTERM/SIGINT handlers and exits after provider shutdown.
- Stage 2 should keep the container command as direct Node PID 1.
- Stage 3 should consider moving graceful shutdown into the main server entry so SIGTERM closes the HTTP/WebSocket server before telemetry shutdown exits the process. This is especially relevant for Coolify deploy/restart behavior.

## 3. Top-Level `compose.yml` Shape

Recommended shape for Coolify:

```yaml
services:
  cpc:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        CPC_UID: "1000"
        CPC_GID: "1000"
    init: true
    restart: unless-stopped
    environment:
      NODE_ENV: production
      PORT: "38830"
      HOME: /home/claude
      TMUX_SESSION: claudes-world
      # secrets injected by Coolify UI / sync-coolify-secrets
    ports:
      - "127.0.0.1:38830:38830"
    volumes:
      - cpc-data:/home/claude/data
      # host integration mounts TBD; see risk section
    healthcheck:
      test: ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:38830/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    networks:
      - cpc

volumes:
  cpc-data:

networks:
  cpc:
```

Important binding rule:

- Host port publishing must be `127.0.0.1:38830:38830`, never `38830:38830` and never `0.0.0.0:38830:38830`.
- The app may listen on all interfaces inside the container so Docker port publishing works, but the host exposure stays loopback-only. Public traffic should arrive through Cloudflare Tunnel/Caddy/Coolify routing only.

Mounts that probably need Liam/operator confirmation:

- `/srv/world/secrets/...` read-only into a path the app can consume, or Coolify env injection only after code is adjusted to stop requiring `common.sh`.
- Host `/home/claude/claudes-world`, `/home/claude/code`, `/home/claude/bin`, `/home/claude/.claude`, and `/home/claude/.world` if CPC should keep file browser, tmux, Claude CLI, PR, pulse, and transcribe feature parity.
- Tmux socket directory, likely under `/tmp/tmux-1000` or the host-specific tmux socket location, if the container needs to talk to an existing host tmux session.

## 4. Health Endpoint Plan

Current state:

- `GET /api/public/health` returns 200 JSON.
- `GET /api/health` returns 200 JSON.
- `GET /health` does not exist.

Plan:

- Stage 3 should add `app.get("/health", ...)` in `apps/server/src/index.ts` before the auth middleware/catch-all static routes.
- Response can mirror the existing health payload: `{"status":"ok"}`.
- Keep existing `/api/public/health` and `/api/health` for backward compatibility and current deploy docs/tests.
- Add a focused server test for unauthenticated `/health`.
- Compose healthcheck and Coolify health path should use `/health`.

## 5. Env Var Schema for Coolify Injection

### Required

- `NODE_ENV=production`
- `PORT=38830`
- `HOME=/home/claude`
- `TELEGRAM_BOT_TOKEN` or `TELEGRAM_BOT_TOKENS`
- `ALLOWED_TELEGRAM_USERS`

### Required for current feature parity

- `OPENAI_API_KEY`
- `BOTTOKEN`
- `TELEGRAM_CHAT_ID`

Note: `BOTTOKEN` and `TELEGRAM_CHAT_ID` are not currently read directly. The app reads them by sourcing `$HOME/code/toolbox/hooks/common.sh`. Stage 3 should either update `getTelegramCreds()` to prefer direct env vars before falling back to `common.sh`, or the container must mount a compatible `common.sh`.

### Optional

- `TMUX_SESSION=claudes-world`
- `FILES_BASE_DIR=/home/claude/claudes-world`
- `CPC_TLDR_MAX_BYTES=512000`
- `CPC_TLDR_MODEL=claude-haiku-4-5`
- `CPC_TLDR_PROMPT_VERSION=1`
- `CPC_CLAUDE_BIN=claude`
- `EARLY_HINTS=0` if early hints cause proxy/client issues
- `OTEL_TRACES_SAMPLE_RATE=0.1`

### Currently hard-coded or not configurable enough

- OpenTelemetry OTLP endpoints are hard-coded to `http://localhost:4318/v1/traces` and `/v1/metrics`. If Coolify/world-os provides a collector elsewhere, add env-configurable OTLP endpoint variables later.
- CORS/WS allowed origins are hard-coded to Telegram, `cpc.claude.do`, `cpc-dev.claude.do`, and localhost dev origins. If the successor host changes the public domain, add env-configurable allowed origins.
- Allowed file roots are hard-coded under `/home/claude`. Keeping `HOME=/home/claude` and matching mounts is the least invasive Stage 2 plan.

## 6. Risky or Unclear Items

- The external `world-os` references were not reachable from this environment, so this plan is based on the local CPC repo plus the dispatch constraints.
- The current `README.md` appears stale and describes an older Next.js/FastAPI/Docker-sandbox concept. The current code and AGENTS docs show the live app is React/Vite plus Hono.
- Host integration is the largest risk. CPC is not a self-contained web app: it reads and writes host files, shells out to tmux/git/gh/curl/claude/transcribe, and expects `/home/claude` paths.
- Tmux access from a non-root container needs careful UID and socket handling. Matching UID/GID is likely required; confirm the actual operator UID for `/srv/world/secrets/` and tmux socket ownership.
- The `BOTTOKEN`/`TELEGRAM_CHAT_ID` path is not Coolify-native yet because the helper sources `common.sh`. Prefer a small Stage 3 code change to read direct env first.
- The `claude` CLI and OAuth/keychain story inside a container is unclear. Decide whether markdown TLDR is required in the first Docker deployment or can degrade gracefully.
- The `gh` CLI auth story inside a container is unclear. Decide whether PR polling is required in the first Docker deployment or can degrade gracefully.
- The server imports `db.ts` on startup, which creates `$HOME/data` and opens SQLite immediately. The runtime user must be able to create/write `/home/claude/data`.
- The app currently has OpenTelemetry signal handlers, but the HTTP server itself is not explicitly closed on SIGTERM. For production-quality restarts, add server close handling.
- Docker build version stamping via `git describe` may return `dev` unless `.git` is present in build context. Decide whether image labels/build args should carry version instead.
- Coolify may impose its own healthcheck/reverse-proxy conventions. Ensure its generated proxy does not publish the service on `0.0.0.0`.

Questions for Liam before implementation:

- What UID/GID should the container use for `/srv/world/secrets/` and host mounts? Is `1000:1000` correct on the successor VPS?
- Should CPC in Docker talk to the host tmux session, run its own tmux session in-container, or have terminal features disabled until a later stage?
- Should `/home/claude/code`, `/home/claude/claudes-world`, `.claude`, `.world`, and `bin` be mounted read-write, read-only, or selectively?
- Should `claude`, `gh`, and `transcribe` be installed in the image, mounted from host, or handled as optional degraded features?
- Will the production domain remain `cpc.claude.do`/`cpc-dev.claude.do`, or should Stage 3 add env-configurable allowed origins?
- Does world-os expect secrets only as env vars, or are read-only secret files under `/srv/world/secrets` part of the contract for CPC?

## 7. Estimated Implementation Effort

Stage 2: Dockerfile and `.dockerignore`

- Add a root multi-stage Dockerfile.
- Build with pnpm/turbo, produce a slim non-root runtime image.
- Ensure native `better-sqlite3` dependency works on the selected Debian Node image.
- Use direct exec-form `CMD`.
- Estimated effort: 0.5-1 day including local image build/debug.

Stage 3: `compose.yml` and Coolify env schema

- Add top-level `compose.yml`.
- Bind only `127.0.0.1:38830:38830`.
- Add `init: true`, healthcheck, named data volume, and documented mount placeholders.
- Add `.env.example` or `docs/coolify-env.md` if desired by world-os/sync tooling.
- Estimated effort: 0.5 day.

Stage 4: Health endpoint and signal handling

- Add unauthenticated `GET /health`.
- Add focused tests.
- Add graceful HTTP/WebSocket server close on SIGTERM/SIGINT while preserving OpenTelemetry shutdown.
- Estimated effort: 0.5 day.

Stage 5: Secrets and host integration cleanup

- Update `getTelegramCreds()` to prefer direct `BOTTOKEN`/`TELEGRAM_CHAT_ID` env vars, fallback to `common.sh`.
- Decide and document required mounts for `/home/claude` paths, tmux socket, CLI auth, and data.
- Add startup checks or clearer degraded-mode logging for missing optional host tools.
- Estimated effort: 0.5-1 day, depending on tmux/Claude CLI decisions.

Stage 6: Verification gates

- Run unit tests for touched server routes.
- Build the image for x86_64.
- Run compose locally with dummy or real injected env.
- Verify:
  - `curl -fsS http://127.0.0.1:38830/health`
  - `curl -fsS http://127.0.0.1:38830/api/health`
  - container runs as non-root UID/GID
  - host port is loopback-only
  - SIGTERM stops the process cleanly
  - logs go to stdout/stderr
- Estimated effort: 0.5-1 day.
