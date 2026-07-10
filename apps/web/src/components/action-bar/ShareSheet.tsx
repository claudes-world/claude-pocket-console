import { BottomSheet } from "../BottomSheet";
import { InProgressAnimation } from "./InProgressAnimation";
import { btnStyle } from "./types";

type ShareScope = "public" | "private";

interface ShareSheetProps {
  viewingFile: { path: string; name: string };
  loading: boolean;
  url: string | null;
  error: string | null;
  onClose: () => void;
  onPublish: (scope: ShareScope, tmp: boolean) => void;
  onCopy: () => void;
  onOpen: () => void;
}

const modes: Array<{ label: string; scope: ShareScope; tmp: boolean }> = [
  { label: "Public", scope: "public", tmp: false },
  { label: "Public · temp", scope: "public", tmp: true },
  { label: "Private", scope: "private", tmp: false },
  { label: "Private · temp", scope: "private", tmp: true },
];

export function ShareSheet({ viewingFile, loading, url, error, onClose, onPublish, onCopy, onOpen }: ShareSheetProps) {
  return (
    <BottomSheet onClose={onClose} title="Share">
      <div style={{ fontSize: 12, color: "var(--color-fg-muted)", marginBottom: 12 }}>{viewingFile.name}</div>
      {loading ? (
        <InProgressAnimation label="Publishing…" ariaLabel="Publishing file" />
      ) : url ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "#16171f", border: "1px solid var(--color-border)", borderRadius: 8, padding: "12px 14px", fontSize: 14, color: "var(--color-accent-cyan)", wordBreak: "break-all", userSelect: "text" }}>
            {url}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={onCopy} style={{ ...btnStyle, padding: "10px 14px", background: "#1a3a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d5a5a" }}>Copy link</button>
            <button onClick={onOpen} style={{ ...btnStyle, padding: "10px 14px" }}>Open</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {error && (
            <div style={{ fontSize: 12, color: "var(--color-accent-red)", padding: "8px 10px", background: "#2a1a22", border: "1px solid #4a2d3a", borderRadius: 6 }}>{error}</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 8 }}>
            {modes.map((mode) => (
              <button
                key={mode.label}
                onClick={() => onPublish(mode.scope, mode.tmp)}
                style={{ ...btnStyle, padding: "10px 12px", background: "#1a3a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d5a5a" }}
              >
                {mode.label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-muted)", lineHeight: 1.4 }}>
            Public links work for anyone; private links require Cloudflare Access. Temp links are short-lived.
          </div>
        </div>
      )}
    </BottomSheet>
  );
}
