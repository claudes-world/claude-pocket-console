# Deploying CPC

## Quick Deploy (Preferred)

Use the `/deploy` skill in the Claude Code session. It handles build, restart,
and verification automatically.

## Manual Deploy Steps

### 1. Build the Frontend

```bash
cd ~/code/claude-pocket-console
npx turbo build
```

Output goes to `apps/web/dist/`. The server serves this directory using an
absolute path resolved from `__dirname`.

**Important:** The version displayed in the UI comes from `git describe --tags`
at build time (via Vite `define`). Always tag the release BEFORE building so the
correct version is baked in.

### 2. Restart the Servers

**Production** (port 38830):
```bash
fuser -k 38830/tcp
cd ~/code/claude-pocket-console
nohup npx tsx apps/server/src/index.ts > /tmp/cpc-server.log 2>&1 &
```

**Development** (port 38831):
```bash
fuser -k 38831/tcp
cd ~/code/claude-pocket-console
PORT=38831 nohup npx tsx apps/server/src/index.ts > /tmp/cpc-dev-server.log 2>&1 &
```

**Note:** The `cd` into the repo dir is required — the server resolves static
file paths relative to `__dirname` which depends on the source location.

### 3. Verify

```bash
curl https://cpc.claude.do/api/health         # prod
curl https://cpc.claude.do/dev/api/health      # dev
```

Both should return `{"status":"ok"}`.

## URL Routing

All traffic enters via Cloudflare tunnel → Caddy on `:18080` → reverse proxy.

| URL                           | Caddy Route       | Backend           |
|-------------------------------|-------------------|-------------------|
| `https://cpc.claude.do/*`     | default           | localhost:38830   |
| `https://cpc.claude.do/dev/*` | handle_path /dev/ | localhost:38831   |

Caddy strips the `/dev/` prefix before proxying, so the dev server receives
requests at `/` just like prod. No code changes needed.

### Why same domain?

The Telegram Login Widget (`/setdomain` in BotFather) only allows **one domain
per bot**. By serving dev under `/dev/` on the same domain, both prod and dev
can use the Login Widget for fallback auth when `initData` is unavailable.

### Keyboard buttons

Managed by `~/bin/launcher-hook` (runs on SessionStart). Current buttons:
- ⚡️Actions — plain text (reserved)
- 📱Develop — opens `https://cpc.claude.do/dev/`
- 🎙️Voice — opens `https://cpc.claude.do/#voice`

### Dev banner

The yellow "DEVELOPMENT" banner appears when the hostname includes `cpc-dev`.
Since dev is now served from cpc.claude.do/dev/ (same hostname), update the
detection if needed — currently checks `window.location.hostname`.

## Release Process

1. Merge `dev` → `main`
2. Tag: `git tag vX.Y.Z`
3. Push: `git push origin main --tags`
4. Build: `npx turbo build --force` (must be AFTER tagging)
5. Restart prod server
6. Verify health check
7. Switch back to dev: `git checkout dev`

**Rule:** Only deploy to production using tagged semver releases on main.

## Infrastructure

- **Cloudflare tunnel:** `cpc.claude.do` → Caddy `:18080`
- **Caddy config:** `/etc/caddy/Caddyfile` (look for `@cpc host cpc.claude.do`)
- **Cloudflared config:** `/etc/cloudflared/config.yml`
- **Bot domain (BotFather):** `cpc.claude.do` (for Login Widget)

## Common Issues

### Server won't start
- Check if port is in use: `fuser 38830/tcp`
- Check secrets: `ls ~/.secrets/cpc.env`
- Check logs: `cat /tmp/cpc-server.log`

### Frontend shows stale content
- Rebuild: `npx turbo build --force`
- Hard refresh in Telegram: close and reopen the Mini App

### Auth failures (401/403)
- Verify `TELEGRAM_BOT_TOKEN` is set in `~/.secrets/cpc.env`
- Verify your Telegram user ID is in `ALLOWED_TELEGRAM_USERS`
- Open the Mini App from Telegram (not a direct browser visit)
- If opened from keyboard button: Login Widget should appear as fallback

### Version shows wrong number
- Tag was created AFTER the build — rebuild with `npx turbo build --force`
