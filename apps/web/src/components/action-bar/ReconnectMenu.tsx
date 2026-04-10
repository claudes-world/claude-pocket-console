import { BottomSheet } from "../BottomSheet";
import { btnStyle } from "./types";

interface ReconnectMenuProps {
  onClose: () => void;
  onReconnect: () => void;
  onRestart: () => void;
}

export function ReconnectMenu({ onClose, onReconnect, onRestart }: ReconnectMenuProps) {
  return (
    <BottomSheet onClose={onClose} title="Session Controls">
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button onClick={onReconnect} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left", background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d" }}>
          Reconnect Terminal
          <div style={{ fontSize: 10, color: "#4a7a5a", marginTop: 2 }}>Refresh the terminal WebSocket connection</div>
        </button>
        <button onClick={onRestart} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left", background: "#3a2020", color: "#f7768e", border: "1px solid #5a3030" }}>
          Restart Claude Session
          <div style={{ fontSize: 10, color: "#7a4a4a", marginTop: 2 }}>Kill tmux session and start fresh</div>
        </button>
      </div>
    </BottomSheet>
  );
}
