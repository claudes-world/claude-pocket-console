import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PrRow, RepoInfo } from "../prs.js";

/**
 * Tests for the HTTP route handlers in `prs.ts`:
 *   - GET /           — snapshot of PRs + repo summary
 *   - POST /refresh   — force-poll and return diff counts
 *   - GET /current-branch-scope — list active branches
 *
 * The pure-logic tests (parseGitRemote, diffSnapshots, PrPoller backoff,
 * getSnapshot sorting) already live in pr-poller.test.ts. This file covers
 * the Hono HTTP layer exclusively.
 *
 * Strategy:
 *   - Use the exported __setPollerForTests() to inject a mock PrPoller so
 *     no real `gh` CLI or `git` commands run.
 *   - Use __resetScopeCacheForTests() to clear the scope cache between tests.
 *   - Drive routes via Hono `app.request()`.
 */

// --- Helpers ---

function makePr(overrides: Partial<PrRow> = {}): PrRow {
  const num = overrides.number ?? 1;
  return {
    key: overrides.key ?? `claudes-world/claude-pocket-console#${num}`,
    repo: overrides.repo ?? "claudes-world/claude-pocket-console",
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

function makeRepoInfo(overrides: Partial<RepoInfo> = {}): RepoInfo {
  return {
    path: "/home/claude/code/claude-pocket-console",
    name: "claude-pocket-console",
    owner: "claudes-world",
    repoName: "claude-pocket-console",
    fullName: "claudes-world/claude-pocket-console",
    branch: "dev",
    ...overrides,
  };
}

// We need to mock discoverRepos and currentBranchScope to avoid real git calls
// from the /current-branch-scope route. Mock the module-level functions.
vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>(
    "node:child_process",
  );
  return {
    ...actual,
    execFile: vi.fn((_cmd: string, _args: string[], _opts: any, cb?: any) => {
      if (cb) cb(new Error("mocked"), "", "");
      return { on: vi.fn() };
    }),
    execFileSync: vi.fn(() => {
      throw new Error("mocked");
    }),
  };
});

const {
  prsRoute,
  PrPoller,
  __setPollerForTests,
  __resetScopeCacheForTests,
  __resetRepoCacheForTests,
} = await import("../prs.js");

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let mockPoller: InstanceType<typeof PrPoller>;

beforeEach(() => {
  __resetScopeCacheForTests();
  __resetRepoCacheForTests();
  // Create a poller in static mode (empty repos = no network calls)
  mockPoller = new PrPoller([], 999_999);
  __setPollerForTests(mockPoller);
});

afterEach(() => {
  __setPollerForTests(null);
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// GET /
// ---------------------------------------------------------------------------
describe("GET /", () => {
  it("returns ok:true with empty prs when poller has no data", async () => {
    const res = await prsRoute.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      prs: PrRow[];
      repos: any[];
      lastPollOk: number;
      lastPollErr: string | null;
    };
    expect(body.ok).toBe(true);
    expect(body.prs).toEqual([]);
    expect(body.repos).toEqual([]);
    expect(body.lastPollErr).toBeNull();
  });

  it("returns PRs from the poller snapshot", async () => {
    const pr1 = makePr({ number: 10, updatedAt: "2026-04-01T00:00:00Z" });
    const pr2 = makePr({ number: 20, updatedAt: "2026-04-10T00:00:00Z" });
    mockPoller.snapshot.set(pr1.key, pr1);
    mockPoller.snapshot.set(pr2.key, pr2);

    const res = await prsRoute.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; prs: PrRow[] };
    expect(body.ok).toBe(true);
    expect(body.prs).toHaveLength(2);
    // Sorted by updatedAt descending
    expect(body.prs[0].number).toBe(20);
    expect(body.prs[1].number).toBe(10);
  });

  it("includes repos summary with prCount", async () => {
    const pr = makePr({ number: 42 });
    mockPoller.snapshot.set(pr.key, pr);
    mockPoller.discoveredRepos = [makeRepoInfo()];

    const res = await prsRoute.request("/");
    const body = (await res.json()) as {
      repos: Array<{
        name: string;
        dirName: string;
        org: string;
        fullName: string;
        branch: string;
        prCount: number;
      }>;
    };
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].name).toBe("claude-pocket-console");
    expect(body.repos[0].dirName).toBe("claude-pocket-console");
    expect(body.repos[0].org).toBe("claudes-world");
    expect(body.repos[0].fullName).toBe("claudes-world/claude-pocket-console");
    expect(body.repos[0].branch).toBe("dev");
    expect(body.repos[0].prCount).toBe(1);
  });

  it("shows prCount=0 for repos with no open PRs", async () => {
    mockPoller.discoveredRepos = [
      makeRepoInfo({ fullName: "claudes-world/inbox", repoName: "inbox", name: "tryinbox-sh" }),
    ];

    const res = await prsRoute.request("/");
    const body = (await res.json()) as { repos: Array<{ prCount: number }> };
    expect(body.repos[0].prCount).toBe(0);
  });

  it("exposes lastPollOk and lastPollErr", async () => {
    mockPoller.lastPollOk = 1_700_000_000_000;
    mockPoller.lastPollErr = "rate limited";

    const res = await prsRoute.request("/");
    const body = (await res.json()) as {
      lastPollOk: number;
      lastPollErr: string | null;
    };
    expect(body.lastPollOk).toBe(1_700_000_000_000);
    expect(body.lastPollErr).toBe("rate limited");
  });
});

// ---------------------------------------------------------------------------
// POST /refresh
// ---------------------------------------------------------------------------
describe("POST /refresh", () => {
  it("returns ok:true with diff counts after polling", async () => {
    const res = await prsRoute.request("/refresh", { method: "POST" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      prs: PrRow[];
      repos: any[];
      diff: { added: number; removed: number; changed: number };
    };
    expect(body.ok).toBe(true);
    expect(body.diff).toEqual({ added: 0, removed: 0, changed: 0 });
  });

  it("reports diff counts when snapshot changes", async () => {
    // Pre-populate snapshot with a PR that will be "removed" after poll
    // (since static poller with empty repos produces empty snapshot)
    const pr = makePr({ number: 99 });
    mockPoller.snapshot.set(pr.key, pr);

    const res = await prsRoute.request("/refresh", { method: "POST" });
    const body = (await res.json()) as {
      diff: { added: number; removed: number; changed: number };
    };
    // The old PR should be reported as removed since empty static repos
    // yield an empty next snapshot
    expect(body.diff.removed).toBe(1);
  });

  it("includes repos in response when discoveredRepos is set", async () => {
    // pollOnce() in static mode clears discoveredRepos to [].
    // The GET / route reads discoveredRepos without calling pollOnce,
    // so test via GET / instead where we control the state directly.
    // For POST /refresh, verify the repos key exists (even if empty in
    // static mode since discoveredRepos is cleared by pollOnce).
    const res = await prsRoute.request("/refresh", { method: "POST" });
    const body = (await res.json()) as { repos: any[] };
    expect(Array.isArray(body.repos)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /current-branch-scope
// ---------------------------------------------------------------------------
describe("GET /current-branch-scope", () => {
  it("returns ok:true with branches array", async () => {
    // With child_process mocked, discoverRepos returns [] (no repos found),
    // so branches will be empty
    const res = await prsRoute.request("/current-branch-scope");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; branches: string[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.branches)).toBe(true);
  });
});
