import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";

const execFileAsync = promisify(execFile);

// Same cap as the tmux helpers — a wedged `ps` must not hang the handler.
const PS_TIMEOUT_MS = 5_000;

// A pane's WorldOS lane binding, resolved from the WOS_CHANNEL_STATE_DIR
// environment variable of a descendant process (the channel-plugin poller).
// `agent` is null when the binding was derived from the session-name
// convention (`<group>--<topic>`) instead of the environ walk — the name
// alone cannot identify the owning agent.
export interface LaneBinding {
  agent: string | null;
  group: string;
  topic: string;
}

// .../agents/<agent>/channel/<group>/<topic> -> binding
// Ported from world-os apps/cpc/cockpit/lib/collector.mjs parseChannelStateDir,
// split into group/topic instead of the cockpit's joined lane string.
export function parseChannelStateDir(dir: string): LaneBinding | null {
  const m = /\/agents\/([^/]+)\/channel\/([^/]+)\/([^/]+)\/?$/.exec(dir ?? "");
  return m ? { agent: m[1], group: m[2], topic: m[3] } : null;
}

// Live lane sessions are conventionally named `<group>--<topic>`
// (e.g. "do-box--cpc-restart-fix"). Split on the FIRST "--" — groups never
// contain a double dash, topics may. Convention-derived, so agent is null.
export function parseLaneSessionName(name: string): LaneBinding | null {
  const i = name.indexOf("--");
  if (i <= 0 || i + 2 >= name.length) return null;
  return { agent: null, group: name.slice(0, i), topic: name.slice(i + 2) };
}

// `ps -e -o pid=,ppid=` output -> ppid -> [child pids]. Pure, for tests.
export function buildPsChildren(psOut: string): Map<number, number[]> {
  const children = new Map<number, number[]>();
  for (const line of psOut.split("\n")) {
    if (!line.trim()) continue;
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    let list = children.get(ppid);
    if (!list) children.set(ppid, (list = []));
    list.push(pid);
  }
  return children;
}

/**
 * BFS the pane PID's descendants (≤32 processes, cycle-safe) reading
 * /proc/<pid>/environ for WOS_CHANNEL_STATE_DIR. Ported from the fleet
 * cockpit collector's findChannelBinding. `procRoot` is injectable so tests
 * can point it at a fixture tree.
 */
export async function findChannelBinding(
  panePid: number,
  children: Map<number, number[]>,
  procRoot = "/proc",
): Promise<LaneBinding | null> {
  const queue = [panePid];
  const seen = new Set<number>();
  while (queue.length && seen.size < 32) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    try {
      const environ = await fs.readFile(`${procRoot}/${pid}/environ`, "utf8");
      for (const kv of environ.split("\0")) {
        if (kv.startsWith("WOS_CHANNEL_STATE_DIR=")) {
          const parsed = parseChannelStateDir(kv.slice("WOS_CHANNEL_STATE_DIR=".length));
          if (parsed) return parsed;
        }
      }
    } catch {
      /* process gone or unreadable */
    }
    for (const child of children.get(pid) ?? []) queue.push(child);
  }
  return null;
}

// Environ-walk results cached per pane PID. Negative results are cached too —
// unbound panes (plain shells, codex without a lane) must not cost a walk on
// every poll. TTL matches the client's 30s roster poll.
const CACHE_TTL_MS = 30_000;
const bindingCache = new Map<number, { binding: LaneBinding | null; expires: number }>();

/** Test hook: clear the pane-PID binding cache. */
export function _resetLaneBindingCache(): void {
  bindingCache.clear();
}

interface ResolveOpts {
  procRoot?: string;
  /** injectable `ps -e -o pid=,ppid=` output for tests */
  psOut?: string;
  now?: () => number;
}

/**
 * Resolve lane bindings for a set of pane PIDs. Runs `ps` at most once per
 * call, and only when at least one PID misses the cache. Failures resolve to
 * null bindings — metadata enrichment must never break the sessions endpoint.
 */
export async function resolveLaneBindings(
  panePids: number[],
  opts: ResolveOpts = {},
): Promise<Map<number, LaneBinding | null>> {
  const now = opts.now ?? Date.now;
  const result = new Map<number, LaneBinding | null>();
  const misses: number[] = [];
  for (const pid of new Set(panePids)) {
    const cached = bindingCache.get(pid);
    if (cached && cached.expires > now()) result.set(pid, cached.binding);
    else misses.push(pid);
  }
  if (misses.length === 0) return result;

  let children: Map<number, number[]>;
  try {
    const psOut =
      opts.psOut ??
      (await execFileAsync("ps", ["-e", "-o", "pid=,ppid="], { timeout: PS_TIMEOUT_MS })).stdout;
    children = buildPsChildren(psOut);
  } catch {
    for (const pid of misses) result.set(pid, null);
    return result; // don't cache: a transient ps failure shouldn't stick for 30s
  }

  await Promise.all(
    misses.map(async (pid) => {
      let binding: LaneBinding | null = null;
      try {
        binding = await findChannelBinding(pid, children, opts.procRoot);
      } catch {
        /* unreachable: findChannelBinding swallows per-pid errors */
      }
      bindingCache.set(pid, { binding, expires: now() + CACHE_TTL_MS });
      result.set(pid, binding);
    }),
  );
  return result;
}
