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

export function ActionBar() {
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
      setStatus(`Error: ${err}`);
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
