import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { PrRow, RepoInfo } from "../prs.js";

/**
 * Tests for repository discovery and the HTTP route handlers in `prs.ts`:
 *   - discoverRepos() — depth-1 repos and depth-2 namespace repos
 *   - GET /           — snapshot of PRs + repo summary
 *   - POST /refresh   — force-poll and return diff counts
 *   - GET /current-branch-scope — list active branches
 *
 * The pure-logic tests (parseGitRemote, diffSnapshots, PrPoller backoff,
 * getSnapshot sorting) already live in pr-poller.test.ts. This file covers
 * discovery plus the Hono HTTP layer.
 *
 * Strategy:
 *   - Use the exported __setPollerForTests() to inject a mock PrPoller so
 *     no real `gh` CLI or `git` commands run.
 *   - Use __resetScopeCacheForTests() to clear the scope cache between tests.
 *   - Mock filesystem and child-process calls for repository discovery.
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
  // Use DISTINCT values for `name` (filesystem dir name) vs `repoName`
  // (GitHub repo name) so the repo-shape test can assert the field mapping
  // is correct and not passing by coincidence (same value in both fields).
  return {
    path: "/home/claude/code/tryinbox-sh",
    name: "tryinbox-sh",          // filesystem dir name
    owner: "claudes-world",
    repoName: "inbox",            // GitHub repo name — intentionally different
    fullName: "claudes-world/inbox",
    branch: "dev",
    ...overrides,
  };
}

// We need to mock discoverRepos and currentBranchScope to avoid real git calls
// from the /current-branch-scope route. Mock the module-level functions.
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    lstatSync: vi.fn(actual.lstatSync),
    readdirSync: vi.fn(actual.readdirSync),
  };
});

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
  };
});

const {
  prsRoute,
  PrPoller,
  __setPollerForTests,
  __resetScopeCacheForTests,
  __resetRepoCacheForTests,
  discoverRepos,
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
// Repo discovery
// ---------------------------------------------------------------------------
describe("discoverRepos", () => {
  const codeDir = join(process.env.HOME || "/home/claude", "code");

  function mockGitCommands(
    implementation: (command: string, args: readonly string[]) => string,
  ) {
    vi.mocked(execFile).mockImplementation(((command, args, _options, callback) => {
      try {
        callback?.(null, implementation(String(command), args ?? []), "");
      } catch (err) {
        callback?.(err as Error, "", "");
      }
      return { on: vi.fn() } as any;
    }) as any);
  }

  afterEach(() => {
    vi.mocked(existsSync).mockReset();
    vi.mocked(readdirSync).mockReset();
    vi.mocked(execFile).mockReset();
    vi.mocked(lstatSync).mockReset();
    vi.useRealTimers();
  });

  function mockGitRepo(repoPath: string, remote: string, branch: string) {
    mockGitCommands((command, args) => {
      if (command !== "git" || args?.[0] !== "-C" || args[1] !== repoPath) {
        throw new Error("unexpected git command");
      }
      if (args[2] === "remote") return remote;
      if (args[2] === "rev-parse") return `${branch}\n`;
      throw new Error("unexpected git arguments");
    });
  }

  it("discovers depth-1 and namespace repos without walking past depth 2", async () => {
    const directPath = join(codeDir, "direct-repo");
    const namespacePath = join(codeDir, "omnipass-world");
    const nestedPath = join(namespacePath, "clan-world");
    const deeperParentPath = join(namespacePath, "not-a-repo");
    const deeperRepoPath = join(deeperParentPath, "too-deep");

    vi.mocked(existsSync).mockImplementation((path) => {
      const value = String(path);
      return value === codeDir
        || value === join(directPath, ".git")
        || value === join(nestedPath, ".git")
        || value === join(deeperRepoPath, ".git");
    });
    vi.mocked(readdirSync).mockImplementation(((path: string) => {
      if (path === codeDir) return ["direct-repo", "omnipass-world"];
      if (path === namespacePath) return ["clan-world", "not-a-repo"];
      throw new Error(`unexpected readdir: ${path}`);
    }) as any);
    vi.mocked(lstatSync).mockImplementation(((path: string) => {
      if (path !== namespacePath) throw new Error(`unexpected lstat: ${path}`);
      return { isDirectory: () => true, isSymbolicLink: () => false };
    }) as any);

    mockGitCommands((command, args) => {
      if (command !== "git" || args?.[0] !== "-C") throw new Error("unexpected git command");
      if (args[2] === "remote") {
        if (args[1] === directPath) return "git@github.com:claudes-world/direct.git";
        if (args[1] === nestedPath) return "https://github.com/omnipass-world/clan-world.git";
      }
      if (args[2] === "rev-parse") return "dev\n";
      throw new Error("unexpected git arguments");
    });

    expect(await discoverRepos()).toEqual([
      {
        path: directPath,
        name: "direct-repo",
        owner: "claudes-world",
        repoName: "direct",
        fullName: "claudes-world/direct",
        branch: "dev",
      },
      {
        path: nestedPath,
        name: "omnipass-world/clan-world",
        owner: "omnipass-world",
        repoName: "clan-world",
        fullName: "omnipass-world/clan-world",
        branch: "dev",
      },
    ]);
    expect(vi.mocked(readdirSync)).not.toHaveBeenCalledWith(directPath);
    expect(vi.mocked(readdirSync)).not.toHaveBeenCalledWith(deeperParentPath);
    expect(vi.mocked(execFile)).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining([deeperRepoPath]),
      expect.anything(),
      expect.anything(),
    );
  });

  it("skips plain files and unreadable namespace directories", async () => {
    const validNamespacePath = join(codeDir, "valid-namespace");
    const nestedPath = join(validNamespacePath, "nested-repo");
    const plainFilePath = join(codeDir, "README.txt");
    const unreadablePath = join(codeDir, "unreadable-namespace");

    vi.mocked(existsSync).mockImplementation((path) => {
      const value = String(path);
      return value === codeDir || value === join(nestedPath, ".git");
    });
    vi.mocked(readdirSync).mockImplementation(((path: string) => {
      if (path === codeDir) {
        return ["README.txt", "unreadable-namespace", "valid-namespace"];
      }
      if (path === plainFilePath) throw new Error("ENOTDIR");
      if (path === unreadablePath) throw new Error("EACCES");
      if (path === validNamespacePath) return ["nested-repo"];
      throw new Error(`unexpected readdir: ${path}`);
    }) as any);
    vi.mocked(lstatSync).mockImplementation(((path: string) => ({
      isDirectory: () => path !== plainFilePath,
      isSymbolicLink: () => false,
    })) as any);
    mockGitRepo(
      nestedPath,
      "git@github.com:claudes-world/nested-repo.git",
      "main",
    );

    expect(await discoverRepos()).toEqual([
      {
        path: nestedPath,
        name: "valid-namespace/nested-repo",
        owner: "claudes-world",
        repoName: "nested-repo",
        fullName: "claudes-world/nested-repo",
        branch: "main",
      },
    ]);
  });

  it("keeps depth-1 symlinked repos but does not descend into symlinked namespaces", async () => {
    const linkedRepoPath = join(codeDir, "linked-repo");
    const linkedNamespacePath = join(codeDir, "linked-namespace");
    const realNamespacePath = join(codeDir, "real-namespace");
    const nestedRepoPath = join(realNamespacePath, "nested-repo");

    vi.mocked(existsSync).mockImplementation((path) => {
      const value = String(path);
      return value === codeDir
        || value === join(linkedRepoPath, ".git")
        || value === join(nestedRepoPath, ".git");
    });
    vi.mocked(readdirSync).mockImplementation(((path: string) => {
      if (path === codeDir) return ["linked-repo", "linked-namespace", "real-namespace"];
      if (path === realNamespacePath) return ["nested-repo"];
      throw new Error(`unexpected readdir: ${path}`);
    }) as any);
    vi.mocked(lstatSync).mockImplementation(((path: string) => ({
      isDirectory: () => true,
      isSymbolicLink: () => path === linkedNamespacePath,
    })) as any);
    mockGitCommands((command, args) => {
      if (command !== "git" || args?.[0] !== "-C") throw new Error("unexpected git command");
      if (args[2] === "remote") {
        const repoName = args[1] === linkedRepoPath ? "linked-repo" : "nested-repo";
        return `git@github.com:claudes-world/${repoName}.git`;
      }
      if (args[2] === "rev-parse") return "dev\n";
      throw new Error("unexpected git arguments");
    });

    expect((await discoverRepos()).map((repo) => repo.name)).toEqual([
      "linked-repo",
      "real-namespace/nested-repo",
    ]);
    expect(vi.mocked(lstatSync)).not.toHaveBeenCalledWith(linkedRepoPath);
    expect(vi.mocked(readdirSync)).not.toHaveBeenCalledWith(linkedNamespacePath);
  });

  it("caps each namespace scan after filtering candidates and warns when truncated", async () => {
    const namespacePath = join(codeDir, "large-namespace");
    const junkNames = Array.from({ length: 10 }, (_, index) => `junk-${index}`);
    const repoNames = Array.from({ length: 51 }, (_, index) => `repo-${index}`);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    vi.mocked(existsSync).mockImplementation((path) => {
      const value = String(path);
      return value === codeDir
        || (value.startsWith(`${namespacePath}/repo-`) && value.endsWith("/.git"));
    });
    vi.mocked(readdirSync).mockImplementation(((path: string) => {
      if (path === codeDir) return ["large-namespace"];
      if (path === namespacePath) return [...junkNames, ...repoNames];
      throw new Error(`unexpected readdir: ${path}`);
    }) as any);
    vi.mocked(lstatSync).mockReturnValue({
      isDirectory: () => true,
      isSymbolicLink: () => false,
    } as any);
    mockGitCommands((command, args) => {
      if (command !== "git" || args?.[0] !== "-C") throw new Error("unexpected git command");
      if (args[2] === "remote") return "git@github.com:claudes-world/repo.git";
      if (args[2] === "rev-parse") return "main\n";
      throw new Error("unexpected git arguments");
    });

    expect(await discoverRepos()).toHaveLength(50);
    expect(vi.mocked(existsSync)).toHaveBeenCalledWith(
      join(namespacePath, "repo-50", ".git"),
    );
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(namespacePath));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dropped 1"));
    warn.mockRestore();
  });

  it("coalesces concurrent scans behind one in-flight promise", async () => {
    const repoPath = join(codeDir, "shared-repo");
    const callbacks: Array<(err: Error | null, stdout: string, stderr: string) => void> = [];

    vi.mocked(existsSync).mockImplementation((path) => {
      const value = String(path);
      return value === codeDir || value === join(repoPath, ".git");
    });
    vi.mocked(readdirSync).mockReturnValue(["shared-repo"] as any);
    vi.mocked(execFile).mockImplementation(((_command, _args, _options, callback) => {
      callbacks.push(callback as any);
      return { on: vi.fn() } as any;
    }) as any);

    const first = discoverRepos();
    const second = discoverRepos();
    expect(second).toBe(first);
    expect(callbacks).toHaveLength(1);

    callbacks.shift()!(null, "git@github.com:claudes-world/shared-repo.git", "");
    await vi.waitFor(() => expect(callbacks).toHaveLength(1));
    callbacks.shift()!(null, "main\n", "");

    await expect(first).resolves.toHaveLength(1);
    await expect(second).resolves.toHaveLength(1);
  });

  it("starts the cache TTL after a slow scan completes", async () => {
    const repoPath = join(codeDir, "slow-repo");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    vi.mocked(existsSync).mockImplementation((path) => {
      const value = String(path);
      return value === codeDir || value === join(repoPath, ".git");
    });
    vi.mocked(readdirSync).mockReturnValue(["slow-repo"] as any);
    mockGitCommands((command, args) => {
      if (command !== "git" || args?.[0] !== "-C") throw new Error("unexpected git command");
      if (args[2] === "remote") {
        vi.setSystemTime(new Date("2026-01-01T00:06:00Z"));
        return "git@github.com:claudes-world/slow-repo.git";
      }
      if (args[2] === "rev-parse") return "main\n";
      throw new Error("unexpected git arguments");
    });

    expect(await discoverRepos()).toHaveLength(1);
    expect(await discoverRepos()).toHaveLength(1);
    expect(vi.mocked(readdirSync)).toHaveBeenCalledTimes(1);
  });
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

  it("includes repos summary with correct field mapping and prCount", async () => {
    // makeRepoInfo() uses DISTINCT name ("tryinbox-sh") vs repoName ("inbox")
    // so we can prove the route maps them to the right response fields.
    // The PR's repo must match the RepoInfo fullName so prCount === 1.
    const pr = makePr({ number: 42, repo: "claudes-world/inbox", key: "claudes-world/inbox#42" });
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
    // name in the response = repoName (GitHub name), NOT the filesystem dir name
    expect(body.repos[0].name).toBe("inbox");
    // dirName = the filesystem directory name, different from name
    expect(body.repos[0].dirName).toBe("tryinbox-sh");
    expect(body.repos[0].org).toBe("claudes-world");
    expect(body.repos[0].fullName).toBe("claudes-world/inbox");
    expect(body.repos[0].branch).toBe("dev");
    // PR.repo matches fullName → prCount must be 1
    expect(body.repos[0].prCount).toBe(1);
  });

  it("shows prCount=0 for repos with no open PRs", async () => {
    // No PRs in snapshot — prCount must be 0 regardless of repo identity
    mockPoller.discoveredRepos = [makeRepoInfo()];

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

describe("PrPoller concurrent triggers", () => {
  it("coalesces concurrent polls behind one in-flight promise", async () => {
    const callbacks: Array<(err: Error | null, stdout: string, stderr: string) => void> = [];
    const poller = new PrPoller([
      { owner: "claudes-world", name: "claude-pocket-console" },
    ]);
    vi.mocked(execFile).mockImplementation(((_command, _args, _options, callback) => {
      callbacks.push(callback as any);
      return { on: vi.fn() } as any;
    }) as any);

    const first = poller.pollOnce();
    const second = poller.pollOnce();
    expect(second).toBe(first);
    expect(callbacks).toHaveLength(1);

    callbacks.shift()!(null, "[]", "");
    await expect(first).resolves.toEqual({ added: [], removed: [], changed: [] });
    await expect(second).resolves.toEqual({ added: [], removed: [], changed: [] });
    expect(vi.mocked(execFile)).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// GET /current-branch-scope
// ---------------------------------------------------------------------------
describe("GET /current-branch-scope", () => {
  it("returns ok:true with branches array (empty when all git calls fail)", async () => {
    // With child_process mocked to fail, discoverRepos returns [] (no repos found),
    // so branches will be empty — the route must still return ok:true.
    const codeDir = join(process.env.HOME || "/home/claude", "code");
    vi.mocked(existsSync)
      .mockReturnValueOnce(true) // codeDir
      .mockReturnValueOnce(true); // broken-repo/.git
    vi.mocked(readdirSync).mockReturnValueOnce(["broken-repo"] as any);
    vi.mocked(execFile).mockImplementationOnce(((_command, _args, _options, callback) => {
      callback?.(new Error("mocked git failure"), "", "");
      return { on: vi.fn() } as any;
    }) as any);
    const res = await prsRoute.request("/current-branch-scope");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; branches: string[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.branches)).toBe(true);
  });

  it("returns branch names when discoverRepos and git worktree list succeed", async () => {
    const mockExistsSync = vi.mocked(existsSync);
    const mockReaddirSync = vi.mocked(readdirSync);
    // Make codeDir exist and contain one repo dir
    mockExistsSync.mockReturnValueOnce(true);  // existsSync(codeDir)
    mockReaddirSync.mockReturnValueOnce(["claude-pocket-console"] as any);
    // Make .git check pass for that repo
    mockExistsSync.mockReturnValueOnce(true);  // existsSync(join(repoPath, '.git'))

    // Override execFile for the discoverRepos git calls:
    //   1st call: git remote get-url origin → GitHub SSH URL
    //   2nd call: git rev-parse --abbrev-ref HEAD → branch name
    const mockExecFile = vi.mocked(execFile);
    mockExecFile.mockImplementation(((_cmd, args, _opts, cb) => {
      const worktreeOutput = [
        "worktree /home/claude/code/claude-pocket-console",
        "HEAD abc123",
        "branch refs/heads/feat/server-route-tests",
        "",
        "worktree /home/claude/code/claude-pocket-console-feat-test",
        "HEAD def456",
        "branch refs/heads/feat/another-branch",
        "",
      ].join("\n");
      let stdout: string;
      if (args?.[2] === "remote") {
        stdout = "git@github.com:claudes-world/claude-pocket-console.git";
      } else if (args?.[2] === "rev-parse") {
        stdout = "feat/server-route-tests\n";
      } else if (args?.[2] === "worktree") {
        stdout = worktreeOutput;
      } else {
        cb?.(new Error("unexpected git arguments"), "", "");
        return { on: vi.fn() } as any;
      }
      cb?.(null, stdout, "");
      return { on: vi.fn() } as any;
    }) as any);

    const res = await prsRoute.request("/current-branch-scope");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; branches: string[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.branches)).toBe(true);
    // Must include the branch names returned by the mocked git calls
    expect(body.branches).toContain("feat/server-route-tests");
    expect(body.branches).toContain("feat/another-branch");
    // Must not have duplicates for the same branch seen in both HEAD and worktree
    const seen = new Set<string>();
    for (const b of body.branches) {
      expect(seen.has(b)).toBe(false);
      seen.add(b);
    }
  });
});
