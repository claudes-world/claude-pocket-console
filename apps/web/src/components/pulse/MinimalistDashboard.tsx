import { useState, ReactNode } from "react";

// ── Types ──────────────────────────────────────────────────────────────────

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

interface Release {
  tag_name: string;
  name: string;
  is_prerelease: boolean;
  created_at: string;
}

interface FieldStatus {
  status: "success" | "failed" | "partial" | "scope_missing";
  error_note: string | null;
}

interface RepoSnapshot {
  org: string;
  name: string;
  is_fork: boolean;
  is_archived: boolean;
  capture_status: "success" | "partial" | "failed";
  field_statuses: Record<string, FieldStatus>;
  upstream: { status: string; commits_behind: number; commits_ahead: number } | null;
  vulnerability_alerts: VulnAlert[] | null;
  prs: PR[];
  issues: Issue[];
  releases: Release[];
}

interface ReviewerActivity {
  total: number;
  approved: number;
  change_requested: number;
  commented: number;
  dismissed: number;
}

export interface PulseSnapshot {
  snapshot_id: string;
  captured_at_et: string;
  capture_status: string;
  duration_ms: number;
  repos_succeeded: number;
  repos_failed: number;
  repos_partial: number;
  warm_up_active: boolean;
  warm_up_fill_date: string | null;
  reviewer_activity_7d: Record<string, ReviewerActivity>;
  repos: RepoSnapshot[];
}

interface Props {
  data: PulseSnapshot;
}

// ── Color helpers ──────────────────────────────────────────────────────────

const C = {
  red: "#f87171",
  yellow: "#fbbf24",
  green: "#4ade80",
  dim: "#6b7280",
  fg: "#e5e7eb",
  fg2: "#9ca3af",
  bg: "#0f1117",
  bgRow: "#161b22",
  bgExpanded: "#0d1117",
  border: "#21262d",
} as const;

function captureColor(status: string): string {
  if (status === "success") return C.green;
  if (status === "partial") return C.yellow;
  return C.red;
}

function captureLabel(status: string): string {
  if (status === "success") return "OK  ";
  if (status === "partial") return "PART";
  return "FAIL";
}

function sevColor(sev: string): string {
  if (sev === "CRITICAL") return C.red;
  if (sev === "HIGH") return C.yellow;
  if (sev === "MODERATE") return C.fg2;
  return C.dim;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function VulnSummary({ alerts }: { alerts: VulnAlert[] | null }) {
  if (alerts === null) {
    return <span style={{ color: C.yellow, fontStyle: "italic" }}>scope?</span>;
  }
  if (alerts.length === 0) {
    return <span style={{ color: C.dim }}>0 vulns</span>;
  }
  const counts: Record<string, number> = {};
  for (const a of alerts) counts[a.severity] = (counts[a.severity] ?? 0) + 1;
  const parts: ReactNode[] = [];
  const order = ["CRITICAL", "HIGH", "MODERATE", "LOW"] as const;
  for (const sev of order) {
    if (counts[sev]) {
      parts.push(
        <span key={sev} style={{ color: sevColor(sev) }}>
          {sev[0]}{counts[sev]}
        </span>
      );
    }
  }
  return <>{parts.map((p, i) => <span key={i}>{p}{i < parts.length - 1 ? " " : ""}</span>)}</>;
}

function PRLine({ pr }: { pr: PR }) {
  const badges: ReactNode[] = [];
  if (pr.is_draft) badges.push(<span key="draft" style={{ color: C.dim }}>[DRAFT]</span>);
  if (pr.stalled) badges.push(<span key="stall" style={{ color: C.red }}>[STALLED {pr.hours_idle}h]</span>);
  if (pr.is_dependabot || pr.is_renovate) {
    badges.push(<span key="bot" style={{ color: C.dim }}>[bot]</span>);
  }

  const titleColor = pr.is_dependabot || pr.is_renovate ? C.dim : pr.stalled ? C.red : C.fg;
  const titleTrunc = pr.title.length > 38 ? pr.title.slice(0, 35) + "…" : pr.title;

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline", paddingLeft: 12, paddingTop: 2 }}>
      <span style={{ color: C.dim, minWidth: 28, textAlign: "right" }}>#{pr.number}</span>
      <span style={{ color: titleColor, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {titleTrunc}
      </span>
      <span style={{ color: C.dim, whiteSpace: "nowrap" }}>{pr.author}</span>
      {badges.map((b, i) => <span key={i} style={{ whiteSpace: "nowrap" }}>{b}</span>)}
    </div>
  );
}

function IssueLine({ issue }: { issue: Issue }) {
  const titleTrunc = issue.title.length > 44 ? issue.title.slice(0, 41) + "…" : issue.title;
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline", paddingLeft: 12, paddingTop: 2 }}>
      <span style={{ color: C.dim, minWidth: 28, textAlign: "right" }}>#{issue.number}</span>
      <span style={{ color: issue.stalled ? C.yellow : C.fg, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {titleTrunc}
      </span>
      {issue.stalled && (
        <span style={{ color: C.yellow, whiteSpace: "nowrap" }}>[{issue.hours_idle}h idle]</span>
      )}
    </div>
  );
}

function VulnLine({ v }: { v: VulnAlert }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "baseline", paddingLeft: 12, paddingTop: 2 }}>
      <span style={{ color: sevColor(v.severity), minWidth: 48 }}>{v.severity.slice(0, 4)}</span>
      <span style={{ color: C.fg }}>{v.package_name}</span>
      <span style={{ color: C.dim }}>({v.ecosystem})</span>
      <span style={{ color: C.dim }}>{v.age_days}d</span>
      {v.dependabot_pr_number && (
        <span style={{ color: C.dim }}>PR#{v.dependabot_pr_number}</span>
      )}
    </div>
  );
}

function FieldStatusLines({ field_statuses }: { field_statuses: Record<string, FieldStatus> }) {
  const problems = Object.entries(field_statuses).filter(
    ([, v]) => v.status !== "success"
  );
  if (problems.length === 0) return null;
  return (
    <div style={{ paddingLeft: 12, paddingTop: 4 }}>
      <div style={{ color: C.dim, fontSize: 10 }}>field errors:</div>
      {problems.map(([field, fs]) => (
        <div key={field} style={{ display: "flex", gap: 6, paddingLeft: 8, paddingTop: 1 }}>
          <span style={{ color: fs.status === "scope_missing" ? C.yellow : C.red, minWidth: 80 }}>
            {field}
          </span>
          <span style={{ color: C.dim, fontSize: 11 }}>
            {fs.status === "scope_missing" ? "scope missing" : fs.error_note ?? fs.status}
          </span>
        </div>
      ))}
    </div>
  );
}

function RepoRow({ repo }: { repo: RepoSnapshot }) {
  const [expanded, setExpanded] = useState(false);

  const stalledPRs = repo.prs.filter((p) => p.stalled && !p.is_dependabot && !p.is_renovate);
  const humanPRs = repo.prs.filter((p) => !p.is_dependabot && !p.is_renovate);
  const botPRs = repo.prs.filter((p) => p.is_dependabot || p.is_renovate);
  const stalledIssues = repo.issues.filter((i) => i.stalled);
  const latestRelease = repo.releases[0];

  const nameDisplay = repo.name.length > 20 ? repo.name.slice(0, 18) + "…" : repo.name.padEnd(20);

  const upstreamStr =
    repo.is_fork && repo.upstream
      ? ` ↓${repo.upstream.commits_behind}↑${repo.upstream.commits_ahead}`
      : "";

  const rowBg = repo.capture_status === "failed" ? "#1a0d0d" : expanded ? C.bgExpanded : C.bgRow;

  return (
    <div
      style={{
        backgroundColor: rowBg,
        borderBottom: `1px solid ${C.border}`,
        cursor: "pointer",
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {/* Summary row */}
      <div
        onClick={() => setExpanded((e) => !e)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "5px 8px",
          fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
          fontSize: 12,
          lineHeight: 1.4,
          whiteSpace: "nowrap",
          overflowX: "hidden",
        }}
        role="button"
        aria-expanded={expanded}
      >
        {/* Status */}
        <span style={{ color: captureColor(repo.capture_status), minWidth: 32 }}>
          {captureLabel(repo.capture_status)}
        </span>

        {/* Repo name */}
        <span style={{ color: C.fg, flex: "0 0 152px", overflow: "hidden", textOverflow: "ellipsis" }}>
          {nameDisplay}
        </span>

        {/* PR / stalled */}
        <span style={{ color: stalledPRs.length > 0 ? C.red : C.fg2, minWidth: 36 }}>
          PR:{humanPRs.length}{stalledPRs.length > 0 ? `!${stalledPRs.length}` : ""}
        </span>

        {/* Issues */}
        <span style={{ color: stalledIssues.length > 0 ? C.yellow : C.dim, minWidth: 28 }}>
          I:{repo.issues.length}
        </span>

        {/* Vulns */}
        <span style={{ minWidth: 48 }}>
          <VulnSummary alerts={repo.vulnerability_alerts} />
        </span>

        {/* Upstream drift */}
        {repo.is_fork && repo.upstream && (
          <span style={{ color: repo.upstream.commits_behind > 0 ? C.yellow : C.dim }}>
            {upstreamStr}
          </span>
        )}

        {/* Latest release */}
        {latestRelease && (
          <span style={{ color: C.dim, marginLeft: "auto" }}>{latestRelease.tag_name}</span>
        )}

        {/* Expand indicator */}
        <span style={{ color: C.dim, marginLeft: 4 }}>{expanded ? "▾" : "▸"}</span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
            fontSize: 11,
            lineHeight: 1.5,
            paddingBottom: 8,
            borderTop: `1px solid ${C.border}`,
          }}
        >
          {/* FAILED repo — show error details only */}
          {repo.capture_status === "failed" ? (
            <div style={{ padding: "6px 12px", color: C.red }}>
              FAILED — no data captured
              <FieldStatusLines field_statuses={repo.field_statuses} />
            </div>
          ) : (
            <>
              {/* Field status errors for partial repos */}
              {repo.capture_status === "partial" && (
                <FieldStatusLines field_statuses={repo.field_statuses} />
              )}

              {/* PRs — human */}
              {humanPRs.length > 0 && (
                <div style={{ paddingTop: 6 }}>
                  <div style={{ paddingLeft: 8, color: C.dim, fontSize: 10, letterSpacing: "0.05em" }}>
                    PULL REQUESTS ({humanPRs.length})
                  </div>
                  {humanPRs.map((pr) => <PRLine key={pr.number} pr={pr} />)}
                </div>
              )}

              {/* PRs — bots */}
              {botPRs.length > 0 && (
                <div style={{ paddingTop: 4 }}>
                  <div style={{ paddingLeft: 8, color: C.dim, fontSize: 10 }}>
                    BOT PRS ({botPRs.length})
                  </div>
                  {botPRs.map((pr) => <PRLine key={pr.number} pr={pr} />)}
                </div>
              )}

              {/* Issues */}
              {repo.issues.length > 0 && (
                <div style={{ paddingTop: 6 }}>
                  <div style={{ paddingLeft: 8, color: C.dim, fontSize: 10, letterSpacing: "0.05em" }}>
                    ISSUES ({repo.issues.length})
                  </div>
                  {repo.issues.map((iss) => <IssueLine key={iss.number} issue={iss} />)}
                </div>
              )}

              {/* Vulns */}
              {repo.vulnerability_alerts === null ? (
                <div style={{ paddingTop: 6, paddingLeft: 12, color: C.yellow, fontSize: 11 }}>
                  vulns: scope missing — re-auth required
                </div>
              ) : repo.vulnerability_alerts.length > 0 ? (
                <div style={{ paddingTop: 6 }}>
                  <div style={{ paddingLeft: 8, color: C.dim, fontSize: 10, letterSpacing: "0.05em" }}>
                    VULNERABILITIES ({repo.vulnerability_alerts.length})
                  </div>
                  {repo.vulnerability_alerts.map((v) => <VulnLine key={v.ghsa_id} v={v} />)}
                </div>
              ) : (
                <div style={{ paddingTop: 6, paddingLeft: 12, color: C.dim, fontSize: 11 }}>
                  vulns: 0
                </div>
              )}

              {/* Upstream */}
              {repo.is_fork && repo.upstream && (
                <div style={{ paddingTop: 6, paddingLeft: 12, color: C.dim, fontSize: 11 }}>
                  upstream:{" "}
                  <span style={{ color: repo.upstream.commits_behind > 0 ? C.yellow : C.green }}>
                    {repo.upstream.commits_behind} behind, {repo.upstream.commits_ahead} ahead
                  </span>
                </div>
              )}

              {/* Releases */}
              {repo.releases.length > 0 && (
                <div style={{ paddingTop: 4, paddingLeft: 12, color: C.dim, fontSize: 11 }}>
                  latest:{" "}
                  <span style={{ color: C.fg2 }}>{repo.releases[0].tag_name}</span>{" "}
                  — {repo.releases[0].name}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ReviewerTable({
  activity,
}: {
  activity: Record<string, ReviewerActivity>;
}) {
  const entries = Object.entries(activity);
  const humans = entries.filter(([k]) => k.startsWith("human:"));
  const bots = entries.filter(([k]) => !k.startsWith("human:"));
  const sorted = (arr: typeof entries) =>
    [...arr].sort(([, a], [, b]) => b.total - a.total);

  const Row = ({ name, data }: { name: string; data: ReviewerActivity }) => {
    const label = name.startsWith("human:") ? name.slice(6) : name;
    const approvalPct = data.total > 0 ? Math.round((data.approved / data.total) * 100) : 0;
    return (
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "2px 8px",
          fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
          fontSize: 11,
        }}
      >
        <span style={{ color: name.startsWith("human:") ? C.fg : C.dim, minWidth: 90 }}>
          {label}
        </span>
        <span style={{ color: C.fg2, minWidth: 30, textAlign: "right" }}>{data.total}</span>
        <span style={{ color: C.green, minWidth: 30, textAlign: "right" }}>✓{data.approved}</span>
        <span style={{ color: data.change_requested > 0 ? C.red : C.dim, minWidth: 30, textAlign: "right" }}>
          ✗{data.change_requested}
        </span>
        <span style={{ color: C.dim, minWidth: 30, textAlign: "right" }}>{approvalPct}%</span>
      </div>
    );
  };

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "2px 8px",
          fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
          fontSize: 10,
          color: C.dim,
          borderBottom: `1px solid ${C.border}`,
          letterSpacing: "0.05em",
        }}
      >
        <span style={{ minWidth: 90 }}>REVIEWER</span>
        <span style={{ minWidth: 30, textAlign: "right" }}>TOT</span>
        <span style={{ minWidth: 30, textAlign: "right" }}>APR</span>
        <span style={{ minWidth: 30, textAlign: "right" }}>REQ</span>
        <span style={{ minWidth: 30, textAlign: "right" }}>APR%</span>
      </div>
      {sorted(humans).map(([k, v]) => <Row key={k} name={k} data={v} />)}
      <div style={{ borderBottom: `1px dashed ${C.border}`, margin: "2px 0" }} />
      {sorted(bots).map(([k, v]) => <Row key={k} name={k} data={v} />)}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function MinimalistDashboard({ data }: Props) {
  const globalStatusColor = captureColor(data.capture_status);
  const totalRepos = data.repos_succeeded + data.repos_failed + data.repos_partial;

  return (
    <div
      style={{
        backgroundColor: C.bg,
        minHeight: "100%",
        paddingTop: "var(--tg-content-safe-area-inset-top, 0px)",
        color: C.fg,
        fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
        fontSize: 12,
        boxSizing: "border-box",
        overflowX: "hidden",
        maxWidth: "100%",
      }}
    >
      {/* CSS reset baseline */}
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      `}</style>

      {/* Warm-up banner */}
      {data.warm_up_active && (
        <div
          style={{
            backgroundColor: "#1c1a0a",
            borderBottom: `1px solid ${C.yellow}`,
            padding: "4px 8px",
            color: C.yellow,
            fontFamily: "ui-monospace, 'Cascadia Code', 'Fira Code', monospace",
            fontSize: 11,
          }}
        >
          WARM-UP — window fills {data.warm_up_fill_date ?? "unknown"} — no trend data yet
        </div>
      )}

      {/* Header */}
      <div
        style={{
          padding: "6px 8px",
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ color: globalStatusColor, fontWeight: "bold" }}>
          ORG-PULSE
        </span>
        <span style={{ color: C.dim }}>
          {data.captured_at_et}
        </span>
        <span style={{ color: globalStatusColor }}>
          [{captureLabel(data.capture_status).trim()}]
        </span>
        <span style={{ color: C.dim, marginLeft: "auto" }}>
          {totalRepos} repos — {data.repos_succeeded} ok{" "}
          {data.repos_partial > 0 && (
            <span style={{ color: C.yellow }}>{data.repos_partial} part </span>
          )}
          {data.repos_failed > 0 && (
            <span style={{ color: C.red }}>{data.repos_failed} fail</span>
          )}
        </span>
        <span style={{ color: C.dim }}>
          {(data.duration_ms / 1000).toFixed(1)}s
        </span>
      </div>

      {/* Reviewer activity */}
      <div>
        <div
          style={{
            padding: "4px 8px",
            color: C.dim,
            fontSize: 10,
            letterSpacing: "0.08em",
            borderBottom: `1px solid ${C.border}`,
            backgroundColor: "#0d1117",
          }}
        >
          REVIEWER ACTIVITY — 7 DAYS
        </div>
        <ReviewerTable activity={data.reviewer_activity_7d} />
      </div>

      {/* Repo list header */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "3px 8px",
          color: C.dim,
          fontSize: 10,
          letterSpacing: "0.05em",
          backgroundColor: "#0d1117",
          borderBottom: `1px solid ${C.border}`,
          borderTop: `1px solid ${C.border}`,
        }}
      >
        <span style={{ minWidth: 32 }}>STAT</span>
        <span style={{ flex: "0 0 152px" }}>REPO</span>
        <span style={{ minWidth: 36 }}>PRs</span>
        <span style={{ minWidth: 28 }}>ISS</span>
        <span style={{ minWidth: 48 }}>VULNS</span>
      </div>

      {/* Repos */}
      <div>
        {data.repos.map((repo) => (
          <RepoRow key={`${repo.org}/${repo.name}`} repo={repo} />
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          padding: "6px 8px",
          color: C.dim,
          fontSize: 10,
          borderTop: `1px solid ${C.border}`,
          marginTop: 8,
        }}
      >
        snap {data.snapshot_id} — tap row to expand
      </div>
    </div>
  );
}
