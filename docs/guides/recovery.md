# Recovery Guide

## session-history Tool

`~/bin/session-history` is a forensic CLI for Claude Code's JSONL session
history. Use it to recover lost file states and trace changes.

```bash
# List all sessions with timestamps and titles
session-history list

# List all files read/written in a session
session-history files <session-id>

# Show all Read tool calls in a session
session-history reads <session-id>

# Show all Write/Edit tool calls in a session
session-history writes <session-id>

# Search all sessions for a file path pattern
session-history search <pattern>

# Extract the last version of a file from a session
session-history extract <session-id> <file-path>

# Show all edits to a file in chronological order
session-history diff <session-id> <file-path>
```

## Git Reflog for Lost Commits

If a commit was made but the branch was moved:

```bash
cd ~/code/claude-pocket-console
git reflog
# Find the commit hash
git cherry-pick <hash>
# Or create a branch from it
git branch recovery-branch <hash>
```

## "Commit Before Experimenting" Rule

Before making experimental changes, always create a WIP commit:

```bash
git add -A
git commit -m "WIP: checkpoint before experiment"
```

This ensures you can always return to the current state via `git reflog`
or `git reset`.

Never use `git checkout -- .` or `git restore .` on uncommitted work
without explicit user approval.

## Orphan Plugin Cleanup

The `launcher-hook` script includes `_cleanup_telegram_orphans()` which
runs on every SessionStart. It finds `bun server.ts` processes from dead
Claude sessions and kills them.

If the Telegram plugin is misbehaving (duplicate messages, missed messages):

1. Check for orphans: `pgrep -af "bun.*server.ts"`
2. Kill orphans manually: `kill <pid>`
3. Restart the Claude session to trigger `launcher-hook` cleanup

## Keyboard Restoration

If the Telegram keyboard buttons disappear:

Do NOT hand-roll the keyboard JSON. The Develop and Voice buttons carry a
short-lived signed auth token in their URLs — a hardcoded copy has no token, so
the app opens but the terminal cannot authenticate and shows "disconnected".
Build the markup with the canonical helper instead:

```bash
# Source credentials + the canonical keyboard builder
. ~/code/toolbox/hooks/common.sh
. ~/code/toolbox/hooks/lib/launcher-keyboard.sh

# Re-send the exact keyboard launcher-hook sends, with a fresh auth token
curl -s -X POST "https://api.telegram.org/bot${BOTTOKEN}/sendMessage" \
  -H "Content-Type: application/json" \
  -d "$(jq -n \
        --arg chat_id "$TELEGRAM_CHAT_ID" \
        --arg text "Keyboard restored." \
        --argjson reply_markup "$(build_launcher_reply_markup "$TELEGRAM_CHAT_ID" "$BOTTOKEN")" \
        '{chat_id: $chat_id, text: $text, reply_markup: $reply_markup}')"
```

`build_launcher_reply_markup` (in `~/code/toolbox/hooks/lib/launcher-keyboard.sh`)
is the single source of truth for the button set and their URLs.

Or simply start a new Claude Code session -- `launcher-hook` will restore
the keyboard automatically.

## Server Recovery

If the CPC server crashes:

```bash
# Check if it's running
fuser 38830/tcp

# If not, restart
cd ~/code/claude-pocket-console/apps/server
nohup npx tsx src/index.ts > /tmp/cpc-server.log 2>&1 &

# Verify
curl http://127.0.0.1:38830/api/public/health
```
