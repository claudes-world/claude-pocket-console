import { useState, useEffect, useCallback, useRef } from "react";
import { getAuthHeaders } from "../lib/telegram";
import { MarkdownViewer } from "./MarkdownViewer";

interface FileEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
  modified: string;
}

interface FileViewerProps {
  onClose: () => void;
  initialFile?: string | null;
  showHidden?: boolean;
  sortMode?: string;
  onViewChange?: (file: { path: string; name: string } | null) => void;
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  py: "python",
  sh: "bash",
  yaml: "yaml",
  yml: "yaml",
  css: "css",
  html: "html",
  sql: "sql",
  rs: "rust",
  go: "go",
  toml: "toml",
};

function getLanguage(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  return EXT_LANG[ext] || "text";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

export function FileViewer({ onClose, initialFile, showHidden = false, sortMode = "name-asc", onViewChange }: FileViewerProps) {
  const [currentPath, setCurrentPath] = useState("/home/claude/claudes-world");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [filePath, setFilePath] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedRanges, setCollapsedRanges] = useState<Set<number>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dir", currentPath);

      const res = await fetch("/api/files/upload", {
        method: "POST",
        headers: getAuthHeaders(),
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Upload failed");
      } else {
        // Refresh directory listing
        loadDirectory(currentPath);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setFileContent(null);
    setCollapsedRanges(new Set());
    onViewChange?.(null);
    try {
      const res = await fetch(`/api/files/list?path=${encodeURIComponent(path)}&hidden=1`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setEntries(data.items);
      setCurrentPath(data.path);
      setParentPath(data.parent);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFile = useCallback(async (path: string, name: string) => {
    setLoading(true);
    setError(null);
    setCollapsedRanges(new Set());
    try {
      const res = await fetch(`/api/files/read?path=${encodeURIComponent(path)}`, {
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error);
        return;
      }
      setFileContent(data.content);
      setFileName(name);
      setFilePath(path);
      onViewChange?.({ path, name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialFile) {
      const name = initialFile.split("/").pop() || "file";
      loadFile(initialFile, name);
    } else {
      loadDirectory(currentPath);
    }
  }, []);

  const handleEntry = (entry: FileEntry) => {
    if (entry.type === "dir") {
      loadDirectory(entry.path);
    } else {
      loadFile(entry.path, entry.name);
    }
  };

  const handleBack = () => {
    if (fileContent !== null) {
      setFileContent(null);
      setFileName("");
      setCollapsedRanges(new Set());
    } else if (parentPath) {
      loadDirectory(parentPath);
    }
  };

  // Simple line folding for code
  const toggleFold = (lineNum: number) => {
    setCollapsedRanges((prev) => {
      const next = new Set(prev);
      if (next.has(lineNum)) {
        next.delete(lineNum);
      } else {
        next.add(lineNum);
      }
      return next;
    });
  };

  const visibleEntries = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));
  const filteredEntries = [...visibleEntries].sort((a, b) => {
    // Dirs always first
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    switch (sortMode) {
      case "name-desc": return b.name.localeCompare(a.name);
      case "date-asc": return a.modified.localeCompare(b.modified);
      case "date-desc": return b.modified.localeCompare(a.modified);
      default: return a.name.localeCompare(b.name); // name-asc
    }
  });
  const shortPath = currentPath.replace("/home/claude/", "~/");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", maxWidth: "100%", overflowX: "hidden" }}>
      {/* Root directory shortcuts */}
      {fileContent === null && (
        <div
          style={{
            padding: "6px 12px",
            display: "flex",
            gap: 6,
            flexShrink: 0,
            overflowX: "auto",
            borderBottom: "1px solid #1e1f2e",
          }}
        >
          {[
            { label: "claudes-world", path: "/home/claude/claudes-world" },
            { label: "code", path: "/home/claude/code" },
            { label: "bin", path: "/home/claude/bin" },
            { label: "\ud83c\udf10 .claude", path: "/home/claude/claudes-world/.claude" },
            { label: "\ud83c\udfe0 .claude", path: "/home/claude/.claude" },
          ].map((root) => (
            <button
              key={root.path}
              onClick={() => loadDirectory(root.path)}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                background: currentPath.startsWith(root.path) ? "#2a2b3d" : "transparent",
                color: currentPath.startsWith(root.path) ? "#7aa2f7" : "#565f89",
                border: "1px solid #2a2b3d",
                borderRadius: 4,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {root.label}
            </button>
          ))}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #2a2b3d",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
          minWidth: 0,
          maxWidth: "100%",
          overflow: "hidden",
        }}
      >
        <button
          onClick={handleBack}
          style={{
            background: "none",
            border: "none",
            color: "#7aa2f7",
            cursor: "pointer",
            fontSize: 16,
            padding: "2px 6px",
          }}
        >
          {fileContent !== null ? "< back" : parentPath ? "< up" : ""}
        </button>
        <span
          style={{
            fontSize: 12,
            color: "#c0caf5",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {fileContent !== null ? fileName : shortPath}
        </span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#565f89",
            cursor: "pointer",
            fontSize: 14,
            padding: "2px 6px",
          }}
        >
          x
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: 12, color: "#f7768e", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: 12, color: "#565f89", fontSize: 13 }}>
          Loading...
        </div>
      )}

      {/* File content view */}
      {fileContent !== null && !loading && fileName.endsWith(".md") && (
        <div style={{ flex: 1, overflow: "auto", overflowX: "hidden" }}>
          <MarkdownViewer content={fileContent} fileName={fileName} />
        </div>
      )}
      {fileContent !== null && !loading && !fileName.endsWith(".md") && (
        <div
          style={{
            flex: 1,
            overflow: "auto",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            lineHeight: 1.6,
          }}
        >
          {fileContent.split("\n").map((line, i) => {
            // Simple fold detection: lines ending with { or containing block starts
            const isFoldable =
              line.trimEnd().endsWith("{") ||
              line.trimEnd().endsWith("(") ||
              line.trimEnd().endsWith("[");
            const isFolded = collapsedRanges.has(i);

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  borderBottom: "1px solid #1e1f2e",
                  minHeight: 20,
                }}
              >
                <span
                  style={{
                    width: 48,
                    textAlign: "right",
                    paddingRight: 12,
                    color: "#3b4261",
                    userSelect: "none",
                    flexShrink: 0,
                    cursor: isFoldable ? "pointer" : "default",
                  }}
                  onClick={() => isFoldable && toggleFold(i)}
                >
                  {isFoldable ? (isFolded ? "+" : "-") : ""}{" "}
                  {i + 1}
                </span>
                <pre
                  style={{
                    margin: 0,
                    padding: "0 8px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                    color: "#c0caf5",
                    flex: 1,
                  }}
                >
                  {line || " "}
                </pre>
              </div>
            );
          })}
        </div>
      )}

      {/* Directory listing */}
      {fileContent === null && !loading && (
        <div style={{ flex: 1, overflow: "auto" }}>
          {filteredEntries.map((entry) => (
            <div
              key={entry.path}
              onClick={() => handleEntry(entry)}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                borderBottom: "1px solid #1e1f2e",
                cursor: "pointer",
                gap: 8,
              }}
            >
              <span
                style={{
                  color: entry.type === "dir" ? "#7aa2f7" : "#c0caf5",
                  fontSize: 14,
                  width: 20,
                  textAlign: "center",
                }}
              >
                {entry.type === "dir" ? "📁" : "📄"}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: entry.type === "dir" ? "#7aa2f7" : "#c0caf5",
                  fontWeight: entry.type === "dir" ? 500 : 400,
                }}
              >
                {entry.name}
              </span>
              {entry.type === "file" && (
                <span style={{ fontSize: 11, color: "#565f89" }}>
                  {formatSize(entry.size)}
                </span>
              )}
            </div>
          ))}
          {/* Upload area */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              display: "block",
              width: "calc(100% - 16px)",
              padding: "14px 12px",
              background: "transparent",
              color: uploading ? "#565f89" : "#4a6a4a",
              border: "none",
              cursor: uploading ? "not-allowed" : "pointer",
              fontSize: 12,
              textAlign: "center" as const,
              outline: "2px dashed #2a3a2a",
              outlineOffset: -8,
              margin: 8,
              borderRadius: 6,
            }}
          >
            {uploading ? "Uploading..." : "+ Upload file"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleUpload}
            style={{ display: "none" }}
          />
        </div>
      )}
    </div>
  );
}
