type Tab = "terminal" | "files" | "links" | "voice" | "prs" | "pulse";

interface AppSwitcherSection {
  id: Tab | "agents" | "settings";
  label: string;
  icon: string;
  active: boolean;
}

const SECTIONS: AppSwitcherSection[] = [
  { id: "terminal", label: "Terminal", icon: "🖥", active: true },
  { id: "files",    label: "Files",    icon: "📁", active: true },
  { id: "links",    label: "Links",    icon: "🔗", active: true },
  { id: "voice",    label: "Voice",    icon: "🎤", active: true },
  { id: "prs",      label: "PRs",      icon: "⊙",  active: true },
  { id: "pulse",    label: "Pulse",    icon: "📊", active: true },
  { id: "agents",   label: "Agents",   icon: "🤖", active: false },
  { id: "settings", label: "Settings", icon: "⚙",  active: false },
];

interface AppSwitcherProps {
  activeTab: Tab;
  onSelect: (tab: Tab) => void;
}

export function AppSwitcher({ activeTab, onSelect }: AppSwitcherProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12,
      padding: "16px 16px 0",
      flex: 1,
      overflowY: "auto",
    }}>
      {SECTIONS.map((section) => (
        <button
          key={section.id}
          disabled={!section.active}
          onClick={() => {
            if (section.active) onSelect(section.id as Tab);
          }}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: "20px 12px",
            borderRadius: 12,
            background: section.active
              ? (section.id === activeTab ? "var(--color-accent-blue)" : "var(--color-surface)")
              : "var(--color-bg-alt)",
            border: "1px solid var(--color-border)",
            cursor: section.active ? "pointer" : "default",
            opacity: section.active ? 1 : 0.4,
            transition: "background 200ms ease",
          }}
        >
          <span style={{ fontSize: 28 }}>{section.icon}</span>
          <span style={{
            fontSize: 12,
            color: section.active
              ? (section.id === activeTab ? "#ffffff" : "var(--color-fg)")
              : "var(--color-muted)",
            fontWeight: section.id === activeTab ? 600 : 400,
          }}>
            {section.label}
          </span>
          {!section.active && (
            <span style={{ fontSize: 9, color: "var(--color-muted)", marginTop: -4 }}>
              soon
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
