interface InProgressAnimationProps {
  /** Main label shown under the spinner (e.g. "Generating summary…"). */
  label: string;
  /** Optional smaller hint underneath (e.g. "typically 15-20 seconds"). */
  hint?: string;
  /** Accessible name for the role=status region. Defaults to `label`. */
  ariaLabel?: string;
}

/**
 * Loading animation shared across modals that wait on a slow LLM/backend
 * call (TL;DR generation, audio generation). Pure CSS keyframes — no new
 * deps. Three signals so the UI never looks frozen: (1) a rotating teal
 * spinner, (2) a pulsing label, and (3) three bouncing dots. Tokyo Night
 * palette: bg #1a1b26, text #c0caf5, accent #7dcfff. Honors
 * `prefers-reduced-motion`.
 */
export function InProgressAnimation({ label, hint, ariaLabel }: InProgressAnimationProps) {
  return (
    <>
      <style>{`
        @keyframes inprogress-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes inprogress-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
        @keyframes inprogress-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
          40%           { transform: translateY(-4px); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          [data-inprogress-spinner], [data-inprogress-label], [data-inprogress-dot] {
            animation: none !important;
          }
          [data-inprogress-spinner] { border-top-color: #7dcfff; }
          [data-inprogress-label]   { opacity: 1; }
          [data-inprogress-dot]     { opacity: 0.9; }
        }
      `}</style>
      <div
        role="status"
        aria-live="polite"
        aria-label={ariaLabel ?? label}
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "28px 16px",
          minHeight: 140,
        }}
      >
        <div
          data-inprogress-spinner=""
          aria-hidden="true"
          style={{
            width: 32,
            height: 32,
            borderRadius: "50%",
            border: "3px solid #2a2b3d",
            borderTopColor: "#7dcfff",
            animation: "inprogress-spin 0.9s linear infinite",
          }}
        />
        <div
          data-inprogress-label=""
          style={{
            fontSize: 13,
            color: "#c0caf5",
            animation: "inprogress-pulse 1.6s ease-in-out infinite",
          }}
        >
          {label}
        </div>
        <div aria-hidden="true" style={{ display: "flex", gap: 5 }}>
          {[0, 0.15, 0.3].map((delay) => (
            <span
              key={delay}
              data-inprogress-dot=""
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "#7dcfff",
                animation: `inprogress-bounce 1.2s ease-in-out ${delay}s infinite`,
              }}
            />
          ))}
        </div>
        {hint && (
          <div style={{ fontSize: 11, color: "#a9b1d6" }}>{hint}</div>
        )}
      </div>
    </>
  );
}
