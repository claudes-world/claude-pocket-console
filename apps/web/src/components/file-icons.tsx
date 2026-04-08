import type { ReactNode } from "react";

/**
 * Returns an inline SVG icon (16x16) for the given filename or folder.
 * Icons use the Tokyo Night palette and cover the most common file types
 * in this repo. Unknown extensions fall back to a generic doc outline.
 *
 * No runtime deps — all paths are hand-rolled SVG.
 */

const SIZE = 16;

// Shared wrapper — keeps every icon the same box so row alignment stays stable.
function Frame({ children, color }: { children: ReactNode; color: string }) {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke={color}
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

// Generic doc outline — also the default fallback.
function DocIcon({ color }: { color: string }) {
  return (
    <Frame color={color}>
      <path d="M3.5 1.5h6l3 3v10h-9z" />
      <path d="M9.5 1.5v3h3" />
    </Frame>
  );
}

// Badge-style icon: colored square with 1-2 letters inside.
function BadgeIcon({ color, label }: { color: string; label: string }) {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill={color} />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fontSize="7"
        fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
        fontWeight="700"
        fill="#1a1b26"
      >
        {label}
      </text>
    </svg>
  );
}

function JsonIcon() {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="#e0af68"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      <path d="M6 2.5c-2 0-2 1.5-2 3s0 2-1.5 2.5c1.5.5 1.5 1 1.5 2.5s0 3 2 3" />
      <path d="M10 2.5c2 0 2 1.5 2 3s0 2 1.5 2.5c-1.5.5-1.5 1-1.5 2.5s0 3-2 3" />
    </svg>
  );
}

function MdIcon() {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="#7dcfff"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" />
      <path d="M4 11V5l2 3 2-3v6" />
      <path d="M11 5v6m0 0l-1.5-1.5M11 11l1.5-1.5" />
    </svg>
  );
}

function ShIcon() {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="#9ece6a"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <path d="M4 6l2 2-2 2" />
      <path d="M8 10.5h4" />
    </svg>
  );
}

function PyIcon() {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="#7aa2f7"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      {/* two interlocking curves — abstract, not the real python logo */}
      <path d="M8 2c-2.5 0-3 1-3 2v2h4" />
      <path d="M5 6H3.5C2.5 6 2 6.5 2 8s.5 2 1.5 2H8" />
      <path d="M8 14c2.5 0 3-1 3-2v-2H7" />
      <path d="M11 10h1.5c1 0 1.5-.5 1.5-2s-.5-2-1.5-2H8" />
    </svg>
  );
}

function CssIcon() {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="#7dcfff"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      <path d="M5 3l-1 10" />
      <path d="M9 3l-1 10" />
      <path d="M2.5 6.5h11" />
      <path d="M2.5 9.5h11" />
    </svg>
  );
}

function HtmlIcon() {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="#e0af68"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      <path d="M6 5L2.5 8 6 11" />
      <path d="M10 5l3.5 3-3.5 3" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="#bb9af7"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <circle cx="5.5" cy="6.5" r="1.2" />
      <path d="M2 12l3.5-3.5L9 12" />
      <path d="M7.5 11l2.5-2.5L14 12.5" />
    </svg>
  );
}

function TxtIcon() {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="#c0caf5"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      <path d="M3.5 1.5h6l3 3v10h-9z" />
      <path d="M9.5 1.5v3h3" />
      <path d="M5.5 8h5" />
      <path d="M5.5 10h5" />
      <path d="M5.5 12h3" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width={SIZE}
      height={SIZE}
      viewBox="0 0 16 16"
      fill="none"
      stroke="#7aa2f7"
      strokeWidth={1.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0, verticalAlign: "text-bottom" }}
      aria-hidden="true"
    >
      <path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" />
    </svg>
  );
}

/**
 * Extract lowercased extension (no dot) from a path or filename.
 * Returns "" if the basename has no extension.
 */
function getExtension(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return ""; // dotfiles (".env") and no-ext files → no extension
  return base.slice(dot + 1).toLowerCase();
}

export function getFileIcon(filename: string, isFolder: boolean): ReactNode {
  if (isFolder) return <FolderIcon />;

  const ext = getExtension(filename);
  switch (ext) {
    case "json":
      return <JsonIcon />;
    case "ts":
    case "tsx":
      return <BadgeIcon color="#7aa2f7" label="TS" />;
    case "js":
    case "jsx":
      return <BadgeIcon color="#e0af68" label="JS" />;
    case "md":
    case "markdown":
      return <MdIcon />;
    case "sh":
    case "bash":
    case "zsh":
      return <ShIcon />;
    case "py":
      return <PyIcon />;
    case "css":
    case "scss":
    case "sass":
      return <CssIcon />;
    case "html":
    case "htm":
      return <HtmlIcon />;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
      return <ImageIcon />;
    case "txt":
    case "log":
      return <TxtIcon />;
    default:
      return <DocIcon color="#c0caf5" />;
  }
}
