import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { SESSION_NAME_RE, TMUX_SESSION } from "../utils.js";
import { type LaneBinding, parseLaneSessionName, resolveLaneBindings } from "../../lib/lane-binding.js";

const execFileAsync = promisify(execFile);

// Same cap as the tmux helpers in routes/utils.ts — a wedged tmux server
// must reject the request after 5s instead of hanging the HTTP handler.
const TMUX_TIMEOUT_MS = 5_000;

// Sessions whose name starts with "_" are infrastructure (e.g. the
// _tmux-server-keepalive session that pins the tmux server alive) and are
// never useful to view from the mini app.
const HIDDEN_SESSION_PREFIX = "_";

// tmux replaces non-printable format characters (including tabs) with "_"
// under a non-UTF-8 locale. "|" is printable and cannot occur in a session
// name accepted by SESSION_NAME_RE, so its output is locale-independent.
const TMUX_FIELD_SEPARATOR = "|";

// A pane whose foreground process is a bare shell means the agent that was
// running there has exited — same liveness heuristic as the fleet cockpit
// collector (world-os apps/cpc/cockpit/lib/collector.mjs).
const SHELL_COMMANDS = new Set(["bash", "zsh", "sh", "fish", "dash"]);

// Foreground command -> harness identity. Extendable; anything unlisted is
// null (plain shell / other tool), which the client renders glyph-less.
const HARNESS_BY_COMMAND: Record<string, "claude" | "codex"> = {
  claude: "claude",
  codex: "codex",
};

export interface TmuxSessionInfo {
  name: string;
  attached: boolean;
  /** epoch seconds of last activity in the session */
  activity: number;
  /** foreground command of the session's first pane, e.g. "claude" */
  command: string;
  /** false when the first pane has dropped to a bare shell */
  alive: boolean;
  /** true only for the server's configured TMUX_SESSION — the implicit
   *  write target and the one that gets the full command set / pencil. Other
   *  sessions are still reachable by the restricted palette (Esc/digits/
   *  /compact/etc.) with an explicit session param; they are "not the default
   *  writable session", not strictly view-only (Option A, Liam msg 1607). */
  writable: boolean;
  /** hostname serving this session — per-session (not only top-level) so a
   *  future multi-host fan-in aggregator needs no client change */
  host: string;
  /** harness running in the first pane, mapped from its foreground command */
  harness: "claude" | "codex" | null;
  /** WorldOS lane binding (Telegram group/topic). From the pane's environ
   *  walk when available; falls back to the `<group>--<topic>` session-name
   *  convention (agent: null marks the fallback). Null when unbound. */
  tg: LaneBinding | null;
}

/** parseSessions output row: session info plus the first pane's PID, which
 *  the route needs for the environ walk but never serves to the client. */
export interface ParsedSession extends TmuxSessionInfo {
  panePid: number | null;
}

/**
 * Parse `tmux list-sessions` + `tmux list-panes -a` output into the session
 * list served to the mini app. Pure function, exported for unit tests.
 *
 * - Skips `_`-prefixed infra sessions and (defensively) any name that fails
 *   SESSION_NAME_RE — a name we would refuse to poll must not be offered to
 *   the client in the first place.
 * - `panesOut` rows are `name|pane_pid|command` — the PID sits between name
 *   and command because commands may themselves contain "|" and are split
 *   off last. Rows are ordered by session/window/pane index, so the first
 *   row seen for a session is its lowest window's first pane — good enough
 *   for the alive/command signal.
 * - `tg` is filled from the session-name convention only; the route upgrades
 *   it with environ-walk results (which need I/O and can't live here).
 * - Sort: the writable TMUX_SESSION first, then most recently active first.
 */
export function parseSessions(
  listOut: string,
  panesOut: string,
  defaultSession: string,
  host = "",
): ParsedSession[] {
  const firstPane = new Map<string, { pid: number | null; command: string }>();
  for (const line of panesOut.split("\n")) {
    if (!line) continue;
    const nameEnd = line.indexOf(TMUX_FIELD_SEPARATOR);
    if (nameEnd === -1) continue;
    const name = line.slice(0, nameEnd);
    const pidEnd = line.indexOf(TMUX_FIELD_SEPARATOR, nameEnd + 1);
    const pidRaw = pidEnd === -1 ? line.slice(nameEnd + 1) : line.slice(nameEnd + 1, pidEnd);
    const command = pidEnd === -1 ? "" : line.slice(pidEnd + 1);
    const pid = /^\d+$/.test(pidRaw) ? Number.parseInt(pidRaw, 10) : null;
    // tmux sorts `list-panes -a` by session name. Every character allowed by
    // SESSION_NAME_RE is below "|" (0x7c), so a real session's first pane row
    // precedes rows from any `real|suffix` impostor; first-wins keeps the real
    // pid+command even though pane commands must preserve pipes after the
    // pid field.
    if (SESSION_NAME_RE.test(name) && !firstPane.has(name)) firstPane.set(name, { pid, command });
  }

  const sessions: ParsedSession[] = [];
  for (const line of listOut.split("\n")) {
    if (!line) continue;
    const fields = line.split(TMUX_FIELD_SEPARATOR);
    if (fields.length !== 3) continue;
    const [name, attached, activity] = fields;
    if (!name || name.startsWith(HIDDEN_SESSION_PREFIX) || !SESSION_NAME_RE.test(name)) continue;
    const pane = firstPane.get(name);
    const command = pane?.command ?? "";
    sessions.push({
      name,
      attached: attached !== "0",
      activity: Number.parseInt(activity, 10) || 0,
      command,
      alive: command !== "" && !SHELL_COMMANDS.has(command),
      writable: name === defaultSession,
      host,
      harness: HARNESS_BY_COMMAND[command] ?? null,
      tg: parseLaneSessionName(name),
      panePid: pane?.pid ?? null,
    });
  }

  sessions.sort((a, b) => {
    if (a.writable !== b.writable) return a.writable ? -1 : 1;
    return b.activity - a.activity;
  });
  return sessions;
}

const app = new Hono();

/**
 * GET /api/terminal/sessions — enumerate the tmux sessions available to the
 * terminal tab's session picker. Sits behind the same /api/* Telegram auth
 * middleware as every other terminal route.
 *
 * The mini app treats `default` as the writable session; `sessions[i].name`
 * feeds back into the WS `?session=` param (re-validated server-side there —
 * this listing is a menu, never an authorization).
 */
app.get("/sessions", async (c) => {
  try {
    const [list, panes] = await Promise.all([
      execFileAsync(
        "tmux",
        ["list-sessions", "-F", `#{session_name}${TMUX_FIELD_SEPARATOR}#{session_attached}${TMUX_FIELD_SEPARATOR}#{session_activity}`],
        { timeout: TMUX_TIMEOUT_MS },
      ),
      execFileAsync(
        "tmux",
        ["list-panes", "-a", "-F", `#{session_name}${TMUX_FIELD_SEPARATOR}#{pane_pid}${TMUX_FIELD_SEPARATOR}#{pane_current_command}`],
        { timeout: TMUX_TIMEOUT_MS },
      ),
    ]);
    const host = os.hostname();
    const parsed = parseSessions(list.stdout, panes.stdout, TMUX_SESSION, host);

    // Upgrade name-convention tg bindings with the environ walk (cached per
    // pane PID, 30s TTL). Enrichment failures degrade to the name fallback —
    // they must never take the roster down.
    const bindings = await resolveLaneBindings(
      parsed.flatMap((s) => (s.panePid === null ? [] : [s.panePid])),
    );
    const sessions: TmuxSessionInfo[] = parsed.map(({ panePid, ...session }) => {
      const walked = panePid === null ? null : bindings.get(panePid) ?? null;
      return walked ? { ...session, tg: walked } : session;
    });

    return c.json({ ok: true, default: TMUX_SESSION, host, sessions });
  } catch (err: any) {
    // tmux exits non-zero when no server is running — surface as an error
    // (not an empty-but-ok list) so the client falls back to the default
    // session instead of rendering a misleading empty picker.
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as sessionsRoute };
