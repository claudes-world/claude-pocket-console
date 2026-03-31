# Architecture -- Component Ownership Map

## System Diagram

```
Telegram App
  └── WebView (cpc.claude.do)
        └── React SPA (apps/web)
              ├── Terminal tab ──── WebSocket ──── CPC Server (apps/server)
              ├── Files tab ─────── REST API ────── CPC Server
              ├── Links tab ──────────────────────── (static content)
              └── Voice tab ─────── REST API ────── CPC Server ──── OpenAI Whisper
                                        │
                                        ├── tmux capture-pane (terminal)
                                        ├── filesystem (files)
                                        ├── SQLite ~/data/cpc-voice.db (voice)
                                        └── Telegram Bot API (send-to-chat, audio)
```

## CPC Server (Hono on port 38830)

**Owner:** `apps/server/src/index.ts`

The server does everything:
- Serves the static frontend from `../web/dist` via `serveStatic`
- Provides REST API routes under `/api/*`
- Hosts a WebSocket endpoint at `/ws/terminal`
- Validates Telegram `initData` via HMAC-SHA256 middleware

### Route Files

| File                 | Mount Point        | Purpose                                      |
|----------------------|--------------------|----------------------------------------------|
| `routes/actions.ts`  | `/api/actions/*`   | Tmux commands, git, compact, rename, TTS, Telegram send |
| `routes/files.ts`    | `/api/files/*`     | Directory listing, file read, search, upload  |
| `routes/terminal.ts` | `/ws/terminal`     | WebSocket: tmux capture-pane every 500ms      |
| `routes/voice.ts`    | `/api/voice/*`     | Transcription via ~/bin/transcribe, CRUD for transcripts |

### Auth Flow

1. Frontend calls `getInitData()` from `telegram.ts`
2. Passes it as `Authorization: tma <initData>` header
3. `middleware.ts` validates HMAC-SHA256 against `TELEGRAM_BOT_TOKEN`
4. Checks user ID against `ALLOWED_TELEGRAM_USERS` allowlist
5. WebSocket auth: `initData` passed as `?auth=` query parameter, validated in `auth.ts`

## Frontend (React SPA)

**Owner:** `apps/web/src/App.tsx`

Four swipeable tabs in a horizontal strip:

| Tab        | Component          | Lines | Description                              |
|------------|--------------------|-------|------------------------------------------|
| terminal   | `Terminal.tsx`     | 160   | xterm.js-rendered tmux capture output    |
| files      | `FileViewer.tsx`   | 447   | Directory browser with file reading      |
| links      | `Links.tsx`        | 89    | Static link list                         |
| voice      | `VoiceRecorder.tsx`| 478   | Audio record, transcribe, transcript CRUD|

Supporting components:
- `ActionBar.tsx` (880 lines) -- command center with tab-specific buttons and modals
- `MarkdownViewer.tsx` (152 lines) -- inline markdown rendering for file viewer
- `WaveformVisualizer.tsx` (117 lines) -- real-time audio waveform display

## Keyboard (EXTERNAL)

**Owner:** `~/bin/launcher-hook`

The Telegram reply keyboard (Actions / Develop / Voice buttons) is set by a
curl call to the Bot API in `launcher-hook`. It runs on `SessionStart` hook.
CPC has no control over or awareness of the keyboard.

## Telegram Plugin (EXTERNAL)

**Owner:** Host system (`~/.claude/plugins/marketplaces/...`)

The Telegram bot polling plugin is a separate bun process managed by Claude
Code's plugin system. CPC does not start, stop, or configure it. The
`launcher-hook` script cleans up orphaned plugin processes from dead sessions.
