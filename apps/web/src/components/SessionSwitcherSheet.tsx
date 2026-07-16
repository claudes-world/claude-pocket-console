import { BottomSheet } from "./BottomSheet";
import { haptic } from "../lib/haptic";
import type { TmuxSessionInfo } from "./SessionPicker";

interface SessionSwitcherSheetProps {
  sessions: TmuxSessionInfo[];
  /** Resolved name of the session currently viewed. */
  active: string;
  /** null selects the server default (writable) session. */
  onSelect: (name: string | null) => void;
  onClose: () => void;
}

/**
 * Full-screen-reachable terminal session picker. Replaces the cramped
 * horizontal chip strip (SessionPicker) that lived under the Telegram
 * buttons: that strip had ~11px labels and 3px tap padding and scrolled
 * sideways, which made switching sessions on a phone genuinely hard.
 *
 * Here each session is a full-width row with a real tap target (~52px),
 * a status dot, the session name, and the running command as a subtitle
 * so cryptic session names are still identifiable. Same select semantics
 * as SessionPicker — the writable/default session maps to `onSelect(null)`
 * (the "view the server default" sentinel), every other name is passed
 * through literally. Selecting closes the sheet.
 */
export function SessionSwitcherSheet({ sessions, active, onSelect, onClose }: SessionSwitcherSheetProps) {
  return (
    <BottomSheet onClose={onClose} title="Switch terminal">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {sessions.map((s) => {
          const isActive = s.name === active;
          return (
            <button
              key={s.name}
              onClick={() => {
                haptic.selection();
                if (!isActive) onSelect(s.writable ? null : s.name);
                onClose();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                padding: "13px 14px",
                borderRadius: 12,
                cursor: "pointer",
                textAlign: "left",
                background: isActive ? "var(--color-surface)" : "transparent",
                border: isActive
                  ? "1px solid var(--color-accent-blue)"
                  : "1px solid var(--color-border)",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: s.alive ? "var(--color-accent-green)" : "var(--color-subtle)",
                }}
              />
              <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: 15,
                    fontWeight: isActive ? 600 : 500,
                    color: isActive ? "var(--color-fg)" : "var(--color-fg-muted)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {s.name}
                </span>
                {(s.command || !s.alive) && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--color-muted)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {s.alive ? s.command : "ended"}
                  </span>
                )}
              </span>
              {s.writable && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--color-accent-green)",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    flexShrink: 0,
                  }}
                >
                  <span aria-label="writable session">&#9998;</span>
                  writable
                </span>
              )}
              {isActive && (
                <span
                  aria-label="current session"
                  style={{ fontSize: 15, color: "var(--color-accent-blue)", flexShrink: 0 }}
                >
                  &#10003;
                </span>
              )}
            </button>
          );
        })}
      </div>
    </BottomSheet>
  );
}
