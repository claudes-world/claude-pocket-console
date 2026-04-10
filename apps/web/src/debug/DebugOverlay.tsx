/**
 * DebugOverlay.tsx — Minimal floating debug panel for CPC.
 *
 * Dev-only: renders nothing on production hostnames.
 * Shows a small badge with the captured error count. Tap to expand
 * into a scrollable error list. Each entry shows timestamp, type,
 * message, and source location.
 *
 * Uses inline styles matching CPC's Tokyo Night palette.
 */

import { useState, useCallback, useSyncExternalStore } from "react";
import {
  isDevHost,
  getEntries,
  getEntryCount,
  clearEntries,
  subscribe,
  isCaptureInstalled,
  type DebugEntry,
} from "./capture";

// --- Palette (Tokyo Night) ---
const BG = "#1a1b26";
const BG_SURFACE = "#16161e";
const TEXT = "#c0caf5";
const TEXT_MUTED = "#565f89";
const ACCENT = "#7aa2f7";
const ERROR_COLOR = "#f7768e";
const BORDER = "#2a2b3d";

function formatTime(timestamp: number): string {
  // timestamp is from performance.now() — convert to wall clock
  const wallMs = Date.now() - performance.now() + timestamp;
  const d = new Date(wallMs);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function EntryRow({ entry }: { entry: DebugEntry }) {
  const [expanded, setExpanded] = useState(false);
  const typeColor = entry.type === "error" ? ERROR_COLOR : "#e0af68";

  return (
    <div
      style={{
        borderBottom: `1px solid ${BORDER}`,
        padding: "6px 8px",
        cursor: "pointer",
      }}
      onClick={() => setExpanded(!expanded)}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: typeColor,
            textTransform: "uppercase",
            flexShrink: 0,
          }}
        >
          {entry.type}
        </span>
        <span style={{ fontSize: 10, color: TEXT_MUTED, flexShrink: 0 }}>
          {formatTime(entry.timestamp)}
        </span>
        <span
          style={{
            fontSize: 11,
            color: TEXT,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {entry.message}
        </span>
      </div>
      {entry.source && !expanded && (
        <div
          style={{
            fontSize: 9,
            color: TEXT_MUTED,
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {entry.source}
        </div>
      )}
      {expanded && (
        <pre
          style={{
            fontSize: 10,
            color: TEXT_MUTED,
            marginTop: 4,
            marginBottom: 0,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            maxHeight: 150,
            overflowY: "auto",
          }}
        >
          {entry.detail || "(no details)"}
        </pre>
      )}
    </div>
  );
}

export function DebugOverlay() {
  // Gate: only render on dev hostnames
  if (!isDevHost()) return null;
  if (!isCaptureInstalled()) return null;

  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState("");

  // Subscribe to capture store changes via useSyncExternalStore
  const entryCount = useSyncExternalStore(subscribe, getEntryCount);
  const allEntries = useSyncExternalStore(subscribe, getEntries);

  const filtered = filter
    ? (allEntries as DebugEntry[]).filter(
        (e) =>
          e.message.toLowerCase().includes(filter.toLowerCase()) ||
          e.detail.toLowerCase().includes(filter.toLowerCase()),
      )
    : (allEntries as DebugEntry[]);

  const handleClear = useCallback(() => {
    clearEntries();
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setFilter("");
  }, []);

  // Badge only (collapsed state)
  if (!isOpen) {
    if (entryCount === 0) return null;
    return (
      <button
        onClick={() => setIsOpen(true)}
        aria-label={`Debug overlay: ${entryCount} errors captured`}
        style={{
          position: "fixed",
          bottom: 52,
          right: 8,
          zIndex: 9999,
          background: BG,
          color: ERROR_COLOR,
          border: `1px solid ${BORDER}`,
          borderRadius: 16,
          padding: "4px 10px",
          fontSize: 12,
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
        }}
      >
        <span aria-hidden="true">&#x1f41b;</span>
        <span>{entryCount}</span>
      </button>
    );
  }

  // Expanded panel
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="CPC Debug Panel"
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        maxHeight: "40vh",
        display: "flex",
        flexDirection: "column",
        background: BG,
        borderTop: `2px solid ${ACCENT}`,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        boxShadow: "0 -4px 16px rgba(0,0,0,0.5)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 8px",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
          background: BG_SURFACE,
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 700, color: ACCENT }}>
          Debug ({filtered.length}/{entryCount})
        </span>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={handleClear}
            aria-label="Clear all debug entries"
            style={{
              background: "none",
              border: `1px solid ${BORDER}`,
              color: TEXT_MUTED,
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 4,
              cursor: "pointer",
            }}
          >
            Clear
          </button>
          <button
            onClick={handleClose}
            aria-label="Close debug panel"
            style={{
              background: "none",
              border: `1px solid ${BORDER}`,
              color: TEXT_MUTED,
              fontSize: 12,
              padding: "2px 6px",
              borderRadius: 4,
              cursor: "pointer",
              fontWeight: 700,
            }}
          >
            &#x2715;
          </button>
        </div>
      </div>

      {/* Filter input */}
      <div
        style={{
          padding: "4px 8px",
          borderBottom: `1px solid ${BORDER}`,
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter errors..."
          aria-label="Filter debug entries"
          style={{
            width: "100%",
            background: BG_SURFACE,
            color: TEXT,
            border: `1px solid ${BORDER}`,
            borderRadius: 4,
            padding: "4px 8px",
            fontSize: 11,
            fontFamily: "inherit",
            outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Entry list */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          minHeight: 0,
        }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 16,
              textAlign: "center",
              color: TEXT_MUTED,
              fontSize: 11,
            }}
          >
            {entryCount === 0 ? "No errors captured" : "No matching entries"}
          </div>
        ) : (
          // Render newest first
          [...filtered].reverse().map((entry) => (
            <EntryRow key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </div>
  );
}
