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
