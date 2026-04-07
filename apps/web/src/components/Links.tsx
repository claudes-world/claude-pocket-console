import { useState } from "react";

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
    iconSrc: "/apps/companion-512.png",
    fallbackEmoji: "🦆",
  },
  {
    id: "t3",
    name: "T3",
    url: "https://t3.claude.do",
    iconSrc: "/apps/t3-1024.png",
    fallbackEmoji: "🌀",
  },
];

// True iOS squircle (superellipse) as inline SVG mask.
// Used as the @supports-not fallback below the CSS `corner-shape: squircle` primary path.
const SQUIRCLE_MASK =
  `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><path d='M 50,0 C 10,0 0,10 0,50 0,90 10,100 50,100 90,100 100,90 100,50 100,10 90,0 50,0 Z'/></svg>")`;

// Squircle technique: tiered fallback chain driven by @supports.
// Layer 1 (primary): CSS `corner-shape: squircle` + `border-radius: 22%` — native true
//   squircle available in Safari 26+ (2025) and Chrome 130+ (late 2025). Telegram iOS
//   WebView wraps WKWebView and inherits Safari's support.
// Layer 2 (fallback): mask-image with an inline SVG superellipse path for browsers that
//   do not yet implement `corner-shape`. Indistinguishable from Layer 1 at 64px.
// Layer 3 (graceful): bare `border-radius: 22%` rounded rect, inherited when neither of
//   the above applies (no @supports block needed — it's the base rule).
// See https://developer.mozilla.org/en-US/docs/Web/CSS/corner-shape
const TILE_STYLE = `
  .cpc-app-tile {
    transition: transform 120ms ease-out;
  }
  .cpc-app-tile:active {
    transform: scale(0.92);
  }
  .cpc-app-squircle {
    border-radius: 22%;
    corner-shape: squircle;
  }
  @supports not (corner-shape: squircle) {
    .cpc-app-squircle {
      border-radius: 0;
      -webkit-mask-image: ${SQUIRCLE_MASK};
      mask-image: ${SQUIRCLE_MASK};
      -webkit-mask-size: 100% 100%;
      mask-size: 100% 100%;
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
    }
  }
`;

interface LinksProps {
  onClose: () => void;
}

export function Links({ onClose }: LinksProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <style>{TILE_STYLE}</style>
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

        {/* --- Apps section --- */}
        <div
          style={{
            borderTop: "1px solid #1e1f2e",
            marginTop: 8,
            padding: "20px 16px 24px",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#565f89",
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
        className="cpc-app-squircle"
        style={{
          width: 64,
          height: 64,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1e1f2e",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {failed ? (
          <span style={{ fontSize: 32, lineHeight: 1 }}>{app.fallbackEmoji}</span>
        ) : (
          <img
            src={app.iconSrc}
            alt={app.name}
            width={64}
            height={64}
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
          color: "#c0caf5",
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
