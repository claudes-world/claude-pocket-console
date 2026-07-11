import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { getAuthHeaders } from "../lib/telegram";
import { haptic } from "../lib/haptic";
import { ManagePrsSheet } from "./ManagePrsSheet";
import {
  applyOrder,
  filterHidden,
  getRepoOrder,
  loadPrViewPrefs,
  savePrViewPrefs,
  type PrViewPrefs,
} from "../lib/prViewPrefs";

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

interface IssueRow {
  key: string;
  repo: string;
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  author: string;
  updatedAt: string;
  labels: string[];
  url: string;
}

interface RepoIssuesState {
  issues: IssueRow[];
  loading: boolean;
  loaded: boolean;
  attempted: boolean;
  error: string | null;
}

type ViewMode = "prs" | "issues";

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

function visibleRepoNames(repos: RepoSummary[], prefs: PrViewPrefs): string[] {
  const grouped = filterHidden(groupPrs([], repos), prefs);
  return Object.values(grouped).flatMap((repoMap) => Object.keys(repoMap));
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
const ISSUE_FETCH_CONCURRENCY = 4;

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const item = items[nextIndex++];
        await worker(item);
      }
    },
  );
  await Promise.all(workers);
}

export function PrTicker() {
  const [prs, setPrs] = useState<PrRow[]>([]);
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>("prs");
  const [issuesByRepo, setIssuesByRepo] = useState<Record<string, RepoIssuesState>>({});
  const [repoIcons, setRepoIcons] = useState<Record<string, string>>({});
  const [collapsedOrgs, setCollapsedOrgs] = useState<Set<string>>(loadCollapsedOrgs);
  const [prefs, setPrefs] = useState<PrViewPrefs>(loadPrViewPrefs);
  const [manageOpen, setManageOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [lastPollAt, setLastPollAt] = useState<number>(0);
  const [pollError, setPollError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [, setTick] = useState(0); // Force re-render for "last poll Xs ago"
  const mountedRef = useRef(true);
  const issuesRef = useRef<Record<string, RepoIssuesState>>({});
  const issuesLoadSeqRef = useRef(0);
  const issueFetchPoolRef = useRef<{ active: number; waiters: Array<() => void> }>({
    active: 0,
    waiters: [],
  });
  const previousViewModeRef = useRef<ViewMode>("prs");

  const toggleOrg = useCallback((org: string) => {
    haptic.impact("light");
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

  const toggleRepo = useCallback((repo: string) => {
    haptic.impact("light");
    setPrefs((prev) => {
      const collapsedRepos = prev.collapsedRepos.includes(repo)
        ? prev.collapsedRepos.filter((item) => item !== repo)
        : [...prev.collapsedRepos, repo];
      const next = { ...prev, collapsedRepos };
      savePrViewPrefs(next);
      return next;
    });
  }, []);

  const handlePrefsChange = useCallback((next: PrViewPrefs) => {
    savePrViewPrefs(next);
    setPrefs(next);
  }, []);

  const fetchPrs = useCallback(async () => {
    try {
      const res = await fetch("/api/prs", { headers: getAuthHeaders() });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (mountedRef.current) {
        if (data.ok) {
          setPrs(data.prs ?? []);
          setRepos(data.repos ?? []);
          setLastPollAt(data.lastPollOk || Date.now());
          setPollError(data.lastPollErr ?? null);
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

  const updateRepoIssues = useCallback((repo: string, state: RepoIssuesState) => {
    const next = { ...issuesRef.current, [repo]: state };
    issuesRef.current = next;
    setIssuesByRepo(next);
  }, []);

  const withIssueFetchSlot = useCallback(async (task: () => Promise<void>) => {
    const pool = issueFetchPoolRef.current;
    if (pool.active < ISSUE_FETCH_CONCURRENCY) {
      pool.active += 1;
    } else {
      await new Promise<void>((resolve) => pool.waiters.push(resolve));
    }
    try {
      await task();
    } finally {
      const next = pool.waiters.shift();
      if (next) {
        next();
      } else {
        pool.active -= 1;
      }
    }
  }, []);

  const fetchIssues = useCallback(async (repoNames: string[], force: boolean, retryFailed = false) => {
    const seq = ++issuesLoadSeqRef.current;
    const reposToFetch = repoNames.filter((repo) => {
      const current = issuesRef.current[repo];
      return force || !current?.attempted || current.loading || (retryFailed && current.error !== null);
    });

    const previousByRepo = new Map(reposToFetch.map((repo) => [repo, issuesRef.current[repo]]));
    for (const repo of reposToFetch) {
      const previous = previousByRepo.get(repo);
      updateRepoIssues(repo, {
        issues: previous?.issues ?? [],
        loading: true,
        loaded: previous?.loaded ?? false,
        attempted: true,
        error: null,
      });
    }

    await runWithConcurrency(reposToFetch, ISSUE_FETCH_CONCURRENCY, async (repo) => {
      if (seq !== issuesLoadSeqRef.current) return;
      const previous = previousByRepo.get(repo);
      await withIssueFetchSlot(async () => {
        if (seq !== issuesLoadSeqRef.current) return;
        try {
          const forceQuery = force ? "&force=1" : "";
          const res = await fetch(`/api/prs/issues?repo=${encodeURIComponent(repo)}${forceQuery}`, {
            headers: getAuthHeaders(),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (!data.ok) throw new Error(data.error ?? "Unknown error");
          if (mountedRef.current && seq === issuesLoadSeqRef.current) {
            updateRepoIssues(repo, {
              issues: data.issues ?? [],
              loading: false,
              loaded: true,
              attempted: true,
              error: null,
            });
          }
        } catch (err) {
          if (mountedRef.current && seq === issuesLoadSeqRef.current) {
            updateRepoIssues(repo, {
              issues: previous?.issues ?? [],
              loading: false,
              loaded: previous?.loaded ?? false,
              attempted: true,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      });
    });
  }, [updateRepoIssues, withIssueFetchSlot]);

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

  const handleIssueRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchIssues(visibleRepoNames(repos, prefs), true);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [fetchIssues, prefs, repos]);

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

  // Icons are local, cached by the server, and only need one request per mount.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/prs/icons", { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (mountedRef.current && data.ok) setRepoIcons(data.icons ?? {});
      } catch {
        // Icons are optional; retain the text-only repository rows on failure.
      }
    })();
  }, []);

  // Fetch only while Issues is selected; the PR polling interval never calls this.
  const visibleIssueRepoSignature = visibleRepoNames(repos, prefs).sort().join("\n");
  useEffect(() => {
    const enteredIssues = viewMode === "issues" && previousViewModeRef.current !== "issues";
    previousViewModeRef.current = viewMode;
    if (viewMode === "issues") {
      const repoNames = visibleIssueRepoSignature ? visibleIssueRepoSignature.split("\n") : [];
      void fetchIssues(repoNames, false, enteredIssues);
    }
  }, [fetchIssues, viewMode, visibleIssueRepoSignature]);

  const grouped = groupPrs(prs, repos);
  const visibleGrouped = filterHidden(grouped, prefs);
  const orgNames = applyOrder(Object.keys(visibleGrouped), prefs.orgOrder);
  const totalPrs = orgNames.reduce(
    (orgTotal, org) => orgTotal + Object.values(visibleGrouped[org]).reduce((repoTotal, repo) => repoTotal + repo.prs.length, 0),
    0,
  );
  const totalIssues = orgNames.reduce(
    (orgTotal, org) => orgTotal + Object.keys(visibleGrouped[org]).reduce(
      (repoTotal, repo) => repoTotal + (issuesByRepo[repo]?.issues.length ?? 0),
      0,
    ),
    0,
  );
  const totalRepos = orgNames.reduce((total, org) => total + Object.keys(visibleGrouped[org]).length, 0);
  const hiddenCount = prefs.hiddenOrgs.length + prefs.hiddenRepos.length;
  const manageOrgRepos = Object.fromEntries(
    Object.entries(grouped).map(([org, repoMap]) => [org, Object.keys(repoMap)]),
  );

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

  const selectView = (mode: ViewMode) => {
    if (mode === viewMode) return;
    haptic.impact("light");
    setViewMode(mode);
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
        {hiddenCount > 0 && (
          <span style={{ fontSize: 10, color: COLORS.textMuted }}>
            {hiddenCount} hidden
          </span>
        )}
        <div style={{
          display: "flex",
          border: `1px solid ${COLORS.border}`,
          borderRadius: 6,
          overflow: "hidden",
          marginLeft: 2,
        }}>
          {(["prs", "issues"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={viewMode === mode}
              onClick={() => selectView(mode)}
              style={{
                border: "none",
                borderRight: mode === "prs" ? `1px solid ${COLORS.border}` : "none",
                background: viewMode === mode ? COLORS.blue : "transparent",
                color: viewMode === mode ? COLORS.bg : COLORS.textMuted,
                fontSize: 11,
                fontWeight: 600,
                padding: "3px 7px",
                cursor: "pointer",
              }}
            >
              {mode === "prs" ? "PRs" : "Issues"}
            </button>
          ))}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <button
            type="button"
            aria-label="Manage PR view"
            onClick={() => { haptic.impact("light"); setManageOpen(true); }}
            style={{
              background: "none",
              border: "none",
              color: COLORS.textMuted,
              cursor: "pointer",
              padding: "2px 4px",
              fontSize: 14,
            }}
            title="Manage PR view"
          >
            ⚙
          </button>
          <button
            aria-label={`Refresh ${viewMode === "prs" ? "PRs" : "issues"}`}
            onClick={() => {
              haptic.impact("light");
              void (viewMode === "prs" ? handleRefresh() : handleIssueRefresh());
            }}
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
            title={`Refresh ${viewMode === "prs" ? "PRs" : "issues"}`}
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

      {/* Grouped PR/issue list */}
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
        ) : Object.keys(grouped).length === 0 ? (
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
            No repos visible
          </div>
        ) : (
          orgNames.map((org) => (
            <OrgSection
              key={org}
              org={org}
              repoMap={visibleGrouped[org]}
              repoOrder={getRepoOrder(prefs, org)}
              collapsed={collapsedOrgs.has(org)}
              collapsedRepos={prefs.collapsedRepos}
              viewMode={viewMode}
              issuesByRepo={issuesByRepo}
              repoIcons={repoIcons}
              onToggle={() => toggleOrg(org)}
              onToggleRepo={toggleRepo}
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
        <span>{viewMode === "prs" ? `${totalPrs} open` : `${totalIssues} issues`}</span>
        {viewMode === "prs" ? (
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
        ) : (
          <span>on demand</span>
        )}
      </div>

      {manageOpen && (
        <ManagePrsSheet
          orgRepos={manageOrgRepos}
          prefs={prefs}
          onChange={handlePrefsChange}
          onClose={() => setManageOpen(false)}
        />
      )}
    </div>
  );
}

// --- Sub-components ---

function OrgSection({
  org,
  repoMap,
  repoOrder,
  collapsed,
  collapsedRepos,
  viewMode,
  issuesByRepo,
  repoIcons,
  onToggle,
  onToggleRepo,
  onTapPr,
}: {
  org: string;
  repoMap: Record<string, { branch: string; prs: PrRow[] }>;
  repoOrder: string[];
  collapsed: boolean;
  collapsedRepos: string[];
  viewMode: ViewMode;
  issuesByRepo: Record<string, RepoIssuesState>;
  repoIcons: Record<string, string>;
  onToggle: () => void;
  onToggleRepo: (repo: string) => void;
  onTapPr: (url: string) => void;
}) {
  const repoNames = applyOrder(Object.keys(repoMap), repoOrder);
  const totalItems = repoNames.reduce(
    (sum, repo) => sum + (viewMode === "prs"
      ? repoMap[repo].prs.length
      : issuesByRepo[repo]?.issues.length ?? 0),
    0,
  );

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
        <img
          src={`https://avatars.githubusercontent.com/${encodeURIComponent(org)}?s=32`}
          alt={`${org} avatar`}
          onError={(event) => { event.currentTarget.style.display = "none"; }}
          style={{ width: 16, height: 16, borderRadius: "50%", flexShrink: 0 }}
        />
        <span style={{ fontWeight: 700, fontSize: 13, color: COLORS.text }}>
          {org}
        </span>
        <span style={{ fontSize: 11, color: COLORS.textMuted }}>
          {totalItems} {viewMode === "prs"
            ? `PR${totalItems !== 1 ? "s" : ""}`
            : `issue${totalItems !== 1 ? "s" : ""}`}
        </span>
      </div>

      {/* Repos within org */}
      {!collapsed && repoNames.map((repoFullName) => {
        const { branch, prs } = repoMap[repoFullName];
        const repoShort = repoFullName.split("/")[1] || repoFullName;
        const repoCollapsed = collapsedRepos.includes(repoFullName);
        const issueState = issuesByRepo[repoFullName];
        const itemCount = viewMode === "prs" ? prs.length : issueState?.issues.length ?? 0;

        return (
          <div key={repoFullName}>
            {/* Repo subheading */}
            <div
              onClick={() => onToggleRepo(repoFullName)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px 6px 24px",
                borderBottom: `1px solid ${COLORS.border}`,
                fontSize: 12,
                cursor: "pointer",
                userSelect: "none",
              }}
            >
              <span style={{ fontSize: 10, color: COLORS.textMuted, width: 10, textAlign: "center" }}>
                {repoCollapsed ? "\u25b6" : "\u25bc"}
              </span>
              {repoIcons[repoFullName] && (
                <img
                  src={repoIcons[repoFullName]}
                  alt={`${repoShort} icon`}
                  onError={(event) => { event.currentTarget.style.display = "none"; }}
                  style={{ width: 16, height: 16, objectFit: "contain", flexShrink: 0 }}
                />
              )}
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
                {viewMode === "issues" && issueState?.loading
                  ? "..."
                  : `${itemCount} ${viewMode === "prs" ? "open" : "issues"}`}
              </span>
            </div>

            {/* PR/issue rows or per-repo state */}
            {!repoCollapsed && (viewMode === "issues" && issueState?.loading ? (
              <RepoMessage>loading issues...</RepoMessage>
            ) : viewMode === "issues" && issueState?.error ? (
              <RepoMessage color={COLORS.red}>issues failed: {issueState.error}</RepoMessage>
            ) : viewMode === "issues" ? (
              (issueState?.issues.length ?? 0) === 0
                ? <RepoMessage>no issues</RepoMessage>
                : issueState!.issues.map((issue) => (
                  <IssueRowItem key={issue.key} issue={issue} onTap={onTapPr} />
                ))
            ) : prs.length === 0 ? (
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
            ))}
          </div>
        );
      })}
    </div>
  );
}

function RepoMessage({ children, color = COLORS.textMuted }: { children: ReactNode; color?: string }) {
  return (
    <div style={{
      padding: "8px 12px 8px 36px",
      fontSize: 12,
      color,
      fontStyle: "italic",
      borderBottom: `1px solid ${COLORS.border}`,
    }}>
      {children}
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
      onClick={() => { haptic.impact("light"); onTap(pr.url); }}
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

function IssueRowItem({
  issue,
  onTap,
}: {
  issue: IssueRow;
  onTap: (url: string) => void;
}) {
  const statusColor = issue.state === "CLOSED" ? "var(--color-accent-purple)" : COLORS.green;

  return (
    <div
      onClick={() => { haptic.impact("light"); onTap(issue.url); }}
      style={{
        padding: "10px 12px 10px 36px",
        borderBottom: `1px solid ${COLORS.border}`,
        cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
        <span style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: statusColor,
          flexShrink: 0,
        }} />
        <span style={{ fontWeight: 600, color: COLORS.text }}>#{issue.number}</span>
        <span style={{
          color: COLORS.text,
          fontSize: 12,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {issue.title}
        </span>
      </div>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        minWidth: 0,
        marginLeft: 14,
        fontSize: 11,
        color: COLORS.textMuted,
      }}>
        <span>{issue.author}</span>
        {issue.labels.slice(0, 3).map((label) => (
          <span key={label} style={{
            padding: "1px 5px",
            borderRadius: 8,
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            color: COLORS.textMuted,
            maxWidth: 80,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {label}
          </span>
        ))}
        <span style={{ marginLeft: "auto", flexShrink: 0 }}>{timeAgo(issue.updatedAt)}</span>
      </div>
    </div>
  );
}
