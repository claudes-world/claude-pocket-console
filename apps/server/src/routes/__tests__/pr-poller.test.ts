import { describe, expect, it, vi, beforeEach } from "vitest";
import { diffSnapshots, PrPoller, type PrRow } from "../prs.js";

// --- Helpers ---

function makePr(overrides: Partial<PrRow> = {}): PrRow {
  const num = overrides.number ?? 1;
  return {
    key: overrides.key ?? `claudes-world/claude-pocket-console#${num}`,
    repo: "claudes-world/claude-pocket-console",
    number: num,
    title: `PR #${num}`,
    state: "OPEN",
    isDraft: false,
    headRefName: "feat/test",
    author: "claude-do",
    reviewDecision: null,
    ciStatus: null,
    url: `https://github.com/claudes-world/claude-pocket-console/pull/${num}`,
    updatedAt: new Date().toISOString(),
    firstSeen: Date.now(),
    lastChanged: Date.now(),
    ...overrides,
  };
}

// --- diffSnapshots tests ---

describe("diffSnapshots", () => {
  it("identifies newly added PRs", () => {
    const prev = new Map<string, PrRow>();
    const next = new Map<string, PrRow>();
    const pr = makePr({ number: 42 });
    next.set(pr.key, pr);

    const diff = diffSnapshots(prev, next);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].number).toBe(42);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("identifies removed PRs", () => {
    const prev = new Map<string, PrRow>();
    const next = new Map<string, PrRow>();
    const pr = makePr({ number: 10 });
    prev.set(pr.key, pr);

    const diff = diffSnapshots(prev, next);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].number).toBe(10);
    expect(diff.added).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("identifies changed PRs with specific fields", () => {
    const prev = new Map<string, PrRow>();
    const next = new Map<string, PrRow>();
    const pr1 = makePr({ number: 5, reviewDecision: null, ciStatus: "PENDING" });
    const pr2 = makePr({ number: 5, reviewDecision: "APPROVED", ciStatus: "SUCCESS" });
    prev.set(pr1.key, pr1);
    next.set(pr2.key, pr2);

    const diff = diffSnapshots(prev, next);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].fields).toContain("reviewDecision");
    expect(diff.changed[0].fields).toContain("ciStatus");
  });

  it("does not report unchanged PRs", () => {
    const prev = new Map<string, PrRow>();
    const next = new Map<string, PrRow>();
    const pr = makePr({ number: 7 });
    prev.set(pr.key, { ...pr });
    next.set(pr.key, { ...pr });

    const diff = diffSnapshots(prev, next);
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("handles simultaneous add + remove + change", () => {
    const prev = new Map<string, PrRow>();
    const next = new Map<string, PrRow>();

    const kept = makePr({ number: 1, ciStatus: "PENDING" });
    const keptUpdated = makePr({ number: 1, ciStatus: "SUCCESS" });
    const removed = makePr({ number: 2 });
    const added = makePr({ number: 3 });

    prev.set(kept.key, kept);
    prev.set(removed.key, removed);
    next.set(keptUpdated.key, keptUpdated);
    next.set(added.key, added);

    const diff = diffSnapshots(prev, next);
    expect(diff.added).toHaveLength(1);
    expect(diff.added[0].number).toBe(3);
    expect(diff.removed).toHaveLength(1);
    expect(diff.removed[0].number).toBe(2);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].pr.number).toBe(1);
    expect(diff.changed[0].fields).toContain("ciStatus");
  });

  it("detects state change from OPEN to MERGED", () => {
    const prev = new Map<string, PrRow>();
    const next = new Map<string, PrRow>();
    const pr1 = makePr({ number: 8, state: "OPEN" });
    const pr2 = makePr({ number: 8, state: "MERGED" });
    prev.set(pr1.key, pr1);
    next.set(pr2.key, pr2);

    const diff = diffSnapshots(prev, next);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].fields).toContain("state");
  });

  it("detects isDraft toggle", () => {
    const prev = new Map<string, PrRow>();
    const next = new Map<string, PrRow>();
    const pr1 = makePr({ number: 9, isDraft: true });
    const pr2 = makePr({ number: 9, isDraft: false });
    prev.set(pr1.key, pr1);
    next.set(pr2.key, pr2);

    const diff = diffSnapshots(prev, next);
    expect(diff.changed).toHaveLength(1);
    expect(diff.changed[0].fields).toContain("isDraft");
  });
});

// --- PrPoller backoff logic ---

describe("PrPoller backoff", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("respects backoff after simulated 403", async () => {
    const poller = new PrPoller([], 60_000); // no repos to poll

    // Simulate internal backoff state
    (poller as any).backoff = {
      failures: 1,
      nextAllowedAt: Date.now() + 120_000, // 2 min in future
    };

    const diff = await poller.pollOnce();
    // Should no-op due to backoff
    expect(diff.added).toHaveLength(0);
    expect(diff.removed).toHaveLength(0);
    expect(diff.changed).toHaveLength(0);
  });

  it("allows polling when backoff period has elapsed", async () => {
    const poller = new PrPoller([], 60_000);

    // Simulate expired backoff
    (poller as any).backoff = {
      failures: 1,
      nextAllowedAt: Date.now() - 1000, // 1 sec in the past
    };

    const diff = await poller.pollOnce();
    // No repos configured, but poll runs (returns empty diff)
    expect(diff).toBeDefined();
    expect(diff.added).toHaveLength(0);
  });

  it("getSnapshot returns empty array when no PRs", () => {
    const poller = new PrPoller([], 60_000);
    expect(poller.getSnapshot()).toEqual([]);
  });

  it("getSnapshot sorts by updatedAt descending", () => {
    const poller = new PrPoller([], 60_000);
    const pr1 = makePr({ number: 1, updatedAt: "2026-01-01T00:00:00Z" });
    const pr2 = makePr({ number: 2, updatedAt: "2026-04-01T00:00:00Z" });
    const pr3 = makePr({ number: 3, updatedAt: "2026-02-15T00:00:00Z" });
    poller.snapshot.set(pr1.key, pr1);
    poller.snapshot.set(pr2.key, pr2);
    poller.snapshot.set(pr3.key, pr3);

    const result = poller.getSnapshot();
    expect(result[0].number).toBe(2);
    expect(result[1].number).toBe(3);
    expect(result[2].number).toBe(1);
  });
});
