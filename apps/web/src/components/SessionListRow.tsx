import {
  formatTgBadge,
  harnessOf,
  hostColor,
  type TmuxSessionInfo,
} from "../lib/session-meta";

/**
 * One 52px row of the session dock's expanded list (WORLD-416 §3.3).
 *
 * ```
 * │▌ ● claudes-world            ✳ ✎ ✓ │   ▌ = 3px host rail (host color)
 * │   claude · do-box › cpc-1         │   ● = alive dot, host ring
 * ```
 *
 * The dot+name cluster is the FLIP shared element — it must stay ONE node
 * (the chip's label flies to exactly this cluster's position), so the
 * subtitle lives on its own line below, indented to align under the name.
 * Everything except the cluster is "furniture": it fades in late during the
 * morph (p 0.5→1), which is why the subtitle and the right-mark cluster
 * register themselves with the dock.
 *
 * Host rails render only when the roster spans >1 host (§3.4
 * suppress-until-two-hosts); the dot's host ring stays on whenever the host
 * is known. Green/red are never used for host identity.
 */

/** rail slot (3px + 6px gap when present) + dot column (9px) + gap (8px) —
 *  the subtitle indents by the dot+gap to sit under the name. */
const NAME_INDENT = 17;

interface SessionListRowProps {
  session: TmuxSessionInfo;
  isActive: boolean;
  /** roster spans more than one host → rails + host grouping are on */
  multiHost: boolean;
  onSelect: (session: TmuxSessionInfo) => void;
  /** FLIP registration: the flying dot+name cluster */
  registerLabel: (name: string, el: HTMLElement | null) => void;
  /** morph registration: late-fading furniture nodes, keyed per node */
  registerFurniture: (name: string, key: string, el: HTMLElement | null) => void;
}

const HARNESS_GLYPHS: Record<"claude" | "codex", { glyph: string; color: string; label: string }> = {
  // ✳ in Tokyo Night orange — the closest neighbor to Anthropic coral.
  claude: { glyph: "✳", color: "var(--color-accent-orange)", label: "claude harness" },
  codex: { glyph: "⌬", color: "var(--color-accent-cyan)", label: "codex harness" },
};

export function SessionListRow({
  session: s,
  isActive,
  multiHost,
  onSelect,
  registerLabel,
  registerFurniture,
}: SessionListRowProps) {
  const host = s.host ? hostColor(s.host) : null;
  const harness = harnessOf(s);
  const badge = formatTgBadge(s);
  return (
    <button
      type="button"
      data-testid="session-row"
      aria-current={isActive || undefined}
      onClick={() => onSelect(s)}
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: 3,
        width: "100%",
        height: 52,
        padding: multiHost ? "0 14px 0 23px" : "0 14px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        flexShrink: 0,
      }}
    >
      {/* Host rail — the strongest scannable signal once a second host
          exists; suppressed while the fleet is single-host. */}
      {multiHost && host && (
        <span
          data-testid="host-rail"
          aria-hidden="true"
          style={{
            position: "absolute",
            left: 8,
            top: 6,
            bottom: 6,
            width: 3,
            borderRadius: 2,
            background: host,
          }}
        />
      )}
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
              boxShadow: host ? `0 0 0 1.5px ${host}` : undefined,
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
          {harness && (
            <span
              aria-label={HARNESS_GLYPHS[harness].label}
              style={{ fontSize: 13, color: HARNESS_GLYPHS[harness].color, lineHeight: 1 }}
            >
              {HARNESS_GLYPHS[harness].glyph}
            </span>
          )}
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
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {s.alive ? (
          <>
            <span>{harness ?? s.command}</span>
            {badge && (
              <>
                <span aria-hidden="true">&middot;</span>
                {/* Tinted pill: host color at 12% over transparent, text at
                    80% — group association reads at a glance. */}
                <span
                  data-testid="tg-badge"
                  style={{
                    padding: "1px 6px",
                    borderRadius: 999,
                    background: host
                      ? `color-mix(in srgb, ${host} 12%, transparent)`
                      : "var(--color-surface)",
                    color: host
                      ? `color-mix(in srgb, ${host} 80%, transparent)`
                      : "var(--color-fg-muted)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {badge}
                </span>
              </>
            )}
          </>
        ) : (
          "ended"
        )}
      </span>
    </button>
  );
}
