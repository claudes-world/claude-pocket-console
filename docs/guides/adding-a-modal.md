# Adding a Modal to ActionBar

Step-by-step checklist for adding new modals to the ActionBar component.

## 1. Add to Modal Union Type

In `ActionBar.tsx`, add your modal name to the `Modal` type:

```typescript
type Modal = null | "commands" | ... | "your-modal";
```

## 2. Choose BottomSheet or Centered Dialog

- **BottomSheet** for scrollable content, lists, search results. Slides up
  from bottom with swipe-to-close header.
- **Centered dialog** for short forms, confirmations, text inputs. Fixed
  overlay with centered card.

## 3. Wire the Open Trigger

Add a button in the action bar area, conditional on `activeTab` if it
should only appear on certain tabs:

```typescript
{activeTab === "terminal" && (
  <button onClick={() => setModal("your-modal")} style={btnStyle}>
    Label
  </button>
)}
```

Or add it inside an existing BottomSheet (like the commands sheet) if it
is a sub-action.

## 4. Implement the Modal Content

### For BottomSheet:

```typescript
{modal === "your-modal" && (
  <BottomSheet onClose={() => setModal(null)} title="Your Title">
    {/* content here */}
  </BottomSheet>
)}
```

### For centered dialog:

```typescript
{modal === "your-modal" && (
  <div style={modalCenter} onClick={() => setModal(null)}>
    <div
      style={{
        background: "#1a1b26",
        border: "1px solid #2a2b3d",
        borderRadius: 12,
        padding: 20,
        maxWidth: 320,
        width: "100%",
      }}
      onClick={(e) => e.stopPropagation()}
    >
      {/* content here */}
    </div>
  </div>
)}
```

Place the modal JSX in the `{/* ===== MODALS ===== */}` section, before
the `{/* ===== ACTION BAR ===== */}` section.

## 5. Test Swipe-to-Close

- BottomSheet: swipe-to-close works automatically via the `useSwipeDown`
  hook on the drag handle header.
- Centered dialog: click-outside-to-close is handled by the overlay
  `onClick={() => setModal(null)}`.

## 6. Verify disableVerticalSwipes Lifecycle

- BottomSheet handles this automatically in its `useEffect`.
- If you create a custom overlay (not using BottomSheet), add:

```typescript
useEffect(() => {
  const tg = (window as any).Telegram?.WebApp;
  if (tg?.disableVerticalSwipes) tg.disableVerticalSwipes();
  return () => { if (tg?.enableVerticalSwipes) tg.enableVerticalSwipes(); };
}, []);
```

Without this, Telegram will minimize the app when users swipe down on
your modal.

## 7. Test in Actual Telegram WebView

Browser testing is not sufficient. You must verify:
- Swipe-to-close works (header only, not content area)
- Content scrolls independently in the sheet
- Telegram does not minimize when interacting with the modal
- Safe area insets are respected on devices with notches
- Touch events do not leak to tab-swipe or other handlers

Use `cpc-dev.claude.do` for testing before deploying to production.
