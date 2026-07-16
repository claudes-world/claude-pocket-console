import { haptic } from "../lib/haptic";

/** Shape served by GET /api/terminal/sessions (see apps/server/src/routes/terminal/sessions.ts). */
export interface TmuxSessionInfo {
  name: string;
  attached: boolean;
  activity: number;
  command: string;
  alive: boolean;
  writable: boolean;
}

interface SessionPickerProps {
  sessions: TmuxSessionInfo[];
  /** Resolved name of the session currently viewed. */
  active: string;
  /** null selects the server default (writable) session. */
  onSelect: (name: string | null) => void;
}

/**
 * Horizontal pill strip above the terminal for switching which tmux session
 * the terminal tab views. Server order is preserved (writable default
 * first, then most recently active). The writable session carries a pencil
 * mark; every other session gets the restricted palette (the ActionBar
 * communicates this separately) — not the full command set, but not strictly
 * view-only either (gated free-text is allowed, Option A). Only rendered when
 * there's actually a choice to make (App.tsx hides it for 0-1 sessions).
 */
export function SessionPicker({ sessions, active, onSelect }: SessionPickerProps) {
  return (
    <div
      data-testid="session-picker"
      style={{
        display: "flex",
        gap: 6,
        padding: "6px 12px",
        overflowX: "auto",
        // Fills the row to the right of the list-view button (App.tsx owns the
        // row's bottom border). flex:1 + minWidth:0 lets the strip scroll
        // horizontally within the remaining width instead of pushing the button
        // off-screen.
        flex: 1,
        minWidth: 0,
        // Momentum scrolling in the Telegram WebView
        WebkitOverflowScrolling: "touch",
      }}
      // The tab strip swipes between tabs on horizontal drag; scrolling the
      // pill strip must not also swipe the tab. Same stopPropagation
      // pattern as the header/action bar in App.tsx.
      onTouchStart={(e) => e.stopPropagation()}
    >
      {sessions.map((s) => {
        const isActive = s.name === active;
        return (
          <button
            key={s.name}
            onClick={() => {
              if (isActive) return;
              haptic.selection();
              onSelect(s.writable ? null : s.name);
            }}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 10px",
              fontSize: 11,
              whiteSpace: "nowrap",
              flexShrink: 0,
              borderRadius: 999,
              cursor: "pointer",
              background: isActive ? "var(--color-surface)" : "none",
              color: isActive ? "var(--color-fg)" : "var(--color-muted)",
              border: isActive
                ? "1px solid var(--color-accent-blue)"
                : "1px solid var(--color-border)",
              fontWeight: isActive ? 600 : 400,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                flexShrink: 0,
                background: s.alive ? "var(--color-accent-green)" : "var(--color-subtle)",
                display: "inline-block",
              }}
            />
            {s.name}
            {s.writable && <span aria-label="writable session">&#9998;</span>}
          </button>
        );
      })}
    </div>
  );
}
