import { btnStyle, modalCenter } from "./types";

interface RenameModalProps {
  value: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}

export function RenameModal({ value, onChange, onBack, onSubmit }: RenameModalProps) {
  return (
    <div style={modalCenter} onClick={onBack}>
      <div style={{ background: "#1a1b26", border: "1px solid #2a2b3d", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#c0caf5" }}>Rename Session</div>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Session name..."
          style={{ width: "100%", padding: 10, background: "#24283b", color: "#c0caf5", border: "1px solid #3b3d57", borderRadius: 6, fontSize: 13, fontFamily: "inherit" }}
          autoFocus
          onKeyDown={(e) => e.key === "Enter" && onSubmit()}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={onBack} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2a2a", color: "#f7768e", border: "1px solid #5a3d3d" }}>Back</button>
          <button onClick={onSubmit} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a" }}>Rename</button>
        </div>
      </div>
    </div>
  );
}
