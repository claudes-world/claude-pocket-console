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

export function ActionBar({ onReconnect, connected, activeTab, fileShowHidden, setFileShowHidden, fileSortMode, setFileSortMode, viewingFile }: ActionBarProps) {
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
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  const [gitBranch, setGitBranch] = useState<GitBranch | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const loadGitBranch = async () => { try { setGitBranch(await fetchGitBranch()); } catch {} };
    void loadGitBranch();
    const interval = setInterval(loadGitBranch, 30000);
    return () => clearInterval(interval);
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
  const handleRename = async () => { if (!renameName.trim()) return; setModal(null); setStatus("Renaming..."); void sendToTmux(`/rename ${renameName.trim()}`); try { const data = await renameSession(renameName.trim()); setStatus(data.ok ? `Renamed to "${renameName.trim()}"` : `Failed: ${data.error}`); } catch { setStatus(`Renamed to "${renameName.trim()}"`); } setTimeout(() => setStatus(null), 2000); };
  const handleFork = () => { const name = forkName.trim(); setModal(null); void sendToTmux(name ? `/fork\n/rename ${name}` : "/fork"); setStatus(name ? `Forked as "${name}"` : "Forked"); setTimeout(() => setStatus(null), 2000); };
  const handleGitAction = async (action: { label: string; command: string }) => { setGitOutput(`Running ${action.label}...`); setModal("git-status"); try { setGitOutput(await runGitCommand(action.command)); } catch { setGitOutput("Failed to run command"); } };
  const handleSearchInput = useCallback((query: string) => { setSearchQuery(query); if (searchTimerRef.current) clearTimeout(searchTimerRef.current); searchTimerRef.current = setTimeout(async () => { if (query.length < 2) { setSearchResults([]); return; } try { setSearchResults(await searchFiles(query)); } catch { setSearchResults([]); } }, 300); }, []);
  const handleCheckAudio = async (filePath: string) => { setAudioStatus(null); setAudioLoading(true); try { setAudioStatus(await checkAudio(filePath)); } catch { setAudioStatus(null); } setAudioLoading(false); };
  const handleGenerateAudio = async (filePath: string) => { setAudioLoading(true); setStatus("Generating audio..."); try { const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 60000); const data = await generateAudio(filePath, controller.signal); clearTimeout(timeout); if (data.ok) { setAudioStatus({ exists: true, path: data.path }); setStatus("Audio generated"); } else setStatus(`Failed: ${data.error}`); } catch (err) { setStatus(err instanceof DOMException && err.name === "AbortError" ? "Timed out" : `Error: ${err instanceof Error ? err.message : String(err)}`); } finally { setAudioLoading(false); } };
  const handleSendAudio = async (audioPath: string) => { setAudioLoading(true); setStatus("Sending to Telegram..."); try { const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30000); const data = await sendAudioTelegram(audioPath, controller.signal); clearTimeout(timeout); setStatus(data.ok ? "Sent to Telegram" : `Failed: ${data.error}`); } catch (err) { setStatus(err instanceof DOMException && err.name === "AbortError" ? "Timed out" : `Error: ${err instanceof Error ? err.message : String(err)}`); } finally { setAudioLoading(false); } };
  const handleRestartSession = async () => { setModal(null); setStatus("Restarting session..."); try { const data = await restartSession(); setStatus(data.ok ? "Session restarted" : `Failed: ${data.error}`); } catch { setStatus("Restart failed"); } setTimeout(() => setStatus(null), 3000); };
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
    case "file-search": modalNode = <FileSearchSheet searchQuery={searchQuery} searchResults={searchResults} onClose={() => setModal(null)} onChange={handleSearchInput} onSelect={(result) => { setModal(null); window.location.hash = `files&file=${encodeURIComponent(result.path)}`; window.location.reload(); }} />; break;
    case "tldr": modalNode = viewingFile ? <TldrModal viewingFile={viewingFile} onClose={() => setModal(null)} /> : null; break;
    case "audio-gen": modalNode = viewingFile ? <AudioGenModal viewingFile={viewingFile} audioLoading={audioLoading} audioStatus={audioStatus} onClose={() => setModal(null)} onGenerate={() => void handleGenerateAudio(viewingFile.path)} onSend={() => { if (audioStatus?.path) void handleSendAudio(audioStatus.path); }} /> : null; break;
  }

  return (
    <>
      {modalNode}
      <div style={{ padding: "10px 12px 8px", borderTop: "1px solid #2a2b3d", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "8px", overflowX: "auto" }}>
          <button onClick={() => { setModal("todo"); void loadTodo(); }} style={{ ...btnStyle, background: "#3a3520", color: "#e0af68", border: "1px solid #5a4a30" }}>TODO</button>
          {activeTab === "terminal" && <>
            {onReconnect && <div style={{ display: "flex", flexShrink: 0 }}><button onClick={onReconnect} style={{ ...btnStyle, background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d", borderRadius: "6px 0 0 6px", borderRight: "none" }}>Reconnect</button><button onClick={() => setModal("reconnect-menu")} style={{ ...btnStyle, background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d", borderRadius: "0 6px 6px 0", padding: "6px 8px", fontSize: 14 }}>&#9652;</button></div>}
            <div style={{ display: "flex", flexShrink: 0 }}><button onClick={() => { setModal("git-status"); void loadGitStatus(); }} style={{ ...btnStyle, borderRadius: "6px 0 0 6px", borderRight: "none" }}>Git</button><button onClick={() => setModal("git-menu")} style={{ ...btnStyle, borderRadius: "0 6px 6px 0", padding: "6px 8px", fontSize: 14 }}>&#9652;</button></div>
            <button onClick={() => setModal("commands")} style={{ ...btnStyle, background: "#2d2a3a", color: "#bb9af7", border: "1px solid #4a3d6a" }}>/commands</button>
          </>}
          {activeTab === "files" && !viewingFile && <><button onClick={() => { setSearchQuery(""); setSearchResults([]); setModal("file-search"); }} style={{ ...btnStyle, background: "#2d3a5a", color: "#7aa2f7", border: "1px solid #3d4a6a" }}>Search</button><button onClick={() => setModal("file-options")} style={btnStyle}>Options</button></>}
          {activeTab === "files" && viewingFile && <button onClick={() => void handleSendToChat()} style={{ ...btnStyle, background: "#1a2a3a", color: "#7dcfff", border: "1px solid #2d4a5a" }}>Send to Chat</button>}
          {activeTab === "files" && viewingFile?.name.toLowerCase().endsWith(".md") && <button onClick={() => setModal("tldr")} style={{ ...btnStyle, background: "#1a3a3a", color: "#7dcfff", border: "1px solid #2d5a5a" }}>TL;DR</button>}
          {activeTab === "files" && viewingFile?.name.toLowerCase().endsWith(".md") && <button onClick={() => { void handleCheckAudio(viewingFile.path); setModal("audio-gen"); }} style={{ ...btnStyle, background: "#2d2a3a", color: "#bb9af7", border: "1px solid #4a3d6a" }}>Audio</button>}
        </div>
        <StatusLine connected={connected} status={status} gitBranch={gitBranch} />
      </div>
    </>
  );
}
