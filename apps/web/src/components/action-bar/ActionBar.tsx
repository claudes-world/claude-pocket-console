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
import { ShareSheet } from "./ShareSheet";
import { StatusLine } from "./StatusLine";
import { btnStyle, type ActionBarProps, type AudioStatus, type GitBranch, type Modal, type SearchResult, type SessionName } from "./types";
import {
  checkAudio, checkReadingListPaths, deleteSessionName, fetchGitBranch, fetchGitStatus,
  fetchSessionNames, fetchTodo, generateAudio, postAction,
  renameSession, restartSession, runGitCommand, searchFiles,
  publishShared, saveReadingListItem, sendAudioTelegram, sendCompactCommand, sendFileToChat, sendToTmux,
} from "./api";
import { haptic } from "../../lib/haptic";
import { usePreferences } from "../../hooks/usePreferences";
import { emitReadingListChanged, READING_LIST_CHANGED_EVENT } from "../../lib/reading-list-events";

// Preference key for the "current folder only" search toggle. Stored under
// the unified cpc_dashboard_prefs aggregate via CloudStorage (Bot API 8.0+)
// with a localStorage fallback — see apps/web/src/lib/cloud-storage.ts.
// Renamed from the old localStorage-direct key "cpc:search:currentFolderOnly"
// when we migrated to the aggregate store; the old key is left behind on
// upgraded clients (one-time loss of this single toggle), which is acceptable
// for a boolean with a sensible default of ON.
const SEARCH_SCOPE_PREF = "searchCurrentFolderOnly";

export function ActionBar({ onReconnect, onFitScreen, fitResult, connected, activeTab, terminalSession, fileShowHidden, setFileShowHidden, fileSortMode, setFileSortMode, viewingFile, currentFolder }: ActionBarProps) {
  // Viewing a non-default tmux session: the restricted palette targets it;
  // default-session-only actions are hidden (see ActionBarProps docs).
  const restrictedSession = terminalSession || null;
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
  // Telegram CloudStorage (syncs across devices) with a localStorage fallback.
  // When ON we pass the folder the user is browsing as a `scope` query param;
  // when OFF the server falls back to the old global search across all allowed
  // roots. (Search UX C3; migrated to unified prefs in feat/cloud-storage-prefs.)
  const [searchCurrentFolderOnly, setSearchCurrentFolderOnly] = usePreferences<boolean>(SEARCH_SCOPE_PREF, true);
  // Keep the latest scope value in a ref so the debounced search callback
  // (which is a useCallback with a stable identity) can read the freshest
  // toggle + folder without needing to rebuild on every change.
  const searchScopeRef = useRef<string | null>(null);
  searchScopeRef.current = searchCurrentFolderOnly && currentFolder ? currentFolder : null;
  const [audioStatus, setAudioStatus] = useState<AudioStatus | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);
  type AudioOp = "idle" | "checking" | "generating" | "sending";
  const [audioOp, setAudioOp] = useState<AudioOp>("idle");
  // Synchronous in-flight guard for audio generation/send. Mirrors the
  // TldrModal pattern (PR #121): React hasn't necessarily committed
  // setAudioLoading(true) by the time a fast double-tap fires the second
  // click handler, so a ref-based lock is the only way to prevent two
  // concurrent backend audio jobs racing each other.
  const audioInFlightRef = useRef(false);
  // Own generation/send state by the file that started it. The global lock
  // still prevents duplicate backend jobs, while this path prevents a late
  // completion from painting (or auto-sending from) a different file's UI.
  const audioOpPathRef = useRef<string | null>(null);
  const audioOpStageRef = useRef<AudioOp>("idle");
  const viewedFilePathRef = useRef<string | null>(viewingFile?.path ?? null);
  // Monotonically versions cache checks so a response from an older sheet
  // open/file cannot overwrite the state established by a newer check or by
  // the generate-and-send chain.
  const audioCheckSeqRef = useRef(0);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const shareInFlightRef = useRef(new Set<string>());
  const shareSeqRef = useRef(0);
  const [readingListSaved, setReadingListSaved] = useState(false);
  const [readingListChecking, setReadingListChecking] = useState(false);
  const [readingListSaving, setReadingListSaving] = useState(false);
  const [readingListRefreshVersion, setReadingListRefreshVersion] = useState(0);
  // Track every path being saved. Navigating to another file must not lock
  // that file's Save button, while returning to any pending path must still
  // block a duplicate save.
  const readingListInFlightRef = useRef(new Set<string>());
  // A check started for the previous file must never mark the newly viewed
  // file as saved. Saving bumps this token to invalidate an older GET; the
  // save completion itself is owned by readingListViewedPathRef so unrelated
  // reading-list events cannot suppress its commit.
  const readingListCheckSeqRef = useRef(0);
  const readingListViewedPathRef = useRef<string | null>(null);
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

  useEffect(() => {
    const refresh = () => setReadingListRefreshVersion((version) => version + 1);
    window.addEventListener(READING_LIST_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(READING_LIST_CHANGED_EVENT, refresh);
  }, []);

  useEffect(() => {
    const seq = ++readingListCheckSeqRef.current;
    const path = viewingFile?.path ?? null;
    const audioPathChanged = path !== viewedFilePathRef.current;
    viewedFilePathRef.current = path;
    if (audioPathChanged) {
      // Invalidate the previous file's cache check and immediately clear its
      // presentation. A generate/send that still belongs to that old path
      // may finish, but its guarded completion must not alter these values.
      ++audioCheckSeqRef.current;
      setAudioStatus(null);
      if (audioInFlightRef.current && audioOpPathRef.current === path) {
        setAudioLoading(true);
        setAudioOp(audioOpStageRef.current);
      } else {
        setAudioLoading(false);
        setAudioOp("idle");
      }
    }
    const pathChanged = path !== readingListViewedPathRef.current;
    readingListViewedPathRef.current = path;
    // Clear the prior file's result immediately. A same-file refresh (for
    // example the event emitted by a successful save) keeps the confirmed
    // Saved state visible while the authoritative re-check runs. Saving
    // state is per-file: derive it from the in-flight set, so a save still
    // pending for the PREVIOUS file doesn't label this one "Saving…", while
    // returning to a file whose save is pending shows "Saving…" again
    // instead of an enabled button whose tap would silently no-op.
    if (pathChanged) {
      setReadingListSaved(false);
      setReadingListSaving(path !== null && readingListInFlightRef.current.has(path));
    }
    if (!viewingFile) {
      setReadingListChecking(false);
      return;
    }

    setReadingListChecking(true);
    void checkReadingListPaths([viewingFile.path])
      .then((data) => {
        if (seq === readingListCheckSeqRef.current) {
          setReadingListSaved(data.saved[viewingFile.path] === true);
        }
      })
      .catch(() => {
        // A failed check leaves Save enabled; the POST remains authoritative.
        if (seq === readingListCheckSeqRef.current) setReadingListSaved(false);
      })
      .finally(() => {
        if (seq === readingListCheckSeqRef.current) setReadingListChecking(false);
      });
    // Invalidate the in-flight check on unmount so it can't setState after
    // teardown (same defensive bump ReadingList's loadSeqRef does).
    return () => {
      ++readingListCheckSeqRef.current;
    };
  }, [viewingFile?.path, readingListRefreshVersion]);

  // Replace the optimistic "Fit screen requested" status (set the instant
  // the button is tapped, in the reconnect-menu case below) with the real
  // server round-trip result once it arrives. Without this, an oversized
  // viewport (wide desktop tab) or a tmux resize-window failure would leave
  // the UI claiming success indefinitely. Depends only on `fitResult` (not
  // `status`) so a later unrelated status update doesn't get clobbered by a
  // stale ack arriving after the fact.
  useEffect(() => {
    if (!fitResult) return;
    if (fitResult.ok) {
      haptic.success();
      setStatus("Fit screen applied");
    } else {
      haptic.error();
      setStatus(`Fit screen failed: ${fitResult.message || "unknown error"}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitResult]);

  const handleAction = async (endpoint: string, label: string, body?: Record<string, unknown>) => {
    setStatus(`Running ${label}...`);
    try {
      const data = await postAction(endpoint, body);
      if (!data.ok) {
        haptic.error();
        setStatus(`Failed: ${data.error || "unknown error"}`);
      } else {
        haptic.success();
        setStatus(data.output || `${label}: OK`);
      }
    } catch (err) {
      haptic.error();
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const loadGitStatus = async () => {
    try { setGitOutput(await fetchGitStatus()); } catch { setGitOutput("Failed to fetch"); }
  };
  const loadTodo = async () => {
    try { setTodoContent(await fetchTodo()); } catch { setTodoContent("Failed to fetch"); }
  };
  const loadSessionNames = async () => {
    try { setSessionNames(await fetchSessionNames()); } catch { setSessionNames([]); }
  };
  const removeSessionName = async (ts: number) => {
    try {
      await deleteSessionName(ts);
      setSessionNames((prev) => prev.filter((s) => s.ts !== ts));
    } catch {}
    setDeleteTarget(null);
    setModal("resume");
  };
  const handleCompact = async (message: string, label = "Compact") => {
    setModal(null);
    setStatus(`${label}...`);
    try {
      // Targets the viewed session (restrictedSession null = default). Only
      // /compact reaches this with a non-default target — the sheet hides
      // /new and /resume (the other handleCompact callers) when restricted.
      const data = await sendCompactCommand(message, restrictedSession);
      if (data.ok) {
        haptic.success();
        setStatus(`${label} sent`);
      } else {
        haptic.error();
        setStatus(`Failed: ${data.error}`);
      }
    } catch (err) {
      haptic.error();
      setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const handleRename = async () => {
    if (!renameName.trim()) return;
    setModal(null);
    setStatus("Renaming...");
    void sendToTmux(`/rename ${renameName.trim()}`);
    try {
      const data = await renameSession(renameName.trim());
      if (data.ok) {
        haptic.success();
        setStatus(`Renamed to "${renameName.trim()}"`);
      } else {
        haptic.error();
        setStatus(`Failed: ${data.error}`);
      }
    } catch (err) {
      // Previously this catch swallowed the error and optimistically reported
      // success because the in-tmux /rename side-effect had already happened.
      // But after jsonFetch started throwing on !res.ok (round-4 fix #1),
      // server-side rejections (400/409) land here too, and a false success
      // would hide real failures. Report the error instead. (Codex round-4
      // review re-pass.)
      haptic.error();
      setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const handleFork = () => {
    const name = forkName.trim();
    setModal(null);
    void sendToTmux(name ? `/fork\n/rename ${name}` : "/fork");
    setStatus(name ? `Forked as "${name}"` : "Forked");
  };
  const handleGitAction = async (action: { label: string; command: string }) => {
    setGitOutput(`Running ${action.label}...`);
    setModal("git-status");
    try { setGitOutput(await runGitCommand(action.command)); } catch { setGitOutput("Failed to run command"); }
  };
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
    const seq = ++audioCheckSeqRef.current;
    const hasInFlightOpForFile = () =>
      audioInFlightRef.current && audioOpPathRef.current === filePath;
    // If a generate or send is already in-flight, don't clobber its
    // loading/op state with a check — just show the in-progress panel.
    if (hasInFlightOpForFile()) {
      setAudioLoading(true);
      setAudioOp(audioOpStageRef.current);
      return;
    }
    setAudioStatus(null);
    setAudioLoading(true);
    setAudioOp("checking");
    try {
      const status = await checkAudio(filePath);
      // Guards: a newer check (or the generate chain, which bumps the seq)
      // owns the UI now — a stale result must not overwrite it. Same for a
      // generate/send that started while this check was in-flight.
      if (seq !== audioCheckSeqRef.current) return;
      if (!hasInFlightOpForFile()) setAudioStatus(status);
    } catch {
      if (seq !== audioCheckSeqRef.current) return;
      if (!hasInFlightOpForFile()) setAudioStatus(null);
    } finally {
      // Only clear loading if this check still owns the UI and no
      // generate/send started while we were checking.
      if (seq === audioCheckSeqRef.current && !hasInFlightOpForFile()) {
        setAudioOp("idle");
        setAudioLoading(false);
      }
    }
  };
  const sendAudio = async (audioPath: string, filePath: string, pendingStatus = "Sending to Telegram...") => {
    const ownsViewedFile = () =>
      audioOpPathRef.current === filePath && viewedFilePathRef.current === filePath;
    audioOpStageRef.current = "sending";
    if (ownsViewedFile()) {
      setAudioOp("sending");
      setStatus(pendingStatus);
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const data = await sendAudioTelegram(audioPath, controller.signal);
        if (!ownsViewedFile()) return;
        if (data.ok) {
          haptic.success();
          setStatus("Sent to Telegram");
        } else {
          haptic.error();
          setStatus(`Failed: ${data.error || "unknown error"}`);
        }
      } finally {
        // clearTimeout in finally so a thrown fetch doesn't leave the
        // 30s timeout dangling and accumulating. (Copilot round-3 review.)
        clearTimeout(timeout);
      }
    } catch (err) {
      if (!ownsViewedFile()) return;
      haptic.error();
      setStatus(
        err instanceof DOMException && err.name === "AbortError"
          ? "Timed out"
          : `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };
  const handleGenerateAudio = async (filePath: string) => {
    ++audioCheckSeqRef.current;
    if (audioInFlightRef.current) return;
    audioInFlightRef.current = true;
    audioOpPathRef.current = filePath;
    audioOpStageRef.current = "generating";
    setAudioStatus(null);
    setAudioLoading(true);
    setAudioOp("generating");
    setStatus("Generating audio...");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000);
      let data: Awaited<ReturnType<typeof generateAudio>>;
      try {
        data = await generateAudio(filePath, controller.signal);
      } finally {
        // clearTimeout in finally so a thrown fetch doesn't leave the
        // 60s timeout dangling and accumulating. (Copilot round-3 review.)
        clearTimeout(timeout);
      }
      if (data.ok && data.path) {
        haptic.success();
        if (viewedFilePathRef.current !== filePath) {
          setStatus("Audio ready — reopen the file to send");
          return;
        }
        setAudioStatus({ exists: true, path: data.path });
        await sendAudio(data.path, filePath, "Audio generated — sending to Telegram…");
      } else {
        if (viewedFilePathRef.current !== filePath) return;
        haptic.error();
        setStatus(`Failed: ${data.error || (data.ok ? "Missing audio path" : "unknown error")}`);
      }
    } catch (err) {
      if (viewedFilePathRef.current !== filePath) return;
      haptic.error();
      setStatus(
        err instanceof DOMException && err.name === "AbortError"
          ? "Timed out"
          : `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    } finally {
      if (audioOpPathRef.current === filePath) {
        audioInFlightRef.current = false;
        audioOpPathRef.current = null;
        audioOpStageRef.current = "idle";
      }
      if (viewedFilePathRef.current === filePath) {
        setAudioOp("idle");
        setAudioLoading(false);
      }
    }
  };
  const handleSendAudio = async (audioPath: string, filePath: string) => {
    if (audioInFlightRef.current) return;
    audioInFlightRef.current = true;
    audioOpPathRef.current = filePath;
    audioOpStageRef.current = "sending";
    setAudioLoading(true);
    try {
      await sendAudio(audioPath, filePath);
    } finally {
      if (audioOpPathRef.current === filePath) {
        audioInFlightRef.current = false;
        audioOpPathRef.current = null;
        audioOpStageRef.current = "idle";
      }
      if (viewedFilePathRef.current === filePath) {
        setAudioOp("idle");
        setAudioLoading(false);
      }
    }
  };
  const handleRestartSession = async () => {
    setModal(null);
    setStatus("Restarting session...");
    try {
      const data = await restartSession();
      if (data.ok) {
        haptic.success();
        setStatus("Session restarted");
      } else {
        haptic.error();
        setStatus(`Failed: ${data.error}`);
      }
    } catch (err) {
      // Surface the server error text (now extracted by jsonFetch from a
      // { error } body on non-2xx responses) instead of a generic message.
      // (Codex round-4 review re-pass.)
      haptic.error();
      setStatus(`Restart failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
  const handleSendToChat = async () => {
    if (!viewingFile) return;
    setStatus("Sharing...");
    try {
      const data = await sendFileToChat(viewingFile.path);
      if (data.ok) {
        haptic.success();
        setStatus("Sent to chat");
      } else {
        haptic.error();
        setStatus("Failed");
      }
    } catch {
      haptic.error();
      setStatus("Failed");
    }
  };
  const handleSaveToReadingList = async () => {
    if (!viewingFile || readingListSaved) return;
    const path = viewingFile.path;
    if (readingListInFlightRef.current.has(path)) return;
    readingListInFlightRef.current.add(path);
    ++readingListCheckSeqRef.current;
    setReadingListSaving(true);
    try {
      await saveReadingListItem(path, viewingFile.name);
      if (readingListViewedPathRef.current === path) {
        setReadingListSaved(true);
        haptic.success();
        setStatus("Saved to reading list");
      }
      emitReadingListChanged();
    } catch (err) {
      if (readingListViewedPathRef.current === path) {
        setReadingListSaved(false);
        haptic.error();
        setStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      readingListInFlightRef.current.delete(path);
      if (readingListViewedPathRef.current === path) setReadingListSaving(false);
    }
  };
  const handlePublishShared = async (scope: "public" | "private", tmp: boolean) => {
    if (!viewingFile) return;
    const path = viewingFile.path;
    if (shareInFlightRef.current.has(path)) return;
    shareInFlightRef.current.add(path);
    const seq = ++shareSeqRef.current;
    setShareLoading(true);
    setShareUrl(null);
    setShareError(null);
    setStatus("Publishing...");
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      try {
        const data = await publishShared(path, scope, tmp, controller.signal);
        if (seq !== shareSeqRef.current) return;
        if (data.ok && data.url) {
          haptic.success();
          setShareUrl(data.url);
          setStatus("Published");
        } else {
          const message = data.error || "Publish failed";
          haptic.error();
          setShareError(message);
          setStatus(`Failed: ${message}`);
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (err) {
      if (seq !== shareSeqRef.current) return;
      const message = err instanceof DOMException && err.name === "AbortError"
        ? "Timed out"
        : err instanceof Error ? err.message : String(err);
      haptic.error();
      setShareError(message);
      setStatus(`Failed: ${message}`);
    } finally {
      shareInFlightRef.current.delete(path);
      if (seq === shareSeqRef.current) setShareLoading(false);
    }
  };
  const handleCopyShareLink = async () => {
    if (!shareUrl) return;
    let copied = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        copied = true;
      }
    } catch {
      // Fall through to the selected-text fallback for restricted WebViews.
    }
    if (!copied) {
      const textarea = document.createElement("textarea");
      textarea.value = shareUrl;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      document.body.removeChild(textarea);
    }
    if (copied) {
      haptic.success();
      setStatus("Link copied");
    } else {
      haptic.error();
      setStatus("Copy failed — long-press the link to copy manually");
    }
  };

  let modalNode: ReactNode = null;
  switch (modal) {
    case "commands":
      modalNode = (
        <CommandsSheet
          onClose={() => setModal(null)}
          targetSession={restrictedSession}
          onEsc={() => { void sendToTmux("Escape", true, restrictedSession); setModal(null); setStatus("Sent: Esc"); }}
          onDigit={(digit) => { void sendToTmux(String(digit), false, restrictedSession); setModal(null); setStatus(`Sent: ${digit}`); }}
          onShiftTab={() => { void sendToTmux("BTab", true, restrictedSession); setModal(null); setStatus("Sent: \u21e7Tab"); }}
          onControlB={() => { void sendToTmux("C-b", true, restrictedSession); setModal(null); setStatus("Sent: ^B"); }}
          onNew={() => setModal("new-confirm")}
          onResume={() => { void loadSessionNames(); setModal("resume"); }}
          onFork={() => { setForkName(""); setModal("fork-name"); }}
          onRename={() => { setRenameName(""); setModal("rename"); }}
          onCompact={() => setModal("compact-confirm")}
          onReloadPlugins={() => { setModal(null); void handleAction("/api/terminal/reload-plugins", "Reload plugins", restrictedSession ? { session: restrictedSession } : undefined); }}
        />
      );
      break;
    case "rename":
      modalNode = (
        <RenameModal value={renameName} onChange={setRenameName} onBack={() => setModal("commands")} onSubmit={() => void handleRename()} />
      );
      break;
    case "fork-name":
      modalNode = (
        <ForkNameModal value={forkName} onChange={setForkName} onBack={() => setModal("commands")} onSubmit={handleFork} />
      );
      break;
    case "resume":
      modalNode = (
        <ResumeSheet
          sessionNames={sessionNames}
          onClose={() => setModal("commands")}
          onResume={(session) => { setModal(null); void handleCompact(`/resume ${session.name}`, "Resume"); }}
          onDelete={(session) => { setDeleteTarget(session); setModal("confirm-delete"); }}
        />
      );
      break;
    case "confirm-delete":
      modalNode = deleteTarget ? (
        <ConfirmDeleteSheet
          deleteTarget={deleteTarget}
          onCancel={() => { setDeleteTarget(null); setModal("resume"); }}
          onConfirm={() => void removeSessionName(deleteTarget.ts)}
        />
      ) : null;
      break;
    case "reconnect-menu":
      modalNode = onReconnect ? (
        <ReconnectMenu
          onClose={() => setModal(null)}
          onReconnect={() => { onReconnect(); setModal(null); }}
          onRestart={() => void handleRestartSession()}
          onFitScreen={onFitScreen ? () => {
            haptic.impact("light");
            onFitScreen();
            setModal(null);
            setStatus("Fit screen requested");
          } : undefined}
        />
      ) : null;
      break;
    case "new-confirm":
      modalNode = (
        <NewConfirmModal onCancel={() => setModal("commands")} onConfirm={() => void handleCompact("/new", "New session")} />
      );
      break;
    case "git-status":
      modalNode = <GitStatusSheet gitOutput={gitOutput} onClose={() => setModal(null)} />;
      break;
    case "git-menu":
      modalNode = (
        <GitMenuSheet
          onClose={() => setModal(null)}
          onViewStatus={() => { void loadGitStatus(); setModal("git-status"); }}
          onAction={(action) => void handleGitAction(action)}
        />
      );
      break;
    case "todo":
      modalNode = <TodoSheet todoContent={todoContent} onClose={() => setModal(null)} />;
      break;
    case "compact-confirm":
      modalNode = (
        <CompactConfirmModal
          onCompactNow={() => { setCompactFocus(""); setModal("compact-focus"); }}
          onContinuity={() => { setContinuityNotes(""); setModal("continuity-notes"); }}
          onCancel={() => setModal(null)}
        />
      );
      break;
    case "compact-focus":
      modalNode = (
        <CompactFocusModal
          value={compactFocus}
          onChange={setCompactFocus}
          onBack={() => setModal("compact-confirm")}
          onSubmit={() => void handleCompact(compactFocus.trim() ? `/compact ${compactFocus.trim()}` : "/compact")}
        />
      );
      break;
    case "continuity-notes": {
      const continuityMsg = [
        "Before compacting, please ensure:",
        "1) README.md is up to date with recent changes.",
        "2) Anything important from this session is saved to the knowledge base or memory.",
        "3) Open work and next steps are captured in NEXT-SESSION.md and TODO.md.",
        continuityNotes.trim() ? `Additional context from user: "${continuityNotes.trim()}".` : "",
      ].filter(Boolean).join(" ");
      modalNode = (
        <ContinuityNotesModal
          value={continuityNotes}
          onChange={setContinuityNotes}
          onBack={() => setModal("compact-confirm")}
          onSubmit={() => void handleCompact(continuityMsg)}
        />
      );
      break;
    }
    case "file-options":
      modalNode = (
        <FileOptionsSheet
          fileShowHidden={fileShowHidden}
          fileSortMode={fileSortMode}
          setFileShowHidden={setFileShowHidden}
          setFileSortMode={setFileSortMode}
          onClose={() => setModal(null)}
        />
      );
      break;
    case "file-search":
      modalNode = (
        <FileSearchSheet
          searchQuery={searchQuery}
          searchResults={searchResults}
          currentFolder={currentFolder ?? null}
          currentFolderOnly={searchCurrentFolderOnly}
          onToggleCurrentFolderOnly={setSearchCurrentFolderOnly}
          onClose={() => setModal(null)}
          onChange={handleSearchInput}
          onSelect={(result) => {
            setModal(null);
            window.location.hash = `files&file=${encodeURIComponent(result.path)}`;
            window.location.reload();
          }}
        />
      );
      break;
    case "tldr":
      modalNode = viewingFile ? <TldrModal viewingFile={viewingFile} onClose={() => setModal(null)} /> : null;
      break;
    case "audio-gen":
      modalNode = viewingFile ? (
        <AudioGenModal
          viewingFile={viewingFile}
          audioLoading={audioLoading}
          audioOp={audioOp}
          audioStatus={audioStatus}
          onClose={() => setModal(null)}
          onGenerate={() => void handleGenerateAudio(viewingFile.path)}
          onSend={() => { if (audioStatus?.path) void handleSendAudio(audioStatus.path, viewingFile.path); }}
        />
      ) : null;
      break;
    case "share":
      modalNode = viewingFile ? (
        <ShareSheet
          viewingFile={viewingFile}
          loading={shareLoading}
          url={shareUrl}
          error={shareError}
          onClose={() => setModal(null)}
          onPublish={(scope, tmp) => void handlePublishShared(scope, tmp)}
          onCopy={() => void handleCopyShareLink()}
          onOpen={() => { if (shareUrl) window.open(shareUrl, "_blank", "noopener,noreferrer"); }}
        />
      ) : null;
      break;
  }

  const isViewingMd = viewingFile?.name.toLowerCase().endsWith(".md");

  return (
    <>
      {modalNode}
      <div style={{ padding: "10px 12px 8px", borderTop: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", gap: "8px", overflowX: "auto" }}>
          <button
            onClick={() => { haptic.impact("light"); setModal("todo"); void loadTodo(); }}
            style={{ ...btnStyle, background: "#3a3520", color: "var(--color-accent-yellow)", border: "1px solid #5a4a30" }}
          >
            TODO
          </button>

          {/* Restricted terminal row: viewing a non-default session. The
              command palette targets the viewed session (Liam voice msg
              1188); default-session-only actions — reconnect-menu's
              Restart/Fit, git — are hidden so they can never act on the
              wrong terminal. */}
          {activeTab === "terminal" && restrictedSession && <>
            {onReconnect && (
              <button
                onClick={() => { haptic.impact("light"); onReconnect(); }}
                style={{ ...btnStyle, background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d" }}
              >
                Reconnect
              </button>
            )}
            <button
              onClick={() => { haptic.impact("light"); setModal("commands"); }}
              style={{ ...btnStyle, background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}
            >
              /commands
            </button>
          </>}

          {activeTab === "terminal" && !restrictedSession && <>
            {onReconnect && (
              <div style={{ display: "flex", flexShrink: 0 }}>
                <button
                  onClick={() => { haptic.impact("light"); onReconnect(); }}
                  style={{ ...btnStyle, background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d", borderRadius: "6px 0 0 6px", borderRight: "none" }}
                >
                  Reconnect
                </button>
                <button
                  onClick={() => { haptic.impact("light"); setModal("reconnect-menu"); }}
                  aria-label="Open reconnect menu"
                  title="Open reconnect menu"
                  style={{ ...btnStyle, background: "#1a3a2a", color: "var(--color-accent-green)", border: "1px solid #2d5a3d", borderRadius: "0 6px 6px 0", padding: "6px 8px", fontSize: 14 }}
                >
                  &#9652;
                </button>
              </div>
            )}
            <div style={{ display: "flex", flexShrink: 0 }}>
              <button
                onClick={() => { haptic.impact("light"); setModal("git-status"); void loadGitStatus(); }}
                style={{ ...btnStyle, borderRadius: "6px 0 0 6px", borderRight: "none" }}
              >
                Git
              </button>
              <button
                onClick={() => { haptic.impact("light"); setModal("git-menu"); }}
                aria-label="Open git menu"
                title="Open git menu"
                style={{ ...btnStyle, borderRadius: "0 6px 6px 0", padding: "6px 8px", fontSize: 14 }}
              >
                &#9652;
              </button>
            </div>
            <button
              onClick={() => { haptic.impact("light"); setModal("commands"); }}
              style={{ ...btnStyle, background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}
            >
              /commands
            </button>
          </>}

          {activeTab === "files" && !viewingFile && <>
            <button
              onClick={() => { resetFileSearch(); setModal("file-search"); }}
              style={{ ...btnStyle, background: "#2d3a5a", color: "var(--color-accent-blue)", border: "1px solid #3d4a6a" }}
            >
              Search
            </button>
            <button onClick={() => setModal("file-options")} style={btnStyle}>Options</button>
          </>}

          {activeTab === "files" && viewingFile && (
            <>
              <button
                onClick={() => { haptic.impact("light"); void handleSendToChat(); }}
                style={{ ...btnStyle, background: "#1a2a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d4a5a" }}
              >
                Send to Chat
              </button>
              <button
                disabled={readingListChecking || readingListSaving || readingListSaved}
                onClick={() => { haptic.impact("light"); void handleSaveToReadingList(); }}
                style={{
                  ...btnStyle,
                  background: "var(--color-surface)",
                  color: readingListSaved ? "var(--color-accent-green)" : "var(--color-accent-blue)",
                  border: "1px solid var(--color-border-alt)",
                  opacity: readingListChecking || readingListSaving ? 0.65 : 1,
                }}
              >
                {readingListSaved ? "Saved ✓" : readingListSaving ? "Saving…" : "Save to reading list"}
              </button>
              <button
                onClick={() => {
                  haptic.impact("light");
                  ++shareSeqRef.current;
                  setShareLoading(false);
                  setShareUrl(null);
                  setShareError(null);
                  setModal("share");
                }}
                style={{ ...btnStyle, background: "#1a3a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d5a5a" }}
              >
                Share
              </button>
            </>
          )}

          {activeTab === "files" && isViewingMd && (
            <button
              onClick={() => setModal("tldr")}
              style={{ ...btnStyle, background: "#1a3a3a", color: "var(--color-accent-cyan)", border: "1px solid #2d5a5a" }}
            >
              TL;DR
            </button>
          )}

          {activeTab === "files" && isViewingMd && viewingFile && (
            <button
              onClick={() => { void handleCheckAudio(viewingFile.path); setModal("audio-gen"); }}
              style={{ ...btnStyle, background: "#2d2a3a", color: "var(--color-accent-purple)", border: "1px solid #4a3d6a" }}
            >
              Audio
            </button>
          )}
        </div>
        <StatusLine connected={connected} status={status} gitBranch={gitBranch} />
      </div>
    </>
  );
}
