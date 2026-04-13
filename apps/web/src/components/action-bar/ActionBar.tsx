import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { CommandsSheet } from "./CommandsSheet";
import { RenameModal } from "./RenameModal";
import { ForkNameModal } from "./ForkNameModal";
import { ResumeSheet, ConfirmDeleteSheet } from "./ResumeSheet";
import { NewConfirmModal } from "./NewConfirmModal";
import { CompactConfirmModal, CompactFocusModal, ContinuityNotesModal } from "./CompactModals";
import { GitStatusSheet, GitMenuSheet } from "./GitSheets";
import { TodoSheet } from "./TodoSheet";
import { ReconnectMenu } from "./ReconnectMenu";
import { FileOptionsSheet } from "./FileOptionsSheet";
import { FileSearchSheet } from "./FileSearchSheet";
import { TldrModal } from "./TldrModal";
import { AudioGenModal } from "./AudioGenModal";
import { StatusLine } from "./StatusLine";
import { btnStyle, type ActionBarProps, type AudioStatus, type GitBranch, type Modal, type SearchResult, type SessionName } from "./types";
import { checkAudio, deleteSessionName, fetchGitBranch, fetchGitStatus, fetchSessionNames, fetchTodo, generateAudio, postAction, renameSession, restartSession, runGitCommand, searchFiles, sendAudioTelegram, sendCompactCommand, sendFileToChat, sendToTmux } from "./api";

const SEARCH_SCOPE_KEY = "cpc:search:currentFolderOnly";

export function ActionBar({ onReconnect, connected, activeTab, fileShowHidden, setFileShowHidden, fileSortMode, setFileSortMode, viewingFile, currentFolder }: ActionBarProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [compactFocus, setCompactFocus] = useState("");
  const [continuityNotes, setContinuityNotes] = useState("");
  const [renameName, setRenameName] = useState("");
  const [forkName, setForkName] = useState("");
  const [gitOutput, setGitOutput] = useState("");
  const [todoContent, setTodoContent] = useState("");
  const [sessionNames, setSessionNames] = useState<SessionName[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<SessionName | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  // "Current folder only" search toggle — default ON, persisted per-user via
  // localStorage. When ON we pass the folder the user is browsing as a
  // `scope` query param; when OFF the server falls back to the old global
  // search across all allowed roots. (Search UX C3.)
  const [searchCurrentFolderOnly, setSearchCurrentFolderOnly] = useState<boolean>(() => {
    try {
      // Default to true unless explicitly set to "false" — so a fresh user
      // gets the scoped behavior we actually want as the default.
      return localStorage.getItem(SEARCH_SCOPE_KEY) !== "false";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try { localStorage.setItem(SEARCH_SCOPE_KEY, String(searchCurrentFolderOnly)); } catch { /* ignore */ }
  }, [searchCurrentFolderOnly]);
  // Keep the latest scope value in a ref so the debounced search callback
  // (which is a useCallback with a stable identity) can read the freshest
  // toggle + folder without needing to rebuild on every change.
  const searchScopeRef = useRef<string | null>(null);
  searchScopeRef.current = searchCurrentFolderOnly && currentFolder ? currentFolder : null;
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioOp, setAudioOp] = useState<"idle" | "checking" | "generating" | "sending">("idle");
  // Synchronous in-flight guard for audio generation/send. Mirrors the
  // TldrModal pattern (PR #121): React hasn't necessarily committed
  // setAudioLoading(true) by the time a fast double-tap fires the second
  // click handler, so a ref-based lock is the only way to prevent two
  // concurrent backend audio jobs racing each other.
  const audioInFlightRef = useRef(false);
  const [gitBranch, setGitBranch] = useState<GitBranch | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const loadGitBranch = async () => {
      try {
        setGitBranch(await fetchGitBranch());
      } catch (err) {
        console.error("Failed to fetch git branch:", err);
      }
    };
    void loadGitBranch();
    const interval = setInterval(loadGitBranch, 30000);
    return () => clearInterval(interval);
  }, []);

  // Clear the debounced file-search timer and abort any in-flight fetch on
  // unmount so the callback can't fire and setState on an unmounted
  // component, and a slow earlier response can't overwrite nothing either.
  // (Copilot round-3 timer review + Gemini round-3 race review.)
  useEffect(() => {
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = null;
      }
      if (searchAbortRef.current) {
        searchAbortRef.current.abort();
        searchAbortRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!status) return;
    const timer = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(timer);
  }, [status]);

  const handleAction = async (endpoint: string, label: string) => {
    setStatus(`Running ${label}...`);
    try {
      const data = await postAction(endpoint);
      setStatus(!data.ok ? `Failed: ${data.error || "unknown error"}` : data.output || `${label}: OK`);
    } catch (err) { setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`); }
  };
  const loadGitStatus = async () => { try { setGitOutput(await fetchGitStatus()); } catch { setGitOutput("Failed to fetch"); } };
  const loadTodo = async () => { try { setTodoContent(await fetchTodo()); } catch { setTodoContent("Failed to fetch"); } };
  const loadSessionNames = async () => { try { setSessionNames(await fetchSessionNames()); } catch { setSessionNames([]); } };
  const removeSessionName = async (ts: number) => { try { await deleteSessionName(ts); setSessionNames((prev) => prev.filter((s) => s.ts !== ts)); } catch {} setDeleteTarget(null); setModal("resume"); };
  const handleCompact = async (message: string, label = "Compact") => { setModal(null); setStatus(`${label}...`); try { const data = await sendCompactCommand(message); setStatus(data.ok ? `${label} sent` : `Failed: ${data.error}`); } catch (err) { setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`); } };
  const handleRename = async () => {
    if (!renameName.trim()) return;
    setModal(null);
    setStatus("Renaming...");
    void sendToTmux(`/rename ${renameName.trim()}`);
    try {
      const data = await renameSession(renameName.trim());
      setStatus(data.ok ? `Renamed to "${renameName.trim()}"` : `Failed: ${data.error}`);
    } catch (err) {
      // Previously this catch swallowed the error and optimistically reported
      // success because the in-tmux /rename side-effect had already happened.
      // But after jsonFetch started throwing on !res.ok (round-4 fix #1),
      // server-side rejections (400/409) land here too, and a false success
      // would hide real failures. Report the error instead. (Codex round-4
      // review re-pass.)
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setTimeout(() => setStatus(null), 2000);
  };
  const handleFork = () => { const name = forkName.trim(); setModal(null); void sendToTmux(name ? `/fork\n/rename ${name}` : "/fork"); setStatus(name ? `Forked as "${name}"` : "Forked"); setTimeout(() => setStatus(null), 2000); };
  const handleGitAction = async (action: { label: string; command: string }) => { setGitOutput(`Running ${action.label}...`); setModal("git-status"); try { setGitOutput(await runGitCommand(action.command)); } catch { setGitOutput("Failed to run command"); } };
  const resetFileSearch = useCallback(() => {
    // Cancel any pending debounce and abort any in-flight request, then
    // clear query+results. Needed when re-opening the search sheet so a
    // stale fetch started before the previous close can't land and
    // repopulate results under an empty query. (Codex round-4 review.)
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
      searchTimerRef.current = null;
    }
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  // Ref to the search input handler so an effect below can re-trigger the
  // debounced search when the scope toggle changes without the effect
  // having to depend on `handleSearchInput` itself (which would thrash
  // whenever any of its deps changed).
  const handleSearchInputRef = useRef<((query: string) => void) | null>(null);

  const handleSearchInput = useCallback((query: string) => {
    setSearchQuery(query);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    // Abort any in-flight search before kicking off the debounce for a new
    // one, so a slow earlier response can't land after a faster later one
    // and overwrite the displayed results. (Gemini round-3 race review.)
    if (searchAbortRef.current) {
      searchAbortRef.current.abort();
      searchAbortRef.current = null;
    }
    searchTimerRef.current = setTimeout(async () => {
      if (query.length < 2) { setSearchResults([]); return; }
      const controller = new AbortController();
      searchAbortRef.current = controller;
      try {
        const results = await searchFiles(query, controller.signal, searchScopeRef.current);
        // Only commit results if this fetch is still the latest one — a
        // later call may have aborted us between await and here.
        if (searchAbortRef.current === controller) {
          setSearchResults(results);
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (searchAbortRef.current === controller) setSearchResults([]);
      } finally {
        if (searchAbortRef.current === controller) searchAbortRef.current = null;
      }
    }, 300);
  }, []);
  handleSearchInputRef.current = handleSearchInput;

  // When the user flips the "current folder only" toggle (or the current
  // folder itself changes while the sheet is open), re-run the debounced
  // search so the visible results reflect the new scope. We intentionally
  // don't depend on `searchQuery` — typing it already schedules its own
  // search via onChange, so including it here would double-fire.
  useEffect(() => {
    if (modal !== "file-search") return;
    if (searchQuery.length < 2) return;
    handleSearchInputRef.current?.(searchQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchCurrentFolderOnly, currentFolder, modal]);

  const handleCheckAudio = async (filePath: string) => {
    // If a generate or send is already in-flight, don't clobber its
    // loading/op state with a check — just show the in-progress panel.
    if (audioInFlightRef.current) return;
    setAudioStatus(null);
    setAudioLoading(true);
    setAudioOp("checking");
    try {
      const status = await checkAudio(filePath);
      // Guard: if generate/send started while check was in-flight, don't
      // overwrite their loading/op state with a stale check result.
      if (!audioInFlightRef.current) setAudioStatus(status);
    } catch {
      if (!audioInFlightRef.current) setAudioStatus(null);
    } finally {
      // Only clear loading if no generate/send started while we were checking
      if (!audioInFlightRef.current) {
        setAudioOp("idle");
        setAudioLoading(false);
      }
    }
  };
  const handleGenerateAudio = async (filePath: string) => {
    if (audioInFlightRef.current) return;
    audioInFlightRef.current = true;
    setAudioLoading(true);
    setAudioOp("generating");
    setStatus("Generating audio...");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      try {
        const data = await generateAudio(filePath, controller.signal);
        if (data.ok) { setAudioStatus({ exists: true, path: data.path }); setStatus("Audio generated"); }
        else setStatus(`Failed: ${data.error}`);
      } finally {
        // clearTimeout in finally so a thrown fetch doesn't leave the
        // 60s timeout dangling and accumulating. (Copilot round-3 review.)
        clearTimeout(timeout);
      }
    } catch (err) {
      setStatus(err instanceof DOMException && err.name === "AbortError" ? "Timed out" : `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      audioInFlightRef.current = false;
      setAudioOp("idle");
      setAudioLoading(false);
    }
  };
  const handleSendAudio = async (audioPath: string) => {
    if (audioInFlightRef.current) return;
    audioInFlightRef.current = true;
    setAudioLoading(true);
    setAudioOp("sending");
    setStatus("Sending to Telegram...");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const data = await sendAudioTelegram(audioPath, controller.signal);
        setStatus(data.ok ? "Sent to Telegram" : `Failed: ${data.error}`);
      } finally {
        // clearTimeout in finally so a thrown fetch doesn't leave the
        // 30s timeout dangling and accumulating. (Copilot round-3 review.)
        clearTimeout(timeout);
      }
    } catch (err) {
      setStatus(err instanceof DOMException && err.name === "AbortError" ? "Timed out" : `Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      audioInFlightRef.current = false;
      setAudioOp("idle");
      setAudioLoading(false);
    }
  };
  const handleRestartSession = async () => {
    setModal(null);
    setStatus("Restarting session...");
    try {
      const data = await restartSession();
      setStatus(data.ok ? "Session restarted" : `Failed: ${data.error}`);
    } catch (err) {
      // Surface the server error text (now extracted by jsonFetch from a
      // { error } body on non-2xx responses) instead of a generic message.
      // (Codex round-4 review re-pass.)
      setStatus(`Restart failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    setTimeout(() => setStatus(null), 3000);
  };
  const handleSendToChat = async () => { if (!viewingFile) return; setStatus("Sharing..."); try { const data = await sendFileToChat(viewingFile.path); setStatus(data.ok ? "Sent to chat" : "Failed"); } catch { setStatus("Failed"); } setTimeout(() => setStatus(null), 2000); };

  let modalNode: ReactNode = null;
  switch (modal) {
    case "commands": modalNode = <CommandsSheet onClose={() => setModal(null)} onEsc={() => { void sendToTmux("Escape", true); setModal(null); setStatus("Sent: Esc"); setTimeout(() => setStatus(null), 1500); }} onDigit={(digit) => { void sendToTmux(String(digit)); setModal(null); setStatus(`Sent: ${digit}`); setTimeout(() => setStatus(null), 1500); }} onShiftTab={() => { void sendToTmux("BTab", true); setModal(null); setStatus("Sent: \u21e7Tab"); setTimeout(() => setStatus(null), 1500); }} onControlB={() => { void sendToTmux("C-b", true); setModal(null); setStatus("Sent: ^B"); setTimeout(() => setStatus(null), 1500); }} onNew={() => setModal("new-confirm")} onResume={() => { void loadSessionNames(); setModal("resume"); }} onFork={() => { setForkName(""); setModal("fork-name"); }} onRename={() => { setRenameName(""); setModal("rename"); }} onCompact={() => setModal("compact-confirm")} onReloadPlugins={() => { setModal(null); void handleAction("/api/terminal/reload-plugins", "Reload plugins"); }} />; break;
    case "rename": modalNode = <RenameModal value={renameName} onChange={setRenameName} onBack={() => setModal("commands")} onSubmit={() => void handleRename()} />; break;
    case "fork-name": modalNode = <ForkNameModal value={forkName} onChange={setForkName} onBack={() => setModal("commands")} onSubmit={handleFork} />; break;
    case "resume": modalNode = <ResumeSheet sessionNames={sessionNames} onClose={() => setModal("commands")} onResume={(session) => { setModal(null); void handleCompact(`/resume ${session.name}`, "Resume"); }} onDelete={(session) => { setDeleteTarget(session); setModal("confirm-delete"); }} />; break;
    case "confirm-delete": modalNode = deleteTarget ? <ConfirmDeleteSheet deleteTarget={deleteTarget} onCancel={() => { setDeleteTarget(null); setModal("resume"); }} onConfirm={() => void removeSessionName(deleteTarget.ts)} /> : null; break;
    case "reconnect-menu": modalNode = onReconnect ? <ReconnectMenu onClose={() => setModal(null)} onReconnect={() => { onReconnect(); setModal(null); }} onRestart={() => void handleRestartSession()} /> : null; break;
    case "new-confirm": modalNode = <NewConfirmModal onCancel={() => setModal("commands")} onConfirm={() => void handleCompact("/new", "New session")} />; break;
    case "git-status": modalNode = <GitStatusSheet gitOutput={gitOutput} onClose={() => setModal(null)} />; break;
    case "git-menu": modalNode = <GitMenuSheet onClose={() => setModal(null)} onViewStatus={() => { void loadGitStatus(); setModal("git-status"); }} onAction={(action) => void handleGitAction(action)} />; break;
    case "todo": modalNode = <TodoSheet todoContent={todoContent} onClose={() => setModal(null)} />; break;
    case "compact-confirm": modalNode = <CompactConfirmModal onCompactNow={() => { setCompactFocus(""); setModal("compact-focus"); }} onContinuity={() => { setContinuityNotes(""); setModal("continuity-notes"); }} onCancel={() => setModal(null)} />; break;
    case "compact-focus": modalNode = <CompactFocusModal value={compactFocus} onChange={setCompactFocus} onBack={() => setModal("compact-confirm")} onSubmit={() => void handleCompact(compactFocus.trim() ? `/compact ${compactFocus.trim()}` : "/compact")} />; break;
    case "continuity-notes": modalNode = <ContinuityNotesModal value={continuityNotes} onChange={setContinuityNotes} onBack={() => setModal("compact-confirm")} onSubmit={() => void handleCompact(`Before compacting, please ensure: 1) README.md is up to date with recent changes. 2) Anything important from this session is saved to the knowledge base or memory. 3) Open work and next steps are captured in NEXT-SESSION.md and TODO.md.${continuityNotes.trim() ? ` Additional context from user: "${continuityNotes.trim()}".` : ""}`)} />; break;
    case "file-options": modalNode = <FileOptionsSheet fileShowHidden={fileShowHidden} fileSortMode={fileSortMode} setFileShowHidden={setFileShowHidden} setFileSortMode={setFileSortMode} onClose={() => setModal(null)} />; break;
    case "file-search": modalNode = <FileSearchSheet searchQuery={searchQuery} searchResults={searchResults} currentFolder={currentFolder ?? null} currentFolderOnly={searchCurrentFolderOnly} onToggleCurrentFolderOnly={setSearchCurrentFolderOnly} onClose={() => setModal(null)} onChange={handleSearchInput} onSelect={(result) => { setModal(null); window.location.hash = `files&file=${encodeURIComponent(result.path)}`; window.location.reload(); }} />; break;
    case "tldr": modalNode = viewingFile ? <TldrModal viewingFile={viewingFile} onClose={() => setModal(null)} /> : null; break;
    case "audio-gen": modalNode = viewingFile ? <AudioGenModal viewingFile={viewingFile} audioLoading={audioLoading} audioOp={audioOp} audioStatus={audioStatus} onClose={() => setModal(null)} onGenerate={() => void handleGenerateAudio(viewingFile.path)} onSend={() => { if (audioStatus?.path) void handleSendAudio(audioStatus.path); }} /> : null; break;
  }

  return (
    <>
      {modalNode}
      <div style={{ padding: "10px 12px 8px", borderTop: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "8px", overflowX: "auto" }}>
          <button onClick={() => { setModal("todo"); void loadTodo(); }} style={{ ...btnStyle, background: "#3a3520", color: "var(--color-accent-yellow)", border: "1px solid #5a4a30" }}>TODO</button>
          {activeTab === "terminal" && <>
            {onReconnect && <div style={{ display: "flex", flexShrink: 0 }}><button onClick={onReconnect} style={{ ...btnStyle, background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d", borderRadius: "6px 0 0 6px", borderRight: "none" }}>Reconnect</button><button onClick={() => setModal("reconnect-menu")} aria-label="Open reconnect menu" title="Open reconnect menu" style={{ ...btnStyle, background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d", borderRadius: "0 6px 6px 0", padding: "6px 8px", fontSize: 14 }}>&#9652;</button></div>}
            <div style={{ display: "flex", flexShrink: 0 }}><button onClick={() => { setModal("git-status"); void loadGitStatus(); }} style={{ ...btnStyle, borderRadius: "6px 0 0 6px", borderRight: "none" }}>Git</button><button onClick={() => setModal("git-menu")} aria-label="Open git menu" title="Open git menu" style={{ ...btnStyle, borderRadius: "0 6px 6px 0", padding: "6px 8px", fontSize: 14 }}>&#9652;</button></div>
            <button onClick={() => setModal("commands")} style={{ ...btnStyle, background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}>/commands</button>
          </>}
          {activeTab === "files" && !viewingFile && <><button onClick={() => { resetFileSearch(); setModal("file-search"); }} style={{ ...btnStyle, background: "#2d3a5a", color: "var(--color-accent-blue)", border: "1px solid #3d4a6a" }}>Search</button><button onClick={() => setModal("file-options")} style={btnStyle}>Options</button></>}
          {activeTab === "files" && viewingFile && <button onClick={() => void handleSendToChat()} style={{ ...btnStyle, background: "#1a2a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d4a5a" }}>Send to Chat</button>}
          {activeTab === "files" && viewingFile?.name.toLowerCase().endsWith(".md") && <button onClick={() => setModal("tldr")} style={{ ...btnStyle, background: "#1a3a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d5a5a" }}>TL;DR</button>}
          {activeTab === "files" && viewingFile?.name.toLowerCase().endsWith(".md") && <button onClick={() => { void handleCheckAudio(viewingFile.path); setModal("audio-gen"); }} style={{ ...btnStyle, background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}>Audio</button>}
        </div>
        <StatusLine connected={connected} status={status} gitBranch={gitBranch} />
      </div>
    </>
  );
}
