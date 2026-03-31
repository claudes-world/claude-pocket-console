# Telegram WebView Rules

All constraints that apply when running inside Telegram's Mini App WebView.

## Initialization

On mount, the app must call:

```typescript
const tg = getTelegramWebApp();  // window.Telegram?.WebApp
if (tg) {
  tg.ready();   // Tell Telegram the app is loaded
  tg.expand();  // Expand to full screen
}
```

This happens in `App.tsx` inside a `useEffect([], [])`.

## Vertical Swipe Control (Bot API 7.7+)

Telegram allows users to swipe down to minimize the Mini App. When a modal
or bottom sheet is open, this must be disabled:

```typescript
useEffect(() => {
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.disableVerticalSwipes) tg.disableVerticalSwipes();
  return () => { if (tg?.enableVerticalSwipes) tg.enableVerticalSwipes(); };
}, []);
```

The `BottomSheet` component in `ActionBar.tsx` handles this automatically.
If you create a new overlay that covers significant screen area, add this
same pattern.

## Safe Area Insets

The `BottomSheet` reads `safeAreaInset.bottom` from the Telegram WebApp
object and applies it as bottom padding:

```typescript
const tg = (window as any).Telegram?.WebApp;
if (tg?.safeAreaInset?.bottom) setBottomOffset(tg.safeAreaInset.bottom);
```

## initData Auth Handshake

1. Telegram injects `window.Telegram.WebApp.initData` (URL-encoded string)
2. Frontend reads it via `getInitData()` in `lib/telegram.ts`
3. Every API call includes header: `Authorization: tma <initData>`
4. Server validates HMAC-SHA256 per Telegram's spec (see `auth.ts`)
5. WebSocket passes auth as query param: `?auth=<initData>`

## Camera and Media Constraints

- **`getUserMedia()` does NOT work** in Telegram WebView.
- Use `<input type="file" capture="environment">` for camera access.
- Use `<input type="file" accept="audio/*" capture>` for microphone.
- The `Camera` permission is absent from MiniKit's Permission enum.
- Audio recording in the VoiceRecorder uses `<input type="file">` fallback
  when MediaRecorder is unavailable.

## Touch Event Rules

- **Never `preventDefault()` on `touchstart`** -- breaks all native gestures.
- Telegram's WebView intercepts vertical swipes for minimize behavior.
- Use `stopPropagation()` selectively (not `preventDefault()`) to isolate
  touch zones.
- See `docs/conventions/touch-handling.md` for the three-zone model.

## Type Declarations

`lib/telegram.ts` declares a minimal `TelegramWebApp` interface. Known gaps:
- `disableVerticalSwipes()` / `enableVerticalSwipes()` are not in the type
  (accessed via `(window as any).Telegram?.WebApp`)
- `safeAreaInset` is not typed (same workaround)
- `MainButton` is typed but not currently used

## Dev vs Prod Detection

```typescript
const isDev = window.location.hostname.includes("cpc-dev");
```

When running on `cpc-dev.claude.do`, a yellow "DEVELOPMENT" banner appears
at the top of the app.
