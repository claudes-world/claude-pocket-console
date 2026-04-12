import { useState } from "react";
import "./Links.css";

interface LinkItem {
  title: string;
  url: string;
  icon?: string;
  description?: string;
}

interface AppItem {
  id: string;
  name: string;
  url: string;
  iconSrc: string;
  /** Emoji fallback shown if iconSrc fails to load. */
  fallbackEmoji: string;
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
    title: "Edit Links",
    url: "https://github.com/claudes-world/claude-pocket-console/edit/feat/file-viewer-and-terminal-fix/apps/web/src/components/Links.tsx",
    icon: "✏️",
    description: "Add or edit links via GitHub",
  },
];

const APPS: AppItem[] = [
  {
    id: "companion",
    name: "Companion",
    url: "https://companion.claude.do",
    iconSrc: `${import.meta.env.BASE_URL}apps/companion-512.png`,
    fallbackEmoji: "🦆",
  },
  {
    id: "t3",
    name: "T3 Code",
    url: "https://t3.claude.do",
    iconSrc: `${import.meta.env.BASE_URL}apps/t3-blueprint-256.png`,
    fallbackEmoji: "🌀",
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
          borderBottom: "1px solid var(--color-border)",
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
            color: "var(--color-muted)",
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
              borderBottom: "1px solid var(--color-separator)",
              textDecoration: "none",
              gap: 12,
            }}
          >
            <span style={{ fontSize: 20 }}>{link.icon || "🔗"}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, color: "var(--color-accent-blue)", fontWeight: 500 }}>
                {link.title}
              </div>
              {link.description && (
                <div style={{ fontSize: 12, color: "var(--color-muted)", marginTop: 2 }}>
                  {link.description}
                </div>
              )}
            </div>
            <span style={{ color: "#3b4261", fontSize: 14 }}>→</span>
          </a>
        ))}

        {/* --- Apps section --- */}
        <div
          style={{
            borderTop: "1px solid var(--color-separator)",
            marginTop: 8,
            padding: "20px 16px 24px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-muted)",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              marginBottom: 12,
            }}
          >
            Apps
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(84px, 1fr))",
              rowGap: 16,
              columnGap: 8,
            }}
          >
            {APPS.map((app) => (
              <AppTile key={app.id} app={app} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppTile({ app }: { app: AppItem }) {
  const [failed, setFailed] = useState(false);

  return (
    <a
      href={app.url}
      target="_blank"
      rel="noopener noreferrer"
      className="cpc-app-tile"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
        padding: "4px 0",
        textDecoration: "none",
        minWidth: 0,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--color-separator)",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {failed ? (
          <span aria-hidden="true" style={{ fontSize: 32, lineHeight: 1 }}>{app.fallbackEmoji}</span>
        ) : (
          <img
            src={app.iconSrc}
            // Empty alt: the visible name label below is the accessible name for this
            // link, so the icon is decorative and should be skipped by screen readers.
            alt=""
            width={64}
            height={64}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        )}
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "var(--color-fg)",
          maxWidth: 80,
          textAlign: "center",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {app.name}
      </div>
    </a>
  );
}
