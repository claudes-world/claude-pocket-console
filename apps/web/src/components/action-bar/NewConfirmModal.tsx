import { btnStyle, modalCenter } from "./types";

interface NewConfirmModalProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export function NewConfirmModal({ onCancel, onConfirm }: NewConfirmModalProps) {
  return (
    <div style={modalCenter} onClick={onCancel}>
      <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: "var(--color-fg)" }}>Start new session?</div>
        <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 16 }}>This will end the current conversation and start fresh.</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "var(--color-surface)", color: "var(--color-muted)", border: "1px solid var(--color-subtle)" }}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2020", color: "var(--color-accent-red)", border: "1px solid #5a3030" }}>New</button>
        </div>
      </div>
    </div>
  );
}
