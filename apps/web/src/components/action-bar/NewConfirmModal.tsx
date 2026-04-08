import { btnStyle, modalCenter } from "./types";

interface NewConfirmModalProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export function NewConfirmModal({ onCancel, onConfirm }: NewConfirmModalProps) {
  return (
    <div style={modalCenter} onClick={onCancel}>
      <div style={{ background: "#1a1b26", border: "1px solid #2a2b3d", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: "#c0caf5" }}>Start new session?</div>
        <div style={{ fontSize: 12, color: "#565f89", marginBottom: 16 }}>This will end the current conversation and start fresh.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#24283b", color: "#565f89", border: "1px solid #3b3d57" }}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2020", color: "#f7768e", border: "1px solid #5a3030" }}>New</button>
        </div>
      </div>
    </div>
  );
}
