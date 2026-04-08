import { SORT_OPTIONS } from "../FileViewer";
import { BottomSheet } from "../BottomSheet";
import { btnStyle } from "./types";
import type { SortMode } from "../FileViewer";

interface FileOptionsSheetProps {
  fileShowHidden?: boolean;
  fileSortMode?: SortMode;
  setFileShowHidden?: (value: boolean) => void;
  setFileSortMode?: (value: SortMode) => void;
  onClose: () => void;
}

export function FileOptionsSheet(props: FileOptionsSheetProps) {
  return (
    <BottomSheet onClose={props.onClose} title="File Options">
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <button onClick={() => { props.setFileShowHidden?.(!props.fileShowHidden); props.onClose(); }} style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" }}>
          {props.fileShowHidden ? "Hide Hidden Files" : "Show Hidden Files"}
        </button>
        <div style={{ fontSize: 12, color: "#565f89", marginTop: 4, marginBottom: 2 }}>Sort by:</div>
        {SORT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            onClick={() => { props.setFileSortMode?.(opt.value); props.onClose(); }}
            style={{ ...btnStyle, padding: "10px 14px", textAlign: "left", ...(props.fileSortMode === opt.value ? { background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a" } : {}) }}
          >
            {opt.long}
            {props.fileSortMode === opt.value && " \u2713"}
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
