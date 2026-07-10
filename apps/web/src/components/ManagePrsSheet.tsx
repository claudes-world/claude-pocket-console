import { BottomSheet } from "./BottomSheet";
import { haptic } from "../lib/haptic";
import { applyOrder, getRepoOrder, type PrViewPrefs } from "../lib/prViewPrefs";

interface ManagePrsSheetProps {
  orgRepos: Record<string, string[]>;
  prefs: PrViewPrefs;
  onChange: (prefs: PrViewPrefs) => void;
  onClose: () => void;
}

function toggleValue(items: string[], value: string): string[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function moveValue(items: string[], value: string, offset: -1 | 1): string[] {
  const index = items.indexOf(value);
  const nextIndex = index + offset;
  if (index < 0 || nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
  return next;
}

const iconButtonStyle = {
  width: 34,
  height: 30,
  border: "1px solid var(--color-border)",
  borderRadius: 7,
  background: "var(--color-surface)",
  color: "var(--color-fg)",
  fontSize: 15,
  cursor: "pointer",
  flexShrink: 0,
};

export function ManagePrsSheet({ orgRepos, prefs, onChange, onClose }: ManagePrsSheetProps) {
  const orgs = applyOrder(Object.keys(orgRepos), prefs.orgOrder);

  const update = (next: PrViewPrefs) => {
    haptic.impact("light");
    onChange(next);
  };

  return (
    <BottomSheet onClose={onClose} title="Manage PRs">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {orgs.map((org, orgIndex) => {
          const orgHidden = prefs.hiddenOrgs.includes(org);
          const repos = applyOrder(orgRepos[org] ?? [], getRepoOrder(prefs, org));

          return (
            <div
              key={org}
              style={{
                border: "1px solid var(--color-border)",
                borderRadius: 10,
                overflow: "hidden",
                opacity: orgHidden ? 0.5 : 1,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 8px 8px 10px", background: "var(--color-surface)" }}>
                <span style={{ minWidth: 0, flex: 1, fontWeight: 700, color: "var(--color-fg)", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {org}
                </span>
                <button
                  type="button"
                  aria-label={`${orgHidden ? "Show" : "Hide"} org ${org}`}
                  title={`${orgHidden ? "Show" : "Hide"} ${org}`}
                  onClick={() => update({ ...prefs, hiddenOrgs: toggleValue(prefs.hiddenOrgs, org) })}
                  style={iconButtonStyle}
                >
                  {orgHidden ? "◌" : "👁"}
                </button>
                <button
                  type="button"
                  aria-label={`Move org ${org} up`}
                  disabled={orgIndex === 0}
                  onClick={() => update({ ...prefs, orgOrder: moveValue(orgs, org, -1) })}
                  style={{ ...iconButtonStyle, opacity: orgIndex === 0 ? 0.3 : 1, cursor: orgIndex === 0 ? "default" : "pointer" }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={`Move org ${org} down`}
                  disabled={orgIndex === orgs.length - 1}
                  onClick={() => update({ ...prefs, orgOrder: moveValue(orgs, org, 1) })}
                  style={{ ...iconButtonStyle, opacity: orgIndex === orgs.length - 1 ? 0.3 : 1, cursor: orgIndex === orgs.length - 1 ? "default" : "pointer" }}
                >
                  ↓
                </button>
              </div>

              {repos.map((repo, repoIndex) => {
                const repoHidden = prefs.hiddenRepos.includes(repo);
                const repoShort = repo.split("/")[1] || repo;
                return (
                  <div
                    key={repo}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "7px 8px 7px 20px",
                      borderTop: "1px solid var(--color-border)",
                      opacity: repoHidden ? 0.5 : 1,
                    }}
                  >
                    <span style={{ minWidth: 0, flex: 1, color: "var(--color-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {repoShort}
                    </span>
                    <button
                      type="button"
                      aria-label={`${repoHidden ? "Show" : "Hide"} repo ${repo}`}
                      title={`${repoHidden ? "Show" : "Hide"} ${repoShort}`}
                      onClick={() => update({ ...prefs, hiddenRepos: toggleValue(prefs.hiddenRepos, repo) })}
                      style={iconButtonStyle}
                    >
                      {repoHidden ? "◌" : "👁"}
                    </button>
                    <button
                      type="button"
                      aria-label={`Move repo ${repo} up`}
                      disabled={repoIndex === 0}
                      onClick={() => update({
                        ...prefs,
                        repoOrder: { ...prefs.repoOrder, [org]: moveValue(repos, repo, -1) },
                      })}
                      style={{ ...iconButtonStyle, opacity: repoIndex === 0 ? 0.3 : 1, cursor: repoIndex === 0 ? "default" : "pointer" }}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move repo ${repo} down`}
                      disabled={repoIndex === repos.length - 1}
                      onClick={() => update({
                        ...prefs,
                        repoOrder: { ...prefs.repoOrder, [org]: moveValue(repos, repo, 1) },
                      })}
                      style={{ ...iconButtonStyle, opacity: repoIndex === repos.length - 1 ? 0.3 : 1, cursor: repoIndex === repos.length - 1 ? "default" : "pointer" }}
                    >
                      ↓
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </BottomSheet>
  );
}
