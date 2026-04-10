import { BottomSheet } from "../BottomSheet";
import { btnStyle } from "./types";

export function TodoSheet({ todoContent, onClose }: { todoContent: string; onClose: () => void }) {
  return (
    <BottomSheet onClose={onClose} title="TODO">
      <pre style={{ fontSize: 11, color: "#a9b1d6", background: "#24283b", padding: 12, borderRadius: 6, overflow: "auto", maxHeight: "50vh", whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
        {todoContent || "Loading..."}
      </pre>
      <button onClick={onClose} style={{ ...btnStyle, marginTop: 12, width: "100%", padding: "10px 16px", textAlign: "center" }}>Close</button>
    </BottomSheet>
  );
}
