import { useState } from "react";
import { getTelegramWebApp } from "../lib/telegram";
import "./Links.css";

interface LinkItem {
  title: string;
  url: string;
  icon?: string;
  description?: string;
  /**
   * Open by navigating the current webview instead of target="_blank", so
   * inside Telegram the destination stays INSIDE the Mini App window
   * (Liam voice msg 1185). See openInApp for why the SDK link methods
   * don't fit.
   */
  inApp?: boolean;
}

/**
 * Navigate to `url` without leaving the Mini App.
 *
 * Inside the Telegram WebView the only mechanic that keeps a destination
 * INSIDE the Mini App window is navigating the webview itself — the SDK's
 * link methods were each checked and rejected:
 *   - `WebApp.openLink(url)` always opens the EXTERNAL browser (Safari) —
 *     the exact behavior this feature exists to avoid;
 *   - `WebApp.openTelegramLink(url)` only takes t.me links and closes the
 *     current Mini App to switch context;
 *   - `target="_blank"` anchors (the default for every other link on this
 *     tab) are handed to the external browser by the WebView too.
 * SDK access is presence-checked and try/caught (same defensive pattern as
 * the PR #286 fullscreen guard); outside Telegram — plain browser tab —
 * fall back to a new tab so CPC itself stays open.
 */
function openInApp(url: string) {
  let insideTelegram = false;
  try {
    insideTelegram = Boolean(getTelegramWebApp());
  } catch {
    insideTelegram = false;
  }
  if (insideTelegram) {
    window.location.assign(url);
  } else {
    window.open(url, "_blank", "noopener,noreferrer");
  }
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
    title: "Fleet Cockpit",
    url: "https://cockpit.claude.do",
    icon: "🛩️",
    description: "Fleet grid + live lane terminals",
    // Stays inside the Mini App (Liam voice msg 1185). NOTE: cockpit.claude.do
    // currently sits behind Cloudflare Access, which a Telegram WebView cannot
    // pass — the link hits the Access wall until the cockpit auth lift lands
    // (world-os#218 plan addendum). Shipped anyway per Liam.
    inApp: true,
  },
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
            // In-app links navigate the webview itself (see openInApp);
            // everything else keeps the external-tab behavior.
            target={link.inApp ? undefined : "_blank"}
            rel={link.inApp ? undefined : "noopener noreferrer"}
            onClick={link.inApp ? (e) => { e.preventDefault(); openInApp(link.url); } : undefined}
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
