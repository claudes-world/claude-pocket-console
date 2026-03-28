import { useState, useEffect, useCallback } from "react";
import { Terminal } from "./components/Terminal";
import { FileViewer } from "./components/FileViewer";
import { ActionBar } from "./components/ActionBar";
import { getTelegramWebApp } from "./lib/telegram";

type Tab = "terminal" | "files";

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

      {/* Content area */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {activeTab === "terminal" && (
          <Terminal key={reconnectKey} onConnectionChange={onConnectionChange} />
        )}
        {activeTab === "files" && (
          <FileViewer onClose={() => setActiveTab("terminal")} initialFile={initialFilePath} />
        )}
      </div>

      {/* Action bar */}
      <ActionBar onReconnect={onReconnect} />
    </div>
  );
}
