import { BottomSheet } from "../BottomSheet";
import { btnStyle } from "./types";

interface ReconnectMenuProps {
  onClose: () => void;
  onReconnect: () => void;
  onRestart: () => void;
  onFitScreen?: () => void;
}

export function ReconnectMenu({ onClose, onReconnect, onRestart, onFitScreen }: ReconnectMenuProps) {
  return (
    <BottomSheet onClose={onClose} title="Session Controls">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button onClick={onReconnect} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left", background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d" }}>
          Reconnect Terminal
          <div style={{ fontSize: 10, color: "#4a7a5a", marginTop: 2 }}>Refresh the terminal WebSocket connection</div>
        </button>
        {onFitScreen && (
          <button onClick={onFitScreen} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left", background: "#1a2a3a", color: "var(--color-accent-blue)", border: "1px solid #2d4a5a" }}>
            Fit Screen
            <div style={{ fontSize: 10, color: "#4a6a8a", marginTop: 2 }}>Resize the terminal to match this screen</div>
          </button>
        )}
        <button onClick={onRestart} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left", background: "#3a2020", color: "var(--color-accent-red)", border: "1px solid #5a3030" }}>
          Restart Claude Session
          <div style={{ fontSize: 10, color: "#7a4a4a", marginTop: 2 }}>Kill tmux session and start fresh</div>
        </button>
      </div>
    </BottomSheet>
  );
}
