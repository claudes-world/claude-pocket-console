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
  const handleAction = async (action: Action) => {
    try {
      const res = await fetch(action.endpoint, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        console.error("Action failed:", data);
      }
    } catch (err) {
      console.error("Action error:", err);
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
    </div>
  );
}
