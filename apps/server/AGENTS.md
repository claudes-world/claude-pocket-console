# AGENTS.md -- CPC Server (apps/server)

> Hono HTTP + WebSocket server on port 38830. Serves API, WebSocket terminal,
> and static frontend. Auth via Telegram initData HMAC-SHA256.

---

## Stack

- **Hono** web framework
- **@hono/node-server** for Node.js HTTP serving
- **@hono/node-ws** for WebSocket support
- **better-sqlite3** for voice transcript storage
- **tsx** for TypeScript execution (`npx tsx src/index.ts`)

## Source Files

| File                    | Lines | Purpose                                        |
|-------------------------|-------|------------------------------------------------|
| `src/index.ts`          | 63    | App setup, middleware, route mounting, serve    |
| `src/auth.ts`           | 71    | initData HMAC-SHA256 validation, allowlist      |
| `src/middleware.ts`     | 41    | Hono middleware: extract and validate auth      |
| `src/db.ts`             | 37    | SQLite setup (~/data/cpc-voice.db), WAL mode   |
| `src/routes/actions.ts` | 347   | Tmux commands, git, compact, TTS, Telegram send|
| `src/routes/files.ts`   | 242   | Directory list, file read, search, upload       |
| `src/routes/terminal.ts`| 103   | WebSocket: tmux capture-pane every 500ms        |
| `src/routes/voice.ts`   | 202   | Transcription, transcript CRUD                  |

## Route Structure

### Public (no auth)
- `GET /api/public/health` -- health check
- `GET /api/health` -- backward-compat health check

### Protected (Telegram auth required)
- `POST /api/actions/reload-plugins`
- `GET|POST /api/actions/git-status`
- `POST /api/actions/resize-terminal`
- `POST /api/actions/send-keys` -- send keystrokes to tmux
- `POST /api/actions/git-command` -- branch, log, pull, status
- `GET /api/actions/todo` -- read TODO.md
- `POST /api/actions/compact` -- send compact command to tmux
- `POST /api/actions/rename-session`
- `GET /api/actions/session-names`
- `GET /api/actions/check-audio` -- check if TTS mp3 exists
- `POST /api/actions/generate-audio` -- generate TTS via OpenAI
- `POST /api/actions/send-audio-telegram` -- send mp3 to Telegram chat
- `POST /api/actions/send-to-chat` -- share file path to Telegram
- `GET /api/files/roots` -- list allowed root directories
- `GET /api/files/list` -- directory contents
- `GET /api/files/read` -- file content
- `GET /api/files/search` -- fuzzy BFS file search
- `POST /api/files/upload` -- upload file
- `POST /api/voice/transcribe` -- audio transcription via ~/bin/transcribe
- `POST /api/voice/transcripts` -- create transcript
- `GET /api/voice/transcripts` -- list transcripts
- `GET /api/voice/transcripts/:id` -- get single transcript
- `PATCH /api/voice/transcripts/:id` -- update transcript
- `DELETE /api/voice/transcripts/:id` -- soft delete transcript

### WebSocket
- `GET /ws/terminal` -- tmux capture-pane stream (auth via `?auth=` query)

### Static
- `GET /*` -- serves `../web/dist` (frontend build output)

## Auth Middleware

`middleware.ts` runs on all `/api/*` routes (except public health checks):

1. Reads `Authorization: tma <initData>` header
2. Validates HMAC-SHA256 per Telegram Mini App spec
3. Checks user ID against `ALLOWED_TELEGRAM_USERS` allowlist
4. Sets `telegramUser` context for downstream routes

WebSocket auth is handled separately in `auth.ts` via `checkAuth()`.

## Secrets

| Env Var                   | Source                    | Used By        |
|---------------------------|---------------------------|----------------|
| `TELEGRAM_BOT_TOKEN`      | `~/.secrets/cpc.env`      | Auth validation|
| `ALLOWED_TELEGRAM_USERS`  | `~/.secrets/cpc.env`      | User allowlist |
| `OPENAI_API_KEY`          | `~/.secrets/openai.env`   | TTS, transcribe|
| `BOTTOKEN`                | `common.sh` (via shell)   | Telegram sends |
| `TELEGRAM_CHAT_ID`        | `common.sh` (via shell)   | Telegram sends |

The server loads `~/.secrets/cpc.env` at startup via `loadEnv()`. OpenAI key
is loaded separately in `actions.ts` and `voice.ts`.

## Tmux Integration

The server interacts with the tmux session `claudes-world` (configurable via
`TMUX_SESSION` env var):

- **Terminal route:** `tmux capture-pane -t <session> -p -e -J` every 500ms
- **Actions route:** `tmux send-keys -t <session>` to inject commands
- **Note:** The mini app is a read-only terminal viewer. It never resizes
  tmux -- resize requests from the WebSocket client are ignored.

## File Access

`files.ts` restricts file access to these allowed roots:
- `/home/claude/claudes-world`
- `/home/claude/code`
- `/home/claude/bin`
- `/home/claude/.claude`
- `/home/claude/claudes-world/.claude`

Files > 1MB are rejected. Binary files are detected and rejected.

## Static Serving

The frontend is served from `../web/dist` via Hono's `serveStatic`. This
is a catch-all route (`/*`) that runs after all API routes.
