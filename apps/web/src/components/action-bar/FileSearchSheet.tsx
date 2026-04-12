import { BottomSheet } from "../BottomSheet";
import { getFileIcon } from "../file-icons";
import { btnStyle, type SearchResult } from "./types";

interface FileSearchSheetProps {
  searchQuery: string;
  searchResults: SearchResult[];
  currentFolder: string | null;
  currentFolderOnly: boolean;
  onToggleCurrentFolderOnly: (value: boolean) => void;
  onClose: () => void;
  onChange: (value: string) => void;
  onSelect: (result: SearchResult) => void;
}

export function FileSearchSheet({
  searchQuery,
  searchResults,
  currentFolder,
  currentFolderOnly,
  onToggleCurrentFolderOnly,
  onClose,
  onChange,
  onSelect,
}: FileSearchSheetProps) {
  const shortFolder = currentFolder ? currentFolder.replace("/home/claude/", "~/") : null;
  // When the toggle is on but no folder is available (edge case — file viewer
  // hasn't reported a path yet), fall back to global so the user isn't stuck
  // with a scope that resolves to nothing. The label flags this state.
  const scopeActive = currentFolderOnly && !!currentFolder;
  return (
    <BottomSheet onClose={onClose} title="Search Files">
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 2px 10px",
          fontSize: 12,
          color: "var(--color-fg-muted)",
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <input
          type="checkbox"
          checked={currentFolderOnly}
          onChange={(e) => onToggleCurrentFolderOnly(e.target.checked)}
          style={{ accentColor: "var(--color-accent-blue)", width: 14, height: 14, cursor: "pointer" }}
        />
        <span>Current folder only</span>
        {scopeActive && shortFolder && (
          <span style={{ color: "var(--color-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {shortFolder}
          </span>
        )}
        {currentFolderOnly && !currentFolder && (
          <span style={{ color: "var(--color-accent-yellow)" }}>no folder — searching globally</span>
        )}
      </label>
      <input
        value={searchQuery}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search files..."
        style={{ width: "100%", padding: 10, background: "var(--color-surface)", color: "var(--color-fg)", border: "1px solid var(--color-subtle)", borderRadius: 6, fontSize: 13, fontFamily: "inherit", marginBottom: 8 }}
        autoFocus
      />
      <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
        {searchResults.length === 0 && searchQuery.length >= 2 && (
          <div style={{ fontSize: 12, color: "var(--color-muted)", padding: 12, textAlign: "center" }}>No results</div>
        )}
        {searchResults.map((result) => (
          <button
            key={result.path}
            onClick={() => onSelect(result)}
            style={{ ...btnStyle, display: "block", width: "100%", padding: "8px 12px", textAlign: "left", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              {getFileIcon(result.name, result.type === "dir")}
              <span>{result.name}</span>
            </span>
            <div style={{ fontSize: 10, color: "var(--color-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>{result.relPath}</div>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
