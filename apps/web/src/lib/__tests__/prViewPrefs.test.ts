import { beforeEach, describe, expect, it } from "vitest";
import {
  PR_VIEW_PREFS_KEY,
  applyOrder,
  filterHidden,
  loadPrViewPrefs,
  savePrViewPrefs,
  type PrViewPrefs,
} from "../prViewPrefs";

const emptyPrefs: PrViewPrefs = {
  orgOrder: [],
  repoOrder: {},
  hiddenOrgs: [],
  hiddenRepos: [],
  collapsedRepos: [],
};

beforeEach(() => {
  localStorage.clear();
});

describe("PR view preference helpers", () => {
  it("applies saved values first and appends unknown values alphabetically", () => {
    expect(applyOrder(["gamma", "alpha", "delta", "beta"], ["beta", "missing", "beta"]))
      .toEqual(["beta", "alpha", "delta", "gamma"]);
  });

  it("filters hidden repos and orgs, including newly empty orgs", () => {
    const grouped = {
      alpha: { "alpha/one": 1, "alpha/two": 2 },
      beta: { "beta/one": 3 },
      gamma: { "gamma/one": 4 },
    };

    const visible = filterHidden(grouped, {
      hiddenOrgs: ["beta"],
      hiddenRepos: ["alpha/two", "gamma/one"],
    });

    expect(Object.keys(visible)).toEqual(["alpha"]);
    expect(Object.keys(visible.alpha)).toEqual(["alpha/one"]);
  });

  it("round-trips the versionless preferences object", () => {
    const prefs: PrViewPrefs = {
      ...emptyPrefs,
      orgOrder: ["beta", "alpha"],
      repoOrder: { alpha: ["alpha/two", "alpha/one"] },
      hiddenRepos: ["alpha/three"],
      collapsedRepos: ["alpha/one"],
    };

    savePrViewPrefs(prefs);

    expect(JSON.parse(localStorage.getItem(PR_VIEW_PREFS_KEY) ?? "null")).toEqual(prefs);
    expect(loadPrViewPrefs()).toEqual(prefs);
  });

  it("tolerates malformed and partially invalid JSON", () => {
    localStorage.setItem(PR_VIEW_PREFS_KEY, "{not-json");
    expect(loadPrViewPrefs()).toEqual(emptyPrefs);

    localStorage.setItem(PR_VIEW_PREFS_KEY, JSON.stringify({
      orgOrder: "wrong",
      repoOrder: { alpha: ["alpha/one", 12], beta: "wrong" },
      hiddenOrgs: ["alpha", null],
      hiddenRepos: null,
      collapsedRepos: ["alpha/one", false],
    }));

    expect(loadPrViewPrefs()).toEqual({
      orgOrder: [],
      repoOrder: { alpha: ["alpha/one"], beta: [] },
      hiddenOrgs: ["alpha"],
      hiddenRepos: [],
      collapsedRepos: ["alpha/one"],
    });
  });
});
