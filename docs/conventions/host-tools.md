# Host Tools CPC Depends On

These tools live in `~/bin/` and are part of the host infrastructure, not
the CPC codebase. CPC calls or depends on them but should never modify them.

## launcher-hook

**Path:** `~/bin/launcher-hook`
**Trigger:** Claude Code `SessionStart` hook
**Purpose:**
1. Cleans up orphaned Telegram plugin processes (`_cleanup_telegram_orphans`)
2. Initializes `.active-chat` file for project-scoped Telegram routing
3. Sends a `sendMessage` with reply keyboard to Telegram Bot API, setting
   the persistent keyboard buttons (Actions / Develop / Voice)

The keyboard buttons are defined in this script's curl payload, not in CPC
code. To change buttons, edit `launcher-hook`.

## common.sh

**Path:** `~/code/toolbox/hooks/common.sh`
**Purpose:** Shared credential loader for Telegram hooks. Sets `BOTTOKEN` and
`TELEGRAM_CHAT_ID` by checking (in order):
1. Project `.claude/.active-chat` file
2. `TELEGRAM_CHAT_ID` env var
3. `~/.secrets/telegram.env`
4. `access.json` allowFrom list

CPC's `actions.ts` calls this via `source common.sh` when it needs to send
messages to Telegram (send-to-chat, send-audio-telegram).

## session-history

**Path:** `~/bin/session-history`
**Purpose:** Forensic CLI for Claude Code JSONL session files. Commands:
- `list` -- all sessions with timestamps, sizes, titles
- `files <id>` -- files read/written in a session
- `reads <id>` / `writes <id>` -- Read or Write tool calls
- `search <pattern>` -- search all sessions for a file path
- `extract <id> <path>` -- recover file content from a session
- `diff <id> <path>` -- chronological edits to a file

## transcribe

**Path:** `~/bin/transcribe`
**Purpose:** Audio transcription via OpenAI Whisper API. Accepts a file path
argument, returns transcribed text to stdout. Called by the CPC voice route
(`routes/voice.ts`) for the voice recorder's transcription feature.

## tg-sanitize (reference only)

CPC includes an inline version of MarkdownV2 escaping in `actions.ts`
(`tgSanitize` function). The standalone `~/bin/tg-sanitize` tool is not
called by CPC directly but follows the same escaping logic.
