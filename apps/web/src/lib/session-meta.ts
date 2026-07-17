/**
 * Client-side session metadata (terminal switcher v2, WORLD-416).
 *
 * The canonical shape of one row served by GET /api/terminal/sessions
 * (apps/server/src/routes/terminal/sessions.ts). The v2 metadata fields
 * (host / harness / tg) are optional here because the client must render
 * gracefully against an old server that doesn't send them yet — every
 * consumer treats `undefined` exactly like the server's explicit `null`.
 */

/** A session's WorldOS lane binding (Telegram group/topic). `agent` is null
 *  when the server derived the binding from the `<group>--<topic>` session
 *  name convention instead of the pane's environment. */
export interface SessionLaneBinding {
  agent: string | null;
  group: string;
  topic: string;
}

export interface TmuxSessionInfo {
  name: string;
  attached: boolean;
  /** epoch seconds of last activity in the session */
  activity: number;
  /** foreground command of the session's first pane, e.g. "claude" */
  command: string;
  /** false when the first pane has dropped to a bare shell */
  alive: boolean;
  /** true only for the server's default (writable) session */
  writable: boolean;
  /** hostname serving this session (absent on pre-v2 servers) */
  host?: string;
  /** harness running in the first pane (absent on pre-v2 servers) */
  harness?: "claude" | "codex" | null;
  /** WorldOS lane binding (absent on pre-v2 servers) */
  tg?: SessionLaneBinding | null;
}

/** Client fallback for pre-v2 servers that don't send `harness`: the same
 *  foreground-command mapping the server applies (sessions.ts). */
export function harnessOf(session: TmuxSessionInfo): "claude" | "codex" | null {
  if (session.harness !== undefined) return session.harness;
  if (session.command === "claude") return "claude";
  if (session.command === "codex") return "codex";
  return null;
}

// ---- host color system (§3.4) ----
//
// Deterministic, defined in exactly one place. Known hosts are pinned;
// unknown hosts hash (FNV-1a) into the four remaining accents. Green and
// red are EXCLUDED everywhere: they carry alive-state and error semantics.

const PINNED_HOST_COLORS: Record<string, string> = {
  // today's box
  "do-box": "var(--color-accent-blue)",
  // the next host — the do-box-successor ops profile already exists
  "do-box-successor": "var(--color-accent-purple)",
};

const HASHED_HOST_COLORS = [
  "var(--color-accent-cyan)",
  "var(--color-accent-yellow)",
  "var(--color-accent-pink)",
  "var(--color-accent-orange)",
];

/** 32-bit FNV-1a — tiny, stable, good enough spread for hostnames. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** The host's CSS color (a `var(--color-accent-*)` expression). */
export function hostColor(host: string): string {
  return PINNED_HOST_COLORS[host] ?? HASHED_HOST_COLORS[fnv1a(host) % HASHED_HOST_COLORS.length];
}

/** `group › topic` — the tg badge text (§3.3). Null when unbound. */
export function formatTgBadge(session: TmuxSessionInfo): string | null {
  const tg = session.tg;
  if (!tg) return null;
  return `${tg.group} › ${tg.topic}`;
}

/** Distinct known hosts across a roster. Rails/grouping appear at 2+
 *  (suppress-until-two-hosts, auto-appear after — §3.4). */
export function distinctHosts(sessions: TmuxSessionInfo[]): string[] {
  const hosts = new Set<string>();
  for (const s of sessions) if (s.host) hosts.add(s.host);
  return [...hosts];
}

/** Rows grouped by host, preserving the incoming (server) order within and
 *  across groups by first appearance. Sessions with no host land in one
 *  trailing null-host group. */
export function groupByHost(
  sessions: TmuxSessionInfo[],
): { host: string | null; sessions: TmuxSessionInfo[] }[] {
  const groups: { host: string | null; sessions: TmuxSessionInfo[] }[] = [];
  const byHost = new Map<string | null, TmuxSessionInfo[]>();
  for (const s of sessions) {
    const key = s.host ?? null;
    let list = byHost.get(key);
    if (!list) {
      byHost.set(key, (list = []));
      groups.push({ host: key, sessions: list });
    }
    list.push(s);
  }
  // Hostless rows trail known hosts (only relevant mid-migration).
  groups.sort((a, b) => Number(a.host === null) - Number(b.host === null));
  return groups;
}
