export interface PrViewPrefs {
  orgOrder: string[];
  repoOrder: Record<string, string[]>;
  hiddenOrgs: string[];
  hiddenRepos: string[];
  collapsedRepos: string[];
}

export const PR_VIEW_PREFS_KEY = "cpc-pr-view-prefs";

const DEFAULT_PREFS: PrViewPrefs = {
  orgOrder: [],
  repoOrder: {},
  hiddenOrgs: [],
  hiddenRepos: [],
  collapsedRepos: [],
};

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/** Load persisted PR view preferences, safely ignoring malformed or partial data. */
export function loadPrViewPrefs(): PrViewPrefs {
  try {
    const saved = localStorage.getItem(PR_VIEW_PREFS_KEY);
    if (!saved) return { ...DEFAULT_PREFS, repoOrder: {} };

    const parsed: unknown = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ...DEFAULT_PREFS, repoOrder: {} };
    }

    const value = parsed as Record<string, unknown>;
    const repoOrder: Record<string, string[]> = {};
    if (value.repoOrder && typeof value.repoOrder === "object" && !Array.isArray(value.repoOrder)) {
      for (const [org, repos] of Object.entries(value.repoOrder as Record<string, unknown>)) {
        repoOrder[org] = stringArray(repos);
      }
    }

    return {
      orgOrder: stringArray(value.orgOrder),
      repoOrder,
      hiddenOrgs: stringArray(value.hiddenOrgs),
      hiddenRepos: stringArray(value.hiddenRepos),
      collapsedRepos: stringArray(value.collapsedRepos),
    };
  } catch {
    return { ...DEFAULT_PREFS, repoOrder: {} };
  }
}

/** Persist the complete, versionless PR view preferences object. */
export function savePrViewPrefs(prefs: PrViewPrefs): void {
  try {
    localStorage.setItem(PR_VIEW_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Storage can be unavailable in private/restricted WebViews.
  }
}

/** Apply saved order first, then append unknown/new values alphabetically. */
export function applyOrder(items: string[], savedOrder: string[]): string[] {
  const available = new Set(items);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const item of savedOrder) {
    if (available.has(item) && !seen.has(item)) {
      ordered.push(item);
      seen.add(item);
    }
  }

  ordered.push(...items.filter((item) => !seen.has(item)).sort((a, b) => a.localeCompare(b)));
  return ordered;
}

/** Remove hidden orgs/repos and omit orgs left empty by repo filtering. */
export function filterHidden<T>(
  grouped: Record<string, Record<string, T>>,
  prefs: Pick<PrViewPrefs, "hiddenOrgs" | "hiddenRepos">,
): Record<string, Record<string, T>> {
  const hiddenOrgs = new Set(prefs.hiddenOrgs);
  const hiddenRepos = new Set(prefs.hiddenRepos);
  const visible = Object.create(null) as Record<string, Record<string, T>>;

  for (const [org, repoMap] of Object.entries(grouped)) {
    if (hiddenOrgs.has(org)) continue;
    const visibleRepos = Object.create(null) as Record<string, T>;
    for (const [repo, value] of Object.entries(repoMap)) {
      if (!hiddenRepos.has(repo)) visibleRepos[repo] = value;
    }
    if (Object.keys(visibleRepos).length > 0) visible[org] = visibleRepos;
  }

  return visible;
}
