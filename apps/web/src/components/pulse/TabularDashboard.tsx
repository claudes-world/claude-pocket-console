import { useState, useMemo, Fragment } from "react";
import type { PulseSnapshot } from "./MinimalistDashboard";

// ── Types ────────────────────────────────────────────────────────────────────

interface VulnAlert {
  severity: "CRITICAL" | "HIGH" | "MODERATE" | "LOW";
  ghsa_id: string;
  package_name: string;
  ecosystem: string;
  age_days: number;
  dependabot_pr_number: number | null;
}

interface PR {
  number: number;
  title: string;
  author: string;
  is_draft: boolean;
  is_dependabot: boolean;
  is_renovate: boolean;
  stalled: boolean;
  hours_idle: number;
  updated_at: string;
}

interface Issue {
  number: number;
  title: string;
  labels: string[];
  stalled: boolean;
  hours_idle: number;
}

interface RepoSnapshot {
  org: string;
  name: string;
  is_fork: boolean;
  is_archived: boolean;
  capture_status: "success" | "partial" | "failed";
  field_statuses: Record<string, { status: string; error_note: string | null }>;
  upstream: { status: string; commits_behind: number; commits_ahead: number } | null;
  vulnerability_alerts: VulnAlert[] | null;
  prs: PR[];
  issues: Issue[];
  releases: { tag_name: string; name: string; is_prerelease: boolean; created_at: string }[];
}

type SortKey =
  | "name"
  | "capture_status"
  | "open_prs"
  | "stalled_prs"
  | "crit"
  | "high"
  | "mod"
  | "low"
  | "oldest_idle";
type SortDir = "asc" | "desc";
type StatusFilter = "ALL" | "success" | "partial" | "failed";

interface Props {
  data: PulseSnapshot;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function vulnCount(alerts: VulnAlert[] | null, severity: string): string {
  if (alerts === null) return "scope?";
  return String(alerts.filter((a) => a.severity === severity).length);
}

function oldestIdleHours(prs: PR[]): number | null {
  if (prs.length === 0) return null;
  return Math.max(...prs.map((p) => p.hours_idle));
}

function captureStatusOrder(s: "success" | "partial" | "failed"): number {
  return s === "failed" ? 0 : s === "partial" ? 1 : 2;
}

function sortableValue(repo: RepoSnapshot, key: SortKey): number | string {
  switch (key) {
    case "name":
      return repo.name;
    case "capture_status":
      return captureStatusOrder(repo.capture_status);
    case "open_prs":
      return repo.prs.length;
    case "stalled_prs":
      return repo.prs.filter((p) => p.stalled).length;
    case "crit":
      return repo.vulnerability_alerts === null
        ? -1
        : repo.vulnerability_alerts.filter((v) => v.severity === "CRITICAL").length;
    case "high":
      return repo.vulnerability_alerts === null
        ? -1
        : repo.vulnerability_alerts.filter((v) => v.severity === "HIGH").length;
    case "mod":
      return repo.vulnerability_alerts === null
        ? -1
        : repo.vulnerability_alerts.filter((v) => v.severity === "MODERATE").length;
    case "low":
      return repo.vulnerability_alerts === null
        ? -1
        : repo.vulnerability_alerts.filter((v) => v.severity === "LOW").length;
    case "oldest_idle":
      return oldestIdleHours(repo.prs) ?? -1;
    default:
      return 0;
  }
}

function compareRepos(a: RepoSnapshot, b: RepoSnapshot, key: SortKey, dir: SortDir): number {
  const av = sortableValue(a, key);
  const bv = sortableValue(b, key);
  let cmp = 0;
  if (typeof av === "string" && typeof bv === "string") {
    cmp = av.localeCompare(bv);
  } else {
    cmp = (av as number) - (bv as number);
  }
  return dir === "asc" ? cmp : -cmp;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: "success" | "partial" | "failed" | string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    success: { label: "OK", bg: "#1a3a1a", color: "#4caf50" },
    partial: { label: "PARTIAL", bg: "#3a2e00", color: "#ffc107" },
    failed: { label: "FAILED", bg: "#3a0a0a", color: "#f44336" },
  };
  const cfg = map[status] ?? { label: status.toUpperCase(), bg: "#222", color: "#aaa" };
  return (
    <span
      style={{
        background: cfg.bg,
        color: cfg.color,
        borderRadius: 3,
        padding: "1px 5px",
        fontSize: 10,
        fontFamily: "monospace",
        fontWeight: 700,
        letterSpacing: "0.04em",
        border: `1px solid ${cfg.color}44`,
      }}
    >
      {cfg.label}
    </span>
  );
}

function VulnCell({ alerts, severity }: { alerts: VulnAlert[] | null; severity: string }) {
  const val = vulnCount(alerts, severity);
  const isScope = val === "scope?";
  const num = parseInt(val, 10);
  const isCrit = severity === "CRITICAL" && num > 0;
  const isHigh = severity === "HIGH" && num > 0;
  return (
    <span
      style={{
        color: isScope ? "#888" : isCrit ? "#f44336" : isHigh ? "#ffc107" : num > 0 ? "#ff9800" : "#555",
        fontStyle: isScope ? "italic" : "normal",
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      {val}
    </span>
  );
}

function PRRow({ pr }: { pr: PR }) {
  const idle =
    pr.hours_idle >= 24
      ? `${Math.floor(pr.hours_idle / 24)}d`
      : `${pr.hours_idle}h`;
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "baseline",
        padding: "3px 0",
        borderBottom: "1px solid #1e1e1e",
        fontSize: 11,
      }}
    >
      <span style={{ color: "#666", minWidth: 28, fontFamily: "monospace" }}>#{pr.number}</span>
      <span style={{ flex: 1, color: pr.stalled ? "#f44336" : "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {pr.is_draft && <span style={{ color: "#888", marginRight: 4 }}>[DRAFT]</span>}
        {(pr.is_dependabot || pr.is_renovate) && (
          <span style={{ color: "#7986cb", marginRight: 4 }}>[bot]</span>
        )}
        {pr.title}
      </span>
      <span
        style={{
          minWidth: 32,
          textAlign: "right",
          fontFamily: "monospace",
          color: pr.stalled ? "#f44336" : pr.hours_idle > 24 ? "#ffc107" : "#888",
        }}
      >
        {idle}
      </span>
      {pr.stalled && (
        <span style={{ color: "#f44336", fontSize: 10, fontFamily: "monospace" }}>STALL</span>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  const idle =
    issue.hours_idle >= 24
      ? `${Math.floor(issue.hours_idle / 24)}d`
      : `${issue.hours_idle}h`;
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "baseline",
        padding: "3px 0",
        borderBottom: "1px solid #1e1e1e",
        fontSize: 11,
      }}
    >
      <span style={{ color: "#666", minWidth: 28, fontFamily: "monospace" }}>#{issue.number}</span>
      <span style={{ flex: 1, color: issue.stalled ? "#ffc107" : "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {issue.title}
      </span>
      <span style={{ color: "#888", minWidth: 32, textAlign: "right", fontFamily: "monospace" }}>{idle}</span>
      {issue.stalled && (
        <span style={{ color: "#ffc107", fontSize: 10, fontFamily: "monospace" }}>STALL</span>
      )}
    </div>
  );
}

function VulnRow({ alert }: { alert: VulnAlert }) {
  const sevColor: Record<string, string> = {
    CRITICAL: "#f44336",
    HIGH: "#ff9800",
    MODERATE: "#ffc107",
    LOW: "#8bc34a",
  };
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "baseline",
        padding: "3px 0",
        borderBottom: "1px solid #1e1e1e",
        fontSize: 11,
      }}
    >
      <span
        style={{
          minWidth: 60,
          color: sevColor[alert.severity] ?? "#aaa",
          fontFamily: "monospace",
          fontWeight: 700,
          fontSize: 10,
        }}
      >
        {alert.severity.slice(0, 4)}
      </span>
      <span style={{ flex: 1, color: "#ccc", fontFamily: "monospace" }}>
        {alert.package_name}
      </span>
      <span style={{ color: "#888", fontSize: 10, minWidth: 32, textAlign: "right" }}>
        {alert.age_days}d
      </span>
      {alert.dependabot_pr_number !== null && (
        <span style={{ color: "#7986cb", fontSize: 10, fontFamily: "monospace" }}>
          #{alert.dependabot_pr_number}
        </span>
      )}
    </div>
  );
}

function RepoDetail({ repo }: { repo: RepoSnapshot }) {
  const hasPRs = repo.prs.length > 0;
  const hasIssues = repo.issues.length > 0;
  const hasVulns = repo.vulnerability_alerts !== null && repo.vulnerability_alerts.length > 0;
  const vulnsNull = repo.vulnerability_alerts === null;

  return (
    <tr>
      <td
        colSpan={9}
        style={{
          background: "#111",
          padding: "8px 8px 8px 16px",
          borderBottom: "1px solid #333",
        }}
      >
        {repo.capture_status === "failed" && (
          <div style={{ color: "#f44336", fontFamily: "monospace", fontSize: 11, marginBottom: 6 }}>
            CAPTURE FAILED — data unavailable. Check field_statuses for error details.
          </div>
        )}

        {/* PRs */}
        <div style={{ marginBottom: hasPRs ? 8 : 0 }}>
          <div style={{ color: "#666", fontSize: 10, fontFamily: "monospace", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Pull Requests ({repo.prs.length})
          </div>
          {hasPRs ? (
            repo.prs.map((pr) => <PRRow key={pr.number} pr={pr} />)
          ) : (
            <div style={{ color: "#444", fontSize: 11 }}>none</div>
          )}
        </div>

        {/* Issues */}
        <div style={{ marginBottom: hasIssues ? 8 : 0, marginTop: 8 }}>
          <div style={{ color: "#666", fontSize: 10, fontFamily: "monospace", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Issues ({repo.issues.length})
          </div>
          {hasIssues ? (
            repo.issues.map((issue) => <IssueRow key={issue.number} issue={issue} />)
          ) : (
            <div style={{ color: "#444", fontSize: 11 }}>none</div>
          )}
        </div>

        {/* Vulns */}
        <div style={{ marginTop: 8 }}>
          <div style={{ color: "#666", fontSize: 10, fontFamily: "monospace", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Vulnerabilities{vulnsNull ? " (scope missing)" : ` (${repo.vulnerability_alerts!.length})`}
          </div>
          {vulnsNull ? (
            <div style={{ color: "#888", fontSize: 11, fontStyle: "italic" }}>
              scope? — security_events scope missing; re-auth required
            </div>
          ) : hasVulns ? (
            repo.vulnerability_alerts!.map((v) => <VulnRow key={v.ghsa_id} alert={v} />)
          ) : (
            <div style={{ color: "#4caf50", fontSize: 11 }}>no vulnerabilities</div>
          )}
        </div>

        {/* Upstream drift */}
        {repo.is_fork && repo.upstream && (
          <div style={{ marginTop: 8, color: "#888", fontSize: 11, fontFamily: "monospace" }}>
            upstream: {repo.upstream.commits_behind}↓ {repo.upstream.commits_ahead}↑
          </div>
        )}
      </td>
    </tr>
  );
}

// ── Column header with sort indicator ────────────────────────────────────────

function ColHeader({
  label,
  sortKey,
  currentKey,
  currentDir,
  onSort,
  align = "right",
  title,
}: {
  label: string;
  sortKey: SortKey;
  currentKey: SortKey;
  currentDir: SortDir;
  onSort: (k: SortKey) => void;
  align?: "left" | "right";
  title?: string;
}) {
  const active = currentKey === sortKey;
  return (
    <th
      onClick={() => onSort(sortKey)}
      title={title}
      style={{
        cursor: "pointer",
        userSelect: "none",
        padding: "10px 8px",
        textAlign: align,
        whiteSpace: "nowrap",
        color: active ? "#90caf9" : "#888",
        fontSize: 11,
        fontFamily: "monospace",
        fontWeight: active ? 700 : 500,
        borderBottom: "2px solid #333",
        minHeight: 44,
        verticalAlign: "bottom",
        background: "#0d0d0d",
      }}
    >
      {label}
      {active && (
        <span style={{ marginLeft: 3, fontSize: 9 }}>
          {currentDir === "asc" ? "▲" : "▼"}
        </span>
      )}
    </th>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function TabularDashboard({ data }: Props) {
  const repos = data.repos as RepoSnapshot[];

  const [sortKey, setSortKey] = useState<SortKey>("capture_status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [nameFilter, setNameFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [expandedRepo, setExpandedRepo] = useState<string | null>(null);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function handleRowClick(name: string) {
    setExpandedRepo((prev) => (prev === name ? null : name));
  }

  const filtered = useMemo(() => {
    return repos
      .filter((r) => {
        const nameMatch = r.name.toLowerCase().includes(nameFilter.toLowerCase());
        const statusMatch = statusFilter === "ALL" || r.capture_status === statusFilter;
        return nameMatch && statusMatch;
      })
      .sort((a, b) => compareRepos(a, b, sortKey, sortDir));
  }, [repos, nameFilter, statusFilter, sortKey, sortDir]);

  const statusPills: StatusFilter[] = ["ALL", "success", "partial", "failed"];
  const pillLabel: Record<StatusFilter, string> = {
    ALL: "ALL",
    success: "OK",
    partial: "PARTIAL",
    failed: "FAILED",
  };
  const pillColor: Record<StatusFilter, string> = {
    ALL: "#90caf9",
    success: "#4caf50",
    partial: "#ffc107",
    failed: "#f44336",
  };

  return (
    <div
      style={{
        margin: 0,
        padding: 0,
        background: "#0a0a0a",
        color: "#ccc",
        minHeight: "100%",
        fontFamily: "monospace",
        paddingTop: "var(--tg-content-safe-area-inset-top, 0px)",
        boxSizing: "border-box",
        maxWidth: "100%",
        overflowX: "hidden",
      }}
    >
      {/* Warm-up banner */}
      {data.warm_up_active && (
        <div
          style={{
            background: "#2a2000",
            borderBottom: "1px solid #ffc107",
            color: "#ffc107",
            fontSize: 11,
            padding: "6px 12px",
            fontFamily: "monospace",
          }}
        >
          ⚠ WARM-UP MODE — trend data unavailable until {data.warm_up_fill_date ?? "?"}
        </div>
      )}

      {/* Header bar */}
      <div
        style={{
          background: "#111",
          borderBottom: "1px solid #222",
          padding: "8px 12px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 4,
        }}
      >
        <div>
          <span style={{ color: "#90caf9", fontWeight: 700, fontSize: 13 }}>org-pulse</span>
          <span style={{ color: "#444", fontSize: 11, marginLeft: 8 }}>
            {data.captured_at_et}
          </span>
        </div>
        <div style={{ fontSize: 11, color: "#666" }}>
          <span style={{ color: "#4caf50" }}>{data.repos_succeeded}✓</span>
          {" "}
          <span style={{ color: "#ffc107" }}>{data.repos_partial}~</span>
          {" "}
          <span style={{ color: "#f44336" }}>{data.repos_failed}✗</span>
          {" "}
          <span style={{ color: "#555" }}>{(data.duration_ms / 1000).toFixed(1)}s</span>
        </div>
      </div>

      {/* Filter bar */}
      <div
        style={{
          background: "#0d0d0d",
          borderBottom: "1px solid #1e1e1e",
          padding: "6px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <input
          type="text"
          placeholder="filter repo…"
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          style={{
            background: "#1a1a1a",
            border: "1px solid #333",
            borderRadius: 4,
            color: "#ccc",
            fontFamily: "monospace",
            fontSize: 12,
            padding: "4px 8px",
            outline: "none",
            width: 140,
          }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {statusPills.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              style={{
                background: statusFilter === s ? pillColor[s] + "22" : "transparent",
                border: `1px solid ${statusFilter === s ? pillColor[s] : "#333"}`,
                borderRadius: 3,
                color: statusFilter === s ? pillColor[s] : "#666",
                fontFamily: "monospace",
                fontSize: 10,
                padding: "3px 7px",
                cursor: "pointer",
                fontWeight: statusFilter === s ? 700 : 400,
                minHeight: 28,
              }}
            >
              {pillLabel[s]}
            </button>
          ))}
        </div>
        <span style={{ marginLeft: "auto", color: "#555", fontSize: 11 }}>
          {filtered.length}/{repos.length}
        </span>
      </div>

      {/* Scrollable table */}
      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "max-content",
            minWidth: "100%",
          }}
        >
          <thead>
            <tr>
              <ColHeader
                label="REPO"
                sortKey="name"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                align="left"
              />
              <ColHeader
                label="STATUS"
                sortKey="capture_status"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                align="left"
              />
              <ColHeader
                label="PRs"
                sortKey="open_prs"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                title="Open PRs"
              />
              <ColHeader
                label="STALL"
                sortKey="stalled_prs"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                title="Stalled PRs (>72h idle)"
              />
              <ColHeader
                label="CRIT"
                sortKey="crit"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                title="Critical vulnerabilities"
              />
              <ColHeader
                label="HIGH"
                sortKey="high"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                title="High vulnerabilities"
              />
              <ColHeader
                label="MOD"
                sortKey="mod"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                title="Moderate vulnerabilities"
              />
              <ColHeader
                label="LOW"
                sortKey="low"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                title="Low vulnerabilities"
              />
              <ColHeader
                label="IDLE"
                sortKey="oldest_idle"
                currentKey={sortKey}
                currentDir={sortDir}
                onSort={handleSort}
                title="Hours idle on oldest PR"
              />
            </tr>
          </thead>
          <tbody>
            {filtered.map((repo) => {
              const isExpanded = expandedRepo === repo.name;
              const isFailed = repo.capture_status === "failed";
              const oldestIdle = oldestIdleHours(repo.prs);

              return (
                <Fragment key={repo.name}>
                  <tr
                    onClick={() => handleRowClick(repo.name)}
                    style={{
                      cursor: "pointer",
                      background: isExpanded ? "#141414" : "transparent",
                      borderBottom: isExpanded ? "none" : "1px solid #1a1a1a",
                      transition: "background 0.1s",
                    }}
                  >
                    {/* Sticky repo name column */}
                    <td
                      style={{
                        position: "sticky",
                        left: 0,
                        background: isExpanded ? "#141414" : "#0a0a0a",
                        padding: "8px 8px 8px 12px",
                        whiteSpace: "nowrap",
                        fontSize: 12,
                        color: isFailed ? "#f44336" : isExpanded ? "#90caf9" : "#e0e0e0",
                        fontWeight: isExpanded ? 700 : 400,
                        borderRight: "1px solid #1e1e1e",
                        minWidth: 120,
                        zIndex: 1,
                      }}
                    >
                      {repo.name}
                      {repo.is_fork && (
                        <span style={{ color: "#555", fontSize: 10, marginLeft: 4 }}>fork</span>
                      )}
                    </td>

                    {/* Status */}
                    <td style={{ padding: "8px", whiteSpace: "nowrap" }}>
                      <StatusBadge status={repo.capture_status} />
                    </td>

                    {/* Open PRs */}
                    <td
                      style={{
                        padding: "8px",
                        textAlign: "right",
                        fontSize: 12,
                        fontFamily: "monospace",
                        color: isFailed ? "#555" : repo.prs.length > 0 ? "#ccc" : "#444",
                      }}
                    >
                      {isFailed ? "N/A" : repo.prs.length}
                    </td>

                    {/* Stalled PRs */}
                    <td
                      style={{
                        padding: "8px",
                        textAlign: "right",
                        fontSize: 12,
                        fontFamily: "monospace",
                      }}
                    >
                      {isFailed ? (
                        <span style={{ color: "#555" }}>N/A</span>
                      ) : (
                        <span
                          style={{
                            color:
                              repo.prs.filter((p) => p.stalled).length > 0
                                ? "#f44336"
                                : "#444",
                          }}
                        >
                          {repo.prs.filter((p) => p.stalled).length}
                        </span>
                      )}
                    </td>

                    {/* Vuln columns */}
                    {(["CRITICAL", "HIGH", "MODERATE", "LOW"] as const).map((sev) => (
                      <td key={sev} style={{ padding: "8px", textAlign: "right" }}>
                        {isFailed ? (
                          <span style={{ color: "#555", fontFamily: "monospace", fontSize: 12 }}>
                            N/A
                          </span>
                        ) : (
                          <VulnCell alerts={repo.vulnerability_alerts} severity={sev} />
                        )}
                      </td>
                    ))}

                    {/* Oldest idle */}
                    <td
                      style={{
                        padding: "8px 12px 8px 8px",
                        textAlign: "right",
                        fontSize: 12,
                        fontFamily: "monospace",
                        color: isFailed
                          ? "#555"
                          : oldestIdle === null
                          ? "#444"
                          : oldestIdle > 72
                          ? "#f44336"
                          : oldestIdle > 24
                          ? "#ffc107"
                          : "#888",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isFailed
                        ? "N/A"
                        : oldestIdle === null
                        ? "—"
                        : oldestIdle >= 24
                        ? `${Math.floor(oldestIdle / 24)}d`
                        : `${oldestIdle}h`}
                    </td>
                  </tr>

                  {/* Inline expansion */}
                  {isExpanded && <RepoDetail repo={repo} />}
                </Fragment>
              );
            })}

            {filtered.length === 0 && (
              <tr>
                <td
                  colSpan={9}
                  style={{
                    padding: "24px",
                    textAlign: "center",
                    color: "#555",
                    fontFamily: "monospace",
                    fontSize: 12,
                  }}
                >
                  no repos match filter
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid #1a1a1a",
          fontSize: 10,
          color: "#444",
          fontFamily: "monospace",
          display: "flex",
          justifyContent: "space-between",
        }}
      >
        <span>{data.snapshot_id}</span>
        <span>tap row to expand · tap header to sort</span>
      </div>
    </div>
  );
}
