import { BottomSheet } from "../BottomSheet";
import { btnStyle, type SearchResult } from "./types";

interface FileSearchSheetProps {
  searchQuery: string;
  searchResults: SearchResult[];
  onClose: () => void;
  onChange: (value: string) => void;
  onSelect: (result: SearchResult) => void;
}

export function FileSearchSheet({ searchQuery, searchResults, onClose, onChange, onSelect }: FileSearchSheetProps) {
  return (
    <BottomSheet onClose={onClose} title="Search Files">
      <input
        value={searchQuery}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search files..."
        style={{ width: "100%", padding: 10, background: "#24283b", color: "#c0caf5", border: "1px solid #3b3d57", borderRadius: 6, fontSize: 13, fontFamily: "inherit", marginBottom: 8 }}
        autoFocus
      />
      <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
        {searchResults.length === 0 && searchQuery.length >= 2 && (
          <div style={{ fontSize: 12, color: "#565f89", padding: 12, textAlign: "center" }}>No results</div>
        )}
        {searchResults.map((result, i) => (
          <button
            key={i}
            onClick={() => onSelect(result)}
            style={{ ...btnStyle, display: "block", width: "100%", padding: "8px 12px", textAlign: "left", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            <span style={{ color: result.type === "directory" ? "#e0af68" : "#7aa2f7" }}>{result.type === "directory" ? "\uD83D\uDCC1 " : "\uD83D\uDCC4 "}</span>
            {result.name}
            <div style={{ fontSize: 10, color: "#565f89", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{result.relPath}</div>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
