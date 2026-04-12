import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { FiDownload } from "react-icons/fi";
import { getAuthHeaders } from "../lib/telegram";
import { MarkdownViewer } from "./MarkdownViewer";
import { BottomSheet } from "./BottomSheet";
import { getFileIcon } from "./file-icons";

const PASTE_MAX_BYTES = 1024 * 1024;

/**
 * Build a default filename from content. If the first non-empty line is a
 * markdown heading, slugify it. Otherwise fall back to a timestamp.
 * Always returns a name with a .md extension — keep heuristics simple;
 * the user can always override in the input field.
 */
function suggestFilename(content: string): string {
  const trimmed = content.trim();
  if (trimmed) {
    const firstLine = trimmed.split("\n", 1)[0];
    const headingMatch = firstLine.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      const slug = headingMatch[1]
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      if (slug) return `${slug}.md`;
    }
  }
  // Timestamp fallback: paste-YYYY-MM-DD-HHMM.md
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `paste-${stamp}.md`;
}

/**
 * Mirror the server's filename rules so the Save button can disable
 * before a round trip. The server re-validates regardless.
 */
/**
 * Normalize a filename to the canonical form the server will write.
 * Trims whitespace and strips trailing dots/spaces (Windows-incompatible
 * but the server's sanitizeFilename does the same so this keeps client
 * and server in sync — Copilot review caught a drift where the client
 * validated the trimmed form but sent the unstripped name to the server).
 */
function normalizeFilename(name: string): string {
  return name.trim().replace(/[. ]+$/, "");
}

function isFilenameValid(name: string): boolean {
  const trimmed = normalizeFilename(name);
  if (!trimmed || trimmed.length > 255) return false;
  if (trimmed === "." || trimmed === "..") return false;
  if (/[\x00-\x1f\x7f/\\]/.test(trimmed)) return false;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(trimmed)) return false;
  return true;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export type SortMode = "name-asc" | "name-desc" | "date-asc" | "date-desc";

/**
 * Sort mode options — single source of truth for both the inline control
 * in FileViewer and the bottom-sheet modal in ActionBar. Export both a
 * short-label version (for compact inline controls) and a long-label
 * version (for menus where space isn't constrained).
 */
export const SORT_OPTIONS: { value: SortMode; short: string; long: string }[] = [
  { value: "name-asc",  short: "name \u2191", long: "Name (A-Z)" },
  { value: "name-desc", short: "name \u2193", long: "Name (Z-A)" },
  { value: "date-asc",  short: "date \u2191", long: "Date (Oldest)" },
  { value: "date-desc", short: "date \u2193", long: "Date (Newest)" },
];

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
  sortMode?: SortMode;
  onSortModeChange?: (mode: SortMode) => void;
  onViewChange?: (file: { path: string; name: string } | null) => void;
  onPathChange?: (path: string) => void;
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

export function FileViewer({ onClose, initialFile, showHidden = false, sortMode = "name-asc", onSortModeChange, onViewChange, onPathChange }: FileViewerProps) {
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
  const [downloading, setDownloading] = useState(false);
  const [dirBranch, setDirBranch] = useState<string | null>(null);
  const [dirTreeInfo, setDirTreeInfo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Paste-to-upload modal state
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteContent, setPasteContent] = useState("");
  const [pasteFilename, setPasteFilename] = useState("");
  const [pasteSaving, setPasteSaving] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  // Track whether the user has manually edited the filename, so content
  // changes don't clobber their edits once they've taken control.
  const pasteFilenameEditedRef = useRef(false);
  const pasteTextareaRef = useRef<HTMLTextAreaElement>(null);
  const downloadInFlightRef = useRef(false);

  const handleDownload = async () => {
    if (!filePath || !fileName || downloadInFlightRef.current) return;
    downloadInFlightRef.current = true;
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch("/api/files/download-ticket", {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ path: filePath }),
      });
      if (!res.ok) {
        let msg = `Download failed (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch { /* not JSON */ }
        throw new Error(msg);
      }

      const data = await res.json() as { ticket?: string };
      if (!data.ticket) {
        throw new Error("Download failed: missing ticket");
      }

      // Use a hidden <a> element with download attribute to trigger the
      // browser's native download. This works in Telegram WebView where
      // window.open("about:blank") is blocked as a popup.
      const url = `/api/files/download?ticket=${encodeURIComponent(data.ticket)}`;
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Download failed");
    } finally {
      downloadInFlightRef.current = false;
      setDownloading(false);
    }
  };

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

  const openPasteSheet = () => {
    setPasteContent("");
    setPasteFilename("");
    setPasteError(null);
    pasteFilenameEditedRef.current = false;
    setPasteOpen(true);
  };

  const closePasteSheet = () => {
    // Block dismissal entirely while a save is in progress — closing
    // mid-write would orphan the in-flight request and leave the user
    // confused about whether the file was actually written.
    if (pasteSaving) return;
    // Guard against accidental dismissal when there is meaningful unsaved content.
    if (pasteContent.trim().length > 0) {
      const ok = window.confirm("Discard pasted content?");
      if (!ok) return;
    }
    setPasteOpen(false);
  };

  const handlePasteContentChange = (next: string) => {
    setPasteContent(next);
    // Editing the content clears any stale validation/save error so the
    // user isn't stuck looking at an old "Invalid filename" or 413 message
    // after they've already corrected it. (Copilot review caught this.)
    setPasteError(null);
    if (!pasteFilenameEditedRef.current) {
      setPasteFilename(suggestFilename(next));
    }
  };

  const handlePasteFilenameChange = (next: string) => {
    pasteFilenameEditedRef.current = true;
    setPasteFilename(next);
    setPasteError(null);
  };

  const handlePasteSave = async () => {
    if (pasteSaving) return;
    // Final client-side guards mirror the server rules. Normalize the
    // filename to the same form that isFilenameValid checks AND that the
    // server will actually write — without this, "foo." passes validation
    // (after the inner trim) but the server writes "foo", so the user sees
    // a different filename than they typed.
    //
    // Treat whitespace-only filename as empty so we fall through to the
    // suggested name instead of normalizing "   " → "" and rejecting.
    // (Copilot caught this consistency drift with the save-disabled check.)
    const userTyped = pasteFilename.trim();
    const name = normalizeFilename(userTyped || suggestFilename(pasteContent));
    if (!isFilenameValid(name)) {
      setPasteError("Invalid filename");
      return;
    }
    if (pasteContent.length === 0) {
      setPasteError("Nothing to save");
      return;
    }
    const byteLength = new Blob([pasteContent]).size;
    if (byteLength > PASTE_MAX_BYTES) {
      setPasteError("Content too large (max 1 MB)");
      return;
    }

    setPasteSaving(true);
    setPasteError(null);
    try {
      const res = await fetch("/api/files/paste", {
        method: "POST",
        headers: {
          ...getAuthHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filename: name,
          content: pasteContent,
          dir: currentPath,
        }),
      });
      // Wrap json() in try/catch — non-JSON error responses (proxy errors,
      // empty bodies, HTML 502 pages) would otherwise throw a confusing
      // "unexpected token" parse error instead of a useful HTTP status.
      let data: { error?: string } | null = null;
      try {
        data = await res.json();
      } catch {
        if (!res.ok) {
          setPasteError(`Save failed (HTTP ${res.status})`);
          return;
        }
        // Success status but unparseable body — treat as success.
      }
      if (!res.ok) {
        setPasteError(data?.error || `Save failed (HTTP ${res.status})`);
        return;
      }
      // Success: close sheet and refresh listing so the new file appears.
      setPasteOpen(false);
      setPasteContent("");
      setPasteFilename("");
      pasteFilenameEditedRef.current = false;
      loadDirectory(currentPath);
    } catch (err) {
      setPasteError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPasteSaving(false);
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
      // Seed currentPath to the file's parent directory so features that
      // depend on "what folder am I in right now" (e.g. the Search UX C3
      // "current folder only" scope) don't stay stuck on the default
      // `/home/claude/claudes-world` root while the user is actually
      // viewing a file that lives elsewhere. Codex round-1 flagged this
      // as a stale-scope bug after a hash-nav reload from search results.
      //
      // We also need to actually populate `entries` / `parentPath` for that
      // folder, otherwise hitting back from a file opened via search shows
      // an empty directory (Copilot round-2 finding on PR #106). We await
      // loadDirectory first so it doesn't clobber fileContent set by
      // loadFile (loadDirectory's setFileContent(null) would otherwise
      // race with loadFile's setFileContent(...)).
      const lastSlash = initialFile.lastIndexOf("/");
      const initFromSearch = async () => {
        if (lastSlash > 0) {
          await loadDirectory(initialFile.slice(0, lastSlash));
        }
        await loadFile(initialFile, name);
      };
      void initFromSearch();
    } else {
      loadDirectory(currentPath);
    }
  }, []);

  // Notify parent of the browsed directory so features like file search can
  // scope themselves to the folder the user is currently looking at.
  useEffect(() => {
    onPathChange?.(currentPath);
  }, [currentPath, onPathChange]);

  // Fetch git branch for the current directory
  useEffect(() => {
    if (fileContent !== null) return;
    let cancelled = false;
    fetch(`/api/terminal/dir-branch?path=${encodeURIComponent(currentPath)}`, {
      headers: getAuthHeaders(),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setDirBranch(data.ok ? data.branch : null);
          if (data.ok && data.isWorktree && data.mainTreePath) {
            setDirTreeInfo(`linked tree \u2192 ${data.mainTreePath}`);
          } else if (data.ok && data.branch) {
            setDirTreeInfo("main tree");
          } else {
            setDirTreeInfo(null);
          }
        }
      })
      .catch(() => {
        if (!cancelled) { setDirBranch(null); setDirTreeInfo(null); }
      });
    return () => { cancelled = true; };
  }, [currentPath, fileContent]);

  const handleEntry = (entry: FileEntry) => {
    if (entry.type === "dir") {
      loadDirectory(entry.path);
    } else {
      loadFile(entry.path, entry.name);
    }
  };

  const handleBack = useCallback(() => {
    if (fileContent !== null) {
      setFileContent(null);
      setFileName("");
      setCollapsedRanges(new Set());
      // Notify parent that file view has ended to reset the ActionBar.
      onViewChange?.(null);
    } else if (parentPath) {
      loadDirectory(parentPath);
    }
  }, [fileContent, parentPath, loadDirectory, onViewChange]);

  // Wire Telegram's native BackButton when viewing a file. Show it on
  // file open, hide it when returning to the directory listing, and clean
  // up the handler on unmount so we don't leak listeners.
  useEffect(() => {
    const bb = window.Telegram?.WebApp?.BackButton;
    if (!bb) return;

    if (fileContent !== null) {
      bb.onClick(handleBack);
      bb.show();
    } else {
      bb.hide();
    }

    return () => {
      bb.offClick(handleBack);
      bb.hide();
    };
  }, [fileContent, handleBack]);

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

  const sortedEntries = useMemo(() => {
    const visible = showHidden ? entries : entries.filter((e) => !e.name.startsWith("."));

    const cmpName = (a: FileEntry, b: FileEntry) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true });

    return [...visible].sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;

      switch (sortMode) {
        case "name-desc":
          return -cmpName(a, b);
        case "date-asc": {
          if (!a.modified && !b.modified) return cmpName(a, b);
          if (!a.modified) return 1;
          if (!b.modified) return -1;
          const d = a.modified.localeCompare(b.modified);
          return d !== 0 ? d : cmpName(a, b);
        }
        case "date-desc": {
          if (!a.modified && !b.modified) return cmpName(a, b);
          if (!a.modified) return 1;
          if (!b.modified) return -1;
          const d = b.modified.localeCompare(a.modified);
          return d !== 0 ? d : cmpName(a, b);
        }
        case "name-asc":
        default:
          return cmpName(a, b);
      }
    });
  }, [entries, showHidden, sortMode]);
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
            borderBottom: "1px solid var(--color-separator)",
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
                background: currentPath.startsWith(root.path) ? "var(--color-border)" : "transparent",
                color: currentPath.startsWith(root.path) ? "var(--color-accent-blue)" : "var(--color-muted)",
                border: "1px solid var(--color-border)",
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

      {/* Inline sort control — only in directory listing view */}
      {fileContent === null && (
        <div
          style={{
            padding: "6px 12px",
            display: "flex",
            gap: 6,
            flexShrink: 0,
            overflowX: "auto",
            borderBottom: "1px solid var(--color-separator)",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 11, color: "var(--color-muted)", marginRight: 4 }}>sort</span>
          {SORT_OPTIONS.map((opt) => {
            const active = sortMode === opt.value;
            return (
              <button
                key={opt.value}
                onClick={() => onSortModeChange?.(opt.value)}
                aria-pressed={active}
                style={{
                  padding: "4px 10px",
                  fontSize: 11,
                  background: active ? "var(--color-border)" : "transparent",
                  color: active ? "var(--color-accent-blue)" : "var(--color-muted)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 4,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  minHeight: 28,
                }}
              >
                {opt.short}
              </button>
            );
          })}
        </div>
      )}

      {/* Header
          Back/Up, Download, and Close all need tap targets that clear
          Apple HIG's 44x44pt minimum AND leave enough breathing room that
          neighbors don't eat each other's hit zones on iOS. The previous
          layout used negative horizontal margins on each button (-6px /
          -2px / -6px) which collapsed the parent flex `gap` to effectively
          0px between the Download button and the Close (✕) button. Liam
          reported "all three buttons are hard to hit" in v1.8.0 UAT — the
          fix is to drop the negative horizontal margins, bump the parent
          gap to 12px, and keep the 44x44 floors so every button has a
          square tap zone with a real corridor between it and its
          neighbors. The header `padding` is trimmed from `8px 12px` to
          `4px 8px` so the 44px button heights don't grow the header
          visibly — with box-sizing: border-box the 44px floor already
          absorbs the padding, and the buttons themselves still read as
          inline icons. The header also stops touch propagation because
          the FileViewer lives inside the app-wide swipeable tab viewport;
          otherwise small tap drift on these buttons can be interpreted as
          a tab swipe and make the controls feel hard to press even when
          their DOM boxes are 44x44. */}
      <div
        style={{
          padding: "4px 8px",
          borderBottom: "1px solid var(--color-border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
          minWidth: 0,
          maxWidth: "100%",
          overflow: "hidden",
        }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {/* Back/Up button. When viewing a file it goes back to the
            directory listing; when in a directory with a parent it goes
            up one level. At the filesystem root (no file open, no
            parent) the button is inert — we hide it from the a11y tree
            and disable clicks so VoiceOver/TalkBack don't announce an
            actionable control that does nothing, while keeping the
            layout slot occupied so the header doesn't jump. */}
        <button
          onClick={handleBack}
          disabled={fileContent === null && parentPath === null}
          aria-hidden={fileContent === null && parentPath === null ? true : undefined}
          aria-label={
            fileContent !== null
              ? "Back to directory"
              : parentPath !== null
                ? "Up one directory"
                : undefined
          }
          style={{
            background: "none",
            border: "none",
            color: "var(--color-accent-blue)",
            cursor:
              fileContent === null && parentPath === null ? "default" : "pointer",
            fontSize: 16,
            padding: "10px 12px",
            minHeight: 44,
            minWidth: 44,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            visibility:
              fileContent === null && parentPath === null ? "hidden" : "visible",
          }}
        >
          {fileContent !== null ? "\u2190 back" : parentPath ? "\u2190 up" : ""}
        </button>
        <span
          style={{
            fontSize: 12,
            color: "var(--color-fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
            minWidth: 0,
          }}
        >
          {fileContent !== null ? fileName : shortPath}
        </span>
        {fileContent !== null && (
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="Download file"
            aria-label="Download file"
            style={{
              background: "none",
              border: "none",
              color: downloading ? "var(--color-muted)" : "var(--color-accent-blue)",
              cursor: downloading ? "wait" : "pointer",
              fontSize: 18,
              padding: "10px 12px",
              minHeight: 44,
              minWidth: 44,
              boxSizing: "border-box",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <FiDownload />
          </button>
        )}
        <button
          onClick={onClose}
          aria-label="Close file viewer"
          style={{
            background: "none",
            border: "none",
            color: "var(--color-muted)",
            cursor: "pointer",
            fontSize: 16,
            padding: "10px 12px",
            minHeight: 44,
            minWidth: 44,
            boxSizing: "border-box",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          ✕
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{ padding: 12, color: "var(--color-accent-red)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ padding: 12, color: "var(--color-muted)", fontSize: 13 }}>
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
                  borderBottom: "1px solid var(--color-separator)",
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
                    color: "var(--color-fg)",
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
          {sortedEntries.map((entry) => (
            <div
              key={entry.path}
              onClick={() => handleEntry(entry)}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 12px",
                borderBottom: "1px solid var(--color-separator)",
                cursor: "pointer",
                gap: 8,
              }}
            >
              <span
                style={{
                  width: 20,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {getFileIcon(entry.name, entry.type === "dir")}
              </span>
              <span
                style={{
                  flex: 1,
                  fontSize: 13,
                  color: entry.type === "dir" ? "var(--color-accent-blue)" : "var(--color-fg)",
                  fontWeight: entry.type === "dir" ? 500 : 400,
                }}
              >
                {entry.name}
              </span>
              {entry.type === "file" && (
                <span style={{ fontSize: 11, color: "var(--color-muted)" }}>
                  {formatSize(entry.size)}
                </span>
              )}
            </div>
          ))}
          {/* Git branch indicator */}
          {dirBranch && (
            <div
              style={{
                padding: "6px 12px",
                fontSize: 11,
                color: "var(--color-accent-blue)",
                textAlign: "left",
                borderTop: "1px solid var(--color-separator)",
              }}
            >
              ⎇ {dirBranch}{dirTreeInfo ? ` (${dirTreeInfo})` : ""}
            </div>
          )}
          {/* Paste + Upload area */}
          <div style={{ display: "flex", gap: 8, margin: 8 }}>
            <button
              onClick={openPasteSheet}
              disabled={pasteSaving}
              style={{
                flex: 1,
                padding: "14px 12px",
                background: "transparent",
                color: pasteSaving ? "var(--color-muted)" : "#4a6a4a",
                border: "none",
                cursor: pasteSaving ? "not-allowed" : "pointer",
                fontSize: 12,
                textAlign: "center" as const,
                outline: "2px dashed #2a3a2a",
                outlineOffset: -8,
                borderRadius: 6,
                boxSizing: "border-box" as const,
              }}
            >
              + Paste
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              style={{
                flex: 1,
                padding: "14px 12px",
                background: "transparent",
                color: uploading ? "var(--color-muted)" : "#4a6a4a",
                border: "none",
                cursor: uploading ? "not-allowed" : "pointer",
                fontSize: 12,
                textAlign: "center" as const,
                outline: "2px dashed #2a3a2a",
                outlineOffset: -8,
                borderRadius: 6,
                boxSizing: "border-box" as const,
              }}
            >
              {uploading ? "Uploading..." : "+ Upload file"}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            onChange={handleUpload}
            style={{ display: "none" }}
          />
        </div>
      )}

      {/* Paste-to-upload bottom sheet */}
      {pasteOpen && (
        <BottomSheet onClose={closePasteSheet} title="Paste to upload">
          <PasteSheetBody
            content={pasteContent}
            filename={pasteFilename}
            saving={pasteSaving}
            error={pasteError}
            currentPath={currentPath}
            onContentChange={handlePasteContentChange}
            onFilenameChange={handlePasteFilenameChange}
            onSave={handlePasteSave}
            onCancel={closePasteSheet}
            textareaRef={pasteTextareaRef}
          />
        </BottomSheet>
      )}
    </div>
  );
}

interface PasteSheetBodyProps {
  content: string;
  filename: string;
  saving: boolean;
  error: string | null;
  currentPath: string;
  onContentChange: (next: string) => void;
  onFilenameChange: (next: string) => void;
  onSave: () => void;
  onCancel: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

function PasteSheetBody({
  content,
  filename,
  saving,
  error,
  currentPath,
  onContentChange,
  onFilenameChange,
  onSave,
  onCancel,
  textareaRef,
}: PasteSheetBodyProps) {
  // Focus the textarea shortly after mount so the Telegram iOS keyboard
  // comes up without a manual tap. A microtask delay keeps the bottom
  // sheet animation from fighting the viewport resize.
  useEffect(() => {
    const t = setTimeout(() => textareaRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, [textareaRef]);

  const byteLength = useMemo(() => new Blob([content]).size, [content]);
  const lineCount = useMemo(() => (content ? content.split("\n").length : 0), [content]);
  const overLimit = byteLength > PASTE_MAX_BYTES;
  // Treat whitespace-only filename as empty so a string like "   " doesn't
  // pass through as a "user-provided name" and then normalize to empty.
  // (Copilot review caught the inconsistency between the save-disabled check
  // and the handlePasteSave OR-fallback.)
  const trimmedName = filename.trim();
  const nameOk = trimmedName.length === 0 || isFilenameValid(filename);
  const saveDisabled =
    saving || content.length === 0 || overLimit || (trimmedName.length > 0 && !nameOk);

  const shortDir = currentPath.replace("/home/claude/", "~/");

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    background: "#16171f",
    color: "var(--color-fg)",
    border: "1px solid var(--color-border)",
    borderRadius: 6,
    fontSize: 13,
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: "var(--color-muted)",
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  };

  const btnBase: React.CSSProperties = {
    padding: "10px 16px",
    fontSize: 13,
    borderRadius: 6,
    border: "1px solid var(--color-border)",
    cursor: "pointer",
    minHeight: 40,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <div style={labelStyle}>Content</div>
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => onContentChange(e.target.value)}
          disabled={saving}
          placeholder="Paste markdown, code, or notes..."
          spellCheck={false}
          style={{
            ...inputStyle,
            minHeight: 180,
            maxHeight: "40vh",
            resize: "vertical",
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12,
            lineHeight: 1.5,
            borderColor: overLimit ? "var(--color-accent-red)" : "var(--color-border)",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 10,
            color: overLimit ? "var(--color-accent-red)" : "var(--color-muted)",
            marginTop: 4,
          }}
        >
          <span>
            {formatBytes(byteLength)} / {formatBytes(PASTE_MAX_BYTES)}
          </span>
          <span>{lineCount} {lineCount === 1 ? "line" : "lines"}</span>
        </div>
      </div>

      <div>
        <div style={labelStyle}>Filename</div>
        <input
          type="text"
          value={filename}
          onChange={(e) => onFilenameChange(e.target.value)}
          disabled={saving}
          placeholder="untitled.md"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          style={{
            ...inputStyle,
            borderColor: nameOk ? "var(--color-border)" : "var(--color-accent-red)",
          }}
        />
      </div>

      <div>
        <div style={labelStyle}>Save to</div>
        <div
          style={{
            ...inputStyle,
            background: "#0f1019",
            color: "var(--color-accent-blue)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={currentPath}
        >
          {shortDir}
        </div>
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "var(--color-accent-red)", padding: "4px 0" }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 4 }}>
        <button
          onClick={onCancel}
          disabled={saving}
          style={{
            ...btnBase,
            background: "transparent",
            color: "var(--color-fg-muted)",
          }}
        >
          Cancel
        </button>
        <button
          onClick={onSave}
          disabled={saveDisabled}
          style={{
            ...btnBase,
            background: saveDisabled ? "var(--color-bg)" : "var(--color-accent-blue)",
            color: saveDisabled ? "var(--color-muted)" : "var(--color-bg)",
            fontWeight: 600,
            cursor: saveDisabled ? "not-allowed" : "pointer",
            borderColor: saveDisabled ? "var(--color-border)" : "var(--color-accent-blue)",
          }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
