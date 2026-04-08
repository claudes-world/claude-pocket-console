import { BottomSheet } from "../BottomSheet";
import { btnStyle, type SessionName } from "./types";

interface ResumeSheetProps {
  sessionNames: SessionName[];
  onClose: () => void;
  onResume: (session: SessionName) => void;
  onDelete: (session: SessionName) => void;
}

export function ResumeSheet({ sessionNames, onClose, onResume, onDelete }: ResumeSheetProps) {
  return (
    <BottomSheet onClose={onClose} title="Resume Session">
      {sessionNames.length === 0 ? (
        <div style={{ fontSize: 13, color: "#565f89", padding: 16, textAlign: "center" }}>No saved sessions</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sessionNames.map((session) => (
            <div key={session.ts} style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
              <button onClick={() => onResume(session)} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left", flex: 1 }}>
                {session.name}
                <div style={{ fontSize: 10, color: "#565f89", marginTop: 2 }}>{new Date(session.ts).toLocaleDateString()}</div>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(session); }}
                style={{ ...btnStyle, padding: "0 12px", color: "#f7768e", background: "#2a2020", border: "1px solid #3a2a2a", fontSize: 16, display: "flex", alignItems: "center", justifyContent: "center" }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

interface ConfirmDeleteSheetProps {
  deleteTarget: SessionName;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteSheet({ deleteTarget, onCancel, onConfirm }: ConfirmDeleteSheetProps) {
  return (
    <BottomSheet onClose={onCancel} title="Delete Session Name">
      <div style={{ padding: "8px 0" }}>
        <div style={{ fontSize: 14, color: "#c0caf5", marginBottom: 4 }}>Delete "{deleteTarget.name}"?</div>
        <div style={{ fontSize: 12, color: "#565f89", marginBottom: 16 }}>
          This only removes the name from the list. It does not delete the session itself.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={{ ...btnStyle, flex: 1, padding: "10px 16px" }}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2020", color: "#f7768e", border: "1px solid #5a3030" }}>Delete</button>
        </div>
      </div>
    </BottomSheet>
  );
}
