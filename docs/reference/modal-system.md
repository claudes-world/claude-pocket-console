# Modal System -- ActionBar

All modals are managed by `ActionBar.tsx` (880 lines). The component owns a
single `modal` state of type `Modal`.

## Modal Union Type

```typescript
type Modal = null
  | "commands"          // BottomSheet: session management commands
  | "compact-confirm"   // Centered: choose compact mode
  | "compact-focus"     // Centered: enter compact focus text
  | "continuity-notes"  // Centered: enter notes before clearing
  | "rename"            // Centered: rename session input
  | "fork-name"         // Centered: name the fork
  | "git-status"        // BottomSheet: git status/log output
  | "git-menu"          // BottomSheet: git action picker
  | "todo"              // BottomSheet: TODO.md content
  | "resume"            // BottomSheet: pick session to resume
  | "new-clear"         // Centered: clear session with optional notes
  | "file-options"      // BottomSheet: show hidden, sort mode
  | "file-search"       // BottomSheet: fuzzy file search
  | "audio-gen";        // BottomSheet: generate/send TTS audio
```

## BottomSheet vs Centered Dialog

**BottomSheet** -- slides up from bottom, swipe-to-close via header handle:
- `commands`, `git-status`, `git-menu`, `todo`, `resume`, `file-options`,
  `file-search`, `audio-gen`

**Centered dialog** -- fixed overlay with centered card, click-outside to close:
- `compact-confirm`, `compact-focus`, `continuity-notes`, `rename`,
  `fork-name`, `new-clear`

## BottomSheet Component

The `BottomSheet` function component provides:
- Overlay backdrop (`rgba(0,0,0,0.6)`)
- Background: `#1a1b26`, border-top: `#2a2b3d`, border-radius: `16px 16px 0 0`
- Max height: `70vh`
- **Drag handle** in header (36x4px bar, `#3b3d57`)
- Swipe-to-close ONLY from the header area (content scrolls independently)
- `disableVerticalSwipes()` on mount, `enableVerticalSwipes()` on cleanup
- Safe area bottom padding via `safeAreaInset.bottom`
- Slide-up animation: `slideUp 200ms ease-out`

## useSwipeDown Hook

```typescript
function useSwipeDown(onClose: () => void, threshold = 80)
```

Returns `{ sheetRef, onTouchStart, onTouchMove, onTouchEnd }`.

- Tracks vertical drag from header only
- `stopPropagation()` on all touch events to prevent Telegram minimize
- Threshold: 80px downward drag triggers close
- Animates sheet translateY during drag, snaps back or slides away

## Tab-Specific Button Rendering

The ActionBar renders different buttons based on `activeTab`:

### Always visible
- **TODO** button (amber: `#3a3520` bg, `#e0af68` text)

### Terminal tab
- **Reconnect** (green: `#1a3a2a` bg, `#9ece6a` text)
- **Git** split button (default style + dropdown arrow)
- **/commands** (purple: `#2d2a3a` bg, `#bb9af7` text)

### Files tab (browsing)
- **Search** (blue: `#2d3a5a` bg, `#7aa2f7` text)
- **Options** (default style)

### Files tab (viewing a file)
- **Send to Chat** (cyan: `#1a2a3a` bg, `#7dcfff` text)
- **Audio** (purple, only for `.md` files)

## Button Style Constants

```typescript
const btnStyle = {
  padding: "6px 12px",
  fontSize: 12,
  borderRadius: 6,
  background: "#24283b",
  color: "#a9b1d6",
  border: "1px solid #2a2b3d",
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
```

## Color Patterns for Semantic Buttons

| Meaning   | Background  | Text      | Border      |
|-----------|-------------|-----------|-------------|
| Default   | `#24283b`   | `#a9b1d6` | `#2a2b3d`   |
| Primary   | `#2d3a5a`   | `#7aa2f7` | `#3d4a6a`   |
| Success   | `#1a3a2a`   | `#9ece6a` | `#2d5a3d`   |
| Danger    | `#3a2020`   | `#f7768e` | `#5a3030`   |
| Purple    | `#2d2a3a`   | `#bb9af7` | `#4a3d6a`   |
| Amber     | `#3a3520`   | `#e0af68` | `#5a4a30`   |
| Cyan      | `#1a2a3a`   | `#7dcfff` | `#2d4a5a`   |
