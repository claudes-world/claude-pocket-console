import { describe, expect, it } from "vitest";
import {
  getBacklinks,
  getOutgoingEdges,
  groupVaultPages,
  mapVaultFindings,
  parseVaultIndex,
  type VaultIndex,
} from "../vault-explorer";

function fixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    index_schema_version: 1,
    pages: [
      { path: "index.md", kind: "index", title: "Home" },
      { path: "wiki/concepts/agency.md", kind: "concept", title: "Agency" },
    ],
    edges: [
      { source: "index.md", target: "wiki/concepts/agency", label: "Agency", resolved: true, line: 4 },
    ],
    findings: {
      broken: [],
      ambiguous: [],
      orphan: [],
      unreferenced_raw: [],
      receipt: [],
    },
    counts: { broken: 0, ambiguous: 0, orphan: 0, unreferenced_raw: 0, receipt: 0 },
    status: "clean",
    generated_at: "2026-07-14T12:00:00Z",
    vault: "sample-vault",
    ...overrides,
  };
}

function parsedIndex(value: Record<string, unknown>): VaultIndex {
  const result = parseVaultIndex(value);
  if (!result.ok) throw new Error(result.message);
  return result.data;
}

describe("parseVaultIndex", () => {
  it("accepts a version 1 link-check export", () => {
    const result = parseVaultIndex(JSON.stringify(fixture()));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.vault).toBe("sample-vault");
  });

  it("rejects unsupported schema versions with a compatibility message", () => {
    const result = parseVaultIndex(fixture({ index_schema_version: 2 }));
    expect(result).toMatchObject({
      ok: false,
      code: "unsupported-version",
      message: "Unsupported index schema version 2. This viewer supports version 1.",
    });
  });

  it("distinguishes malformed JSON from an invalid contract", () => {
    expect(parseVaultIndex("{")).toMatchObject({ ok: false, code: "invalid-json" });
    expect(parseVaultIndex(fixture({ pages: "not-an-array" }))).toMatchObject({
      ok: false,
      code: "invalid-contract",
    });
  });
});

describe("vault view model", () => {
  it("groups top-level layers and nested wiki folders", () => {
    const index = parsedIndex(fixture({
      pages: [
        { path: "index.md", kind: "index", title: "Home" },
        { path: "raw/inbox.md", kind: "raw", title: "Inbox" },
        { path: "wiki/concepts/c.md", kind: "concept", title: "Concept" },
        { path: "wiki/entities/e.md", kind: "entity", title: "Entity" },
        { path: "wiki/summaries/s.md", kind: "summary", title: "Summary" },
        { path: "doctrine/rule.md", kind: "doctrine", title: "Rule" },
        { path: "armory/tool.md", kind: "raw", title: "Tool" },
        { path: "notes/misc.md", kind: "raw", title: "Misc" },
      ],
    }));

    const groups = groupVaultPages(index.pages);
    expect(groups.index.map((page) => page.path)).toEqual(["index.md"]);
    expect(groups.raw.map((page) => page.path)).toEqual(["raw/inbox.md"]);
    expect(groups.wiki.concepts).toHaveLength(1);
    expect(groups.wiki.entities).toHaveLength(1);
    expect(groups.wiki.summaries).toHaveLength(1);
    expect(groups.doctrine).toHaveLength(1);
    expect(groups.armory).toHaveLength(1);
    expect(groups.other.map((page) => page.path)).toEqual(["notes/misc.md"]);
  });

  it("derives outgoing edges and backlinks across .md and extensionless paths", () => {
    const index = parsedIndex(fixture());
    const [home, agency] = index.pages;
    expect(getOutgoingEdges(home, index.edges)).toHaveLength(1);
    expect(getBacklinks(agency, index.edges)).toEqual(index.edges);
    expect(getBacklinks(home, index.edges)).toHaveLength(0);
  });

  it("maps all finding categories to pages and preserves optional lines", () => {
    const finding = (category: string, path: string, line?: number) => ({
      category,
      path,
      reason: `${category} reason`,
      ...(line ? { line } : {}),
    });
    const findings = {
      broken: [finding("broken", "index.md", 8)],
      ambiguous: [finding("ambiguous", "wiki/concepts/agency")],
      orphan: [finding("orphan", "missing.md", 3)],
      unreferenced_raw: [finding("unreferenced_raw", "index.md")],
      receipt: [finding("receipt", "wiki/concepts/agency.md", 12)],
    };
    const index = parsedIndex(fixture({
      findings,
      counts: { broken: 1, ambiguous: 1, orphan: 1, unreferenced_raw: 1, receipt: 1 },
      status: "findings",
    }));

    const mapped = mapVaultFindings(index);
    expect(mapped.broken[0]).toMatchObject({ page: { path: "index.md" }, finding: { line: 8 } });
    expect(mapped.ambiguous[0].page?.path).toBe("wiki/concepts/agency.md");
    expect(mapped.orphan[0].page).toBeNull();
    expect(mapped.unreferenced_raw[0].finding.category).toBe("unreferenced_raw");
    expect(mapped.receipt[0]).toMatchObject({ page: { path: "wiki/concepts/agency.md" } });
  });
});
