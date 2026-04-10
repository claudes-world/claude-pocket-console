import { BottomSheet } from "../BottomSheet";
import { btnStyle } from "./types";

interface CommandsSheetProps {
  onClose: () => void;
  onEsc: () => void;
  onDigit: (digit: number) => void;
  onShiftTab: () => void;
  onControlB: () => void;
  onNew: () => void;
  onResume: () => void;
  onFork: () => void;
  onRename: () => void;
  onCompact: () => void;
  onReloadPlugins: () => void;
}

export function CommandsSheet(props: CommandsSheetProps) {
  const commandStyle = { ...btnStyle, padding: "4px 12px", textAlign: "left" as const, fontFamily: "monospace" };

  return (
    <BottomSheet onClose={props.onClose} title="/commands">
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={props.onEsc} style={{ ...btnStyle, flex: 1, padding: "12px 0", textAlign: "center", fontSize: 13, fontWeight: 600, color: "#f7768e" }}>Esc</button>
          {[1, 2, 3].map((n) => (
            <button key={n} onClick={() => props.onDigit(n)} style={{ ...btnStyle, flex: 1, padding: "12px 0", textAlign: "center", fontSize: 16, fontWeight: 600 }}>
              {n}
            </button>
          ))}
          <button onClick={props.onShiftTab} style={{ ...btnStyle, flex: 1, padding: "12px 0", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#bb9af7" }}>{"\u21e7Tab"}</button>
          <button onClick={props.onControlB} style={{ ...btnStyle, flex: 1, padding: "12px 0", textAlign: "center", fontSize: 11, fontWeight: 600, color: "#e0af68" }}>^B</button>
        </div>
        <button onClick={props.onNew} style={{ ...commandStyle, background: "#3a2020", color: "#f7768e", border: "1px solid #5a3030" }}>
          /new
          <div style={{ fontSize: 10, color: "#6a4040", marginTop: 1 }}>Start a new conversation</div>
        </button>
        <button onClick={props.onResume} style={{ ...commandStyle, background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d" }}>
          /resume
          <div style={{ fontSize: 10, color: "#4a7a5a", marginTop: 1 }}>Switch to a previous session</div>
        </button>
        <button onClick={props.onFork} style={commandStyle}>
          /branch <span style={{ color: "#565f89", fontFamily: "inherit" }}>(fork)</span>
          <div style={{ fontSize: 10, color: "#565f89", marginTop: 1 }}>Branch or fork this conversation</div>
        </button>
        <button onClick={props.onRename} style={commandStyle}>
          /rename
          <div style={{ fontSize: 10, color: "#565f89", marginTop: 1 }}>Give this session a name</div>
        </button>
        <button onClick={props.onCompact} style={{ ...commandStyle, background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a" }}>
          /compact
          <div style={{ fontSize: 10, color: "#4a5a8a", marginTop: 1 }}>Compress conversation context</div>
        </button>
        <button onClick={props.onReloadPlugins} style={commandStyle}>
          /reload-plugins
          <div style={{ fontSize: 10, color: "#565f89", marginTop: 1 }}>Reload installed plugins, skills, and agents</div>
        </button>
      </div>
    </BottomSheet>
  );
}
