import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SESSION_NAME_RE, TMUX_SESSION } from "../utils.js";

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

export interface TmuxSessionInfo {
  name: string;
  attached: boolean;
  /** epoch seconds of last activity in the session */
  activity: number;
  /** foreground command of the session's first pane, e.g. "claude" */
  command: string;
  /** false when the first pane has dropped to a bare shell */
  alive: boolean;
  /** true only for the server's configured TMUX_SESSION (the one session
   *  the REST write endpoints target) — everything else is view-only */
  writable: boolean;
}

/**
 * Parse `tmux list-sessions` + `tmux list-panes -a` output into the session
 * list served to the mini app. Pure function, exported for unit tests.
 *
 * - Skips `_`-prefixed infra sessions and (defensively) any name that fails
 *   SESSION_NAME_RE — a name we would refuse to poll must not be offered to
 *   the client in the first place.
 * - `panesOut` rows are ordered by session/window/pane index, so the first
 *   row seen for a session is its lowest window's first pane — good enough
 *   for the alive/command signal.
 * - Sort: the writable TMUX_SESSION first, then most recently active first.
 */
export function parseSessions(listOut: string, panesOut: string, defaultSession: string): TmuxSessionInfo[] {
  const firstPaneCommand = new Map<string, string>();
  for (const line of panesOut.split("\n")) {
    if (!line) continue;
    const separatorIndex = line.indexOf(TMUX_FIELD_SEPARATOR);
    const name = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
    const command = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
    // tmux sorts `list-panes -a` by session name. Every character allowed by
    // SESSION_NAME_RE is below "|" (0x7c), so a real session's first pane row
    // precedes rows from any `real|suffix` impostor; first-wins keeps the real
    // command even though pane commands must preserve pipes after the first.
    if (SESSION_NAME_RE.test(name) && !firstPaneCommand.has(name)) firstPaneCommand.set(name, command);
  }

  const sessions: TmuxSessionInfo[] = [];
  for (const line of listOut.split("\n")) {
    if (!line) continue;
    const fields = line.split(TMUX_FIELD_SEPARATOR);
    if (fields.length !== 3) continue;
    const [name, attached, activity] = fields;
    if (!name || name.startsWith(HIDDEN_SESSION_PREFIX) || !SESSION_NAME_RE.test(name)) continue;
    const command = firstPaneCommand.get(name) ?? "";
    sessions.push({
      name,
      attached: attached !== "0",
      activity: Number.parseInt(activity, 10) || 0,
      command,
      alive: command !== "" && !SHELL_COMMANDS.has(command),
      writable: name === defaultSession,
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
        ["list-panes", "-a", "-F", `#{session_name}${TMUX_FIELD_SEPARATOR}#{pane_current_command}`],
        { timeout: TMUX_TIMEOUT_MS },
      ),
    ]);
    return c.json({
      ok: true,
      default: TMUX_SESSION,
      sessions: parseSessions(list.stdout, panes.stdout, TMUX_SESSION),
    });
  } catch (err: any) {
    // tmux exits non-zero when no server is running — surface as an error
    // (not an empty-but-ok list) so the client falls back to the default
    // session instead of rendering a misleading empty picker.
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as sessionsRoute };
