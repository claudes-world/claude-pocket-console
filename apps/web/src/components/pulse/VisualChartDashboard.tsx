import { useState, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell,
  PieChart,
  Pie,
  ResponsiveContainer,
} from "recharts";
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

interface ReviewerBucket {
  total: number;
  approved: number;
  change_requested: number;
  commented: number;
  dismissed: number;
}

interface Props {
  data: PulseSnapshot;
}

// ── Color palette ────────────────────────────────────────────────────────────

const COLORS = {
  CRITICAL: "#ef4444",
  HIGH: "#f97316",
  MODERATE: "#eab308",
  LOW: "#22c55e",
  UNKNOWN: "#6b7280",
  stalled: "#f59e0b",
  draft: "#60a5fa",
  bot: "#9ca3af",
  active: "#34d399",
  approved: "#22c55e",
  change_requested: "#ef4444",
  commented: "#60a5fa",
  dismissed: "#9ca3af",
  failed: "#ef4444",
  partial: "#f59e0b",
  success: "#22c55e",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function vulnSeverityScore(v: VulnAlert): number {
  return { CRITICAL: 4, HIGH: 3, MODERATE: 2, LOW: 1 }[v.severity] ?? 0;
}

function repoSeverityScore(repo: RepoSnapshot): number {
  if (repo.capture_status === "failed") return 100;
  let score = 0;
  if (repo.prs.some((p) => p.stalled)) score += 20;
  if (repo.vulnerability_alerts) {
    for (const v of repo.vulnerability_alerts) score += vulnSeverityScore(v) * 5;
  }
  if (repo.capture_status === "partial") score += 10;
  return score;
}

function formatReviewerLabel(key: string): string {
  if (key.startsWith("human:")) return key.slice(6);
  return key;
}

function relativeTime(isoStr: string): string {
  const ms = Date.now() - new Date(isoStr).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Sub-components ───────────────────────────────────────────────────────────

function StatusChip({ status }: { status: "success" | "partial" | "failed" }) {
  const labels = { success: "OK", partial: "PARTIAL", failed: "FAILED" };
  const colors: Record<string, string> = {
    success: "#22c55e",
    partial: "#f59e0b",
    failed: "#ef4444",
  };
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.05em",
        padding: "2px 7px",
        borderRadius: 4,
        backgroundColor: colors[status] + "22",
        color: colors[status],
        border: `1px solid ${colors[status]}55`,
        flexShrink: 0,
      }}
    >
      {labels[status]}
    </span>
  );
}

function SeverityBadge({
  severity,
  count,
}: {
  severity: string;
  count: number;
}) {
  const color = COLORS[severity as keyof typeof COLORS] ?? COLORS.UNKNOWN;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        fontSize: 11,
        fontWeight: 700,
        padding: "2px 6px",
        borderRadius: 4,
        backgroundColor: color + "22",
        color: color,
        border: `1px solid ${color}55`,
      }}
    >
      {severity[0]} <span style={{ fontWeight: 500 }}>{count}</span>
    </span>
  );
}

function PRItem({ pr }: { pr: PR }) {
  const isBot = pr.is_dependabot || pr.is_renovate;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        padding: "6px 0",
        borderBottom: "1px solid #1f2937",
        fontSize: 13,
      }}
    >
      <span style={{ color: "#6b7280", flexShrink: 0, marginTop: 1 }}>
        #{pr.number}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            color: pr.stalled ? "#f59e0b" : "#e5e7eb",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {pr.title}
        </div>
        <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
          {pr.is_draft && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                backgroundColor: "#1e40af44",
                color: "#60a5fa",
                border: "1px solid #60a5fa44",
              }}
            >
              DRAFT
            </span>
          )}
          {pr.stalled && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                backgroundColor: "#78350f44",
                color: "#f59e0b",
                border: "1px solid #f59e0b44",
              }}
            >
              STALLED {pr.hours_idle}h
            </span>
          )}
          {isBot && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                backgroundColor: "#37415144",
                color: "#9ca3af",
                border: "1px solid #9ca3af44",
              }}
            >
              {pr.is_dependabot ? "dependabot" : "renovate"}
            </span>
          )}
          <span style={{ fontSize: 10, color: "#6b7280" }}>
            {relativeTime(pr.updated_at)}
          </span>
        </div>
      </div>
    </div>
  );
}

function VulnItem({ v }: { v: VulnAlert }) {
  const color = COLORS[v.severity] ?? COLORS.UNKNOWN;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 0",
        borderBottom: "1px solid #1f2937",
        fontSize: 12,
      }}
    >
      <span
        style={{
          flexShrink: 0,
          fontWeight: 700,
          fontSize: 10,
          padding: "2px 5px",
          borderRadius: 3,
          backgroundColor: color + "22",
          color,
        }}
      >
        {v.severity}
      </span>
      <span style={{ flex: 1, color: "#d1d5db", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {v.package_name}
      </span>
      <span style={{ flexShrink: 0, color: "#6b7280", fontSize: 11 }}>
        {v.age_days}d
      </span>
      {v.dependabot_pr_number && (
        <span style={{ flexShrink: 0, fontSize: 10, color: "#60a5fa" }}>
          PR#{v.dependabot_pr_number}
        </span>
      )}
    </div>
  );
}

function RepoCard({
  repo,
  highlighted,
}: {
  repo: RepoSnapshot;
  highlighted: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFailed = repo.capture_status === "failed";
  const vulnMissing =
    repo.field_statuses.vulnerability_alerts?.status === "scope_missing";

  const vulnCounts = useMemo(() => {
    if (!repo.vulnerability_alerts) return null;
    const c: Record<string, number> = {};
    for (const v of repo.vulnerability_alerts) {
      c[v.severity] = (c[v.severity] ?? 0) + 1;
    }
    return c;
  }, [repo.vulnerability_alerts]);

  const stalledPRs = repo.prs.filter((p) => p.stalled);
  const draftPRs = repo.prs.filter((p) => p.is_draft && !p.stalled);
  const botPRs = repo.prs.filter(
    (p) => (p.is_dependabot || p.is_renovate) && !p.stalled
  );
  const activePRs = repo.prs.filter(
    (p) => !p.stalled && !p.is_draft && !p.is_dependabot && !p.is_renovate
  );

  return (
    <div
      style={{
        backgroundColor: "#111827",
        border: `1px solid ${
          isFailed
            ? "#ef444455"
            : highlighted
            ? "#6366f155"
            : "#1f2937"
        }`,
        borderRadius: 10,
        marginBottom: 10,
        overflow: "hidden",
        opacity: isFailed ? 0.85 : 1,
        transition: "border-color 0.2s",
      }}
    >
      {/* Card header */}
      <button
        onClick={() => !isFailed && setExpanded((x) => !x)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "12px 14px",
          cursor: isFailed ? "default" : "pointer",
          textAlign: "left",
          display: "flex",
          alignItems: "center",
          gap: 8,
          minHeight: 44,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                fontWeight: 600,
                fontSize: 15,
                color: isFailed ? "#9ca3af" : "#f3f4f6",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                maxWidth: "200px",
              }}
            >
              {repo.name}
            </span>
            <StatusChip status={repo.capture_status} />
            {repo.is_fork && (
              <span style={{ fontSize: 10, color: "#6b7280" }}>fork</span>
            )}
          </div>

          {!isFailed && (
            <div
              style={{
                display: "flex",
                gap: 6,
                marginTop: 6,
                flexWrap: "wrap",
                alignItems: "center",
              }}
            >
              {/* PR pills */}
              {stalledPRs.length > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 4,
                    backgroundColor: "#78350f44",
                    color: "#f59e0b",
                    border: "1px solid #f59e0b44",
                  }}
                >
                  {stalledPRs.length} stalled
                </span>
              )}
              {draftPRs.length > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 4,
                    backgroundColor: "#1e3a8a44",
                    color: "#93c5fd",
                    border: "1px solid #93c5fd44",
                  }}
                >
                  {draftPRs.length} draft
                </span>
              )}
              {activePRs.length > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 4,
                    backgroundColor: "#06402144",
                    color: "#34d399",
                    border: "1px solid #34d39944",
                  }}
                >
                  {activePRs.length} PR{activePRs.length !== 1 ? "s" : ""}
                </span>
              )}
              {botPRs.length > 0 && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 4,
                    backgroundColor: "#37415144",
                    color: "#9ca3af",
                    border: "1px solid #9ca3af44",
                  }}
                >
                  {botPRs.length} bot
                </span>
              )}

              {/* Vuln badges */}
              {vulnMissing && (
                <span
                  style={{
                    fontSize: 11,
                    padding: "1px 6px",
                    borderRadius: 4,
                    backgroundColor: "#37415144",
                    color: "#9ca3af",
                    border: "1px solid #9ca3af44",
                  }}
                >
                  vulns: scope missing
                </span>
              )}
              {vulnCounts &&
                (["CRITICAL", "HIGH", "MODERATE", "LOW"] as const).map(
                  (sev) =>
                    vulnCounts[sev] ? (
                      <SeverityBadge
                        key={sev}
                        severity={sev}
                        count={vulnCounts[sev]}
                      />
                    ) : null
                )}

              {/* Fork drift */}
              {repo.upstream && repo.upstream.commits_behind > 0 && (
                <span style={{ fontSize: 11, color: "#6b7280" }}>
                  ↓{repo.upstream.commits_behind} behind
                </span>
              )}
            </div>
          )}

          {isFailed && (
            <div style={{ marginTop: 4, fontSize: 12, color: "#ef4444" }}>
              {Object.values(repo.field_statuses).find((f) => f.error_note)
                ?.error_note ?? "Capture failed"}
            </div>
          )}
        </div>

        {!isFailed && (
          <span style={{ color: "#4b5563", fontSize: 16, flexShrink: 0 }}>
            {expanded ? "▲" : "▼"}
          </span>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && !isFailed && (
        <div
          style={{
            padding: "0 14px 12px",
            borderTop: "1px solid #1f2937",
          }}
        >
          {repo.prs.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                Pull Requests
              </div>
              {repo.prs.map((pr) => (
                <PRItem key={pr.number} pr={pr} />
              ))}
            </div>
          )}

          {repo.vulnerability_alerts && repo.vulnerability_alerts.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                Vulnerabilities
              </div>
              {repo.vulnerability_alerts
                .sort((a, b) => vulnSeverityScore(b) - vulnSeverityScore(a))
                .map((v) => (
                  <VulnItem key={v.ghsa_id} v={v} />
                ))}
            </div>
          )}

          {repo.issues.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "#6b7280",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                Issues
              </div>
              {repo.issues.map((issue) => (
                <div
                  key={issue.number}
                  style={{
                    display: "flex",
                    gap: 6,
                    padding: "5px 0",
                    borderBottom: "1px solid #1f2937",
                    fontSize: 13,
                    alignItems: "flex-start",
                  }}
                >
                  <span style={{ color: "#6b7280", flexShrink: 0 }}>
                    #{issue.number}
                  </span>
                  <span
                    style={{
                      flex: 1,
                      color: issue.stalled ? "#f59e0b" : "#e5e7eb",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {issue.title}
                  </span>
                  {issue.stalled && (
                    <span style={{ fontSize: 10, color: "#f59e0b", flexShrink: 0 }}>
                      {issue.hours_idle}h idle
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {repo.releases.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              Latest: {repo.releases[0].tag_name} —{" "}
              {relativeTime(repo.releases[0].created_at)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main chart helpers ────────────────────────────────────────────────────────

function buildVulnDonutData(repos: RepoSnapshot[]) {
  const counts: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 0,
    MODERATE: 0,
    LOW: 0,
    UNKNOWN: 0,
  };
  for (const repo of repos) {
    if (repo.vulnerability_alerts === null) {
      counts.UNKNOWN += 1;
    } else {
      for (const v of repo.vulnerability_alerts) {
        counts[v.severity] = (counts[v.severity] ?? 0) + 1;
      }
    }
  }
  return Object.entries(counts)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value }));
}

function buildPRHealthData(repos: RepoSnapshot[]) {
  let draft = 0, stalled = 0, bot = 0, active = 0;
  for (const repo of repos) {
    for (const pr of repo.prs) {
      if (pr.stalled) stalled++;
      else if (pr.is_draft) draft++;
      else if (pr.is_dependabot || pr.is_renovate) bot++;
      else active++;
    }
  }
  return [
    { name: "Active", value: active, fill: COLORS.active },
    { name: "Stalled", value: stalled, fill: COLORS.stalled },
    { name: "Draft", value: draft, fill: COLORS.draft },
    { name: "Bot", value: bot, fill: COLORS.bot },
  ].filter((d) => d.value > 0);
}

function buildReviewerData(activity: Record<string, ReviewerBucket>) {
  return Object.entries(activity).map(([key, bucket]) => ({
    name: formatReviewerLabel(key),
    Approved: bucket.approved,
    "Changes Req": bucket.change_requested,
    Commented: bucket.commented,
  }));
}

// ── Dashboard component ───────────────────────────────────────────────────────

export default function VisualChartDashboard({ data }: Props) {
  const [highlightSeverity, setHighlightSeverity] = useState<string | null>(null);

  const repos = data.repos as RepoSnapshot[];

  const sortedRepos = useMemo(
    () => [...repos].sort((a, b) => repoSeverityScore(b) - repoSeverityScore(a)),
    [repos]
  );

  const vulnDonutData = useMemo(() => buildVulnDonutData(repos), [repos]);
  const prHealthData = useMemo(() => buildPRHealthData(repos), [repos]);
  const reviewerData = useMemo(
    () => buildReviewerData(data.reviewer_activity_7d as Record<string, ReviewerBucket>),
    [data.reviewer_activity_7d]
  );

  const totalVulns = vulnDonutData
    .filter((d) => d.name !== "UNKNOWN")
    .reduce((s, d) => s + d.value, 0);

  const captureColor =
    data.capture_status === "success"
      ? COLORS.success
      : data.capture_status === "partial"
      ? COLORS.partial
      : COLORS.failed;

  return (
    <div
      style={{
        maxWidth: "100%",
        margin: "0 auto",
        backgroundColor: "#0f1117",
        minHeight: "100%",
        paddingTop: "var(--tg-content-safe-area-inset-top, 0px)",
        color: "#e5e7eb",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        boxSizing: "border-box",
        overflowX: "hidden",
      }}
    >
      {/* Safe-area CSS reset */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        button { font-family: inherit; }
      `}</style>

      {/* Warm-up banner */}
      {data.warm_up_active && (
        <div
          style={{
            backgroundColor: "#1c1917",
            borderBottom: "1px solid #f59e0b44",
            padding: "8px 16px",
            fontSize: 12,
            color: "#fbbf24",
            display: "flex",
            gap: 6,
            alignItems: "center",
          }}
        >
          <span>⏳</span>
          <span>
            Warm-up active — trend data available{" "}
            {data.warm_up_fill_date ?? "soon"}
          </span>
        </div>
      )}

      {/* Header */}
      <div
        style={{
          padding: "14px 16px 10px",
          borderBottom: "1px solid #1f2937",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f3f4f6" }}>
            Org Pulse
          </div>
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 2 }}>
            {data.captured_at_et}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              color: captureColor,
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {data.capture_status}
          </span>
          <span style={{ fontSize: 11, color: "#4b5563" }}>
            {data.repos_succeeded}✓ {data.repos_failed}✗ {data.repos_partial}~
          </span>
        </div>
      </div>

      {/* ── Chart 1: Vuln Donut ─────────────────────────────────────────────── */}
      <div
        style={{
          padding: "16px 16px 8px",
          borderBottom: "1px solid #1f2937",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 10,
          }}
        >
          Vulnerabilities
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 130, height: 130, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={vulnDonutData}
                  cx="50%"
                  cy="50%"
                  innerRadius={38}
                  outerRadius={58}
                  dataKey="value"
                  paddingAngle={2}
                  onClick={(entry) =>
                    setHighlightSeverity(
                      highlightSeverity === entry.name ? null : (entry.name ?? null)
                    )
                  }
                  style={{ cursor: "pointer" }}
                >
                  {vulnDonutData.map((entry) => (
                    <Cell
                      key={entry.name}
                      fill={
                        COLORS[entry.name as keyof typeof COLORS] ??
                        COLORS.UNKNOWN
                      }
                      opacity={
                        highlightSeverity && highlightSeverity !== entry.name
                          ? 0.3
                          : 1
                      }
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#1f2937",
                    border: "1px solid #374151",
                    borderRadius: 6,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{ fontSize: 28, fontWeight: 700, color: "#f3f4f6", lineHeight: 1 }}
            >
              {totalVulns}
            </div>
            <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10 }}>
              vulns across org
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {vulnDonutData.map((d) => {
                const color =
                  COLORS[d.name as keyof typeof COLORS] ?? COLORS.UNKNOWN;
                return (
                  <div
                    key={d.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      opacity:
                        highlightSeverity && highlightSeverity !== d.name
                          ? 0.4
                          : 1,
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        backgroundColor: color,
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ color: "#9ca3af", minWidth: 70 }}>
                      {d.name === "UNKNOWN" ? "scope missing" : d.name}
                    </span>
                    <span style={{ color, fontWeight: 600 }}>{d.value}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {highlightSeverity && (
          <div style={{ fontSize: 11, color: "#6b7280", marginTop: 6 }}>
            Tap card below to see {highlightSeverity} vulns ·{" "}
            <button
              onClick={() => setHighlightSeverity(null)}
              style={{
                background: "none",
                border: "none",
                color: "#60a5fa",
                cursor: "pointer",
                fontSize: 11,
                padding: 0,
              }}
            >
              clear
            </button>
          </div>
        )}
      </div>

      {/* ── Chart 2: PR Health bar ──────────────────────────────────────────── */}
      <div
        style={{
          padding: "16px 16px 8px",
          borderBottom: "1px solid #1f2937",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 10,
          }}
        >
          PR Health
        </div>
        <div style={{ height: 60 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={prHealthData}
              barSize={16}
              margin={{ left: 0, right: 20, top: 0, bottom: 0 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={55}
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="value" radius={[0, 3, 3, 0]}>
                {prHealthData.map((d) => (
                  <Cell key={d.name} fill={d.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Chart 3: Reviewer activity ──────────────────────────────────────── */}
      <div
        style={{
          padding: "16px 16px 12px",
          borderBottom: "1px solid #1f2937",
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 10,
          }}
        >
          Reviewer Activity (7d)
        </div>
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              layout="vertical"
              data={reviewerData}
              barSize={12}
              margin={{ left: 8, right: 20, top: 0, bottom: 0 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                width={80}
                tick={{ fill: "#9ca3af", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1f2937",
                  border: "1px solid #374151",
                  borderRadius: 6,
                  fontSize: 12,
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 11, paddingTop: 4, color: "#9ca3af" }}
              />
              <Bar dataKey="Approved" stackId="a" fill={COLORS.approved} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Changes Req" stackId="a" fill={COLORS.change_requested} radius={[0, 0, 0, 0]} />
              <Bar dataKey="Commented" stackId="a" fill={COLORS.commented} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Repo cards ─────────────────────────────────────────────────────── */}
      <div style={{ padding: "14px 12px 32px" }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#6b7280",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            marginBottom: 10,
            paddingLeft: 2,
          }}
        >
          Repos ({repos.length})
        </div>
        {sortedRepos.map((repo) => {
          const hasHighlightedSeverity =
            highlightSeverity !== null &&
            repo.vulnerability_alerts !== null &&
            repo.vulnerability_alerts.some((v) => v.severity === highlightSeverity);
          return (
            <RepoCard
              key={`${repo.org}/${repo.name}`}
              repo={repo}
              highlighted={hasHighlightedSeverity}
            />
          );
        })}
      </div>
    </div>
  );
}
