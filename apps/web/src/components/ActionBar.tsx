import { useState, useRef, useCallback, useEffect } from "react";
import { getAuthHeaders } from "../lib/telegram";
import { SORT_OPTIONS, type SortMode } from "./FileViewer";

/** Hook: swipe-down-to-close — ONLY from header/drag handle area */
function useSwipeDown(onClose: () => void, threshold = 80) {
  const startY = useRef(0);
  const currentY = useRef(0);
  const sheetRef = useRef<HTMLDivElement>(null);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    e.stopPropagation(); // prevent Telegram mini app from minimizing
    startY.current = e.touches[0].clientY;
    currentY.current = e.touches[0].clientY;
    if (sheetRef.current) sheetRef.current.style.transition = "none";
  }, []);

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    e.stopPropagation();
    currentY.current = e.touches[0].clientY;
    const dy = currentY.current - startY.current;
    if (dy > 0 && sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
    }
  }, []);

  const onTouchEnd = useCallback(() => {
    const dy = currentY.current - startY.current;
    if (sheetRef.current) {
      sheetRef.current.style.transition = "transform 200ms ease-out";
      if (dy > threshold) {
        sheetRef.current.style.transform = "translateY(100%)";
        setTimeout(onClose, 200);
      } else {
        sheetRef.current.style.transform = "translateY(0)";
      }
    }
  }, [onClose, threshold]);

  return { sheetRef, onTouchStart, onTouchMove, onTouchEnd };
}

interface ActionBarProps {
  onReconnect?: () => void;
  connected?: boolean;
  activeTab?: string;
  fileShowHidden?: boolean;
  setFileShowHidden?: (v: boolean) => void;
  fileSortMode?: SortMode;
  setFileSortMode?: (v: SortMode) => void;
  viewingFile?: { path: string; name: string } | null;
}

type Modal = null | "commands" | "compact-confirm" | "compact-focus" | "continuity-notes" | "rename" | "fork-name" | "git-status" | "git-menu" | "todo" | "resume" | "new-confirm" | "file-options" | "file-search" | "audio-gen" | "tldr" | "confirm-delete" | "reconnect-menu";

/** Bottom sheet — swipe-to-close ONLY from header, content scrolls independently */
function BottomSheet({ onClose, title, children }: { onClose: () => void; title: string; children: React.ReactNode }) {
  const { sheetRef, onTouchStart, onTouchMove, onTouchEnd } = useSwipeDown(onClose);
  const [bottomOffset, setBottomOffset] = useState(0);

  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.safeAreaInset?.bottom) setBottomOffset(tg.safeAreaInset.bottom);
  }, []);

  // Disable Telegram's swipe-to-minimize while bottom sheet is open (Bot API 7.7+)
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg?.disableVerticalSwipes) tg.disableVerticalSwipes();
    return () => { if (tg?.enableVerticalSwipes) tg.enableVerticalSwipes(); };
  }, []);

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", flexDirection: "column", justifyContent: "flex-end" }}
      onClick={onClose}
    >
      <div
        ref={sheetRef}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#1a1b26",
          borderTop: "1px solid #2a2b3d",
          borderRadius: "16px 16px 0 0",
          maxHeight: "70vh",
          display: "flex",
          flexDirection: "column",
          paddingBottom: bottomOffset,
          animation: "slideUp 200ms ease-out",
        }}
      >
        {/* Header — ONLY this area triggers swipe-to-close */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={{ padding: "12px 16px 0", cursor: "grab", flexShrink: 0 }}
        >
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 8 }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: "#3b3d57" }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: "#c0caf5", marginBottom: 12 }}>{title}</div>
        </div>
        {/* Content — scrolls independently, does NOT trigger swipe-to-close or Telegram minimize */}
        <div style={{ overflowY: "auto", padding: "0 16px 24px", flex: 1, minHeight: 0 }}>
          {children}
        </div>
      </div>
      <style>{`@keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }`}</style>
    </div>
  );
}

export function ActionBar({ onReconnect, connected, activeTab, fileShowHidden, setFileShowHidden, fileSortMode, setFileSortMode, viewingFile }: ActionBarProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [compactFocus, setCompactFocus] = useState("");
  const [continuityNotes, setContinuityNotes] = useState("");
  const [renameName, setRenameName] = useState("");
  const [forkName, setForkName] = useState("");
  const [resumeName, setResumeName] = useState("");
  const [gitOutput, setGitOutput] = useState("");
  const [todoContent, setTodoContent] = useState("");
  const [sessionNames, setSessionNames] = useState<{ name: string; ts: number }[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; ts: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ name: string; path: string; type: string; relPath: string }[]>([]);
  const [audioStatus, setAudioStatus] = useState<{ exists: boolean; path?: string } | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [gitBranch, setGitBranch] = useState<{ branch: string; treeType: string } | null>(null);
  const [tldrLoading, setTldrLoading] = useState(false);
  const [tldrSummary, setTldrSummary] = useState<string | null>(null);
  const [tldrError, setTldrError] = useState<string | null>(null);
  const [tldrCached, setTldrCached] = useState(false);
  const [tldrMs, setTldrMs] = useState(0);
  const [tldrCopied, setTldrCopied] = useState(false);

  const btnStyle = { padding: "6px 12px", fontSize: 12, borderRadius: 6, background: "#24283b", color: "#a9b1d6", border: "1px solid #2a2b3d", cursor: "pointer", whiteSpace: "nowrap" as const, flexShrink: 0 };
  const modalCenter = { position: "fixed" as const, inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 };

  // --- API helpers ---
  const handleAction = async (endpoint: string, label: string) => {
    setStatus(`Running ${label}...`);
    try {
      const res = await fetch(endpoint, { method: "POST", headers: getAuthHeaders() });
      const data = await res.json();
      if (!res.ok) setStatus(`Failed: ${data.error || "unknown error"}`);
      else setStatus(data.output || `${label}: OK`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const fetchGitStatus = async () => {
    try {
      const res = await fetch("/api/terminal/git-status", { headers: getAuthHeaders() });
      const data = await res.json();
      setGitOutput(data.output || "No output");
    } catch { setGitOutput("Failed to fetch"); }
  };

  const fetchTodo = async () => {
    try {
      const res = await fetch("/api/todo", { headers: getAuthHeaders() });
      const data = await res.json();
      setTodoContent(data.content || "No TODO.md found");
    } catch { setTodoContent("Failed to fetch"); }
  };

  const fetchSessionNames = async () => {
    try {
      const res = await fetch("/api/session/names", { headers: getAuthHeaders() });
      const data = await res.json();
      setSessionNames(data.names || []);
    } catch { setSessionNames([]); }
  };

  const deleteSessionName = async (ts: number) => {
    try {
      await fetch("/api/session/names", {
        method: "DELETE",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ts }),
      });
      setSessionNames((prev) => prev.filter((s) => s.ts !== ts));
    } catch { /* silent */ }
    setDeleteTarget(null);
    setModal("resume");
  };

  const fetchGitBranch = async () => {
    try {
      const res = await fetch("/api/terminal/git-branch", { headers: getAuthHeaders() });
      const data = await res.json();
      if (data.ok) setGitBranch({ branch: data.branch, treeType: data.treeType });
    } catch { /* silent */ }
  };

  // Fetch git branch on mount and every 30 seconds
  useEffect(() => {
    fetchGitBranch();
    const interval = setInterval(fetchGitBranch, 30000);
    return () => clearInterval(interval);
  }, []);

  const sendToTmux = async (text: string) => {
    try {
      await fetch("/api/terminal/send-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ keys: text }),
      });
    } catch { /* fire and forget */ }
  };

  const sendRawKey = async (key: string) => {
    try {
      await fetch("/api/terminal/send-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({ keys: key, raw: true }),
      });
    } catch { /* fire and forget */ }
  };

  const sendCompactCommand = async (message: string, statusLabel?: string) => {
    setModal(null);
    const label = statusLabel || "Compact";
    setStatus(`${label}...`);
    try {
      const res = await fetch("/api/terminal/compact", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      setStatus(data.ok ? `${label} sent` : `Failed: ${data.error}`);
    } catch (err) {
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const renameSession = async () => {
    if (!renameName.trim()) return;
    setModal(null);
    setStatus("Renaming...");
    sendToTmux(`/rename ${renameName.trim()}`);
    try {
      const res = await fetch("/api/session/rename", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: renameName.trim() }),
      });
      const data = await res.json();
      setStatus(data.ok ? `Renamed to "${renameName.trim()}"` : `Failed: ${data.error}`);
    } catch {
      setStatus(`Renamed to "${renameName.trim()}"`);
    }
    setTimeout(() => setStatus(null), 2000);
  };

  const handleGitAction = async (action: { label: string; command: string }) => {
    setGitOutput(`Running ${action.label}...`);
    setModal("git-status");
    try {
      const res = await fetch("/api/terminal/git-command", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ command: action.command }),
      });
      const data = await res.json();
      setGitOutput(data.output || "No output");
    } catch { setGitOutput("Failed to run command"); }
  };

  const searchFiles = async (q: string) => {
    if (q.length < 2) { setSearchResults([]); return; }
    try {
      const res = await fetch(`/api/files/search?q=${encodeURIComponent(q)}`, { headers: getAuthHeaders() });
      const data = await res.json();
      setSearchResults(data.results || []);
    } catch { setSearchResults([]); }
  };

  const checkAudio = async (filePath: string) => {
    setAudioStatus(null);
    setAudioLoading(true);
    try {
      const res = await fetch(`/api/audio/check?path=${encodeURIComponent(filePath)}`, { headers: getAuthHeaders() });
      const data = await res.json();
      setAudioStatus({ exists: data.exists, path: data.path });
    } catch { setAudioStatus(null); }
    setAudioLoading(false);
  };

  const generateAudio = async (filePath: string) => {
    setAudioLoading(true);
    setStatus("Generating audio...");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout
      const res = await fetch("/api/audio/generate", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (data.ok) {
        setAudioStatus({ exists: true, path: data.path });
        setStatus("Audio generated");
      } else {
        setStatus(`Failed: ${data.error}`);
      }
    } catch (err) {
      setStatus(err instanceof DOMException && err.name === "AbortError" ? "Timed out" : `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAudioLoading(false);
    }
  };

  const sendAudioTelegram = async (audioPath: string) => {
    setAudioLoading(true);
    setStatus("Sending to Telegram...");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
      const res = await fetch("/api/audio/send-telegram", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ path: audioPath }),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const data = await res.json();
      setStatus(data.ok ? "Sent to Telegram" : `Failed: ${data.error}`);
    } catch (err) {
      setStatus(err instanceof DOMException && err.name === "AbortError" ? "Timed out" : `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAudioLoading(false);
    }
  };

  // Per-request counter to scope TL;DR state to the specific in-flight
  // call, not just the file path. Every request increments the counter
  // and captures its own snapshot. Late-arriving responses check that
  // the counter hasn't moved since they started; if it has, they are
  // stale and silently discarded. Also handles the "same file summarized
  // twice" race — an older call for file A cannot overwrite a newer one.
  const tldrRequestIdRef = useRef(0);

  const generateTldr = async (filePath: string) => {
    const requestId = ++tldrRequestIdRef.current;
    setTldrLoading(true);
    setTldrError(null);
    setTldrSummary(null);
    setTldrCopied(false);
    // Client timeout must be slightly LONGER than the server-side claude
    // CLI timeout (60s). If the client gives up first, the server keeps
    // running the LLM call for no benefit and the user sees a misleading
    // "took too long" error while the real answer was still coming. 70s
    // gives the server its full 60s plus ~10s network + JSON overhead.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 70_000);
    try {
      const res = await fetch("/api/markdown/summarize", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
        signal: controller.signal,
      });
      if (tldrRequestIdRef.current !== requestId) return;
      const data = await res.json();
      if (tldrRequestIdRef.current !== requestId) return;
      if (!data.ok) {
        setTldrError(data.error || "Failed to generate summary");
      } else {
        setTldrSummary(data.summary);
        setTldrCached(Boolean(data.cached));
        setTldrMs(Number(data.ms) || 0);
      }
    } catch (err) {
      if (tldrRequestIdRef.current !== requestId) return;
      setTldrError(
        err instanceof DOMException && err.name === "AbortError"
          ? "Took too long — Claude may be slow right now"
          : `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      // Always clear the timeout — prior code only cleared after fetch
      // resolved, leaking the timeout on fast rejections (network error,
      // CORS, etc). The cleanup must happen regardless of outcome.
      clearTimeout(timeout);
      if (tldrRequestIdRef.current === requestId) {
        setTldrLoading(false);
      }
    }
  };

  const copyTldr = async () => {
    if (!tldrSummary) return;
    try {
      await navigator.clipboard.writeText(tldrSummary);
      setTldrCopied(true);
      setTimeout(() => setTldrCopied(false), 1500);
    } catch {
      setTldrError("Clipboard copy failed");
    }
  };

  // Debounced file search
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchInput = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => searchFiles(q), 300);
  }, []);

  // Clear status after 4 seconds
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <>
      {/* ===== MODALS ===== */}

      {/* Commands bottom sheet */}
      {modal === "commands" && (
        <BottomSheet onClose={() => setModal(null)} title="/commands">
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {/* Quick key buttons at top */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => { sendRawKey("Escape"); setModal(null); setStatus("Sent: Esc"); setTimeout(() => setStatus(null), 1500); }}
                style={{ ...btnStyle, flex: 1, padding: "12px 0", textAlign: "center" as const, fontSize: 13, fontWeight: 600, color: "#f7768e" }}
              >
                Esc
              </button>
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  onClick={() => { sendToTmux(String(n)); setModal(null); setStatus(`Sent: ${n}`); setTimeout(() => setStatus(null), 1500); }}
                  style={{ ...btnStyle, flex: 1, padding: "12px 0", textAlign: "center" as const, fontSize: 16, fontWeight: 600 }}
                >
                  {n}
                </button>
              ))}
              <button
                onClick={() => { sendRawKey("BTab"); setModal(null); setStatus("Sent: \u21e7Tab"); setTimeout(() => setStatus(null), 1500); }}
                style={{ ...btnStyle, flex: 1, padding: "12px 0", textAlign: "center" as const, fontSize: 11, fontWeight: 600, color: "#bb9af7" }}
              >
                {"\u21e7Tab"}
              </button>
              <button
                onClick={() => { sendRawKey("C-b"); setModal(null); setStatus("Sent: ^B"); setTimeout(() => setStatus(null), 1500); }}
                style={{ ...btnStyle, flex: 1, padding: "12px 0", textAlign: "center" as const, fontSize: 11, fontWeight: 600, color: "#e0af68" }}
              >
                ^B
              </button>
            </div>
            <button
              onClick={() => setModal("new-confirm")}
              style={{ ...btnStyle, padding: "4px 12px", textAlign: "left" as const, background: "#3a2020", color: "#f7768e", border: "1px solid #5a3030", fontFamily: "monospace" }}
            >
              /new
              <div style={{ fontSize: 10, color: "#6a4040", marginTop: 1 }}>Start a new conversation</div>
            </button>
            <button
              onClick={() => { fetchSessionNames(); setModal("resume"); }}
              style={{ ...btnStyle, padding: "4px 12px", textAlign: "left" as const, background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d", fontFamily: "monospace" }}
            >
              /resume
              <div style={{ fontSize: 10, color: "#4a7a5a", marginTop: 1 }}>Switch to a previous session</div>
            </button>
            <button
              onClick={() => { setForkName(""); setModal("fork-name"); }}
              style={{ ...btnStyle, padding: "4px 12px", textAlign: "left" as const, fontFamily: "monospace" }}
            >
              /branch <span style={{ color: "#565f89", fontFamily: "inherit" }}>(fork)</span>
              <div style={{ fontSize: 10, color: "#565f89", marginTop: 1 }}>Branch or fork this conversation</div>
            </button>
            <button
              onClick={() => { setRenameName(""); setModal("rename"); }}
              style={{ ...btnStyle, padding: "4px 12px", textAlign: "left" as const, fontFamily: "monospace" }}
            >
              /rename
              <div style={{ fontSize: 10, color: "#565f89", marginTop: 1 }}>Give this session a name</div>
            </button>
            <button
              onClick={() => setModal("compact-confirm")}
              style={{ ...btnStyle, padding: "4px 12px", textAlign: "left" as const, background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a", fontFamily: "monospace" }}
            >
              /compact
              <div style={{ fontSize: 10, color: "#4a5a8a", marginTop: 1 }}>Compress conversation context</div>
            </button>
          </div>
        </BottomSheet>
      )}

      {/* Rename modal */}
      {modal === "rename" && (
        <div style={modalCenter} onClick={() => setModal("commands")}>
          <div
            style={{ background: "#1a1b26", border: "1px solid #2a2b3d", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#c0caf5" }}>Rename Session</div>
            <input
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              placeholder="Session name..."
              style={{
                width: "100%", padding: 10, background: "#24283b", color: "#c0caf5",
                border: "1px solid #3b3d57", borderRadius: 6, fontSize: 13, fontFamily: "inherit",
              }}
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && renameSession()}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setModal("commands")} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2a2a", color: "#f7768e", border: "1px solid #5a3d3d" }}>Back</button>
              <button onClick={renameSession} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a" }}>Rename</button>
            </div>
          </div>
        </div>
      )}

      {/* Fork name modal */}
      {modal === "fork-name" && (
        <div style={modalCenter} onClick={() => setModal("commands")}>
          <div
            style={{ background: "#1a1b26", border: "1px solid #2a2b3d", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4, color: "#c0caf5" }}>Branch / Fork</div>
            <div style={{ fontSize: 12, color: "#565f89", marginBottom: 12 }}>Name the new branch (optional)</div>
            <input
              value={forkName}
              onChange={(e) => setForkName(e.target.value)}
              placeholder="Branch name..."
              style={{
                width: "100%", padding: 10, background: "#24283b", color: "#c0caf5",
                border: "1px solid #3b3d57", borderRadius: 6, fontSize: 13, fontFamily: "inherit",
              }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const name = forkName.trim();
                  setModal(null);
                  sendToTmux(name ? `/fork\n/rename ${name}` : "/fork");
                  setStatus(name ? `Forked as "${name}"` : "Forked");
                  setTimeout(() => setStatus(null), 2000);
                }
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setModal("commands")} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2a2a", color: "#f7768e", border: "1px solid #5a3d3d" }}>Back</button>
              <button
                onClick={() => {
                  const name = forkName.trim();
                  setModal(null);
                  sendToTmux(name ? `/fork\n/rename ${name}` : "/fork");
                  setStatus(name ? `Forked as "${name}"` : "Forked");
                  setTimeout(() => setStatus(null), 2000);
                }}
                style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a" }}
              >Fork</button>
            </div>
          </div>
        </div>
      )}

      {/* Resume session modal */}
      {modal === "resume" && (
        <BottomSheet onClose={() => setModal("commands")} title="Resume Session">
          {sessionNames.length === 0 ? (
            <div style={{ fontSize: 13, color: "#565f89", padding: 16, textAlign: "center" }}>No saved sessions</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {sessionNames.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 6, alignItems: "stretch" }}>
                  <button
                    onClick={() => {
                      setModal(null);
                      sendCompactCommand(`/resume ${s.name}`, "Resume");
                    }}
                    style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" as const, flex: 1 }}
                  >
                    {s.name}
                    <div style={{ fontSize: 10, color: "#565f89", marginTop: 2 }}>
                      {new Date(s.ts).toLocaleDateString()}
                    </div>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteTarget(s);
                      setModal("confirm-delete");
                    }}
                    style={{
                      ...btnStyle,
                      padding: "0 12px",
                      color: "#f7768e",
                      background: "#2a2020",
                      border: "1px solid #3a2a2a",
                      fontSize: 16,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </BottomSheet>
      )}

      {/* Confirm delete session name modal */}
      {modal === "confirm-delete" && deleteTarget && (
        <BottomSheet onClose={() => { setDeleteTarget(null); setModal("resume"); }} title="Delete Session Name">
          <div style={{ padding: "8px 0" }}>
            <div style={{ fontSize: 14, color: "#c0caf5", marginBottom: 4 }}>
              Delete "{deleteTarget.name}"?
            </div>
            <div style={{ fontSize: 12, color: "#565f89", marginBottom: 16 }}>
              This only removes the name from the list. It does not delete the session itself.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => { setDeleteTarget(null); setModal("resume"); }}
                style={{ ...btnStyle, flex: 1, padding: "10px 16px" }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteSessionName(deleteTarget.ts)}
                style={{
                  ...btnStyle,
                  flex: 1,
                  padding: "10px 16px",
                  background: "#3a2020",
                  color: "#f7768e",
                  border: "1px solid #5a3030",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </BottomSheet>
      )}

      {/* Reconnect menu */}
      {modal === "reconnect-menu" && (
        <BottomSheet onClose={() => setModal(null)} title="Session Controls">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button
              onClick={() => { if (onReconnect) onReconnect(); setModal(null); }}
              style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" as const, background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d" }}
            >
              Reconnect Terminal
              <div style={{ fontSize: 10, color: "#4a7a5a", marginTop: 2 }}>Refresh the terminal WebSocket connection</div>
            </button>
            <button
              onClick={async () => {
                setModal(null);
                setStatus("Restarting session...");
                try {
                  const res = await fetch("/api/terminal/restart-session", {
                    method: "POST",
                    headers: getAuthHeaders(),
                  });
                  const data = await res.json();
                  setStatus(data.ok ? "Session restarted" : `Failed: ${data.error}`);
                } catch { setStatus("Restart failed"); }
                setTimeout(() => setStatus(null), 3000);
              }}
              style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" as const, background: "#3a2020", color: "#f7768e", border: "1px solid #5a3030" }}
            >
              Restart Claude Session
              <div style={{ fontSize: 10, color: "#7a4a4a", marginTop: 2 }}>Kill tmux session and start fresh</div>
            </button>
          </div>
        </BottomSheet>
      )}

      {/* New session confirm modal */}
      {modal === "new-confirm" && (
        <div style={modalCenter} onClick={() => setModal("commands")}>
          <div
            style={{ background: "#1a1b26", border: "1px solid #2a2b3d", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: "#c0caf5" }}>Start new session?</div>
            <div style={{ fontSize: 12, color: "#565f89", marginBottom: 16 }}>
              This will end the current conversation and start fresh.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => setModal("commands")} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#24283b", color: "#565f89", border: "1px solid #3b3d57" }}>Cancel</button>
              <button
                onClick={() => sendCompactCommand("/new", "New session")}
                style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2020", color: "#f7768e", border: "1px solid #5a3030" }}
              >
                New
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Git status bottom sheet */}
      {modal === "git-status" && (
        <BottomSheet onClose={() => setModal(null)} title="Git Status">
          <pre style={{
            fontSize: 11, color: "#a9b1d6", background: "#24283b", padding: 12,
            borderRadius: 6, overflow: "auto", maxHeight: "50vh", whiteSpace: "pre-wrap", wordBreak: "break-all",
            fontFamily: "'SF Mono', 'Fira Code', monospace",
          }}>
            {gitOutput || "Loading..."}
          </pre>
          <button onClick={() => setModal(null)} style={{ ...btnStyle, marginTop: 12, width: "100%", padding: "10px 16px", textAlign: "center" as const }}>Close</button>
        </BottomSheet>
      )}

      {/* Git menu bottom sheet */}
      {modal === "git-menu" && (
        <BottomSheet onClose={() => setModal(null)} title="Git">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={() => { fetchGitStatus(); setModal("git-status"); }}
              style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" as const }}
            >
              View Status
            </button>
            <button
              onClick={() => handleGitAction({ label: "Check Branch", command: "branch" })}
              style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" as const }}
            >
              Check Branch
            </button>
            <button
              onClick={() => handleGitAction({ label: "View Log", command: "log" })}
              style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" as const }}
            >
              View Log
            </button>
            <button
              onClick={() => handleGitAction({ label: "Pull", command: "pull" })}
              style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" as const, background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d" }}
            >
              Pull
            </button>
          </div>
        </BottomSheet>
      )}

      {/* TODO bottom sheet */}
      {modal === "todo" && (
        <BottomSheet onClose={() => setModal(null)} title="TODO">
          <pre style={{
            fontSize: 11, color: "#a9b1d6", background: "#24283b", padding: 12,
            borderRadius: 6, overflow: "auto", maxHeight: "50vh", whiteSpace: "pre-wrap", wordBreak: "break-all",
            fontFamily: "'SF Mono', 'Fira Code', monospace",
          }}>
            {todoContent || "Loading..."}
          </pre>
          <button onClick={() => setModal(null)} style={{ ...btnStyle, marginTop: 12, width: "100%", padding: "10px 16px", textAlign: "center" as const }}>Close</button>
        </BottomSheet>
      )}

      {/* Compact confirm modal */}
      {modal === "compact-confirm" && (
        <div style={modalCenter} onClick={() => setModal(null)}>
          <div
            style={{ background: "#1a1b26", border: "1px solid #2a2b3d", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#c0caf5" }}>Compact Context</div>
            <div style={{ fontSize: 13, color: "#a9b1d6", marginBottom: 16, lineHeight: 1.5 }}>
              Choose how to compact the conversation:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => { setCompactFocus(""); setModal("compact-focus"); }}
                style={{ ...btnStyle, background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a", padding: "10px 16px", textAlign: "left" as const }}
              >
                Compact Now
                <div style={{ fontSize: 11, color: "#565f89", marginTop: 2 }}>Compress context immediately</div>
              </button>
              <button
                onClick={() => { setContinuityNotes(""); setModal("continuity-notes"); }}
                style={{ ...btnStyle, background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d", padding: "10px 16px", textAlign: "left" as const }}
              >
                Prompt for Continuity
                <div style={{ fontSize: 11, color: "#4a7a5a", marginTop: 2 }}>Save context to files first, then compact</div>
              </button>
              <button
                onClick={() => setModal(null)}
                style={{ ...btnStyle, background: "#3a2a2a", color: "#f7768e", border: "1px solid #5a3d3d", padding: "10px 16px" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Compact focus modal */}
      {modal === "compact-focus" && (
        <div style={modalCenter} onClick={() => setModal("compact-confirm")}>
          <div
            style={{ background: "#1a1b26", border: "1px solid #2a2b3d", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: "#c0caf5" }}>Compact Focus</div>
            <div style={{ fontSize: 12, color: "#565f89", marginBottom: 12 }}>
              Optionally steer what the compact summary focuses on:
            </div>
            <textarea
              value={compactFocus}
              onChange={(e) => setCompactFocus(e.target.value)}
              placeholder="e.g. Focus on the auth refactor and voice recorder plan..."
              style={{
                width: "100%", height: 80, background: "#24283b", color: "#c0caf5",
                border: "1px solid #3b3d57", borderRadius: 6, padding: 10, fontSize: 13,
                resize: "vertical", fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setModal("compact-confirm")} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2a2a", color: "#f7768e", border: "1px solid #5a3d3d" }}>Back</button>
              <button
                onClick={() => {
                  const focus = compactFocus.trim();
                  sendCompactCommand(focus ? `/compact ${focus}` : "/compact");
                }}
                style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a" }}
              >
                Compact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Continuity notes modal */}
      {modal === "continuity-notes" && (
        <div style={modalCenter} onClick={() => setModal("compact-confirm")}>
          <div
            style={{ background: "#1a1b26", border: "1px solid #2a2b3d", borderRadius: 12, padding: 20, maxWidth: 320, width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: "#c0caf5" }}>Additional Notes</div>
            <div style={{ fontSize: 12, color: "#565f89", marginBottom: 12 }}>
              Anything extra to preserve before compacting? (optional)
            </div>
            <textarea
              value={continuityNotes}
              onChange={(e) => setContinuityNotes(e.target.value)}
              placeholder="e.g. Remember we were debugging the auth issue..."
              style={{
                width: "100%", height: 100, background: "#24283b", color: "#c0caf5",
                border: "1px solid #3b3d57", borderRadius: 6, padding: 10, fontSize: 13,
                resize: "vertical", fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button onClick={() => setModal("compact-confirm")} style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#3a2a2a", color: "#f7768e", border: "1px solid #5a3d3d" }}>Back</button>
              <button
                onClick={() => {
                  const base = "Before compacting, please ensure: 1) README.md is up to date with recent changes. 2) Anything important from this session is saved to the knowledge base or memory. 3) Open work and next steps are captured in NEXT-SESSION.md and TODO.md.";
                  const notes = continuityNotes.trim() ? ` Additional context from user: "${continuityNotes.trim()}".` : "";
                  sendCompactCommand(`${base}${notes}`);
                }}
                style={{ ...btnStyle, flex: 1, padding: "10px 16px", background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d" }}
              >
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* File options bottom sheet */}
      {modal === "file-options" && (
        <BottomSheet onClose={() => setModal(null)} title="File Options">
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              onClick={() => { setFileShowHidden?.(!fileShowHidden); setModal(null); }}
              style={{ ...btnStyle, padding: "10px 14px", textAlign: "left" as const }}
            >
              {fileShowHidden ? "Hide Hidden Files" : "Show Hidden Files"}
            </button>
            <div style={{ fontSize: 12, color: "#565f89", marginTop: 4, marginBottom: 2 }}>Sort by:</div>
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => { setFileSortMode?.(opt.value); setModal(null); }}
                style={{
                  ...btnStyle,
                  padding: "10px 14px",
                  textAlign: "left" as const,
                  ...(fileSortMode === opt.value ? { background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a" } : {}),
                }}
              >
                {opt.long}
                {fileSortMode === opt.value && " \u2713"}
              </button>
            ))}
          </div>
        </BottomSheet>
      )}

      {/* File search bottom sheet */}
      {modal === "file-search" && (
        <BottomSheet onClose={() => setModal(null)} title="Search Files">
          <input
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            placeholder="Search files..."
            style={{
              width: "100%", padding: 10, background: "#24283b", color: "#c0caf5",
              border: "1px solid #3b3d57", borderRadius: 6, fontSize: 13, fontFamily: "inherit",
              marginBottom: 8,
            }}
            autoFocus
          />
          <div style={{ maxHeight: "40vh", overflowY: "auto" }}>
            {searchResults.length === 0 && searchQuery.length >= 2 && (
              <div style={{ fontSize: 12, color: "#565f89", padding: 12, textAlign: "center" }}>No results</div>
            )}
            {searchResults.map((r, i) => (
              <button
                key={i}
                onClick={() => {
                  setModal(null);
                  window.location.hash = `files&file=${encodeURIComponent(r.path)}`;
                  window.location.reload();
                }}
                style={{
                  ...btnStyle,
                  display: "block",
                  width: "100%",
                  padding: "8px 12px",
                  textAlign: "left" as const,
                  marginBottom: 4,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                <span style={{ color: r.type === "directory" ? "#e0af68" : "#7aa2f7" }}>
                  {r.type === "directory" ? "\uD83D\uDCC1 " : "\uD83D\uDCC4 "}
                </span>
                {r.name}
                <div style={{ fontSize: 10, color: "#565f89", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {r.relPath}
                </div>
              </button>
            ))}
          </div>
        </BottomSheet>
      )}

      {/* TL;DR modal */}
      {modal === "tldr" && viewingFile && (
        <BottomSheet onClose={() => setModal(null)} title="TL;DR">
          <div style={{ fontSize: 12, color: "#a9b1d6", marginBottom: 12 }}>
            {viewingFile.name}
          </div>
          {tldrLoading && (
            <div style={{ fontSize: 13, color: "#565f89", padding: 16, textAlign: "center" }}>
              Summarizing with Claude Haiku...
            </div>
          )}
          {!tldrLoading && tldrError && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#f7768e", padding: "8px 10px", background: "#2a1a22", border: "1px solid #4a2d3a", borderRadius: 6 }}>
                {tldrError}
              </div>
              <button
                onClick={() => viewingFile && generateTldr(viewingFile.path)}
                style={{ ...btnStyle, padding: "10px 14px", background: "#1a3a3a", color: "#7dcfff", border: "1px solid #2d5a5a" }}
              >
                Retry
              </button>
            </div>
          )}
          {!tldrLoading && !tldrError && tldrSummary && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ fontSize: 10, color: "#565f89" }}>
                {tldrCached ? "cached" : `fresh (${tldrMs}ms)`}
              </div>
              <div
                style={{
                  background: "#16171f",
                  border: "1px solid #2a2b3d",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 13,
                  color: "#c0caf5",
                  maxHeight: "45vh",
                  overflowY: "auto",
                }}
              >
                {/* XSS defense: the TL;DR summary comes from an LLM whose
                    input is the (potentially malicious) markdown file. A
                    prompt-injected document could coerce the model into
                    emitting raw HTML, <script>, or javascript: URLs which
                    MarkdownViewer's marked + dangerouslySetInnerHTML
                    pipeline would render unsanitized. Render the summary
                    as plain text inside a <pre> instead of the MarkdownViewer
                    so no HTML parsing happens at all. This sacrifices
                    markdown rendering (bold, headings look like raw ##) but
                    eliminates the attack surface entirely. Wave 2 react-
                    markdown migration will let us switch back to rich
                    rendering with rehype-sanitize defenses. */}
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    margin: 0,
                    fontFamily: "inherit",
                    fontSize: "inherit",
                    lineHeight: 1.5,
                  }}
                >
                  {tldrSummary}
                </pre>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  onClick={copyTldr}
                  style={{ ...btnStyle, padding: "10px 14px", background: "#1a3a3a", color: "#7dcfff", border: "1px solid #2d5a5a" }}
                >
                  {tldrCopied ? "Copied" : "Copy"}
                </button>
                <button
                  onClick={() => viewingFile && generateTldr(viewingFile.path)}
                  style={{ ...btnStyle, padding: "10px 14px" }}
                >
                  Regenerate
                </button>
              </div>
            </div>
          )}
        </BottomSheet>
      )}

      {/* Audio generation modal */}
      {modal === "audio-gen" && viewingFile && (
        <BottomSheet onClose={() => setModal(null)} title="Audio">
          <div style={{ fontSize: 12, color: "#a9b1d6", marginBottom: 12 }}>
            {viewingFile.name}
          </div>
          {audioLoading ? (
            <div style={{ fontSize: 13, color: "#565f89", padding: 16, textAlign: "center" }}>Loading...</div>
          ) : audioStatus?.exists ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#9ece6a", marginBottom: 4 }}>Audio file exists</div>
              <button
                onClick={() => audioStatus.path && sendAudioTelegram(audioStatus.path)}
                style={{ ...btnStyle, padding: "10px 14px", background: "#2d2a3a", color: "#bb9af7", border: "1px solid #4a3d6a" }}
              >
                Send to Telegram
              </button>
              <button
                onClick={() => viewingFile && generateAudio(viewingFile.path)}
                style={{ ...btnStyle, padding: "10px 14px" }}
              >
                Regenerate
              </button>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 12, color: "#565f89", marginBottom: 4 }}>No audio file found</div>
              <button
                onClick={() => viewingFile && generateAudio(viewingFile.path)}
                style={{ ...btnStyle, padding: "10px 14px", background: "#2d2a3a", color: "#bb9af7", border: "1px solid #4a3d6a" }}
              >
                Generate Audio
              </button>
            </div>
          )}
        </BottomSheet>
      )}

      {/* ===== ACTION BAR ===== */}
      <div style={{ padding: "10px 12px 8px", borderTop: "1px solid #2a2b3d", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "8px", overflowX: "auto" }}>
          {/* TODO — always first */}
          <button onClick={() => { setModal("todo"); fetchTodo(); }} style={{ ...btnStyle, background: "#3a3520", color: "#e0af68", border: "1px solid #5a4a30" }}>
            TODO
          </button>
          {/* Tab-specific buttons */}
          {activeTab === "terminal" && (
            <>
              {onReconnect && (
                <div style={{ display: "flex", flexShrink: 0 }}>
                  <button onClick={onReconnect} style={{ ...btnStyle, background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d", borderRadius: "6px 0 0 6px", borderRight: "none" }}>
                    Reconnect
                  </button>
                  <button onClick={() => setModal("reconnect-menu")} style={{ ...btnStyle, background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d", borderRadius: "0 6px 6px 0", padding: "6px 8px", fontSize: 14 }}>
                    &#9652;
                  </button>
                </div>
              )}
              <div style={{ display: "flex", flexShrink: 0 }}>
                <button onClick={() => { setModal("git-status"); fetchGitStatus(); }} style={{ ...btnStyle, borderRadius: "6px 0 0 6px", borderRight: "none" }}>
                  Git
                </button>
                <button onClick={() => setModal("git-menu")} style={{ ...btnStyle, borderRadius: "0 6px 6px 0", padding: "6px 8px", fontSize: 14 }}>
                  &#9652;
                </button>
              </div>
              <button onClick={() => setModal("commands")} style={{ ...btnStyle, background: "#2d2a3a", color: "#bb9af7", border: "1px solid #4a3d6a" }}>
                /commands
              </button>
            </>
          )}
          {activeTab === "files" && !viewingFile && (
            <>
              <button onClick={() => { setSearchQuery(""); setSearchResults([]); setModal("file-search"); }} style={{ ...btnStyle, background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a" }}>
                Search
              </button>
              <button onClick={() => setModal("file-options")} style={btnStyle}>
                Options
              </button>
            </>
          )}
          {activeTab === "files" && viewingFile && (
            <button
              onClick={async () => {
                setStatus("Sharing...");
                try {
                  const res = await fetch("/api/telegram/send-to-chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json", ...getAuthHeaders() },
                    body: JSON.stringify({ filePath: viewingFile.path }),
                  });
                  const data = await res.json();
                  setStatus(data.ok ? "Sent to chat" : "Failed");
                } catch { setStatus("Failed"); }
                setTimeout(() => setStatus(null), 2000);
              }}
              style={{ ...btnStyle, background: "#1a2a3a", color: "#7dcfff", border: "1px solid #2d4a5a" }}
            >
              Send to Chat
            </button>
          )}
          {activeTab === "files" && viewingFile?.name.endsWith(".md") && (
            <button
              onClick={() => {
                setTldrError(null);
                setTldrSummary(null);
                setTldrCopied(false);
                setModal("tldr");
                generateTldr(viewingFile.path);
              }}
              style={{ ...btnStyle, background: "#1a3a3a", color: "#7dcfff", border: "1px solid #2d5a5a" }}
            >
              TL;DR
            </button>
          )}
          {activeTab === "files" && viewingFile?.name.endsWith(".md") && (
            <button onClick={() => { checkAudio(viewingFile.path); setModal("audio-gen"); }} style={{ ...btnStyle, background: "#2d2a3a", color: "#bb9af7", border: "1px solid #4a3d6a" }}>
              Audio
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: connected === false ? "#f7768e" : "#7aa2f7", marginTop: 6, textAlign: "center", minHeight: 16, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {status || (connected === false ? "[disconnected]" : gitBranch ? `\uD83D\uDD00 ${gitBranch.branch} (${gitBranch.treeType})` : "\u00A0")}
        </div>
      </div>
    </>
  );
}
