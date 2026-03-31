# Deploying CPC

## Quick Deploy (Preferred)

Use the `/deploy` skill in the Claude Code session. It handles build, restart,
and verification automatically.

## Manual Deploy Steps

### 1. Build the Frontend

```bash
cd ~/code/claude-pocket-console/apps/web
npx vite build
```

Output goes to `apps/web/dist/`. The server serves this directory via
`serveStatic({ root: "../web/dist" })`.

### 2. Restart the Server

```bash
fuser -k 38830/tcp
cd ~/code/claude-pocket-console/apps/server
nohup npx tsx src/index.ts > /tmp/cpc-server.log 2>&1 &
```

### 3. Verify

```bash
curl http://127.0.0.1:38830/api/public/health
# Should return: {"status":"ok"}
```

Open `https://cpc.claude.do` in Telegram to verify the frontend loads.

## Tunnel URLs

| URL                      | Purpose              |
|--------------------------|----------------------|
| `https://cpc.claude.do`     | Production         |
| `https://cpc-dev.claude.do` | Development/testing |

Both are Cloudflare tunnels via `cloudflared` pointing to `localhost:38830`.
The dev banner (yellow "DEVELOPMENT" bar) appears automatically when the
hostname includes `cpc-dev`.

## Common Issues

### Server won't start
- Check if port 38830 is already in use: `fuser 38830/tcp`
- Check secrets are present: `ls ~/.secrets/cpc.env ~/.secrets/openai.env`
- Check logs: `cat /tmp/cpc-server.log`

### Frontend shows stale content
- Rebuild: `cd apps/web && npx vite build`
- Hard refresh in Telegram: close and reopen the Mini App

### Auth failures (401/403)
- Verify `TELEGRAM_BOT_TOKEN` is set in `~/.secrets/cpc.env`
- Verify your Telegram user ID is in `ALLOWED_TELEGRAM_USERS`
- Open the Mini App from Telegram (not a direct browser visit)
