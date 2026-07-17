import type { TmuxSessionInfo } from "../lib/session-meta";

/**
 * One 52px row of the session dock's expanded list (WORLD-416 §3.3).
 *
 * The dot+name cluster is the FLIP shared element — it must stay ONE node
 * (the chip's label flies to exactly this cluster's position), so the
 * subtitle lives on its own line below, indented to align under the name.
 * Everything except the cluster is "furniture": it fades in late during the
 * morph (p 0.5→1), which is why the subtitle and the right-mark cluster
 * register themselves with the dock.
 *
 * PR-E extends this row with the host rail/ring, harness glyph, and the
 * Telegram group›topic badge.
 */

/** dot column (9px) + gap (8px) — the subtitle indents by this to sit under
 *  the name. */
const NAME_INDENT = 17;

interface SessionListRowProps {
  session: TmuxSessionInfo;
  isActive: boolean;
  onSelect: (session: TmuxSessionInfo) => void;
  /** FLIP registration: the flying dot+name cluster */
  registerLabel: (name: string, el: HTMLElement | null) => void;
  /** morph registration: late-fading furniture nodes, keyed per node */
  registerFurniture: (name: string, key: string, el: HTMLElement | null) => void;
}

export function SessionListRow({
  session: s,
  isActive,
  onSelect,
  registerLabel,
  registerFurniture,
}: SessionListRowProps) {
  return (
    <button
      type="button"
      data-testid="session-row"
      aria-current={isActive || undefined}
      onClick={() => onSelect(s)}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 3,
        width: "100%",
        height: 52,
        padding: "0 14px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        flexShrink: 0,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 0, width: "100%" }}>
        {/* FLIP shared element: dot + name, one node. */}
        <span
          ref={(el) => registerLabel(s.name, el)}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, minWidth: 0 }}
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
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 15,
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--color-fg)" : "var(--color-fg-muted)",
              whiteSpace: "nowrap",
              // Badges truncate first, the name never does in their favor
              // (§3.3) — but a name alone longer than the row still needs
              // an ellipsis rather than an overflow.
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {s.name}
          </span>
        </span>
        <span
          ref={(el) => registerFurniture(s.name, "marks", el)}
          style={{
            marginLeft: "auto",
            paddingLeft: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            flexShrink: 0,
          }}
        >
          {s.writable && (
            <span aria-label="writable session" style={{ fontSize: 12, color: "var(--color-accent-green)" }}>
              &#9998;
            </span>
          )}
          {isActive && (
            <span aria-label="current session" style={{ fontSize: 14, color: "var(--color-accent-blue)" }}>
              &#10003;
            </span>
          )}
        </span>
      </span>
      <span
        ref={(el) => registerFurniture(s.name, "subtitle", el)}
        style={{
          paddingLeft: NAME_INDENT,
          fontSize: 11,
          color: "var(--color-muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          minHeight: 13,
        }}
      >
        {s.alive ? s.command : "ended"}
      </span>
    </button>
  );
}
