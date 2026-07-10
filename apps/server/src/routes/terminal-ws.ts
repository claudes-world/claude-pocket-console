import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import type { WSContext } from "hono/ws";
import { checkAuth, validateSession, validateJwtTokenWithTokens, getBotTokens } from "../auth.js";
import { isAllowedUser } from "../lib/allowed-users.js";
// Import the validated TMUX_SESSION from routes/utils so we inherit the
// `/^[A-Za-z0-9_.-]+$/` character-set check that runs once at module load.
// Keeping a local unvalidated copy would bypass that fence and leave the
// execSync call below vulnerable to env-var shell injection. Flagged
// security-high by cloud Gemini Code Assist on round-2 review of PR #85.
import { SESSION_NAME_RE, TMUX_SESSION } from "./utils.js";
import { ALLOWED_ORIGINS } from "../lib/allowed-origins.js";

const execFileAsync = promisify(execFile);

// Same cap as the tmux helpers in routes/utils.ts — a wedged tmux server
// must fail the call after 5s instead of wedging the connection setup.
const TMUX_TIMEOUT_MS = 5_000;

// Async (execFileAsync, no shell) rather than execFileSync (round-2 review,
// PR #299): this runs on every 500ms poll tick per open WebSocket
// connection, and execFileSync blocks Node's single event loop for however
// long tmux takes — even bounded by TMUX_TIMEOUT_MS, that's up to 5s of
// stalling every other request/socket on the process per slow tick. Callers
// now await the result (fire-and-forget from sendPaneContent, same pattern
// as the capture-pane spawn below) instead of using it synchronously inline.
async function getPaneDimensions(session: string): Promise<{ cols: number; rows: number }> {
  try {
    // argv (no shell) because `session` can come from the client's
    // ?session= query param — regex-validated upstream, but a
    // client-controlled string must never be interpolated into a shell
    // line. Target form `=<name>:` — exact-match session lookup, and the
    // trailing `:` is REQUIRED: tmux 3.5a rejects bare `=name` for
    // pane-target commands (display-message/capture-pane/send-keys) with
    // "can't find pane"; only session-target commands (has-session) take
    // `=name` alone. Verified live on this host, 2026-07-09.
    const { stdout } = await execFileAsync(
      "tmux",
      ["display-message", "-t", `=${session}:`, "-p", "#{pane_width}x#{pane_height}"],
      { encoding: "utf-8", timeout: TMUX_TIMEOUT_MS },
    );
    const [cols, rows] = stdout.trim().split("x").map(Number);
    return { cols: cols || 80, rows: rows || 24 };
  } catch {
    return { cols: 80, rows: 24 };
  }
}

export type SessionResolution =
  | { ok: true; session: string }
  | { ok: false; error: string };

/**
 * Resolve the tmux session a WS connection will view. The `?session=` query
 * param is client-controlled (Telegram WebView — untrusted by definition):
 * an absent/empty param keeps today's behavior (the configured
 * TMUX_SESSION); anything else must pass the shared session-name allowlist
 * before it can ever reach a tmux argv. Existence is checked separately in
 * onOpen (`tmux has-session -t =<name>`) — this only fences the charset.
 */
export function resolveRequestedSession(raw: string): SessionResolution {
  if (!raw) return { ok: true, session: TMUX_SESSION };
  if (!SESSION_NAME_RE.test(raw)) {
    return { ok: false, error: "Invalid session name" };
  }
  return { ok: true, session: raw };
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
//
// INCIDENT (Liam msg 585, 2026-07-08): `resize-window -x/-y` has a tmux
// side effect beyond the one-shot resize — it also flips the session's
// `window-size` option to "manual", which is STICKY: every later client
// that attaches (e.g. a real Termius SSH session) gets clamped to that
// exact size forever, instead of tmux auto-fitting to it. Live evidence:
// `[ws] fit applied: 58x60` in the cpc.service journal, followed by Liam
// unable to use the TUI from Termius because the window stayed pinned at
// 58x60 regardless of his actual terminal size.
//
// Fix: immediately follow the one-shot resize with a `set-option
// window-size latest` call that hands sizing back to "whichever client was
// most recently active" — the resize applies once (for the mini app's
// current tap) and then releases, so the next real attached client (Termius)
// drives the size again. Order matters: `resize-window` itself is what sets
// window-size to manual, so the release call MUST run after it, never
// before (verified live: running them in the other order left it stuck on
// "manual").
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
 * cols x rows, then release the manual-size latch that `resize-window -x/-y`
 * leaves behind. `execFile` (no shell) with an argv array — same discipline
 * as `sendToTmux` in routes/utils.ts — so the numeric strings can never be
 * interpreted as shell metacharacters even though they're already
 * integer-validated above.
 *
 * The two tmux calls MUST run in this order: `resize-window` sets
 * `window-size` to "manual" as a side effect, so the `set-option
 * window-size latest` release has to come after it — running it before
 * (or relying on `resize-window -A` alone) leaves the session pinned to
 * the mini app's small viewport for every later attach (see incident note
 * above the option constants).
 */
/**
 * Thrown when `resize-window` itself succeeded but the follow-up
 * `set-option window-size latest` release call failed. Callers MUST
 * distinguish this from a plain resize failure: the resize already applied,
 * and the tmux session is now stuck with `window-size` pinned to "manual" —
 * i.e. the exact incident this file's INCIDENT note above describes, except
 * silent instead of logged, if not surfaced distinctly. Never collapse this
 * into the generic "Failed to resize tmux window" message.
 */
export class FitLatchReleaseError extends Error {
  constructor(message: string, public readonly cause: unknown) {
    super(message);
    this.name = "FitLatchReleaseError";
  }
}

export async function applyFitResize(cols: number, rows: number): Promise<void> {
  // TMUX_TIMEOUT_MS on both calls (round-2 review, PR #299): every other
  // tmux invocation in this file is capped so a wedged tmux server fails
  // the request instead of hanging it forever; these two were the only
  // ones left uncapped, letting a stuck fit request accumulate an
  // unbounded child process and never resolve for the caller.
  await execFileAsync("tmux", [
    "resize-window",
    "-t", TMUX_SESSION,
    "-x", String(cols),
    "-y", String(rows),
  ], { timeout: TMUX_TIMEOUT_MS });
  try {
    await execFileAsync("tmux", [
      "set-option",
      "-t", TMUX_SESSION,
      "window-size", "latest",
    ], { timeout: TMUX_TIMEOUT_MS });
  } catch (err) {
    // Resize already succeeded — do NOT let this fall through to the
    // generic resize-failure handling in onMessage below. Wrap so the
    // caller can tell "resize applied but latch may still be engaged"
    // apart from "resize never happened".
    throw new FitLatchReleaseError(
      "tmux window-size latch release failed after resize-window succeeded",
      err,
    );
  }
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

  // Which tmux session this connection views. Client-controlled query
  // param — charset-fenced here, existence-checked in onOpen. Absent param
  // = the configured TMUX_SESSION (today's single-session behavior).
  const sessionResolution = resolveRequestedSession(c.req.query("session") || "");

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
      if (!sessionResolution.ok) {
        console.log(`[ws] rejected: ${sessionResolution.error}`);
        ws.send(JSON.stringify({ type: "error", message: sessionResolution.error }));
        ws.close(4004, "Invalid session");
        return;
      }
      const session = sessionResolution.session;
      console.log(
        `[ws] client connected (user: ${authResult.user?.username || "unknown"}, session: ${session})`,
      );

      let lastContent = "";
      let lastDims = "";
      let interval: ReturnType<typeof setInterval> | undefined;
      // Set by onClose (via _cleanup). Guards the async has-session gate
      // below: if the client disconnects before the check resolves, we must
      // not start an interval nobody will ever clear.
      let closed = false;
      // In-flight guard for the dims poll (codex local-swarm finding, round-2
      // PR #299): getPaneDimensions is async now (was execFileSync, which
      // serialized ticks for free by blocking). Without this guard, a tmux
      // call slower than the 500ms tick interval lets multiple
      // display-message calls pile up concurrently per connection (up to
      // TMUX_TIMEOUT_MS / 500ms ~= 10 of them), and whichever happens to
      // resolve last wins even if it isn't the most recently issued —
      // skipping a tick while one is already in flight avoids both.
      let dimsInFlight = false;
      (ws as any)._cleanup = () => {
        closed = true;
        if (interval !== undefined) clearInterval(interval);
      };

      const sendPaneContent = () => {
        // Send updated dimensions whenever they change. Fire-and-forget —
        // same async-child-process pattern as the capture-pane spawn right
        // below, so a slow tmux display-message call never blocks the
        // event loop for other connections (round-2 review, PR #299:
        // execFileSync here stalled the whole process for up to
        // TMUX_TIMEOUT_MS on every 500ms poll tick, per connection).
        if (!dimsInFlight) {
          dimsInFlight = true;
          getPaneDimensions(session)
            .then((dims) => {
              if (closed) return;
              const dimsKey = `${dims.cols}x${dims.rows}`;
              if (dimsKey !== lastDims) {
                lastDims = dimsKey;
                ws.send(JSON.stringify({ type: "dimensions", cols: dims.cols, rows: dims.rows }));
              }
            })
            .finally(() => {
              dimsInFlight = false;
            });
        }
        // -e preserves ANSI colors and -J joins wrapped lines so they reflow
        // to the client width. `=<name>:` target (exact-match + trailing
        // colon required for pane-target commands on tmux 3.5a), since
        // `session` may originate from the client's ?session= param.
        // timeout: a wedged tmux server must not accumulate one unbounded
        // child per 500ms poll tick — same cap as every other tmux call on
        // these routes (spawn kills with SIGTERM on expiry).
        const capture = spawn("tmux", [
          "capture-pane",
          "-t", `=${session}:`,
          "-p",
          "-e",
          "-J",
        ], { timeout: TMUX_TIMEOUT_MS });

        let output = "";
        capture.stdout.on("data", (data: Buffer) => {
          output += data.toString();
        });

        capture.on("close", (code: number | null) => {
          // The capture child resolves asynchronously — the socket may have
          // closed (and the interval been cleared) while it ran. Never send
          // on a closed WSContext.
          if (closed) return;
          // A non-default session can disappear mid-view (lanes come and
          // go). Close the connection honestly instead of leaving a frozen
          // last frame that looks live. The DEFAULT session deliberately
          // keeps the legacy tolerance: /restart-session kills and
          // recreates it, and connections are expected to ride that out.
          //
          // `code` is null (not 0) when the TMUX_TIMEOUT_MS timeout SIGTERMs
          // the child instead of it exiting normally — a transient tmux
          // slowdown, not proof the session is gone. Treating null as
          // `!== 0` force-disconnected live non-default-session viewers on
          // a single slow poll tick (server HIGH #299 H3); skip this tick
          // instead and let the next poll re-check.
          if (code !== 0 && code !== null && session !== TMUX_SESSION) {
            (ws as any)._cleanup?.();
            ws.send(JSON.stringify({ type: "error", message: `Session "${session}" ended` }));
            ws.close(4010, "Session ended");
            return;
          }
          // A timed-out capture's `output` is a partial read cut off by
          // SIGTERM, not a real frame — skip this tick entirely (don't
          // overwrite lastContent with truncated data) and let the next
          // 500ms poll retry cleanly.
          if (code === null) return;
          if (output !== lastContent) {
            lastContent = output;
            ws.send(JSON.stringify({ type: "pane", content: output }));
          }
        });

        capture.on("error", (err: Error) => {
          console.error("[tmux] capture error:", err.message);
        });
      };

      const startPolling = () => {
        if (closed) return;
        sendPaneContent();
        interval = setInterval(sendPaneContent, 500);
      };

      if (session === TMUX_SESSION) {
        // Default session: start immediately, tolerate absence (legacy
        // behavior — see the capture close handler above).
        startPolling();
      } else {
        // Client-picked session: prove it exists before polling it, so a
        // bogus (but charset-valid) name gets a crisp error instead of a
        // silently empty terminal. Exact-match `=` prefix, argv array.
        execFileAsync("tmux", ["has-session", "-t", `=${session}`], { timeout: TMUX_TIMEOUT_MS })
          .then(startPolling)
          .catch(() => {
            if (closed) return;
            console.log(`[ws] rejected: unknown session "${session}"`);
            ws.send(JSON.stringify({ type: "error", message: `Unknown session "${session}"` }));
            ws.close(4004, "Unknown session");
          });
      }
    },

    onMessage(event: MessageEvent, ws: WSContext) {
      // onMessage previously only logged on any branch (dead weight — the
      // "resize" case was a documented no-op). Now that a message type can
      // trigger a real `tmux resize-window` call, guard on the same
      // authResult computed in onOpen; onOpen already closes unauthorized
      // sockets, but this closes the gap if a message arrives before the
      // close takes effect.
      if (!authResult.ok) return;
      if (!sessionResolution.ok) return;
      try {
        const msg = JSON.parse(event.data.toString());
        if (msg.type === "fit") {
          // Fit resizes the REAL tmux window (a write). Only the default
          // session — the one the REST write endpoints already target — may
          // be resized; every client-picked session is view-only, so the
          // multi-session feature adds zero new write surface. Checked
          // before validation so applyFitResize (hardwired to TMUX_SESSION)
          // can never be reached from a view-only connection.
          if (sessionResolution.session !== TMUX_SESSION) {
            console.log(`[ws] fit rejected: view-only session "${sessionResolution.session}"`);
            ws.send(JSON.stringify({
              type: "fit-error",
              message: "This session is view-only — fit is only available on the default session",
            }));
            return;
          }
          // Explicit, user-initiated "Fit screen" action only — the client
          // never sends this automatically (see NOTE above). Validate
          // before touching tmux.
          const result = validateFitDimensions(msg);
          if (!result.ok) {
            console.log(`[ws] fit rejected: ${result.error}`);
            // Distinct "fit-error" type (not the generic "error" also used
            // for auth failures) so the client can pair it unambiguously
            // with "fit-ack" and surface a real failure instead of the
            // optimistic "requested" status sticking around. (Review
            // finding: client previously showed success regardless.)
            ws.send(JSON.stringify({ type: "fit-error", message: result.error }));
            return;
          }
          const { cols, rows } = result;
          applyFitResize(cols, rows)
            .then(() => {
              console.log(`[ws] fit applied: ${cols}x${rows}`);
              ws.send(JSON.stringify({ type: "fit-ack", cols, rows }));
            })
            .catch((err: Error) => {
              if (err instanceof FitLatchReleaseError) {
                // Fail LOUD and distinct: the resize itself already applied,
                // so "Failed to resize tmux window" would be actively
                // misleading here, and staying silent would reproduce the
                // Liam-msg-585 incident (latch stuck on "manual" with no
                // signal to anyone). Log with full cause + tell the client
                // resized:true so it doesn't think nothing happened.
                console.error(
                  `[tmux] fit resize applied (${cols}x${rows}) but the manual-size latch release FAILED — window-size may remain pinned to ${cols}x${rows} for other clients:`,
                  err.cause,
                );
                ws.send(JSON.stringify({
                  type: "fit-error",
                  message: "Resized, but could not release the tmux window-size latch — other terminals may stay pinned to this size until it's cleared manually.",
                  resized: true,
                }));
                return;
              }
              console.error("[tmux] fit resize error:", err.message);
              ws.send(JSON.stringify({ type: "fit-error", message: "Failed to resize tmux window" }));
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
