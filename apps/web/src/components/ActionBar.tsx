import { useState } from "react";
import { getAuthHeaders } from "../lib/telegram";

interface Action {
  label: string;
  endpoint: string;
  confirm?: boolean;
}

const ACTIONS: Action[] = [
  { label: "Reload Plugins", endpoint: "/api/actions/reload-plugins" },
  { label: "Git Status", endpoint: "/api/actions/git-status" },
];

interface ActionBarProps {
  onReconnect?: () => void;
}

export function ActionBar({ onReconnect }: ActionBarProps) {
  const [status, setStatus] = useState<string | null>(null);

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

  return (
    <div
      style={{
        padding: "8px 12px",
        borderTop: "1px solid #2a2b3d",
        display: "flex",
        gap: "8px",
        flexShrink: 0,
        overflowX: "auto",
      }}
    >
      {onReconnect && (
        <button
          onClick={onReconnect}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 500,
            background: "#1a3a2a",
            color: "#9ece6a",
            border: "1px solid #2d5a3d",
            borderRadius: 6,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Reconnect
        </button>
      )}
      {ACTIONS.map((action) => (
        <button
          key={action.endpoint}
          onClick={() => handleAction(action)}
          style={{
            padding: "6px 12px",
            fontSize: 12,
            fontWeight: 500,
            background: "#2a2b3d",
            color: "#c0caf5",
            border: "1px solid #3b3d57",
            borderRadius: 6,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          {action.label}
        </button>
      ))}
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
  );
}
