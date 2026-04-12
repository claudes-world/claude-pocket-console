import { btnStyle, modalCenter } from "./types";

interface CompactConfirmModalProps {
  onCompactNow: () => void;
  onContinuity: () => void;
  onCancel: () => void;
}

export function CompactConfirmModal({ onCompactNow, onContinuity, onCancel }: CompactConfirmModalProps) {
  return (
    <div style={modalCenter} onClick={onCancel}>
      <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "var(--color-fg)" }}>Compact Context</div>
        <div style={{ fontSize: 13, color: "var(--color-fg-muted)", marginBottom: 16, lineHeight: 1.5 }}>Choose how to compact the conversation:</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button onClick={onCompactNow} style={{ ...btnStyle, background: "#2d3a5a", color: "var(--color-accent-blue)", border: "1px solid #3d4a6a", padding: "10px 16px", textAlign: "left" }}>
            Compact Now
            <div style={{ fontSize: 11, color: "var(--color-muted)", marginTop: 2 }}>Compress context immediately</div>
          </button>
          <button onClick={onContinuity} style={{ ...btnStyle, background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d", padding: "10px 16px", textAlign: "left" }}>
            Prompt for Continuity
            <div style={{ fontSize: 11, color: "#4a7a5a", marginTop: 2 }}>Save context to files first, then compact</div>
          </button>
          <button onClick={onCancel} style={{ ...btnStyle, background: "#3a2a2a", color: "var(--color-accent-red)", border: "1px solid #5a3d3d", padding: "10px 16px" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

interface CompactFocusModalProps {
  value: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}

export function CompactFocusModal({ value, onChange, onBack, onSubmit }: CompactFocusModalProps) {
  return (
    <div style={modalCenter} onClick={onBack}>
      <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: "var(--color-fg)" }}>Compact Focus</div>
        <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 12 }}>Optionally steer what the compact summary focuses on:</div>
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Focus on the auth refactor and voice recorder plan..." style={{ width: "100%", height: 80, background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-subtle)", borderRadius: 6, padding: 10, fontSize: 13, resize: "vertical", fontFamily: "inherit" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={onBack} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2a2a", color: "var(--color-accent-red)", border: "1px solid #5a3d3d" }}>Back</button>
          <button onClick={onSubmit} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#2d3a5a", color: "var(--color-accent-blue)", border: "1px solid #3d4a6a" }}>Compact</button>
        </div>
      </div>
    </div>
  );
}

interface ContinuityNotesModalProps {
  value: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}

export function ContinuityNotesModal({ value, onChange, onBack, onSubmit }: ContinuityNotesModalProps) {
  return (
    <div style={modalCenter} onClick={onBack}>
      <div style={{ background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: "var(--color-fg)" }}>Additional Notes</div>
        <div style={{ fontSize: 12, color: "var(--color-muted)", marginBottom: 12 }}>Anything extra to preserve before compacting? (optional)</div>
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. Remember we were debugging the auth issue..." style={{ width: "100%", height: 100, background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-subtle)", borderRadius: 6, padding: 10, fontSize: 13, resize: "vertical", fontFamily: "inherit" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button onClick={onBack} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2a2a", color: "var(--color-accent-red)", border: "1px solid #5a3d3d" }}>Back</button>
          <button onClick={onSubmit} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d" }}>Send</button>
        </div>
      </div>
    </div>
  );
}
