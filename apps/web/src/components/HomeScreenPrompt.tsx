import { getTelegramWebApp } from "../lib/telegram";

interface HomeScreenPromptProps {
  onDismiss: () => void;
}

export function HomeScreenPrompt({ onDismiss }: HomeScreenPromptProps) {
  const handleAdd = () => {
    getTelegramWebApp()?.addToHomeScreen?.();
    onDismiss();
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 64,
        left: 12,
        right: 12,
        background: "var(--color-surface)",
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        padding: "12px 14px",
        display: "flex",
        alignItems: "center",
        gap: 10,
        zIndex: 100,
        boxShadow: "0 4px 16px rgba(0,0,0,0.25)",
      }}
    >
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-fg)", marginBottom: 2 }}>
          Add to Home Screen
        </div>
        <div style={{ fontSize: 12, color: "var(--color-muted)" }}>
          Quick access to Claude Pocket Console
        </div>
      </div>
      <button
        onClick={onDismiss}
        style={{
          background: "none",
          border: "none",
          color: "var(--color-muted)",
          fontSize: 12,
          cursor: "pointer",
          padding: "4px 8px",
          borderRadius: 6,
        }}
      >
        Not now
      </button>
      <button
        onClick={handleAdd}
        style={{
          background: "var(--color-accent-blue)",
          border: "none",
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          padding: "6px 12px",
          borderRadius: 6,
          whiteSpace: "nowrap",
        }}
      >
        Add
      </button>
    </div>
  );
}
