import { useState } from "react";
import { getAuthHeaders } from "../lib/telegram";

interface Action {
  label: string;
  endpoint: string;
}

const ACTIONS: Action[] = [
  { label: "Reload Plugins", endpoint: "/api/actions/reload-plugins" },
  { label: "Git Status", endpoint: "/api/actions/git-status" },
];

interface ActionBarProps {
  onReconnect?: () => void;
}

type CompactModal = null | "confirm" | "continuity-notes";

export function ActionBar({ onReconnect }: ActionBarProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [compactModal, setCompactModal] = useState<CompactModal>(null);
  const [continuityNotes, setContinuityNotes] = useState("");

  const handleAction = async (action: Action) => {
    setStatus(`Running ${action.label}...`);
    try {
      const res = await fetch(action.endpoint, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`Failed: ${data.error || "unknown error"}`);
      } else {
        setStatus(data.output || `${action.label}: OK`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${message}`);
    }
  };

  const sendCompactCommand = async (command: string) => {
    setCompactModal(null);
    setStatus("Sending...");
    try {
      const res = await fetch("/api/actions/send-keys", {
        method: "POST",
        headers: { ...getAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ keys: command }),
      });
      const data = await res.json();
      setStatus(data.ok ? "Sent" : `Failed: ${data.error}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${message}`);
    }
  };

  const btnStyle = {
    padding: "6px 12px",
    fontSize: 12,
    fontWeight: 500,
    background: "#2a2b3d",
    color: "#c0caf5",
    border: "1px solid #3b3d57",
    borderRadius: 6,
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  };

  return (
    <>
      {/* Compact confirmation modal */}
      {compactModal === "confirm" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 16,
          }}
          onClick={() => setCompactModal(null)}
        >
          <div
            style={{
              background: "#1a1b26",
              border: "1px solid #2a2b3d",
              borderRadius: 12,
              padding: 20,
              maxWidth: 320,
              width: "100%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: "#c0caf5" }}>
              Compact Context
            </div>
            <div style={{ fontSize: 13, color: "#a9b1d6", marginBottom: 16, lineHeight: 1.5 }}>
              Choose how to compact the conversation:
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                onClick={() => sendCompactCommand("/compact")}
                style={{
                  ...btnStyle,
                  background: "#2d3a5a",
                  color: "#7aa2f7",
                  border: "1px solid #3d4a6a",
                  padding: "10px 16px",
                  textAlign: "left" as const,
                }}
              >
                Compact Now
                <div style={{ fontSize: 11, color: "#565f89", marginTop: 2 }}>
                  Compress context immediately
                </div>
              </button>
              <button
                onClick={() => {
                  setContinuityNotes("");
                  setCompactModal("continuity-notes");
                }}
                style={{
                  ...btnStyle,
                  background: "#1a3a2a",
                  color: "#9ece6a",
                  border: "1px solid #2d5a3d",
                  padding: "10px 16px",
                  textAlign: "left" as const,
                }}
              >
                Prompt for Continuity
                <div style={{ fontSize: 11, color: "#4a7a5a", marginTop: 2 }}>
                  Save context to files first, then compact
                </div>
              </button>
              <button
                onClick={() => setCompactModal(null)}
                style={{
                  ...btnStyle,
                  background: "#3a2a2a",
                  color: "#f7768e",
                  border: "1px solid #5a3d3d",
                  padding: "10px 16px",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Continuity notes modal */}
      {compactModal === "continuity-notes" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            padding: 16,
          }}
          onClick={() => setCompactModal("confirm")}
        >
          <div
            style={{
              background: "#1a1b26",
              border: "1px solid #2a2b3d",
              borderRadius: 12,
              padding: 20,
              maxWidth: 320,
              width: "100%",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 8, color: "#c0caf5" }}>
              Additional Notes
            </div>
            <div style={{ fontSize: 12, color: "#565f89", marginBottom: 12 }}>
              Anything extra to preserve before compacting? (optional)
            </div>
            <textarea
              value={continuityNotes}
              onChange={(e) => setContinuityNotes(e.target.value)}
              placeholder="e.g. Remember we were debugging the auth issue..."
              style={{
                width: "100%",
                height: 100,
                background: "#24283b",
                color: "#c0caf5",
                border: "1px solid #3b3d57",
                borderRadius: 6,
                padding: 10,
                fontSize: 13,
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    const base = "Before compacting, please ensure: 1) README.md is up to date with recent changes. 2) Anything important from this session is saved to the knowledge base or memory. 3) Open work and next steps are captured in NEXT-SESSION.md and TODO.md.";
                    const notes = continuityNotes.trim()
                      ? ` Additional context from user: "${continuityNotes.trim()}".`
                      : "";
                    sendCompactCommand(`${base}${notes}`);
                  }}
                  style={{
                    ...btnStyle,
                    flex: 1,
                    background: "#1a3a2a",
                    color: "#9ece6a",
                    border: "1px solid #2d5a3d",
                    padding: "10px 16px",
                  }}
                >
                  Just Send
                </button>
                <button
                  onClick={() => {
                    const base = "Before compacting, please ensure: 1) README.md is up to date with recent changes. 2) Anything important from this session is saved to the knowledge base or memory. 3) Open work and next steps are captured in NEXT-SESSION.md and TODO.md.";
                    const notes = continuityNotes.trim()
                      ? ` Additional context from user: "${continuityNotes.trim()}".`
                      : "";
                    sendCompactCommand(`${base}${notes} Then run /compact.`);
                  }}
                  style={{
                    ...btnStyle,
                    flex: 1,
                    background: "#2d3a5a",
                    color: "#7aa2f7",
                    border: "1px solid #3d4a6a",
                    padding: "10px 16px",
                  }}
                >
                  Send & Compact
                </button>
              </div>
              <button
                onClick={() => setCompactModal("confirm")}
                style={{
                  ...btnStyle,
                  background: "#3a2a2a",
                  color: "#f7768e",
                  border: "1px solid #5a3d3d",
                  padding: "10px 16px",
                  width: "100%",
                }}
              >
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div
        style={{
          padding: "10px 12px calc(16px + env(safe-area-inset-bottom, 8px))",
          borderTop: "1px solid #2a2b3d",
          display: "flex",
          gap: "8px",
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        {onReconnect && (
          <button onClick={onReconnect} style={{ ...btnStyle, background: "#1a3a2a", color: "#9ece6a", border: "1px solid #2d5a3d" }}>
            Reconnect
          </button>
        )}
        {ACTIONS.map((action) => (
          <button key={action.endpoint} onClick={() => handleAction(action)} style={btnStyle}>
            {action.label}
          </button>
        ))}
        <button
          onClick={() => setCompactModal("confirm")}
          style={{ ...btnStyle, background: "#3a2020", color: "#f7768e", border: "1px solid #5a3030" }}
        >
          Compact
        </button>
        {status && (
          <span
            style={{
              fontSize: 11,
              color: "#7aa2f7",
              alignSelf: "center",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 200,
            }}
          >
            {status}
          </span>
        )}
      </div>
    </>
  );
}
