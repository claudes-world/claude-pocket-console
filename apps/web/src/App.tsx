import { useState, useEffect } from "react";
import { Terminal } from "./components/Terminal";
import { ActionBar } from "./components/ActionBar";
import { getTelegramWebApp } from "./lib/telegram";

export function App() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const tg = getTelegramWebApp();
    if (tg) {
      tg.ready();
      tg.expand();
    }
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        style={{
          padding: "8px 16px",
          borderBottom: "1px solid #2a2b3d",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          Claude Pocket Console
        </span>
        <span
          style={{
            fontSize: 12,
            color: connected ? "#9ece6a" : "#f7768e",
          }}
        >
          {connected ? "connected" : "disconnected"}
        </span>
      </header>

      <div style={{ flex: 1, minHeight: 0 }}>
        <Terminal onConnectionChange={setConnected} />
      </div>

      <ActionBar />
    </div>
  );
}
