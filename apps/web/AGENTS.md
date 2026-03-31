# AGENTS.md -- CPC Frontend (apps/web)

> React SPA built with Vite. Runs inside Telegram's WebView.
> No Next.js, no Tailwind, no CSS modules. Inline styles only.

---

## Stack

- **React 18** + TypeScript
- **Vite** bundler (not Next.js, not CRA)
- **Inline styles** -- no CSS files, no styled-components, no Tailwind
- **xterm.js** for terminal rendering
- **Build:** `npx vite build` produces `dist/`

## Tokyo Night Color Palette

All colors are from the Tokyo Night theme, applied via inline style objects.

| Name            | Hex       | Usage                                   |
|-----------------|-----------|-----------------------------------------|
| Background      | `#1a1b26` | App background, modal/sheet backgrounds |
| Surface         | `#24283b` | Button default bg, input bg, code bg    |
| Border          | `#2a2b3d` | Borders, dividers                       |
| Border light    | `#3b3d57` | Drag handle, secondary borders          |
| Text primary    | `#c0caf5` | Headings, active tab text               |
| Text secondary  | `#a9b1d6` | Body text, button default text          |
| Text muted      | `#565f89` | Subtitles, descriptions, inactive tabs  |
| Blue            | `#7aa2f7` | Primary actions, active tab indicator    |
| Green           | `#9ece6a` | Success, connected status, resume       |
| Red             | `#f7768e` | Danger, disconnected, cancel            |
| Purple          | `#bb9af7` | Commands, audio actions                 |
| Amber           | `#e0af68` | TODO, warnings, folder icons            |
| Cyan            | `#7dcfff` | Send-to-chat, info actions              |

## Component Inventory

| Component              | File                         | Lines | Description                          |
|------------------------|------------------------------|-------|--------------------------------------|
| App                    | `src/App.tsx`                | 225   | Root: tabs, swipe gestures, layout   |
| ActionBar              | `src/components/ActionBar.tsx` | 880 | Command center, all modals           |
| VoiceRecorder          | `src/components/VoiceRecorder.tsx` | 478 | Record, transcribe, transcript CRUD |
| FileViewer             | `src/components/FileViewer.tsx` | 447 | Directory browser, file reader      |
| Terminal               | `src/components/Terminal.tsx`  | 160 | xterm.js WebSocket terminal viewer  |
| MarkdownViewer         | `src/components/MarkdownViewer.tsx` | 152 | Inline markdown renderer           |
| WaveformVisualizer     | `src/components/WaveformVisualizer.tsx` | 117 | Real-time audio waveform          |
| Links                  | `src/components/Links.tsx`    | 89  | Static link list                    |

## Type Declarations

`src/lib/telegram.ts` (45 lines) declares a minimal `TelegramWebApp` interface
and provides three helpers:

- `getTelegramWebApp()` -- returns `window.Telegram?.WebApp` or null
- `getInitData()` -- returns the initData string for auth
- `getAuthHeaders()` -- returns `{ Authorization: "tma <initData>" }`

**Known type gaps** (accessed via `(window as any)`):
- `disableVerticalSwipes()` / `enableVerticalSwipes()` (Bot API 7.7+)
- `safeAreaInset` object
- `sendData()`, `BackButton`, `SettingsButton`

## Inline Styles Pattern

All styling is inline via React `style` props. No CSS files except the
auto-generated Vite entry point. This was chosen because:

1. Telegram WebView caching is unpredictable -- inline styles always apply
2. Component co-location -- styles live next to the JSX they affect
3. Simplicity -- no build-time CSS processing, no class name conflicts

When adding new components, follow this pattern. Do not introduce CSS
modules, Tailwind, or any CSS-in-JS library.

## Build

```bash
cd apps/web
npx vite build
# Output: dist/
```

The server serves `dist/` via `serveStatic({ root: "../web/dist" })`.
