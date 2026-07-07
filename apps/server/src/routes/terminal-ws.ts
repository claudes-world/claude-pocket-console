import { spawn, execSync, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WSContext } from "hono/ws";
import { checkAuth, validateSession, validateJwtTokenWithTokens, getBotTokens } from "../auth.js";
import { isAllowedUser } from "../lib/allowed-users.js";
// Import the validated TMUX_SESSION from routes/utils so we inherit the
// `/^[A-Za-z0-9_.-]+$/` character-set check that runs once at module load.
// Keeping a local unvalidated copy would bypass that fence and leave the
// execSync call below vulnerable to env-var shell injection. Flagged
// security-high by cloud Gemini Code Assist on round-2 review of PR #85.
import { TMUX_SESSION } from "./utils.js";
import { ALLOWED_ORIGINS } from "../lib/allowed-origins.js";

const execFileAsync = promisify(execFile);

function getPaneDimensions(): { cols: number; rows: number } {
  try {
    const out = execSync(
      `tmux display-message -t ${TMUX_SESSION} -p '#{pane_width}x#{pane_height}'`,
      { encoding: "utf-8" },
    ).trim();
    const [cols, rows] = out.split("x").map(Number);
    return { cols: cols || 80, rows: rows || 24 };
  } catch {
    return { cols: 80, rows: 24 };
  }
}

// NOTE (original design, still true for the *automatic* path): the mini app
// is a read-only viewer using capture-pane, not a real attached tmux client.
// tmux itself decides the window's size from its `window-size` option
// (host default: "smallest" — the size of the smallest ATTACHED client,
// e.g. a Termius SSH session) plus the `/resize-terminal` REST endpoint
// (slash-commands.ts) which forces `resize-window -A` (largest attached
// client) on every Reconnect tap. Neither of those has any notion of the
// mini app's own xterm.js viewport, because the mini app was never an
// "attached client" in tmux's eyes — it only polls `capture-pane`. That's
// the root cause of the sizing bug: whichever SSH client happens to be
// attached (or the stale size left over from one that detached) wins, and
// the mini app just captures whatever that produced.
//
// We still do NOT auto-resize tmux to the mini app's viewport on every
// frame/reconnect — that would fight a concurrently attached Termius
// session and thrash the window size back and forth. Instead we support a
// single EXPLICIT, user-initiated "fit" request (the "Fit screen" action in
// the reconnect menu): the client measures its current xterm.js viewport
// and sends one `{ type: "fit", cols, rows }` message; we validate the
// dimensions and issue exactly one bounded `tmux resize-window -x -y` call.
// Per `man tmux`, `resize-window -x/-y` "automatically sets window-size to
// manual" for that window, so the size sticks until the user (or another
// manual resize) changes it again — a deliberate, visible trade-off the
// user accepts by tapping the button, not something we impose silently.
const FIT_COLS_MIN = 20;
const FIT_COLS_MAX = 500;
const FIT_ROWS_MIN = 5;
const FIT_ROWS_MAX = 300;

export type FitValidationResult =
  | { ok: true; cols: number; rows: number }
  | { ok: false; error: string };

/**
 * Validate the cols/rows pair in a client "fit" WS message before it ever
 * reaches `tmux resize-window`. This input comes from a Telegram WebView —
 * untrusted by definition — so bounds are enforced defensively even though
 * the values are also argv-escaped (no shell) below.
 */
export function validateFitDimensions(msg: unknown): FitValidationResult {
  if (typeof msg !== "object" || msg === null) {
    return { ok: false, error: "fit message must be an object" };
  }
  const { cols, rows } = msg as { cols?: unknown; rows?: unknown };
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    return { ok: false, error: "cols/rows must be integers" };
  }
  const c = cols as number;
  const r = rows as number;
  if (c < FIT_COLS_MIN || c > FIT_COLS_MAX) {
    return { ok: false, error: `cols out of range (${FIT_COLS_MIN}-${FIT_COLS_MAX})` };
  }
  if (r < FIT_ROWS_MIN || r > FIT_ROWS_MAX) {
    return { ok: false, error: `rows out of range (${FIT_ROWS_MIN}-${FIT_ROWS_MAX})` };
  }
  return { ok: true, cols: c, rows: r };
}

/**
 * Apply a validated fit request: resize the tmux window to exactly
 * cols x rows. `execFile` (no shell) with an argv array — same discipline
 * as `sendToTmux` in routes/utils.ts — so the numeric strings can never be
 * interpreted as shell metacharacters even though they're already
 * integer-validated above.
 */
export async function applyFitResize(cols: number, rows: number): Promise<void> {
  await execFileAsync("tmux", [
    "resize-window",
    "-t", TMUX_SESSION,
    "-x", String(cols),
    "-y", String(rows),
  ]);
}

export function terminalWsRoute(c: any) {
  // Origin check: WebSocket upgrades bypass Hono's cors() middleware, so we
  // validate the Origin header explicitly here. Close with 4003 (policy
  // violation) if the origin is not in the allowlist.
  // NOTE: c.req.header() may return undefined for missing headers.
  const origin = c.req.header("origin") ?? "";
  if (!ALLOWED_ORIGINS.includes(origin)) {
    console.log(`[ws] rejected: disallowed origin "${origin}"`);
    return {
      onOpen(_event: Event, ws: WSContext) {
        ws.close(4003, "Forbidden origin");
      },
    };
  }

  // Auth check: initData or session token passed as query param
  const initData = c.req.query("auth") || "";
  let authResult = checkAuth(initData);

  // Fallback: session token from Login Widget auth
  if (!authResult.ok) {
    const token = c.req.query("token") || "";
    if (token) {
      const { valid, user } = validateSession(token);
      if (valid && user) {
        if (isAllowedUser(user.id)) {
          authResult = { ok: true, user };
        } else {
          authResult = { ok: false, error: "User not in allowlist" };
        }
      }

      // Fallback: JWT token validation (keyboard button auth)
      // Iterates all configured bot tokens (TELEGRAM_BOT_TOKENS or TELEGRAM_BOT_TOKEN)
      // so multi-bot deployments work over WebSocket the same as over HTTP.
      if (!authResult.ok) {
        const { valid: jwtValid, user: jwtUser } = validateJwtTokenWithTokens(token, getBotTokens());
        if (jwtValid && jwtUser && isAllowedUser(jwtUser.id)) {
          authResult = { ok: true, user: jwtUser };
        }
      }
    }
  }

  return {
    onOpen(_event: Event, ws: WSContext) {
      if (!authResult.ok) {
        console.log(`[ws] unauthorized: ${authResult.error}`);
        ws.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        ws.close(4001, "Unauthorized");
        return;
      }
      console.log(`[ws] client connected (user: ${authResult.user?.username || "unknown"})`);

      let lastContent = "";
      let lastDims = "";
      let interval: ReturnType<typeof setInterval>;

      const sendPaneContent = () => {
        // Send updated dimensions whenever they change
        const dims = getPaneDimensions();
        const dimsKey = `${dims.cols}x${dims.rows}`;
        if (dimsKey !== lastDims) {
          lastDims = dimsKey;
          ws.send(JSON.stringify({ type: "dimensions", cols: dims.cols, rows: dims.rows }));
        }
        // -e preserves ANSI colors and -J joins wrapped lines so they reflow
        // to the client width.
        const capture = spawn("tmux", [
          "capture-pane",
          "-t", TMUX_SESSION,
          "-p",
          "-e",
          "-J",
        ]);

        let output = "";
        capture.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });

        capture.on("close", () => {
          if (output !== lastContent) {
            lastContent = output;
            ws.send(JSON.stringify({ type: "pane", content: output }));
          }
        });

        capture.on("error", (err: Error) => {
          console.error("[tmux] capture error:", err.message);
        });
      };

      sendPaneContent();
      interval = setInterval(sendPaneContent, 500);

      (ws as any)._cleanup = () => {
        clearInterval(interval);
      };
    },

    onMessage(event: MessageEvent, ws: WSContext) {
      // onMessage previously only logged on any branch (dead weight — the
      // "resize" case was a documented no-op). Now that a message type can
      // trigger a real `tmux resize-window` call, guard on the same
      // authResult computed in onOpen; onOpen already closes unauthorized
      // sockets, but this closes the gap if a message arrives before the
      // close takes effect.
      if (!authResult.ok) return;
      try {
        const msg = JSON.parse(event.data.toString());
        if (msg.type === "fit") {
          // Explicit, user-initiated "Fit screen" action only — the client
          // never sends this automatically (see NOTE above). Validate
          // before touching tmux.
          const result = validateFitDimensions(msg);
          if (!result.ok) {
            console.log(`[ws] fit rejected: ${result.error}`);
            ws.send(JSON.stringify({ type: "error", message: result.error }));
            return;
          }
          const { cols, rows } = result;
          applyFitResize(cols, rows)
            .then(() => {
              console.log(`[ws] fit applied: ${cols}x${rows}`);
              ws.send(JSON.stringify({ type: "fit-ack", cols, rows }));
            })
            .catch((err: Error) => {
              console.error("[tmux] fit resize error:", err.message);
              ws.send(JSON.stringify({ type: "error", message: "Failed to resize tmux window" }));
            });
        } else if (msg.type === "resize") {
          // Legacy/automatic path — intentionally still a no-op. Kept so any
          // stray client still sending continuous resize-on-viewport-change
          // messages can't silently start fighting an attached Termius
          // session. Only the explicit "fit" message (above) resizes tmux.
          console.log(`[ws] resize request ignored (read-only viewer): ${msg.cols}x${msg.rows}`);
        }
      } catch {
        // Ignore non-JSON messages
      }
    },

    onClose(_event: Event, ws: WSContext) {
      console.log("[ws] client disconnected");
      (ws as any)._cleanup?.();
    },
  };
}
