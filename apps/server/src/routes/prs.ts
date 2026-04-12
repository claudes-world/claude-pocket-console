import { Hono } from "hono";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const app = new Hono();

const HOME = process.env.HOME || "/home/claude";
const GH_TIMEOUT_MS = 10_000;
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const SCOPE_CACHE_TTL_MS = 60_000;

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
  private interval: ReturnType<typeof setInterval> | null = null;
  private backoff: BackoffState = { failures: 0, nextAllowedAt: 0 };
  private repos: { owner: string; name: string }[];
  private pollIntervalMs: number;

  constructor(
    repos: { owner: string; name: string }[] = [
      { owner: "claudes-world", name: "claude-pocket-console" },
    ],
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ) {
    this.repos = repos;
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

    const nextSnapshot = new Map<string, PrRow>();

    for (const repo of this.repos) {
      const fullName = `${repo.owner}/${repo.name}`;
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
  // Phase 1: just CPC
  const repoPath = join(HOME, "code/claude-pocket-console");

  if (!existsSync(repoPath)) {
    scopeCache = { branches, cachedAt: now };
    return branches;
  }

  try {
    // Main worktree HEAD
    const head = await new Promise<string>((resolve, reject) => {
      execFile("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"], {
        timeout: 5000,
      }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.trim());
      });
    });
    if (head && head !== "HEAD") branches.push(head);

    // Linked worktrees
    const worktreeOutput = await new Promise<string>((resolve, reject) => {
      execFile("git", ["-C", repoPath, "worktree", "list", "--porcelain"], {
        timeout: 5000,
      }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout);
      });
    });

    // Parse porcelain output — look for "branch refs/heads/<name>" lines
    for (const line of worktreeOutput.split("\n")) {
      const match = line.match(/^branch refs\/heads\/(.+)$/);
      if (match && match[1]) {
        const branch = match[1];
        if (!branches.includes(branch)) branches.push(branch);
      }
    }
  } catch {
    // git commands failed — return empty scope
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
    pollerInstance = new PrPoller();
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
  return c.json({
    ok: true,
    prs: poller.getSnapshot(),
    lastPollOk: poller.lastPollOk,
    lastPollErr: poller.lastPollErr,
  });
});

app.post("/refresh", async (c) => {
  const poller = getPoller();
  const diff = await poller.pollOnce();
  return c.json({
    ok: true,
    prs: poller.getSnapshot(),
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
