import { useState, useEffect, useCallback, useRef } from "react";
import { Terminal } from "./components/Terminal";
import { FileViewer } from "./components/FileViewer";
import { Links } from "./components/Links";
import { ActionBar } from "./components/ActionBar";
import { VoiceRecorder } from "./components/VoiceRecorder";
import { getTelegramWebApp, getAuthHeaders } from "./lib/telegram";

type Tab = "terminal" | "files" | "links" | "voice";
const TABS: Tab[] = ["terminal", "files", "links", "voice"];
const SWIPE_THRESHOLD = 120;

export function App() {
  const [connected, setConnected] = useState(false);
  const hashParams = window.location.hash.replace("#", "");
  const initialFile = hashParams.match(/file=([^&]+)/)?.[1] ? decodeURIComponent(hashParams.match(/file=([^&]+)/)![1]) : null;
  const initialTab = initialFile ? "files" : (hashParams.split("&")[0] || "terminal") as Tab;
  const [activeTab, setActiveTab] = useState<Tab>(
    TABS.includes(initialTab as Tab) ? initialTab : "terminal"
  );
  const [reconnectKey, setReconnectKey] = useState(0);
  const [initialFilePath] = useState<string | null>(initialFile);
  const [fileShowHidden, setFileShowHidden] = useState(false);
  const [fileSortMode, setFileSortMode] = useState<string>("name-asc");
  const [viewingFile, setViewingFile] = useState<{ path: string; name: string } | null>(null);
  const [cpcBranch, setCpcBranch] = useState<string | null>(null);

  const onConnectionChange = useCallback((c: boolean) => setConnected(c), []);
  const onReconnect = useCallback(() => {
    fetch("/api/terminal/resize-terminal", { method: "POST" }).catch(() => {});
    setReconnectKey((k) => k + 1);
  }, []);

  // Swipe gesture state
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);
  const isDragging = useRef(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);

  const activeIdx = TABS.indexOf(activeTab);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    isDragging.current = false;
    setIsAnimating(false);
    setDragOffset(0);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - touchStartX.current;
    const dy = e.touches[0].clientY - touchStartY.current;
    // Only track horizontal swipes where horizontal is dominant
    if (!isDragging.current && Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
    if (!isDragging.current) {
      if (Math.abs(dx) > Math.abs(dy) * 1.2) {
        isDragging.current = true;
      } else {
        return;
      }
    }
    // Clamp: can't swipe past first/last tab
    const currentIdx = TABS.indexOf(activeTab);
    const clampedDx =
      (dx < 0 && currentIdx >= TABS.length - 1) ? Math.min(0, dx * 0.2) :
      (dx > 0 && currentIdx <= 0) ? Math.max(0, dx * 0.2) :
      dx;
    setDragOffset(clampedDx);
  }, [activeTab]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    setIsAnimating(true);
    setDragOffset(0);
    if (isDragging.current && Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const currentIdx = TABS.indexOf(activeTab);
      if (dx < 0 && currentIdx < TABS.length - 1) {
        setActiveTab(TABS[currentIdx + 1]);
      } else if (dx > 0 && currentIdx > 0) {
        setActiveTab(TABS[currentIdx - 1]);
      }
    }
    isDragging.current = false;
  }, [activeTab]);

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);

  // Fetch CPC branch on mount and every 30 seconds
  useEffect(() => {
    const fetchCpcBranch = async () => {
      try {
        const res = await fetch("/api/terminal/cpc-branch", { headers: getAuthHeaders() });
        const data = await res.json();
        if (data.ok) setCpcBranch(data.branch);
      } catch { /* silent */ }
    };
    fetchCpcBranch();
    const interval = setInterval(fetchCpcBranch, 30000);
    return () => clearInterval(interval);
  }, []);

  // The strip is (TABS.length * 100vw) wide. To show tab N we shift by -(N * 100vw).
  // Expressed as % of the strip: -(N * 100% / TABS.length).
  // dragOffset is in px (finger delta) and should also be expressed relative to strip width,
  // but since we just want pixel-accurate dragging we use a calc mix.
  const stripShift = `calc(${(-activeIdx * 100) / TABS.length}% + ${dragOffset / TABS.length}px)`;

  const isDev = window.location.hostname.includes("cpc-dev");

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", maxWidth: "100vw", overflowX: "hidden" }}>
      {/* Dev mode banner */}
      {isDev && (
        <div style={{
          background: "#f59e0b",
          color: "#000",
          textAlign: "center",
          fontSize: 11,
          fontWeight: 700,
          padding: "2px 0",
          letterSpacing: "0.1em",
          flexShrink: 0,
        }}>
          DEVELOPMENT
        </div>
      )}
      {/* Header with tabs — stop propagation so swipe doesn't fire from tab bar */}
      <header
        style={{
          padding: "0 12px",
          borderBottom: "1px solid #2a2b3d",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
          height: 40,
        }}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", gap: 0 }}>
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: activeTab === tab ? 600 : 400,
                background: "none",
                color: activeTab === tab ? "#c0caf5" : "#565f89",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid #7aa2f7" : "2px solid transparent",
                cursor: "pointer",
                textTransform: "capitalize",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
        <span
          style={{
            fontSize: 11,
            color: connected ? "#9ece6a" : "#f7768e",
            display: "flex",
            alignItems: "center",
            gap: 4,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: connected ? "#9ece6a" : "#f7768e",
              display: "inline-block",
            }}
          />
          {connected ? "live" : "offline"}
        </span>
      </header>

      {/* CPC branch indicator — terminal tab only */}
      {activeTab === "terminal" && cpcBranch && (
        <div
          style={{
            fontSize: 11,
            color: "#565f89",
            padding: "3px 14px",
            borderBottom: "1px solid #2a2b3d",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
          }}
        >
          <span>Claude Pocket Console: {cpcBranch}</span>
          <span style={{ marginLeft: "auto", color: "#3b3d57" }}>v1.0.1</span>
        </div>
      )}

      {/* Content area — swipeable viewport */}
      <div
        style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Sliding strip of all tab contents */}
        <div
          style={{
            display: "flex",
            width: `${TABS.length * 100}%`,
            height: "100%",
            transform: `translateX(${stripShift})`,
            transition: isAnimating ? "transform 300ms ease-out" : "none",
            willChange: "transform",
          }}
          onTransitionEnd={() => setIsAnimating(false)}
        >
          <div style={{ width: `${100 / TABS.length}%`, height: "100%", flexShrink: 0 }}>
            <Terminal key={reconnectKey} onConnectionChange={onConnectionChange} />
          </div>
          <div style={{ width: `${100 / TABS.length}%`, height: "100%", flexShrink: 0 }}>
            <FileViewer onClose={() => setActiveTab("terminal")} initialFile={initialFilePath} showHidden={fileShowHidden} sortMode={fileSortMode} onViewChange={setViewingFile} />
          </div>
          <div style={{ width: `${100 / TABS.length}%`, height: "100%", flexShrink: 0 }}>
            <Links onClose={() => setActiveTab("terminal")} />
          </div>
          <div style={{ width: `${100 / TABS.length}%`, height: "100%", flexShrink: 0 }}>
            <VoiceRecorder />
          </div>
        </div>
      </div>

      {/* Action bar — stop propagation so swipe doesn't fire from action buttons */}
      <div onTouchStart={(e) => e.stopPropagation()}>
        <ActionBar
          onReconnect={onReconnect}
          connected={connected}
          activeTab={activeTab}
          fileShowHidden={fileShowHidden}
          setFileShowHidden={setFileShowHidden}
          fileSortMode={fileSortMode}
          setFileSortMode={setFileSortMode}
          viewingFile={viewingFile}
        />
      </div>
    </div>
  );
}
