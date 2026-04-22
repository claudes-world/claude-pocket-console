import { useState } from "react";
import type { PulseSnapshot } from "./MinimalistDashboard";

// ── Types ────────────────────────────────────────────────────────────────────

interface FieldStatus {
  status: "success" | "failed" | "partial" | "scope_missing";
  error_note: string | null;
}

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
  issues: { number: number; title: string; labels: string[]; stalled: boolean; hours_idle: number }[];
  releases: { tag_name: string; name: string; is_prerelease: boolean; created_at: string }[];
}

type AlertKind =
  | "capture_failed"
  | "vuln_critical"
  | "stalled_pr"
  | "vuln_high"
  | "scope_missing"
  | "capture_partial"
  | "vuln_moderate"
  | "vuln_low";

interface Alert {
  id: string;
  kind: AlertKind;
  priority: number;
  repo: string;
  org: string;
  title: string;
  subtitle: string;
  meta: string;
  detail: string | null;
}

interface Props {
  data: PulseSnapshot;
}

// ── Priority weights (lower = more urgent) ───────────────────────────────────

const PRIORITY: Record<AlertKind, number> = {
  capture_failed: 0,
  vuln_critical: 1,
  stalled_pr: 2,
  vuln_high: 3,
  scope_missing: 4,
  capture_partial: 5,
  vuln_moderate: 6,
  vuln_low: 7,
};

// ── Alert generation ─────────────────────────────────────────────────────────

function buildAlerts(repos: RepoSnapshot[]): Alert[] {
  const alerts: Alert[] = [];

  for (const repo of repos) {
    const repoKey = `${repo.org}/${repo.name}`;

    // 1. Capture failure
    if (repo.capture_status === "failed") {
      const firstError = Object.values(repo.field_statuses)
        .find((f) => f.status === "failed")
        ?.error_note ?? "Unknown capture error";
      alerts.push({
        id: `capture_failed:${repoKey}`,
        kind: "capture_failed",
        priority: PRIORITY.capture_failed,
        repo: repo.name,
        org: repo.org,
        title: "Capture failed",
        subtitle: repo.name,
        meta: firstError,
        detail: Object.entries(repo.field_statuses)
          .filter(([, v]) => v.status === "failed")
          .map(([field, v]) => `${field}: ${v.error_note}`)
          .join("\n"),
      });
    }

    // 2. Vulnerability alerts (null = scope_missing, handled below)
    if (repo.vulnerability_alerts !== null) {
      for (const vuln of repo.vulnerability_alerts) {
        const kind: AlertKind =
          vuln.severity === "CRITICAL"
            ? "vuln_critical"
            : vuln.severity === "HIGH"
            ? "vuln_high"
            : vuln.severity === "MODERATE"
            ? "vuln_moderate"
            : "vuln_low";

        alerts.push({
          id: `${kind}:${repoKey}:${vuln.ghsa_id}`,
          kind,
          priority: PRIORITY[kind],
          repo: repo.name,
          org: repo.org,
          title: `${vuln.severity} vuln — ${vuln.package_name}`,
          subtitle: `${vuln.ghsa_id} · ${vuln.ecosystem}`,
          meta: `${vuln.age_days}d old${vuln.dependabot_pr_number ? ` · PR #${vuln.dependabot_pr_number}` : " · no PR"}`,
          detail: vuln.dependabot_pr_number
            ? `Dependabot PR #${vuln.dependabot_pr_number} open. Review and merge to remediate.`
            : `No dependabot PR exists. Manual remediation required for ${vuln.package_name} (${vuln.ecosystem}).`,
        });
      }
    }

    // 3. Stalled PRs (human-authored only — skip dependabot/renovate)
    for (const pr of repo.prs) {
      if (pr.stalled && !pr.is_dependabot && !pr.is_renovate) {
        const days = Math.round(pr.hours_idle / 24);
        alerts.push({
          id: `stalled_pr:${repoKey}:#${pr.number}`,
          kind: "stalled_pr",
          priority: PRIORITY.stalled_pr,
          repo: repo.name,
          org: repo.org,
          title: `Stalled PR #${pr.number}`,
          subtitle: pr.title,
          meta: `${days}d idle · @${pr.author}${pr.is_draft ? " · draft" : ""}`,
          detail: `Last updated: ${new Date(pr.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. No activity for ${pr.hours_idle}h.`,
        });
      }
    }

    // 4. Scope-missing fields (vuln_alerts: null means the whole field is missing)
    if (repo.vulnerability_alerts === null) {
      const note = repo.field_statuses["vulnerability_alerts"]?.error_note;
      alerts.push({
        id: `scope_missing:${repoKey}:vulnerability_alerts`,
        kind: "scope_missing",
        priority: PRIORITY.scope_missing,
        repo: repo.name,
        org: repo.org,
        title: "Scope missing — vulnerability_alerts",
        subtitle: repo.name,
        meta: "Cannot read vuln data",
        detail: note ?? "Token lacks security_events scope. Re-auth required to capture vulnerability data for this repo.",
      });
    }

    // 5. Other scope_missing / failed fields (not already caught above)
    for (const [field, fs] of Object.entries(repo.field_statuses)) {
      if (fs.status === "scope_missing" && field !== "vulnerability_alerts") {
        alerts.push({
          id: `scope_missing:${repoKey}:${field}`,
          kind: "scope_missing",
          priority: PRIORITY.scope_missing,
          repo: repo.name,
          org: repo.org,
          title: `Scope missing — ${field}`,
          subtitle: repo.name,
          meta: fs.error_note ?? "Permission gap",
          detail: fs.error_note,
        });
      }
    }

    // 6. Partial capture (repo-level, not already failed)
    if (repo.capture_status === "partial") {
      const partialFields = Object.entries(repo.field_statuses)
        .filter(([, v]) => v.status === "partial" || v.status === "failed")
        .map(([field]) => field);
      if (partialFields.length > 0) {
        alerts.push({
          id: `capture_partial:${repoKey}`,
          kind: "capture_partial",
          priority: PRIORITY.capture_partial,
          repo: repo.name,
          org: repo.org,
          title: "Partial capture",
          subtitle: `Fields affected: ${partialFields.join(", ")}`,
          meta: repo.name,
          detail: partialFields
            .map((f) => `${f}: ${repo.field_statuses[f]?.error_note ?? "partial"}`)
            .join("\n"),
        });
      }
    }
  }

  // Deduplicate by id then sort
  const seen = new Set<string>();
  const unique = alerts.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  return unique.sort((a, b) => a.priority - b.priority);
}

// ── Styles ───────────────────────────────────────────────────────────────────

const css = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }

  .ap-root {
    max-width: 100%;
    margin: 0 auto;
    background: var(--tg-theme-bg-color, #0f0f0f);
    color: var(--tg-theme-text-color, #e8e8e8);
    padding-top: var(--tg-content-safe-area-inset-top, 0px);
    min-height: 100%;
    overflow-x: hidden;
  }

  .ap-header {
    padding: 12px 16px 8px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }

  .ap-header-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
  }

  .ap-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: rgba(255,255,255,0.4);
  }

  .ap-timestamp {
    font-size: 11px;
    color: rgba(255,255,255,0.3);
  }

  .ap-alert-count {
    font-size: 11px;
    font-weight: 700;
    color: #ff4d4d;
    margin-left: auto;
  }

  .ap-list {
    list-style: none;
  }

  .ap-card {
    border-bottom: 1px solid rgba(255,255,255,0.06);
    cursor: pointer;
    user-select: none;
  }

  .ap-card:active {
    background: rgba(255,255,255,0.04);
  }

  .ap-card-main {
    display: flex;
    align-items: stretch;
    min-height: 64px;
    padding: 0;
  }

  .ap-card-stripe {
    width: 4px;
    flex-shrink: 0;
    border-radius: 0;
  }

  .stripe-capture_failed  { background: #ff4d4d; }
  .stripe-vuln_critical   { background: #ff4d4d; }
  .stripe-stalled_pr      { background: #ff9500; }
  .stripe-vuln_high       { background: #ffcc00; }
  .stripe-scope_missing   { background: #a78bfa; }
  .stripe-capture_partial { background: #60a5fa; }
  .stripe-vuln_moderate   { background: #94a3b8; }
  .stripe-vuln_low        { background: #475569; }

  .ap-card-body {
    flex: 1;
    padding: 10px 12px;
    min-width: 0;
  }

  .ap-card-top {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
  }

  .ap-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 1px 5px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .badge-capture_failed  { background: rgba(255,77,77,0.2);  color: #ff4d4d; }
  .badge-vuln_critical   { background: rgba(255,77,77,0.2);  color: #ff4d4d; }
  .badge-stalled_pr      { background: rgba(255,149,0,0.2);  color: #ff9500; }
  .badge-vuln_high       { background: rgba(255,204,0,0.2);  color: #ffcc00; }
  .badge-scope_missing   { background: rgba(167,139,250,0.2);color: #a78bfa; }
  .badge-capture_partial { background: rgba(96,165,250,0.2); color: #60a5fa; }
  .badge-vuln_moderate   { background: rgba(148,163,184,0.2);color: #94a3b8; }
  .badge-vuln_low        { background: rgba(71,85,105,0.3);  color: #94a3b8; }

  .ap-repo-label {
    font-size: 11px;
    font-weight: 600;
    color: rgba(255,255,255,0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ap-card-title {
    font-size: 13px;
    font-weight: 600;
    color: #e8e8e8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .ap-card-subtitle {
    font-size: 12px;
    color: rgba(255,255,255,0.45);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-top: 1px;
  }

  .ap-card-meta {
    font-size: 11px;
    color: rgba(255,255,255,0.3);
    margin-top: 4px;
  }

  .ap-expand-icon {
    width: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.2);
    font-size: 10px;
    flex-shrink: 0;
  }

  .ap-card-detail {
    padding: 10px 12px 12px 16px;
    background: rgba(255,255,255,0.03);
    border-top: 1px solid rgba(255,255,255,0.05);
    font-size: 12px;
    color: rgba(255,255,255,0.5);
    white-space: pre-line;
    line-height: 1.5;
  }

  .ap-section-header {
    padding: 8px 16px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255,255,255,0.25);
    background: rgba(255,255,255,0.02);
    border-top: 1px solid rgba(255,255,255,0.06);
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }

  .ap-healthy-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 16px;
    cursor: pointer;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    user-select: none;
    min-height: 44px;
  }

  .ap-healthy-toggle:active {
    background: rgba(255,255,255,0.04);
  }

  .ap-healthy-label {
    font-size: 13px;
    color: rgba(255,255,255,0.4);
  }

  .ap-healthy-label strong {
    color: #4ade80;
  }

  .ap-healthy-chevron {
    font-size: 10px;
    color: rgba(255,255,255,0.2);
    transition: transform 0.15s ease;
  }

  .ap-healthy-list {
    list-style: none;
  }

  .ap-healthy-repo {
    display: flex;
    align-items: center;
    padding: 10px 16px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    gap: 8px;
  }

  .ap-healthy-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #4ade80;
    flex-shrink: 0;
  }

  .ap-healthy-name {
    font-size: 13px;
    color: rgba(255,255,255,0.6);
    flex: 1;
  }

  .ap-healthy-prs {
    font-size: 11px;
    color: rgba(255,255,255,0.3);
  }

  .ap-empty-state {
    padding: 40px 24px;
    text-align: center;
    color: rgba(255,255,255,0.3);
    font-size: 14px;
  }

  .ap-empty-icon {
    font-size: 32px;
    margin-bottom: 12px;
  }

  .ap-footer {
    padding: 16px;
    text-align: center;
    font-size: 11px;
    color: rgba(255,255,255,0.2);
    line-height: 1.5;
  }

  .ap-warmup-note {
    display: inline-block;
    background: rgba(255,204,0,0.08);
    border: 1px solid rgba(255,204,0,0.15);
    color: rgba(255,204,0,0.6);
    border-radius: 4px;
    padding: 4px 8px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .ap-no-alerts {
    padding: 32px 24px;
    text-align: center;
  }

  .ap-no-alerts-icon {
    font-size: 28px;
    margin-bottom: 8px;
  }

  .ap-no-alerts-text {
    font-size: 14px;
    color: #4ade80;
    font-weight: 600;
  }

  .ap-no-alerts-sub {
    font-size: 12px;
    color: rgba(255,255,255,0.3);
    margin-top: 4px;
  }
`;

// ── Badge label mapping ───────────────────────────────────────────────────────

const BADGE_LABEL: Record<AlertKind, string> = {
  capture_failed: "Failed",
  vuln_critical: "Critical",
  stalled_pr: "Stalled",
  vuln_high: "High",
  scope_missing: "Scope",
  capture_partial: "Partial",
  vuln_moderate: "Moderate",
  vuln_low: "Low",
};

// ── AlertCard component ───────────────────────────────────────────────────────

interface AlertCardProps {
  alert: Alert;
  expanded: boolean;
  onToggle: () => void;
}

function AlertCard({ alert, expanded, onToggle }: AlertCardProps) {
  return (
    <li className="ap-card" onClick={onToggle}>
      <div className="ap-card-main">
        <div className={`ap-card-stripe stripe-${alert.kind}`} />
        <div className="ap-card-body">
          <div className="ap-card-top">
            <span className={`ap-badge badge-${alert.kind}`}>
              {BADGE_LABEL[alert.kind]}
            </span>
            <span className="ap-repo-label">{alert.repo}</span>
          </div>
          <div className="ap-card-title">{alert.title}</div>
          <div className="ap-card-subtitle">{alert.subtitle}</div>
          {alert.meta && <div className="ap-card-meta">{alert.meta}</div>}
        </div>
        <div className="ap-expand-icon">{expanded ? "▲" : "▼"}</div>
      </div>
      {expanded && alert.detail && (
        <div className="ap-card-detail">{alert.detail}</div>
      )}
    </li>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AlertFirstDashboard({ data }: Props) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showHealthy, setShowHealthy] = useState(false);

  const repos = data.repos as RepoSnapshot[];
  const alerts = buildAlerts(repos);

  const healthyRepos = repos.filter(
    (r) =>
      r.capture_status === "success" &&
      (r.vulnerability_alerts === null || r.vulnerability_alerts.length === 0) &&
      r.prs.every((pr) => !pr.stalled || pr.is_dependabot || pr.is_renovate)
  );

  const toggleAlert = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <>
      <style>{css}</style>
      <div className="ap-root">
        {/* Header */}
        <div className="ap-header">
          <div className="ap-header-row">
            <span className="ap-title">Org Pulse</span>
            <span className="ap-timestamp">{data.captured_at_et}</span>
            {alerts.length > 0 && (
              <span className="ap-alert-count">{alerts.length} alerts</span>
            )}
          </div>
        </div>

        {/* Alert list */}
        {alerts.length === 0 ? (
          <div className="ap-no-alerts">
            <div className="ap-no-alerts-icon">✓</div>
            <div className="ap-no-alerts-text">All systems healthy</div>
            <div className="ap-no-alerts-sub">No alerts at {data.captured_at_et}</div>
          </div>
        ) : (
          <ul className="ap-list">
            {alerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                expanded={expandedIds.has(alert.id)}
                onToggle={() => toggleAlert(alert.id)}
              />
            ))}
          </ul>
        )}

        {/* Healthy repos section */}
        {healthyRepos.length > 0 && (
          <>
            <div
              className="ap-healthy-toggle"
              onClick={() => setShowHealthy((v) => !v)}
            >
              <span className="ap-healthy-label">
                <strong>{healthyRepos.length}</strong> repo{healthyRepos.length !== 1 ? "s" : ""} healthy
                {!showHealthy && " — show"}
              </span>
              <span
                className="ap-healthy-chevron"
                style={{ transform: showHealthy ? "rotate(180deg)" : undefined }}
              >
                ▼
              </span>
            </div>
            {showHealthy && (
              <ul className="ap-healthy-list">
                {healthyRepos.map((repo) => (
                  <li key={`${repo.org}/${repo.name}`} className="ap-healthy-repo">
                    <div className="ap-healthy-dot" />
                    <span className="ap-healthy-name">{repo.name}</span>
                    <span className="ap-healthy-prs">
                      {repo.prs.length > 0
                        ? `${repo.prs.length} PR${repo.prs.length !== 1 ? "s" : ""}`
                        : "no PRs"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* Footer */}
        <div className="ap-footer">
          {data.warm_up_active && (
            <>
              <span className="ap-warmup-note">
                Warm-up — trend data available {data.warm_up_fill_date}
              </span>
              <br />
              <br />
            </>
          )}
          Snapshot {data.snapshot_id} · {data.repos_succeeded}✓{" "}
          {data.repos_partial}~ {data.repos_failed}✗ repos ·{" "}
          {(data.duration_ms / 1000).toFixed(1)}s
        </div>
      </div>
    </>
  );
}
