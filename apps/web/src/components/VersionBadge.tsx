/**
 * Branch + version indicator (terminal switcher v2, WORLD-416 §3.1).
 *
 * Two render modes, decided by how much Telegram fullscreen chrome exists:
 *
 * - **Band badge** — when the Telegram content safe area is tall enough to
 *   be a real chrome band (`contentInset >= 24`), the info floats centered
 *   inside that band, between Telegram's native Close and "⋯" pills, out of
 *   the document flow entirely. The old in-flow row disappears and the
 *   terminal gains its height.
 * - **Fallback row** — outside fullscreen (desktop browser, old Telegram,
 *   collapsed mini app) the band doesn't exist, so the pre-v2 in-flow
 *   bordered row renders unchanged. The info never disappears.
 *
 * WORLD-417 (future): the badge becomes a tappable host switcher. The
 * interactivity boundary is prepared here — the band wrapper is inert
 * (`pointerEvents: "none"`, so taps near Telegram's pills always reach
 * Telegram), while the inner badge element is a separate node that can turn
 * into a <button> with `pointerEvents: "auto"` without any parent changing.
 * Nothing outside this component may assume the badge is non-interactive.
 */

// Band rendering requires a real chrome band. Telegram's content safe area
// is ~46px in fullscreen on phones; anything under 24px is either zero
// (non-Telegram, not fullscreen) or too thin to center 10px text in.
export const BAND_MIN_CONTENT_INSET = 24;

interface VersionBadgeProps {
  /** current git branch of the CPC checkout, null while loading */
  branch: string | null;
  /** app version string (__APP_VERSION__) */
  version: string;
  /** device safe-area top inset (notch band) — the band sits below it */
  deviceInset: number;
  /** Telegram content safe-area top inset — the chrome band's height */
  contentInset: number;
  /** dev deployment marker (▲ dev prefix) */
  isDev: boolean;
  /** whether the non-fullscreen fallback row may occupy flow
   *  (terminal tab only, matching the pre-v2 row's visibility) */
  fallbackVisible: boolean;
}

export function VersionBadge({
  branch,
  version,
  deviceInset,
  contentInset,
  isDev,
  fallbackVisible,
}: VersionBadgeProps) {
  if (contentInset >= BAND_MIN_CONTENT_INSET) {
    return (
      <div
        data-testid="version-badge-band"
        style={{
          position: "absolute",
          top: deviceInset,
          left: 0,
          right: 0,
          height: contentInset,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Inert wrapper: taps in the band belong to Telegram's pills.
          pointerEvents: "none",
          zIndex: 10,
        }}
      >
        {/* The future WORLD-417 host-switcher boundary: this node (not the
            band) becomes interactive, with its own pointerEvents: "auto". */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--color-muted)",
            letterSpacing: "0.04em",
            whiteSpace: "nowrap",
          }}
        >
          {isDev && <span style={{ color: "var(--color-accent-yellow)", fontWeight: 700 }}>&#9650; dev</span>}
          <span>CPC</span>
          {branch && (
            <>
              <span aria-hidden="true">&middot;</span>
              {/* ~96px reserved each side clears Telegram's pills across
                  locales — Telegram exposes no pill geometry, so this is a
                  safe constant, not a queryable value. */}
              <span
                style={{
                  maxWidth: "calc(100vw - 200px)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {branch}
              </span>
            </>
          )}
          <span aria-hidden="true">&middot;</span>
          {/* __APP_VERSION__ comes from `git describe` and already carries
              its "v" prefix (v1.17.0[-N-ghash]) — don't add another. */}
          <span>{version}</span>
        </span>
      </div>
    );
  }

  if (!fallbackVisible || !branch) return null;

  // Pre-v2 in-flow row, unchanged: bordered strip under the tab header.
  return (
    <div
      data-testid="version-badge-row"
      style={{
        fontSize: 11,
        color: "var(--color-muted)",
        padding: "3px 14px",
        borderBottom: "1px solid var(--color-border)",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
      }}
    >
      <span>Claude Pocket Console: {branch}</span>
      <span style={{ marginLeft: "auto", color: "var(--color-subtle)" }}>{version}</span>
    </div>
  );
}
