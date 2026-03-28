import { useState, useEffect, useCallback, useRef } from "react";
import { Terminal } from "./components/Terminal";
import { FileViewer } from "./components/FileViewer";
import { Links } from "./components/Links";
import { ActionBar } from "./components/ActionBar";
import { getTelegramWebApp } from "./lib/telegram";

type Tab = "terminal" | "files" | "links";
const TABS: Tab[] = ["terminal", "files", "links"];
const SWIPE_THRESHOLD = 50;

export function App() {
  const [connected, setConnected] = useState(false);
  const hashParams = window.location.hash.replace("#", "");
  const initialFile = hashParams.match(/file=([^&]+)/)?.[1] ? decodeURIComponent(hashParams.match(/file=([^&]+)/)![1]) : null;
  const initialTab = initialFile ? "files" : (hashParams.split("&")[0] || "terminal") as Tab;
  const [activeTab, setActiveTab] = useState<Tab>(
    ["terminal", "files"].includes(initialTab) ? initialTab : "terminal"
  );
  const [reconnectKey, setReconnectKey] = useState(0);
  const [initialFilePath] = useState<string | null>(initialFile);

  const onConnectionChange = useCallback((c: boolean) => setConnected(c), []);
  const onReconnect = useCallback(() => setReconnectKey((k) => k + 1), []);

  // Swipe gesture handling
  const touchStartX = useRef(0);
  const touchStartY = useRef(0);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    // Only swipe if horizontal movement is dominant
    if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5) {
      const currentIdx = TABS.indexOf(activeTab);
      if (dx < 0 && currentIdx < TABS.length - 1) {
        setActiveTab(TABS[currentIdx + 1]);
      } else if (dx > 0 && currentIdx > 0) {
        setActiveTab(TABS[currentIdx - 1]);
      }
    }
  }, [activeTab]);

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Header with tabs */}
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
      >
        <div style={{ display: "flex", gap: 0 }}>
          {(["terminal", "files"] as Tab[]).map((tab) => (
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

      {/* Content area — swipeable */}
      <div
        style={{ flex: 1, minHeight: 0 }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {activeTab === "terminal" && (
          <Terminal key={reconnectKey} onConnectionChange={onConnectionChange} />
        )}
        {activeTab === "files" && (
          <FileViewer onClose={() => setActiveTab("terminal")} initialFile={initialFilePath} />
        )}
        {activeTab === "links" && (
          <Links onClose={() => setActiveTab("terminal")} />
        )}
      </div>

      {/* Action bar */}
      <ActionBar onReconnect={onReconnect} />
    </div>
  );
}
