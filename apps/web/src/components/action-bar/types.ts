import type { CSSProperties } from "react";
import type { SortMode } from "../FileViewer";

export interface ActionBarProps {
  onReconnect?: () => void;
  connected?: boolean;
  activeTab?: string;
  fileShowHidden?: boolean;
  setFileShowHidden?: (v: boolean) => void;
  fileSortMode?: SortMode;
  setFileSortMode?: (v: SortMode) => void;
  viewingFile?: { path: string; name: string } | null;
  currentFolder?: string | null;
}

export type Modal =
  | null
  | "commands"
  | "compact-confirm"
  | "compact-focus"
  | "continuity-notes"
  | "rename"
  | "fork-name"
  | "git-status"
  | "git-menu"
  | "todo"
  | "resume"
  | "new-confirm"
  | "file-options"
  | "file-search"
  | "audio-gen"
  | "tldr"
  | "confirm-delete"
  | "reconnect-menu";

export interface SessionName {
  name: string;
  ts: number;
}

export interface SearchResult {
  name: string;
  path: string;
  type: string;
  relPath: string;
}

export interface AudioStatus {
  exists: boolean;
  path?: string;
}

export interface GitBranch {
  branch: string;
  treeType: string;
}

export const btnStyle: CSSProperties = {
  padding: "6px 12px",
  fontSize: 12,
  borderRadius: 6,
  background: "var(--color-surface)",
  color: "var(--color-fg-muted)",
  border: "1px solid var(--color-border)",
  cursor: "pointer",
  whiteSpace: "nowrap",
  flexShrink: 0,
};

export const modalCenter: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 16,
};
