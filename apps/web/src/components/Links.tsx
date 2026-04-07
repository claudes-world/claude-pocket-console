interface LinkItem {
  title: string;
  url: string;
  icon?: string;
  description?: string;
}

const LINKS: LinkItem[] = [
  {
    title: "Transcription Glossary",
    url: "https://github.com/claudes-world/toolbox/blob/main/transcribe/glossary.txt",
    icon: "📝",
    description: "Tech terms for STT accuracy",
  },
  {
    title: "React Icons",
    url: "https://react-icons.github.io/react-icons/",
    icon: "🎨",
    description: "Icon library (FA, MD, Hero, Feather, etc.)",
  },
  {
    title: "Companion",
    url: "https://companion.claude.do",
    icon: "🦆",
    description: "companion.claude.do",
  },
  {
    title: "T3",
    url: "https://t3.claude.do",
    icon: "🌀",
    description: "t3.claude.do",
  },
  {
    title: "Edit Links",
    url: "https://github.com/claudes-world/claude-pocket-console/edit/feat/file-viewer-and-terminal-fix/apps/web/src/components/Links.tsx",
    icon: "✏️",
    description: "Add or edit links via GitHub",
  },
];

interface LinksProps {
  onClose: () => void;
}

export function Links({ onClose }: LinksProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid #2a2b3d",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexShrink: 0,
        }}
      >
        <span style={{ fontSize: 14, fontWeight: 600 }}>Links</span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#565f89",
            cursor: "pointer",
            fontSize: 14,
            padding: "2px 6px",
          }}
        >
          x
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {LINKS.map((link) => (
          <a
            key={link.url}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "flex",
              alignItems: "center",
              padding: "12px 16px",
              borderBottom: "1px solid #1e1f2e",
              textDecoration: "none",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 20 }}>{link.icon || "🔗"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: "#7aa2f7", fontWeight: 500 }}>
                {link.title}
              </div>
              {link.description && (
                <div style={{ fontSize: 12, color: "#565f89", marginTop: 2 }}>
                  {link.description}
                </div>
              )}
            </div>
            <span style={{ color: "#3b4261", fontSize: 14 }}>→</span>
          </a>
        ))}
      </div>
    </div>
  );
}
