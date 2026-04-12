import { useState, useEffect, useCallback, useRef } from "react";
import { getAuthHeaders } from "../lib/telegram";

// --- Types matching server PrRow ---

interface PrRow {
  key: string;
  repo: string;
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  headRefName: string;
  author: string;
  reviewDecision: "APPROVED" | "REVIEW_REQUIRED" | "CHANGES_REQUESTED" | null;
  ciStatus: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | null;
  url: string;
  updatedAt: string;
  firstSeen: number;
  lastChanged: number;
}

type FilterMode = "current" | "all";

// --- Color palette (reuses existing CPC theme) ---

const COLORS = {
  green: "#9ece6a",
  yellow: "#e0af68",
  red: "#f7768e",
  blue: "#7aa2f7",
  muted: "#565f89",
  bg: "#1a1b26",
  surface: "#24283b",
  border: "#2a2b3d",
  text: "#c0caf5",
  textMuted: "#565f89",
};

// --- Status dot color logic ---

function getStatusColor(pr: PrRow): string {
  if (pr.isDraft) return COLORS.muted;
  if (pr.state === "MERGED") return "#bb9af7"; // purple
  if (pr.state === "CLOSED") return COLORS.muted;

  // Open PR color: combine review + CI status
  if (pr.reviewDecision === "CHANGES_REQUESTED" || pr.ciStatus === "FAILURE" || pr.ciStatus === "ERROR") {
    return COLORS.red;
  }
  if (pr.reviewDecision === "APPROVED" && (pr.ciStatus === "SUCCESS" || pr.ciStatus === null)) {
    return COLORS.green;
  }
  return COLORS.yellow; // pending
}

// --- Relative time ---

function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// --- Review status label ---

function reviewLabel(pr: PrRow): string {
  if (pr.isDraft) return "draft";
  if (!pr.reviewDecision) return "no reviews";
  switch (pr.reviewDecision) {
    case "APPROVED": return "approved";
    case "CHANGES_REQUESTED": return "changes";
    case "REVIEW_REQUIRED": return "review req";
    default: return "pending";
  }
}

// --- CI status label ---

function ciLabel(pr: PrRow): string {
  if (!pr.ciStatus) return "";
  switch (pr.ciStatus) {
    case "SUCCESS": return "CI pass";
    case "FAILURE": return "CI fail";
    case "ERROR": return "CI error";
    case "PENDING": return "CI pending";
    default: return "";
  }
}

// --- Main component ---

const POLL_INTERVAL_MS = 10_000;
const FILTER_KEY = "cpc-pr-filter-mode";

export function PrTicker() {
  const [prs, setPrs] = useState<PrRow[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [filter, setFilter] = useState<FilterMode>(() => {
    try {
      const saved = localStorage.getItem(FILTER_KEY);
      return saved === "all" ? "all" : "current";
    } catch {
      return "current";
    }
  });
  const [lastPollAt, setLastPollAt] = useState<number>(0);
  const [pollError, setPollError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0); // Force re-render for "last poll Xs ago"
  const mountedRef = useRef(true);

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_KEY, filter);
    } catch { /* ignore */ }
  }, [filter]);

  const fetchPrs = useCallback(async () => {
    try {
      const res = await fetch("/api/prs", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (mountedRef.current && data.ok) {
        setPrs(data.prs ?? []);
        setLastPollAt(data.lastPollOk || Date.now());
        setPollError(data.lastPollErr ?? null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setPollError(err instanceof Error ? err.message : String(err));
      }
    }
  }, []);

  const fetchBranches = useCallback(async () => {
    try {
      const res = await fetch("/api/prs/current-branch-scope", { headers: getAuthHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      if (mountedRef.current && data.ok) {
        setBranches(data.branches ?? []);
      }
    } catch { /* silent */ }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/prs/refresh", {
        method: "POST",
        headers: getAuthHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (mountedRef.current && data.ok) {
        setPrs(data.prs ?? []);
        setLastPollAt(data.lastPollOk || Date.now());
        setPollError(data.lastPollErr ?? null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setPollError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, []);

  // Polling
  useEffect(() => {
    mountedRef.current = true;
    void fetchPrs();
    void fetchBranches();
    const prInterval = setInterval(fetchPrs, POLL_INTERVAL_MS);
    const branchInterval = setInterval(fetchBranches, 60_000);
    // Tick every 5s to update "last poll Xs ago"
    const tickInterval = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => {
      mountedRef.current = false;
      clearInterval(prInterval);
      clearInterval(branchInterval);
      clearInterval(tickInterval);
    };
  }, [fetchPrs, fetchBranches]);

  // Filter PRs
  const filteredPrs = filter === "all"
    ? prs
    : prs.filter((pr) => branches.includes(pr.headRefName));

  const pollAgoSec = lastPollAt ? Math.floor((Date.now() - lastPollAt) / 1000) : 0;

  const openPr = (url: string) => {
    // Telegram mini app honors window.open as in-app browser
    try {
      const tg = window.Telegram?.WebApp;
      if (tg && typeof (tg as any).openLink === "function") {
        (tg as any).openLink(url);
        return;
      }
    } catch { /* fallback */ }
    window.open(url, "_blank");
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: COLORS.bg,
      color: COLORS.text,
      fontSize: 13,
    }}>
      {/* Filter bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderBottom: `1px solid ${COLORS.border}`,
        flexShrink: 0,
      }}>
        <FilterChip
          label="current branch"
          active={filter === "current"}
          onClick={() => setFilter("current")}
        />
        <FilterChip
          label="all"
          active={filter === "all"}
          onClick={() => setFilter("all")}
        />
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            style={{
              background: "none",
              border: "none",
              color: COLORS.textMuted,
              cursor: refreshing ? "default" : "pointer",
              padding: "2px 4px",
              fontSize: 14,
              opacity: refreshing ? 0.5 : 1,
            }}
            title="Force refresh"
          >
            {refreshing ? "..." : "\u21bb"}
          </button>
        </div>
      </div>

      {/* Error banner */}
      {pollError && (
        <div style={{
          background: "#2d1a1a",
          color: COLORS.red,
          padding: "4px 12px",
          fontSize: 11,
          borderBottom: `1px solid ${COLORS.border}`,
          flexShrink: 0,
        }}>
          poll failed: {pollError}
        </div>
      )}

      {/* PR list */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}>
        {filteredPrs.length === 0 ? (
          <div style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            color: COLORS.textMuted,
            fontSize: 14,
            padding: 20,
            textAlign: "center",
          }}>
            {filter === "current" && prs.length > 0
              ? "No PRs on current branch. Switch to All."
              : "No open PRs"}
          </div>
        ) : (
          filteredPrs.map((pr) => (
            <PrRowItem key={pr.key} pr={pr} onTap={openPr} />
          ))
        )}
      </div>

      {/* Footer */}
      <div style={{
        padding: "6px 12px",
        borderTop: `1px solid ${COLORS.border}`,
        fontSize: 11,
        color: COLORS.textMuted,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
      }}>
        <span>{filteredPrs.length} open</span>
        <span>
          last poll {pollAgoSec}s ago
          <span style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: pollError ? COLORS.red : COLORS.green,
            marginLeft: 6,
            verticalAlign: "middle",
          }} />
          {" "}{pollError ? "degraded" : "live"}
        </span>
      </div>
    </div>
  );
}

// --- Sub-components ---

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "3px 10px",
        borderRadius: 12,
        fontSize: 12,
        fontWeight: active ? 600 : 400,
        background: active ? COLORS.blue : "transparent",
        color: active ? "#1a1b26" : COLORS.textMuted,
        border: active ? "none" : `1px solid ${COLORS.border}`,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function PrRowItem({
  pr,
  onTap,
}: {
  pr: PrRow;
  onTap: (url: string) => void;
}) {
  const statusColor = getStatusColor(pr);
  const ci = ciLabel(pr);
  const review = reviewLabel(pr);

  return (
    <div
      onClick={() => onTap(pr.url)}
      style={{
        padding: "10px 12px",
        borderBottom: `1px solid ${COLORS.border}`,
        cursor: "pointer",
        position: "relative",
      }}
    >
      {/* Line 1: status dot + repo label + PR number + branch */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: statusColor,
          flexShrink: 0,
          display: "inline-block",
        }} />
        <span style={{ fontWeight: 600, color: COLORS.text }}>
          #{pr.number}
        </span>
        <span style={{
          color: COLORS.blue,
          fontSize: 11,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {pr.headRefName}
        </span>
      </div>

      {/* Line 2: title */}
      <div style={{
        color: COLORS.text,
        fontSize: 12,
        marginLeft: 14,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        marginBottom: 2,
      }}>
        {pr.title}
      </div>

      {/* Line 3: author, review, CI, time */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        color: COLORS.textMuted,
        marginLeft: 14,
      }}>
        <span>{pr.author}</span>
        <span style={{ color: statusColor }}>{review}</span>
        {ci && <span style={{ color: statusColor }}>{ci}</span>}
        <span style={{ marginLeft: "auto" }}>{timeAgo(pr.updatedAt)}</span>
      </div>
    </div>
  );
}
