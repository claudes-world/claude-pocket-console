# Touch Handling Conventions

CPC runs inside Telegram's WebView where touch events are shared between
the app, the WebView container, and Telegram's own gestures. Getting touch
handling wrong breaks the entire app.

## Three Touch Zones

### 1. Tab Strip (App.tsx header)

The `<header>` element calls `e.stopPropagation()` on `touchstart` to
prevent the tab-swipe handler from firing when users tap tabs.

### 2. Content Area (App.tsx main viewport)

The content `<div>` handles horizontal swipe gestures for tab switching:
- `handleTouchStart` records start position
- `handleTouchMove` tracks drag offset (horizontal only, must be > 1.2x
  vertical to engage)
- `handleTouchEnd` commits tab switch if `dx > SWIPE_THRESHOLD` (120px)
  and horizontal dominance (`dx > dy * 1.5`)
- Drag offset provides real-time visual feedback via CSS transform

### 3. BottomSheet Header (ActionBar.tsx)

The `useSwipeDown` hook handles vertical swipe-to-close:
- ONLY fires from the header/drag-handle area
- `stopPropagation()` on all three touch events
- Threshold: 80px downward drag
- Animates translateY during drag, snaps back or slides away

### 4. ActionBar (App.tsx wrapper)

The `<div>` wrapping `<ActionBar>` calls `e.stopPropagation()` on
`touchstart` to prevent tab-swipe from firing on action buttons.

## Rules

### Never preventDefault on touchstart

```typescript
// BAD -- breaks ALL Telegram gestures
element.addEventListener("touchstart", (e) => e.preventDefault(), { passive: false });

// GOOD -- isolates without breaking native behavior
element.addEventListener("touchstart", (e) => e.stopPropagation());
```

`preventDefault` on `touchstart` disables scrolling, Telegram's minimize
gesture, and all native touch behavior. Always use `stopPropagation`
instead.

### Why passive:false Is Dangerous

Adding `{ passive: false }` to touch listeners tells the browser "I might
call preventDefault()". In Telegram's WebView, this can:
- Trigger jank warnings
- Block the compositor thread
- Break Telegram's own gesture handling

Only use `passive: false` if you have a proven need AND have tested in
the actual Telegram WebView on both iOS and Android.

### SWIPE_THRESHOLD = 120px

Defined in `App.tsx`. This is intentionally high to avoid accidental tab
switches during vertical scrolling. The 1.2x and 1.5x horizontal dominance
checks provide additional protection.

### Content Scrolling Must Work

BottomSheet content area does NOT have touch handlers -- it scrolls via
`overflowY: auto`. Only the header has `onTouchStart`/`onTouchMove`/
`onTouchEnd`. This separation is critical: users must be able to scroll
long lists inside sheets without accidentally closing them.
