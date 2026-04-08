import { BottomSheet } from "../BottomSheet";
import { btnStyle } from "./types";

const preStyle = {
  fontSize: 11,
  color: "#a9b1d6",
  background: "#24283b",
  padding: 12,
  borderRadius: 6,
  overflow: "auto",
  maxHeight: "50vh",
  whiteSpace: "pre-wrap" as const,
  wordBreak: "break-all" as const,
  fontFamily: "'SF Mono', 'Fira Code', monospace",
};

export function GitStatusSheet({ gitOutput, onClose }: { gitOutput: string; onClose: () => void }) {
  return (
    <BottomSheet onClose={onClose} title="Git Status">
      <pre style={preStyle}>{gitOutput || "Loading..."}</pre>
      <button onClick={onClose} style={{ ...btnStyle, marginTop: 12, width: "100%", padding: "10px 16px", textAlign: "center" }}>Close</button>
    </BottomSheet>
  );
}

interface GitMenuSheetProps {
  onClose: () => void;
  onViewStatus: () => void;
  onAction: (action: { label: string; command: string }) => void;
}

export function GitMenuSheet({ onClose, onViewStatus, onAction }: GitMenuSheetProps) {
  return (
    <BottomSheet onClose={onClose} title="Git">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={onViewStatus} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" }}>View Status</button>
        <button onClick={() => onAction({ label: "Check Branch", command: "branch" })} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" }}>Check Branch</button>
        <button onClick={() => onAction({ label: "View Log", command: "log" })} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" }}>View Log</button>
        <button onClick={() => onAction({ label: "Pull", command: "pull" })} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left", background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d" }}>Pull</button>
      </div>
    </BottomSheet>
  );
}
