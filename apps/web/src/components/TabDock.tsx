type Tab = "terminal" | "files" | "links" | "voice" | "prs";

const TAB_LABELS: Record<Tab, string> = {
  terminal: "Terminal",
  files: "Files",
  links: "Links",
  voice: "Voice",
  prs: "PRs",
};

const TABS: Tab[] = ["terminal", "files", "links", "voice", "prs"];

interface TabDockProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  connected: boolean;
}

export function TabDock({ activeTab, onTabChange, connected }: TabDockProps) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      width: "100%",
      padding: "0 8px",
      gap: 2,
      height: 48,
    }}>
      {/* Tab pills */}
      <div style={{ display: "flex", gap: 2, flex: 1, overflowX: "auto", scrollbarWidth: "none" }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            style={{
              padding: "6px 14px",
              borderRadius: 16,
              fontSize: 13,
              fontWeight: activeTab === tab ? 600 : 400,
              color: activeTab === tab ? "#ffffff" : "var(--color-muted)",
              background: activeTab === tab ? "var(--color-accent-blue)" : "transparent",
              border: "none",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
              transition: "background 200ms ease, color 200ms ease",
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>

      {/* Connection indicator */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 4,
        fontSize: 11,
        color: connected ? "var(--color-accent-green)" : "var(--color-accent-red)",
        flexShrink: 0,
        paddingLeft: 4,
      }}>
        <span>●</span>
        <span>{connected ? "live" : "off"}</span>
      </div>

      {/* More button */}
      <button
        onClick={() => {}}
        style={{
          padding: "6px 10px",
          borderRadius: 16,
          fontSize: 13,
          color: "var(--color-muted)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          flexShrink: 0,
          marginLeft: 2,
        }}
      >
        ⋯
      </button>
    </div>
  );
}
