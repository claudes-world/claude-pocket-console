import { Hono } from "hono";
import { execFile } from "node:child_process";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { join } from "node:path";
import { openAllowedForRead } from "../lib/path-allowed.js";

const app = new Hono();

const HOME = process.env.HOME || "/home/claude";
const GH_TIMEOUT_MS = 10_000;
const GIT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const SCOPE_CACHE_TTL_MS = 60_000;
const REPO_DISCOVERY_TTL_MS = 5 * 60_000; // re-scan ~/code every 5 min
const ISSUE_CACHE_TTL_MS = 5 * 60_000;
const ICON_CACHE_TTL_MS = 30 * 60_000;
const MAX_ICON_BYTES = 64 * 1024;
const NAMESPACE_SCAN_CAP = 50;
const GIT_SCAN_CONCURRENCY = 8;

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

export interface IssueRow {
  key: string;
  repo: string;
  number: number;
  title: string;
  state: "OPEN" | "CLOSED";
  author: string;
  updatedAt: string;
  labels: string[];
  url: string;
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
let repoScanInFlight: Promise<RepoInfo[]> | null = null;

interface RepoCandidate {
  path: string;
  name: string;
}

function execGit(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { timeout: GIT_TIMEOUT_MS, encoding: "utf-8" }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function scanRepos(): Promise<RepoInfo[]> {
  const codeDir = join(HOME, "code");
  const candidates: RepoCandidate[] = [];

  if (!existsSync(codeDir)) return [];

  let dirNames: string[];
  try {
    dirNames = readdirSync(codeDir);
  } catch {
    return [];
  }

  for (const dirName of dirNames) {
    const repoPath = join(codeDir, dirName);
    if (existsSync(join(repoPath, ".git"))) {
      candidates.push({ path: repoPath, name: dirName });
      continue;
    }

    try {
      const stats = lstatSync(repoPath);
      if (!stats.isDirectory() || stats.isSymbolicLink()) continue;
    } catch {
      continue;
    }

    let childNames: string[];
    try {
      childNames = readdirSync(repoPath);
    } catch {
      continue;
    }

    const childRepos = childNames.filter((childName) =>
      existsSync(join(repoPath, childName, ".git")));
    const droppedCount = childRepos.length - NAMESPACE_SCAN_CAP;
    if (droppedCount > 0) {
      console.warn(
        `Repo discovery truncated namespace ${repoPath}: dropped ${droppedCount} candidate repos`,
      );
    }
    for (const childName of childRepos.slice(0, NAMESPACE_SCAN_CAP)) {
      candidates.push({
        path: join(repoPath, childName),
        name: `${dirName}/${childName}`,
      });
    }
  }

  const repos: RepoInfo[] = [];
  for (let index = 0; index < candidates.length; index += GIT_SCAN_CONCURRENCY) {
    const batch = candidates.slice(index, index + GIT_SCAN_CONCURRENCY);
    const results = await Promise.all(batch.map(async (candidate): Promise<RepoInfo | null> => {
      try {
        const remoteUrl = (await execGit([
          "-C", candidate.path, "remote", "get-url", "origin",
        ])).trim();
        const parsed = parseGitRemote(remoteUrl);
        if (!parsed) return null;

        const branch = (await execGit([
          "-C", candidate.path, "rev-parse", "--abbrev-ref", "HEAD",
        ])).trim();
        return {
          path: candidate.path,
          name: candidate.name,
          owner: parsed.owner,
          repoName: parsed.repoName,
          fullName: `${parsed.owner}/${parsed.repoName}`,
          branch: branch || "HEAD",
        };
      } catch {
        // Skip repos where git commands fail (no remote, detached HEAD, etc.)
        return null;
      }
    }));
    for (const repo of results) {
      if (repo) repos.push(repo);
    }
  }

  return repos;
}

export function discoverRepos(): Promise<RepoInfo[]> {
  const now = Date.now();
  if (repoCache && now - repoCache.cachedAt < REPO_DISCOVERY_TTL_MS) {
    return Promise.resolve(repoCache.repos);
  }
  if (repoScanInFlight) return repoScanInFlight;

  repoScanInFlight = scanRepos()
    .then((repos) => {
      repoCache = { repos, cachedAt: Date.now() };
      return repos;
    })
    .finally(() => {
      repoScanInFlight = null;
    });
  return repoScanInFlight;
}

/** Allow tests to reset the repo discovery cache */
export function __resetRepoCacheForTests() {
  repoCache = null;
  repoScanInFlight = null;
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

interface GhIssueJson {
  number: number;
  title: string;
  state: string;
  author: { login: string } | null;
  updatedAt: string;
  labels: Array<{ name: string }>;
  url: string;
}

function parseGhIssues(jsonStr: string, repoFullName: string): IssueRow[] {
  let raw: GhIssueJson[];
  try {
    raw = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((issue) => ({
    key: `${repoFullName}#${issue.number}`,
    repo: repoFullName,
    number: issue.number,
    title: issue.title,
    state: issue.state?.toUpperCase() === "CLOSED" ? "CLOSED" : "OPEN",
    author: issue.author?.login ?? "unknown",
    updatedAt: issue.updatedAt,
    labels: Array.isArray(issue.labels)
      ? issue.labels.map((label) => label?.name).filter((name): name is string => typeof name === "string")
      : [],
    url: issue.url,
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
  private pollInFlight: Promise<PrDiff> | null = null;

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

  pollOnce(): Promise<PrDiff> {
    if (this.pollInFlight) return this.pollInFlight;
    this.pollInFlight = this.runPollOnce().finally(() => {
      this.pollInFlight = null;
    });
    return this.pollInFlight;
  }

  private async runPollOnce(): Promise<PrDiff> {
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
      const discovered = await discoverRepos();
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
  const repos = await discoverRepos();

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

// --- On-demand issues and repository icons ---

let issueCache = new Map<string, { issues: IssueRow[]; cachedAt: number }>();
let iconCache: { icons: Record<string, string>; cachedAt: number } | null = null;

const ICON_CANDIDATES = [
  "favicon.svg",
  "favicon.ico",
  "favicon.png",
  "public/favicon.svg",
  "public/favicon.ico",
  "public/favicon.png",
  "app/favicon.ico",
  "app/favicon.png",
  "app/icon.svg",
  "app/icon.png",
  "assets/icon.svg",
  "assets/icon.png",
  "assets/logo.svg",
  "assets/logo.png",
] as const;

const ICON_MIME: Record<string, string> = {
  svg: "image/svg+xml",
  ico: "image/x-icon",
  png: "image/png",
};

async function readRepoIcon(repoPath: string): Promise<string | null> {
  let realRepoPath: string;
  try {
    realRepoPath = await realpath(repoPath);
  } catch {
    return null;
  }

  for (const candidate of ICON_CANDIDATES) {
    const candidatePath = join(repoPath, candidate);
    const opened = await openAllowedForRead(candidatePath, [realRepoPath]);
    if (!opened.ok) continue;
    try {
      const stat = await opened.handle.stat();
      if (!stat.isFile() || stat.size > MAX_ICON_BYTES) continue;

      const extension = candidate.slice(candidate.lastIndexOf(".") + 1);
      const mime = ICON_MIME[extension];
      if (!mime) continue;

      // Read from the validated descriptor, never by path. The extra byte
      // detects a file that grows after fstat without staging an unbounded read.
      const buffer = Buffer.alloc(MAX_ICON_BYTES + 1);
      let total = 0;
      while (total < buffer.length) {
        const { bytesRead } = await opened.handle.read(
          buffer,
          total,
          buffer.length - total,
          total,
        );
        if (bytesRead === 0) break;
        total += bytesRead;
      }
      if (total > MAX_ICON_BYTES) continue;
      const contents = buffer.subarray(0, total);
      const encoded = contents.toString("base64");
      return `data:${mime};base64,${encoded}`;
    } catch {
      // Unreadable/broken candidates are skipped in favor of the next one.
    } finally {
      await opened.handle.close().catch(() => {});
    }
  }

  return null;
}

export function __resetPrAuxCachesForTests() {
  issueCache = new Map();
  iconCache = null;
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

app.get("/issues", async (c) => {
  const requestedRepo = c.req.query("repo");
  const repos = await discoverRepos();
  const repo = repos.find((candidate) => candidate.fullName === requestedRepo);
  if (!requestedRepo || !repo) {
    return c.json({ ok: false, error: "Unknown repository" }, 400);
  }

  const force = c.req.query("force") === "1";
  const now = Date.now();
  const cached = issueCache.get(repo.fullName);
  if (!force && cached && now - cached.cachedAt < ISSUE_CACHE_TTL_MS) {
    return c.json({ ok: true, repo: repo.fullName, issues: cached.issues });
  }

  try {
    const stdout = await execGh([
      "issue", "list",
      "--repo", repo.fullName,
      "--json", "number,title,state,author,updatedAt,labels,url",
      "--limit", "30",
    ]);
    const issues = parseGhIssues(stdout, repo.fullName);
    issueCache.set(repo.fullName, { issues, cachedAt: now });
    return c.json({ ok: true, repo: repo.fullName, issues });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error("issues fetch failed", error);
    return c.json({ ok: false, error: "issues fetch failed" }, 502);
  }
});

app.get("/icons", async (c) => {
  const now = Date.now();
  if (iconCache && now - iconCache.cachedAt < ICON_CACHE_TTL_MS) {
    return c.json({ ok: true, icons: iconCache.icons });
  }

  const icons: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const repo of await discoverRepos()) {
    if (icons[repo.fullName]) continue;
    const icon = await readRepoIcon(repo.path);
    if (icon) icons[repo.fullName] = icon;
  }

  iconCache = { icons, cachedAt: now };
  return c.json({ ok: true, icons });
});

app.get("/current-branch-scope", async (c) => {
  const branches = await currentBranchScope();
  return c.json({ ok: true, branches });
});

export { app as prsRoute };
