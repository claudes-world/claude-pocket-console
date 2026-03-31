# Off-Limits -- Things Agents Must Never Modify

## Telegram Plugin Directory

**Path:** `~/.claude/plugins/marketplaces/claude-plugins-official/external_plugins/telegram/`

**Why:** This is a shared plugin managed by the host system. Editing it can
break Telegram bot polling for all sessions. The plugin auto-updates and
any local changes will be overwritten or cause conflicts.

**Instead:** If the plugin is misbehaving, report the issue to the user.
If orphaned processes are the problem, use `launcher-hook`'s cleanup or
manually kill the orphaned `bun server.ts` processes.

## launcher-hook and common.sh

**Paths:**
- `~/bin/launcher-hook`
- `~/code/toolbox/hooks/common.sh`

**Why:** These are host infrastructure scripts used by multiple projects,
not just CPC. Changing them affects all Claude Code sessions.

**Instead:** If CPC needs different keyboard buttons or credential loading,
implement the change in CPC's own code (e.g., a CPC-specific API endpoint)
rather than modifying the shared scripts.

## Secrets Directory

**Path:** `~/.secrets/`

**Why:** Contains bot tokens, API keys, and other credentials. Never read
these files for display purposes, never log their contents, never include
them in commits or documentation.

**Instead:** Reference secrets by their env var names (`TELEGRAM_BOT_TOKEN`,
`OPENAI_API_KEY`, `ALLOWED_TELEGRAM_USERS`). The server loads them at
startup from `~/.secrets/cpc.env` and `~/.secrets/openai.env`.

## Cloudflare Tunnel Config

**Path:** `/etc/cloudflared/config.yml`

**Why:** Manages all tunnels on the host (`cpc.claude.do`, `cpc-dev.claude.do`,
`shared.claude.do`, etc.). Incorrect changes can take down all tunneled
services.

**Instead:** If a new tunnel is needed, ask the user. If the existing tunnel
is not working, check `systemctl status cloudflared` and report the status.

## systemd Service Files

**Paths:** `/etc/systemd/system/cloudflared.service` and similar

**Why:** System service configuration. Changes require root and affect
host stability.

**Instead:** Report service issues to the user and suggest the fix. Do not
attempt to edit service files directly.
