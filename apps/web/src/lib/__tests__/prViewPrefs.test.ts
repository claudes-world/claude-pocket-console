import { beforeEach, describe, expect, it } from "vitest";
import {
  PR_VIEW_PREFS_KEY,
  applyOrder,
  filterHidden,
  getRepoOrder,
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

  it("treats a malformed saved order as empty", () => {
    expect(applyOrder(["beta", "alpha"], "constructor" as unknown as string[]))
      .toEqual(["alpha", "beta"]);
  });

  it("ignores inherited repo-order properties for adversarial org names", () => {
    expect(getRepoOrder(emptyPrefs, "constructor")).toEqual([]);
    expect(getRepoOrder(emptyPrefs, "toString")).toEqual([]);
    expect(getRepoOrder(emptyPrefs, "__proto__")).toEqual([]);
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

  it("filters __proto__ while loading repo orders", () => {
    localStorage.setItem(
      PR_VIEW_PREFS_KEY,
      '{"repoOrder":{"__proto__":["__proto__/repo"],"constructor":["constructor/repo"]}}',
    );

    const prefs = loadPrViewPrefs();

    expect(Object.keys(prefs.repoOrder)).toEqual(["constructor"]);
    expect(getRepoOrder(prefs, "__proto__")).toEqual([]);
    expect(getRepoOrder(prefs, "constructor")).toEqual(["constructor/repo"]);
  });
});
