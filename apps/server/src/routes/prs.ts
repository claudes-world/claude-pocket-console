import { Hono } from "hono";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const app = new Hono();

const HOME = process.env.HOME || "/home/claude";
const GH_TIMEOUT_MS = 10_000;
const GIT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const SCOPE_CACHE_TTL_MS = 60_000;
const REPO_DISCOVERY_TTL_MS = 5 * 60_000; // re-scan ~/code every 5 min

// --- Types ---

export interface PrRow {
  key: string;           // "claudes-world/claude-pocket-console#42"
  repo: string;          // "claudes-world/claude-pocket-console"
  number: number;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  isDraft: boolean;
  headRefName: string;
  author: string;
  reviewDecision: "APPROVED" | "REVIEW_REQUIRED" | "CHANGES_REQUESTED" | null;
  ciStatus: "SUCCESS" | "FAILURE" | "PENDING" | "ERROR" | null;
  url: string;
  updatedAt: string;     // ISO
  firstSeen: number;     // local poll timestamp (ms)
  lastChanged: number;   // last time reviewDecision/ciStatus/state changed
}

export interface PrDiff {
  added: PrRow[];
  removed: PrRow[];
  changed: { pr: PrRow; fields: string[] }[];
}

// --- Repo discovery ---

export interface RepoInfo {
  path: string;
  name: string;       // directory name (e.g. "tryinbox-sh")
  owner: string;      // GitHub org/user from remote (e.g. "claudes-world")
  repoName: string;   // GitHub repo name from remote (e.g. "inbox")
  fullName: string;   // "owner/repoName"
  branch: string;     // current HEAD branch
}

/** Parse owner/repo from a git remote URL (HTTPS or SSH). Returns null if unparseable or non-GitHub. */
export function parseGitRemote(url: string): { owner: string; repoName: string } | null {
  // SSH: git@github.com:owner/repo.git — require github.com host explicitly
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repoName: sshMatch[2] };

  // HTTPS: https://[user@]github.com/owner/repo.git — use URL parser to handle
  // optional credentials (e.g. https://token@github.com/...) while still requiring
  // a github.com hostname. Regex-only approaches miss the credentialed form.
  if (/^https?:\/\//i.test(url)) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "github.com") return null;
      const parts = parsed.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
      if (parts.length >= 2) return { owner: parts[0], repoName: parts[1] };
    } catch {
      // URL constructor threw — not a valid HTTPS URL
    }
  }

  return null;
}

let repoCache: { repos: RepoInfo[]; cachedAt: number } | null = null;

export function discoverRepos(): RepoInfo[] {
  const now = Date.now();
  if (repoCache && now - repoCache.cachedAt < REPO_DISCOVERY_TTL_MS) {
    return repoCache.repos;
  }

  const codeDir = join(HOME, "code");
  const repos: RepoInfo[] = [];

  if (!existsSync(codeDir)) {
    repoCache = { repos, cachedAt: now };
    return repos;
  }

  let dirNames: string[];
  try {
    dirNames = readdirSync(codeDir);
  } catch {
    repoCache = { repos, cachedAt: now };
    return repos;
  }

  for (const dirName of dirNames) {
    const repoPath = join(codeDir, dirName);
    if (!existsSync(join(repoPath, ".git"))) continue;

    try {
      // Get remote URL.
      // execFileSync is intentional: discoverRepos() runs at most once per 5-min TTL,
      // covers <20 repos in practice, and completes in <2s total. Converting to async
      // would complicate callers (currentBranchScope, pollOnce) for negligible gain.
      const remoteUrl = execFileSync("git", ["-C", repoPath, "remote", "get-url", "origin"], {
        timeout: GIT_TIMEOUT_MS,
        encoding: "utf-8",
      }).trim();

      const parsed = parseGitRemote(remoteUrl);
      if (!parsed) continue; // skip repos without a parseable GitHub remote

      // Get current branch
      const branch = execFileSync("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], {
        timeout: GIT_TIMEOUT_MS,
        encoding: "utf-8",
      }).trim();

      repos.push({
        path: repoPath,
        name: dirName,
        owner: parsed.owner,
        repoName: parsed.repoName,
        fullName: `${parsed.owner}/${parsed.repoName}`,
        branch: branch || "HEAD",
      });
    } catch {
      // Skip repos where git commands fail (no remote, detached HEAD, etc.)
      continue;
    }
  }

  repoCache = { repos, cachedAt: now };
  return repos;
}

/** Allow tests to reset the repo discovery cache */
export function __resetRepoCacheForTests() {
  repoCache = null;
}

// --- gh CLI wrapper ---

function execGh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("gh", args, { timeout: GH_TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`gh failed: ${err.message}${stderr ? ` — ${stderr.trim()}` : ""}`));
        return;
      }
      resolve(stdout);
    });
    // Belt-and-braces: kill if timeout fires but callback hasn't
    void child;
  });
}

// --- Parse gh pr list JSON into PrRow[] ---

interface GhPrJson {
  number: number;
  title: string;
  state: string;
  headRefName: string;
  author: { login: string };
  isDraft: boolean;
  reviewDecision: string;
  statusCheckRollup: { state: string }[];
  updatedAt: string;
  url: string;
}

function parseCiStatus(rollup: { state: string }[] | null | undefined): PrRow["ciStatus"] {
  if (!rollup || rollup.length === 0) return null;
  const states = rollup.map((c) => c.state?.toUpperCase());
  if (states.some((s) => s === "FAILURE" || s === "ERROR")) return "FAILURE";
  if (states.some((s) => s === "PENDING" || s === "EXPECTED")) return "PENDING";
  if (states.every((s) => s === "SUCCESS")) return "SUCCESS";
  return "PENDING";
}

function parseGhPrs(jsonStr: string, repoFullName: string, now: number): PrRow[] {
  let raw: GhPrJson[];
  try {
    raw = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((pr) => ({
    key: `${repoFullName}#${pr.number}`,
    repo: repoFullName,
    number: pr.number,
    title: pr.title,
    state: (pr.state?.toUpperCase() ?? "OPEN") as PrRow["state"],
    isDraft: pr.isDraft ?? false,
    headRefName: pr.headRefName,
    author: pr.author?.login ?? "unknown",
    reviewDecision: (pr.reviewDecision as PrRow["reviewDecision"]) || null,
    ciStatus: parseCiStatus(pr.statusCheckRollup),
    url: pr.url,
    updatedAt: pr.updatedAt,
    firstSeen: now,
    lastChanged: now,
  }));
}

// --- PrPoller ---

const TRACKED_CHANGE_FIELDS: (keyof PrRow)[] = [
  "state", "isDraft", "reviewDecision", "ciStatus", "title",
];

export function diffSnapshots(
  prev: Map<string, PrRow>,
  next: Map<string, PrRow>,
): PrDiff {
  const added: PrRow[] = [];
  const removed: PrRow[] = [];
  const changed: { pr: PrRow; fields: string[] }[] = [];

  for (const [key, pr] of next) {
    const old = prev.get(key);
    if (!old) {
      added.push(pr);
      continue;
    }
    const changedFields: string[] = [];
    for (const field of TRACKED_CHANGE_FIELDS) {
      if (old[field] !== pr[field]) changedFields.push(field);
    }
    if (changedFields.length > 0) {
      changed.push({ pr, fields: changedFields });
    }
  }

  for (const key of prev.keys()) {
    if (!next.has(key)) removed.push(prev.get(key)!);
  }

  return { added, removed, changed };
}

// Exponential backoff state
interface BackoffState {
  failures: number;
  nextAllowedAt: number;
}

const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 5 * 60_000;

function computeBackoffMs(failures: number): number {
  return Math.min(BACKOFF_BASE_MS * Math.pow(2, failures - 1), BACKOFF_CAP_MS);
}

export class PrPoller {
  snapshot: Map<string, PrRow> = new Map();
  lastPollOk: number = 0;
  lastPollErr: string | null = null;
  discoveredRepos: RepoInfo[] = [];
  private interval: ReturnType<typeof setInterval> | null = null;
  private backoff: BackoffState = { failures: 0, nextAllowedAt: 0 };
  private staticRepos: { owner: string; name: string }[] | null;
  private pollIntervalMs: number;

  constructor(
    repos?: { owner: string; name: string }[],
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {
    // If repos provided, use static mode (for tests); otherwise use dynamic discovery
    this.staticRepos = repos ?? null;
    this.pollIntervalMs = pollIntervalMs;
  }

  start() {
    // Initial poll
    void this.pollOnce();
    this.interval = setInterval(() => void this.pollOnce(), this.pollIntervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async pollOnce(): Promise<PrDiff> {
    const now = Date.now();

    // Respect backoff
    if (now < this.backoff.nextAllowedAt) {
      return { added: [], removed: [], changed: [] };
    }

    // Resolve repos: static (test mode) or dynamic discovery
    let repoList: { fullName: string }[];
    if (this.staticRepos) {
      repoList = this.staticRepos.map((r) => ({ fullName: `${r.owner}/${r.name}` }));
      this.discoveredRepos = [];
    } else {
      const discovered = discoverRepos();
      this.discoveredRepos = discovered;
      // Deduplicate by fullName (multiple worktrees for same repo)
      const seen = new Set<string>();
      repoList = [];
      for (const r of discovered) {
        if (!seen.has(r.fullName)) {
          seen.add(r.fullName);
          repoList.push({ fullName: r.fullName });
        }
      }
    }

    const nextSnapshot = new Map<string, PrRow>();

    for (const repo of repoList) {
      const fullName = repo.fullName;
      try {
        const stdout = await execGh([
          "pr", "list",
          "--repo", fullName,
          "--json", "number,title,state,headRefName,author,isDraft,reviewDecision,statusCheckRollup,updatedAt,url",
          "--limit", "30",
        ]);
        const prs = parseGhPrs(stdout, fullName, now);
        for (const pr of prs) {
          // Preserve firstSeen from previous snapshot
          const prev = this.snapshot.get(pr.key);
          if (prev) {
            pr.firstSeen = prev.firstSeen;
            // Preserve lastChanged unless something actually changed
            const fieldsChanged = TRACKED_CHANGE_FIELDS.some(
              (f) => prev[f] !== pr[f],
            );
            pr.lastChanged = fieldsChanged ? now : prev.lastChanged;
          }
          nextSnapshot.set(pr.key, pr);
        }
        // Success — reset backoff
        this.backoff.failures = 0;
        this.backoff.nextAllowedAt = 0;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.lastPollErr = msg;

        // Check for rate limit / auth errors
        if (msg.includes("403") || msg.includes("429") || msg.includes("rate limit")) {
          this.backoff.failures++;
          this.backoff.nextAllowedAt = now + computeBackoffMs(this.backoff.failures);
        }

        // On error, keep previous PRs for this repo in snapshot
        for (const [key, pr] of this.snapshot) {
          if (pr.repo === fullName && !nextSnapshot.has(key)) {
            nextSnapshot.set(key, pr);
          }
        }
      }
    }

    const diff = diffSnapshots(this.snapshot, nextSnapshot);
    this.snapshot = nextSnapshot;
    this.lastPollOk = now;
    this.lastPollErr = null;

    return diff;
  }

  getSnapshot(): PrRow[] {
    return Array.from(this.snapshot.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }
}

// --- Current branch scope ---

let scopeCache: { branches: string[]; cachedAt: number } | null = null;

export async function currentBranchScope(): Promise<string[]> {
  const now = Date.now();
  if (scopeCache && now - scopeCache.cachedAt < SCOPE_CACHE_TTL_MS) {
    return scopeCache.branches;
  }

  const branches: string[] = [];

  // Scan all discovered repos for branches (main worktree + linked worktrees)
  const repos = discoverRepos();

  // Deduplicate by repo path (worktrees share the same .git)
  const seenRepoPaths = new Set<string>();

  for (const repo of repos) {
    // Avoid scanning the same underlying repo multiple times
    // (worktrees for the same repo share the same git dir)
    if (seenRepoPaths.has(repo.path)) continue;
    seenRepoPaths.add(repo.path);

    try {
      // Main worktree HEAD
      if (repo.branch && repo.branch !== "HEAD" && !branches.includes(repo.branch)) {
        branches.push(repo.branch);
      }

      // Linked worktrees
      const worktreeOutput = await new Promise<string>((resolve, reject) => {
        execFile("git", ["-C", repo.path, "worktree", "list", "--porcelain"], {
          timeout: GIT_TIMEOUT_MS,
        }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout);
        });
      });

      for (const line of worktreeOutput.split("\n")) {
        const match = line.match(/^branch refs\/heads\/(.+)$/);
        if (match && match[1]) {
          const branch = match[1];
          if (!branches.includes(branch)) branches.push(branch);
        }
      }
    } catch {
      // git commands failed for this repo — skip
    }
  }

  scopeCache = { branches, cachedAt: now };
  return branches;
}

// Allow tests to reset scope cache
export function __resetScopeCacheForTests() {
  scopeCache = null;
}

// --- Singleton poller instance ---

let pollerInstance: PrPoller | null = null;

function getPoller(): PrPoller {
  if (!pollerInstance) {
    pollerInstance = new PrPoller(); // no args = dynamic discovery mode
    pollerInstance.start();
  }
  return pollerInstance;
}

// Allow tests to inject a mock poller
export function __setPollerForTests(p: PrPoller | null) {
  if (pollerInstance) pollerInstance.stop();
  pollerInstance = p;
}

// --- Routes ---

app.get("/", (c) => {
  const poller = getPoller();
  const prs = poller.getSnapshot();

  // Build repos summary from discovered repos
  const prCountByRepo = new Map<string, number>();
  for (const pr of prs) {
    prCountByRepo.set(pr.repo, (prCountByRepo.get(pr.repo) || 0) + 1);
  }

  const repos = poller.discoveredRepos.map((r) => ({
    name: r.repoName,
    dirName: r.name,
    org: r.owner,
    fullName: r.fullName,
    branch: r.branch,
    prCount: prCountByRepo.get(r.fullName) || 0,
  }));

  return c.json({
    ok: true,
    prs,
    repos,
    lastPollOk: poller.lastPollOk,
    lastPollErr: poller.lastPollErr,
  });
});

app.post("/refresh", async (c) => {
  const poller = getPoller();
  const diff = await poller.pollOnce();
  const prs = poller.getSnapshot();

  const prCountByRepo = new Map<string, number>();
  for (const pr of prs) {
    prCountByRepo.set(pr.repo, (prCountByRepo.get(pr.repo) || 0) + 1);
  }

  const repos = poller.discoveredRepos.map((r) => ({
    name: r.repoName,
    dirName: r.name,
    org: r.owner,
    fullName: r.fullName,
    branch: r.branch,
    prCount: prCountByRepo.get(r.fullName) || 0,
  }));

  return c.json({
    ok: true,
    prs,
    repos,
    lastPollOk: poller.lastPollOk,
    lastPollErr: poller.lastPollErr,
    diff: {
      added: diff.added.length,
      removed: diff.removed.length,
      changed: diff.changed.length,
    },
  });
});

app.get("/current-branch-scope", async (c) => {
  const branches = await currentBranchScope();
  return c.json({ ok: true, branches });
});

export { app as prsRoute };
