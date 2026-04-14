import { useState, useEffect, useCallback, useRef } from "react";
import { getAuthHeaders } from "../lib/telegram";
import { usePrCache } from "../hooks/usePrCache";

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

interface RepoSummary {
  name: string;
  dirName: string;
  org: string;
  fullName: string;
  branch: string;
  prCount: number;
}

// Grouped structure: org -> repo -> { branch, prs }
type GroupedPrs = Record<string, Record<string, { branch: string; prs: PrRow[] }>>;

// --- Color palette (reuses existing CPC theme) ---

const COLORS = {
  green: "var(--color-accent-green)",
  yellow: "var(--color-accent-yellow)",
  red: "var(--color-accent-red)",
  blue: "var(--color-accent-blue)",
  muted: "var(--color-muted)",
  bg: "var(--color-bg)",
  surface: "var(--color-surface)",
  border: "var(--color-border)",
  text: "var(--color-fg)",
  textMuted: "var(--color-muted)",
};

// --- Status dot color logic ---

function getStatusColor(pr: PrRow): string {
  if (pr.isDraft) return COLORS.muted;
  if (pr.state === "MERGED") return "var(--color-accent-purple)"; // purple
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

// --- Group PRs by org -> repo ---

function groupPrs(prs: PrRow[], repos: RepoSummary[]): GroupedPrs {
  // Use Object.create(null) to avoid prototype pollution from org/repo names
  // that could shadow Object prototype properties (e.g. "constructor", "toString").
  const grouped = Object.create(null) as GroupedPrs;

  // Seed structure from repos (so repos with 0 PRs still show)
  for (const repo of repos) {
    if (!grouped[repo.org]) grouped[repo.org] = Object.create(null) as Record<string, { branch: string; prs: PrRow[] }>;
    if (!grouped[repo.org][repo.fullName]) {
      grouped[repo.org][repo.fullName] = { branch: repo.branch, prs: [] };
    }
  }

  // Place PRs into groups
  for (const pr of prs) {
    const [org] = pr.repo.split("/");
    if (!grouped[org]) grouped[org] = Object.create(null) as Record<string, { branch: string; prs: PrRow[] }>;
    if (!grouped[org][pr.repo]) {
      // Repo not in discovery (edge case: leftover from cache)
      const repoInfo = repos.find((r) => r.fullName === pr.repo);
      grouped[org][pr.repo] = { branch: repoInfo?.branch || "", prs: [] };
    }
    grouped[org][pr.repo].prs.push(pr);
  }

  return grouped;
}

// --- Collapse state persistence ---

const COLLAPSE_KEY = "cpc-pr-collapsed-orgs";

function loadCollapsedOrgs(): Set<string> {
  try {
    const saved = localStorage.getItem(COLLAPSE_KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch { /* ignore */ }
  return new Set();
}

function saveCollapsedOrgs(collapsed: Set<string>) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...collapsed]));
  } catch { /* ignore */ }
}

// --- Main component ---

const POLL_INTERVAL_MS = 10_000;

export function PrTicker() {
  const { cache, saveCache } = usePrCache();
  const [prs, setPrs] = useState<PrRow[]>(cache?.prs ?? []);
  const [repos, setRepos] = useState<RepoSummary[]>(cache?.repos ?? []);
  const [collapsedOrgs, setCollapsedOrgs] = useState<Set<string>>(loadCollapsedOrgs);
  const [loading, setLoading] = useState(cache === null); // skip spinner if cache available
  const [lastPollAt, setLastPollAt] = useState<number>(cache?.cachedAt ?? 0);
  const [pollError, setPollError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0); // Force re-render for "last poll Xs ago"
  const mountedRef = useRef(true);
  const hasLiveDataRef = useRef(false); // true once first live fetch succeeds

  const toggleOrg = useCallback((org: string) => {
    setCollapsedOrgs((prev) => {
      const next = new Set(prev);
      if (next.has(org)) {
        next.delete(org);
      } else {
        next.add(org);
      }
      saveCollapsedOrgs(next);
      return next;
    });
  }, []);

  const fetchPrs = useCallback(async () => {
    try {
      const res = await fetch("/api/prs", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (mountedRef.current) {
        if (data.ok) {
          saveCache(data.prs ?? [], data.repos ?? []);
          setPrs(data.prs ?? []);
          setRepos(data.repos ?? []);
          setLastPollAt(data.lastPollOk || Date.now());
          setPollError(data.lastPollErr ?? null);
          hasLiveDataRef.current = true;
        } else {
          setPollError(data.error ?? "Unknown error");
        }
      }
    } catch (err) {
      if (mountedRef.current) {
        setPollError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
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
        saveCache(data.prs ?? [], data.repos ?? []);
        hasLiveDataRef.current = true;
        setPrs(data.prs ?? []);
        setRepos(data.repos ?? []);
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
    const prInterval = setInterval(fetchPrs, POLL_INTERVAL_MS);
    // Tick every 5s to update "last poll Xs ago"
    const tickInterval = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => {
      mountedRef.current = false;
      clearInterval(prInterval);
      clearInterval(tickInterval);
    };
  }, [fetchPrs]);

  const grouped = groupPrs(prs, repos);
  const orgNames = Object.keys(grouped).sort();
  const totalPrs = prs.length;
  const totalRepos = repos.length;

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
      {/* Header bar */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderBottom: `1px solid ${COLORS.border}`,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, color: COLORS.textMuted }}>
          {totalRepos} repos
        </span>
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

      {/* Grouped PR list */}
      <div style={{
        flex: 1,
        overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}>
        {loading ? (
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
            Loading PRs...
          </div>
        ) : orgNames.length === 0 ? (
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
            No repos discovered
          </div>
        ) : (
          orgNames.map((org) => (
            <OrgSection
              key={org}
              org={org}
              repoMap={grouped[org]}
              collapsed={collapsedOrgs.has(org)}
              onToggle={() => toggleOrg(org)}
              onTapPr={openPr}
            />
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
        <span>{totalPrs} open</span>
        <span>
          {hasLiveDataRef.current
            ? `last poll ${pollAgoSec}s ago`
            : cache
              ? `cached ${Math.floor((Date.now() - cache.cachedAt) / 60_000)}m ago`
              : "loading..."}
          <span style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: pollError ? COLORS.red : hasLiveDataRef.current ? COLORS.green : COLORS.yellow,
            marginLeft: 6,
            verticalAlign: "middle",
          }} />
          {" "}{pollError ? "degraded" : hasLiveDataRef.current ? "live" : "connecting..."}
        </span>
      </div>
    </div>
  );
}

// --- Sub-components ---

function OrgSection({
  org,
  repoMap,
  collapsed,
  onToggle,
  onTapPr,
}: {
  org: string;
  repoMap: Record<string, { branch: string; prs: PrRow[] }>;
  collapsed: boolean;
  onToggle: () => void;
  onTapPr: (url: string) => void;
}) {
  const repoNames = Object.keys(repoMap).sort();
  const totalPrs = repoNames.reduce((sum, r) => sum + repoMap[r].prs.length, 0);

  return (
    <div>
      {/* Org heading */}
      <div
        onClick={onToggle}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          background: COLORS.surface,
          borderBottom: `1px solid ${COLORS.border}`,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <span style={{ fontSize: 11, color: COLORS.textMuted, width: 12, textAlign: "center" }}>
          {collapsed ? "\u25b6" : "\u25bc"}
        </span>
        <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.text }}>
          {org}
        </span>
        <span style={{ fontSize: 11, color: COLORS.textMuted }}>
          {totalPrs} PR{totalPrs !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Repos within org */}
      {!collapsed && repoNames.map((repoFullName) => {
        const { branch, prs } = repoMap[repoFullName];
        const repoShort = repoFullName.split("/")[1] || repoFullName;

        return (
          <div key={repoFullName}>
            {/* Repo subheading */}
            <div style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px 6px 24px",
              borderBottom: `1px solid ${COLORS.border}`,
              fontSize: 12,
            }}>
              <span style={{ fontWeight: 600, color: COLORS.text }}>
                {repoShort}
              </span>
              {branch && (
                <span style={{
                  fontSize: 10,
                  padding: "1px 6px",
                  borderRadius: 8,
                  background: COLORS.blue,
                  color: COLORS.bg,
                  fontWeight: 500,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 140,
                }}>
                  {branch}
                </span>
              )}
              <span style={{ fontSize: 11, color: COLORS.textMuted, marginLeft: "auto" }}>
                {prs.length} open
              </span>
            </div>

            {/* PR rows or empty state */}
            {prs.length === 0 ? (
              <div style={{
                padding: "8px 12px 8px 36px",
                fontSize: 12,
                color: COLORS.textMuted,
                fontStyle: "italic",
                borderBottom: `1px solid ${COLORS.border}`,
              }}>
                no open PRs
              </div>
            ) : (
              prs.map((pr) => (
                <PrRowItem key={pr.key} pr={pr} onTap={onTapPr} />
              ))
            )}
          </div>
        );
      })}
    </div>
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
        padding: "10px 12px 10px 36px",
        borderBottom: `1px solid ${COLORS.border}`,
        cursor: "pointer",
        position: "relative",
      }}
    >
      {/* Line 1: status dot + PR number + branch */}
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
