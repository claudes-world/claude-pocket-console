import { useState, useEffect, useCallback } from "react";
import { getAuthHeaders } from "../lib/telegram";

interface FileEntry {
  name: string;
  path: string;
  type: "dir" | "file";
  size: number;
  modified: string;
}

interface FileViewerProps {
  onClose: () => void;
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

export function FileViewer({ onClose }: FileViewerProps) {
  const [currentPath, setCurrentPath] = useState("/home/claude/claudes-world");
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsedRanges, setCollapsedRanges] = useState<Set<number>>(new Set());

  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setFileContent(null);
    setCollapsedRanges(new Set());
    try {
      const res = await fetch(`/api/files/list?path=${encodeURIComponent(path)}`, {
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read file");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDirectory(currentPath);
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

  const shortPath = currentPath.replace("/home/claude/", "~/");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #2a2b3d",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
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
            color: "#565f89",
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
      {fileContent !== null && !loading && (
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
          {entries.map((entry) => (
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
        </div>
      )}
    </div>
  );
}
