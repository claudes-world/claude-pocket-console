import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Session-targeting tests for the restricted command palette endpoints
 * (send-keys / compact / reload-plugins — world-os#218, Liam voice msg
 * 1188: the palette targets the tmux session the terminal tab is viewing).
 *
 * Covers, per endpoint:
 *   - a valid non-default `session` body field is existence-checked
 *     (`tmux has-session -t =<name>`) and then targeted with the
 *     exact-match `=` prefix;
 *   - an invalid session name is rejected 400 BEFORE any tmux call;
 *   - an unknown (charset-valid) session is rejected 404 after the probe,
 *     and no keys are ever sent;
 *   - the absent-session legacy path still targets the default session
 *     with NO existence probe.
 *
 * Also: /restart-session and /resize-terminal remain default-session-only —
 * they ignore a `session` field entirely (never retarget).
 *
 * /restart-session (WORLD-415) finds the orchestrator by ROLE — the pane
 * cw-launch tags `@cpc-role=orchestrator` — and never by position, because
 * `renumber-windows` is on and indices are reassigned when a window dies. It
 * respawns that pane if present, else cold-starts via cw-launch. Neither the
 * role lookup nor the cold start ever touches a client-supplied name, and
 * neither ever kills a pane it cannot identify.
 */

const execFileCalls: { cmd: string; args: string[] }[] = [];
const execCalls: string[] = [];
/** Session names `tmux has-session` should report as existing. */
let existingSessions = new Set<string>();
/**
 * Panes in the fake tmux session: [pane_id, @cpc-role]. An empty role is an
 * untagged pane (an SSH tab, a split). Mirrors real tmux, where an unset pane
 * option formats as the empty string.
 */
let sessionPanes: [string, string][] = [["%1", "orchestrator"]];

const execFileMock = vi.fn((...fnArgs: any[]) => {
  const cmd = fnArgs[0] as string;
  const args = fnArgs[1] as string[];
  const callback = fnArgs.find((a) => typeof a === "function");
  execFileCalls.push({ cmd, args });
  if (args[0] === "has-session") {
    const target = (args[args.indexOf("-t") + 1] || "").replace(/^=/, "");
    if (!existingSessions.has(target)) {
      callback?.(new Error(`can't find session: ${target}`));
      return { kill: () => {} } as any;
    }
  }
  // Renders the requested -F fields per pane. Only the two formats the handler
  // uses are modelled. An unset @cpc-role formats as "" (real tmux behaviour),
  // which is what makes the "untagged panes must never be a candidate" tests
  // meaningful.
  if (args[0] === "list-panes") {
    const format = args[args.indexOf("-F") + 1] || "";
    const rows = sessionPanes.map(([paneId, role]) =>
      // Substitute verbatim, exactly as tmux does — including role values that
      // contain spaces. Faithfulness here is the point: a role-first format
      // mis-parses such a value, and this mock must be able to expose that.
      format
        .replace("#{@cpc-role}", role)
        .replace("#{pane_id}", paneId),
    );
    callback?.(null, { stdout: rows.join("\n") + (rows.length ? "\n" : ""), stderr: "" });
    return { kill: () => {} } as any;
  }
  callback?.(null, { stdout: "", stderr: "" });
  return { kill: () => {} } as any;
});

const execMock = vi.fn((...fnArgs: any[]) => {
  execCalls.push(fnArgs[0] as string);
  const callback = fnArgs.find((a) => typeof a === "function");
  callback?.(null, { stdout: "", stderr: "" });
  return { kill: () => {} } as any;
});

/**
 * Cold start spawns the launcher detached. The fake launcher does what the real
 * one does — makes the session exist — so `coldStartDetached`'s confirm poll
 * can succeed. `unref` is asserted on: forgetting it would keep the request's
 * event loop tied to a process that runs for up to 300s.
 */
const spawnCalls: { cmd: string; opts: any; unrefCalled: boolean }[] = [];
const spawnMock = vi.fn((cmd: string, _args: string[], opts: any) => {
  const record = { cmd, opts, unrefCalled: false };
  spawnCalls.push(record);
  if (launcherOutcome === "starts-orchestrator") {
    existingSessions.add(TMUX_SESSION);
    sessionPanes = [["%200", "orchestrator"]];
  } else if (launcherOutcome === "noop-session-occupied") {
    // cw-launch is attach-or-start: a live session means "nothing to do", so an
    // occupied-but-orchestrator-less session gets NO new orchestrator.
    existingSessions.add(TMUX_SESSION);
  }
  return { unref: () => { record.unrefCalled = true; } } as any;
});
let launcherOutcome: "starts-orchestrator" | "noop-session-occupied" | "fails" = "starts-orchestrator";

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, execFile: execFileMock, exec: execMock, spawn: spawnMock };
});

vi.mock("../utils.js", async () => {
  const actual = await vi.importActual<typeof import("../utils.js")>("../utils.js");
  // Keep the real resolveTargetSession/tmuxSessionExists/sendToTmux — only
  // pin the default session name. NOTE: utils' own helpers close over the
  // real module-scope TMUX_SESSION ("claudes-world" by default env), so the
  // pin must match what utils resolved to keep default-path assertions
  // meaningful. The test env has no TMUX_SESSION set → "claudes-world".
  return { ...actual, TMUX_SESSION: actual.TMUX_SESSION };
});

const { slashCommandsRoute } = await import("../terminal/slash-commands.js");
const { TMUX_SESSION } = await import("../utils.js");

beforeEach(() => {
  execFileCalls.length = 0;
  execCalls.length = 0;
  existingSessions = new Set();
  sessionPanes = [["%1", "orchestrator"]];
  launcherOutcome = "starts-orchestrator";
  spawnCalls.length = 0;
  execFileMock.mockClear();
  execMock.mockClear();
  spawnMock.mockClear();
});

async function post(path: string, body?: unknown) {
  const res = await slashCommandsRoute.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const sendKeysCalls = () => execFileCalls.filter((c) => c.args[0] === "send-keys");
const probeCalls = () => execFileCalls.filter((c) => c.args[0] === "has-session");

describe("/send-keys session targeting", () => {
  it("targets a valid existing session with the exact-match prefix, after probing it", async () => {
    existingSessions.add("do-box--lane-a");
    const { status, body } = await post("/send-keys", { keys: "Escape", raw: true, session: "do-box--lane-a" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(probeCalls()[0]?.args).toEqual(["has-session", "-t", "=do-box--lane-a"]);
    expect(sendKeysCalls()[0]?.args).toEqual(["send-keys", "-t", "=do-box--lane-a:", "Escape"]);
  });

  it("targets the selected session on the literal path too", async () => {
    existingSessions.add("do-box--lane-a");
    const { status } = await post("/send-keys", { keys: "2", session: "do-box--lane-a" });
    expect(status).toBe(200);
    expect(sendKeysCalls().map((c) => c.args)).toEqual([
      ["send-keys", "-t", "=do-box--lane-a:", "-l", "--", "2"],
      ["send-keys", "-t", "=do-box--lane-a:", "Enter"],
    ]);
  });

  it("rejects a multi-line literal payload to a non-default session 400 without sending", async () => {
    existingSessions.add("do-box--lane-a");
    const { status, body } = await post("/send-keys", { keys: "ls\nrm -rf /", session: "do-box--lane-a" });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(sendKeysCalls()).toHaveLength(0);
  });

  it("still allows a multi-line literal payload for the default session", async () => {
    const { status } = await post("/send-keys", { keys: "/fork\n/rename x" });
    expect(status).toBe(200);
    expect(sendKeysCalls()[0]?.args).toEqual([
      "send-keys", "-t", `=${TMUX_SESSION}:`, "-l", "--", "/fork\n/rename x",
    ]);
  });

  it("rejects an invalid session name 400 before any tmux call", async () => {
    const { status, body } = await post("/send-keys", { keys: "Escape", raw: true, session: "bad;name" });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(execFileCalls).toHaveLength(0);
  });

  it("rejects an unknown session 404 and never sends keys", async () => {
    const { status, body } = await post("/send-keys", { keys: "Escape", raw: true, session: "do-box--gone" });
    expect(status).toBe(404);
    expect(body.error).toMatch(/unknown session/);
    expect(sendKeysCalls()).toHaveLength(0);
  });

  it("keeps the legacy default path: no session field → default target, no probe", async () => {
    const { status } = await post("/send-keys", { keys: "Escape", raw: true });
    expect(status).toBe(200);
    expect(probeCalls()).toHaveLength(0);
    expect(sendKeysCalls()[0]?.args).toEqual(["send-keys", "-t", `=${TMUX_SESSION}:`, "Escape"]);
  });
});

describe("/compact session targeting", () => {
  it("sends the compact message to the selected session", async () => {
    existingSessions.add("do-box--lane-a");
    const { status } = await post("/compact", { message: "/compact", session: "do-box--lane-a" });
    expect(status).toBe(200);
    expect(sendKeysCalls().map((c) => c.args)).toEqual([
      ["send-keys", "-t", "=do-box--lane-a:", "-l", "--", "/compact"],
      ["send-keys", "-t", "=do-box--lane-a:", "Enter"],
    ]);
  });

  it("rejects unknown sessions 404 without sending", async () => {
    const { status } = await post("/compact", { message: "/compact", session: "do-box--gone" });
    expect(status).toBe(404);
    expect(sendKeysCalls()).toHaveLength(0);
  });

  it("accepts a single-line free-text message for a non-default session", async () => {
    existingSessions.add("do-box--lane-a");
    const { status } = await post("/compact", {
      message: "/compact keep context on X",
      session: "do-box--lane-a",
    });
    expect(status).toBe(200);
    expect(sendKeysCalls()[0]?.args).toEqual([
      "send-keys", "-t", "=do-box--lane-a:", "-l", "--", "/compact keep context on X",
    ]);
  });

  it("rejects a multi-line message to a non-default session 400 without sending (newline injection)", async () => {
    existingSessions.add("do-box--lane-a");
    const { status, body } = await post("/compact", {
      message: "/compact\nrm -rf /",
      session: "do-box--lane-a",
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(sendKeysCalls()).toHaveLength(0);
  });

  it("still accepts a multi-line message for the default session (Liam's own)", async () => {
    const { status } = await post("/compact", { message: "/fork\n/rename x" });
    expect(status).toBe(200);
    expect(sendKeysCalls()[0]?.args).toEqual([
      "send-keys", "-t", `=${TMUX_SESSION}:`, "-l", "--", "/fork\n/rename x",
    ]);
  });
});

describe("/reload-plugins session targeting", () => {
  it("tolerates a missing body (legacy clients) and targets the default session", async () => {
    const { status, body } = await post("/reload-plugins");
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(probeCalls()).toHaveLength(0);
    expect(sendKeysCalls()[0]?.args).toEqual([
      "send-keys", "-t", `=${TMUX_SESSION}:`, "-l", "--", "/reload-plugins",
    ]);
  });

  it("targets the selected session when given one", async () => {
    existingSessions.add("do-box--lane-a");
    const { status } = await post("/reload-plugins", { session: "do-box--lane-a" });
    expect(status).toBe(200);
    expect(sendKeysCalls()[0]?.args).toEqual([
      "send-keys", "-t", "=do-box--lane-a:", "-l", "--", "/reload-plugins",
    ]);
  });

  it("rejects invalid session names 400", async () => {
    const { status } = await post("/reload-plugins", { session: "a b c" });
    expect(status).toBe(400);
    expect(execFileCalls).toHaveLength(0);
  });
});

describe("default-session-only endpoints ignore session fields", () => {
  it("/resize-terminal never probes or retargets", async () => {
    const { status } = await post("/resize-terminal", { session: "do-box--lane-a" });
    expect(status).toBe(200);
    expect(probeCalls()).toHaveLength(0);
    // Runs through execAsync (shell) against the default session, as before.
    expect(execCalls.some((cmd) => cmd.includes(`resize-window -t ${TMUX_SESSION}`))).toBe(true);
  });

  it("/restart-session never retargets: a client session field is ignored entirely", async () => {
    existingSessions.add(TMUX_SESSION);
    const { status, body } = await post("/restart-session", { session: "do-box--lane-a" });
    expect(status).toBe(200);
    expect(body.path).toBe("respawned-tagged-pane");
    // The probe is the default session's own liveness check — never the client's.
    expect(probeCalls().map((c) => c.args)).toEqual([["has-session", "-t", `=${TMUX_SESSION}`]]);
    expect(execFileCalls.some((c) => c.args.some((a) => a.includes("do-box--lane-a")))).toBe(false);
  });

  it("/restart-session respawns the pane tagged @cpc-role=orchestrator, by pane id", async () => {
    existingSessions.add(TMUX_SESSION);
    sessionPanes = [["%9", ""], ["%183", "orchestrator"], ["%12", ""]];

    const { status, body } = await post("/restart-session");
    expect(status).toBe(200);
    expect(body.path).toBe("respawned-tagged-pane");
    expect(execFileCalls.find((c) => c.args[0] === "respawn-pane")?.args).toEqual([
      "respawn-pane", "-k", "-t", "%183",
    ]);
    // Session-wide, and pane_id FIRST — see the spaced-role test below.
    expect(execFileCalls.find((c) => c.args[0] === "list-panes")?.args).toEqual([
      "list-panes", "-s", "-t", `=${TMUX_SESSION}`, "-F", "#{pane_id} #{@cpc-role}",
    ]);
  });

  /**
   * `@cpc-role` is a user-settable tmux option and its value can contain
   * spaces (verified: `set-option -p @cpc-role "orchestrator x"` renders as
   * `orchestrator x %229`). With a role-FIRST format the split yielded
   * paneId="x". pane_id can never contain a space, so it must lead.
   * A role that merely starts with "orchestrator" is not the role.
   */
  it("/restart-session does not treat a spaced role value as the orchestrator", async () => {
    existingSessions.add(TMUX_SESSION);
    sessionPanes = [["%229", "orchestrator x"]];

    const { body } = await post("/restart-session");
    // No exact-role pane => nothing to respawn => cold start, not a mis-parse.
    expect(execFileCalls.some((c) => c.args[0] === "respawn-pane")).toBe(false);
    expect(body.path).toBe("cold-started-fresh");
  });

  it("/restart-session refuses to guess when two panes claim the role", async () => {
    existingSessions.add(TMUX_SESSION);
    sessionPanes = [["%1", "orchestrator"], ["%2", "orchestrator"]];

    const { status, body } = await post("/restart-session");
    expect(status).toBe(500);
    expect(body.error).toMatch(/ambiguous: 2 panes claim/);
    expect(execFileCalls.some((c) => c.args[0] === "respawn-pane")).toBe(false);
    expect(spawnCalls).toHaveLength(0);
  });

  /**
   * PR #335 rounds 1+2 — both wrong-kill bugs in one assertion. Positional
   * targeting killed a bystander (the selected window; then the SSH tab that
   * inherited slot 1 after the orchestrator's window died) while the
   * orchestrator went unrestarted and the call still returned ok:true.
   * renumber-windows is ON globally, so index is never identity: an untagged
   * pane must NEVER be a respawn candidate, whatever slot it occupies.
   */
  it("/restart-session never kills an untagged pane — it cold-starts instead", async () => {
    existingSessions.add(TMUX_SESSION);
    existingSessions.add(TMUX_SESSION);
    sessionPanes = [["%77", ""]]; // orchestrator window died; only an SSH tab survives

    const { status, body } = await post("/restart-session");
    expect(status).toBe(200);
    expect(execFileCalls.some((c) => c.args[0] === "respawn-pane")).toBe(false);
    expect(body.path).toBe("cold-started-fresh");
    expect(spawnCalls).toHaveLength(1);
  });

  /**
   * WORLD-415 regression. The old handler killed the session and rebuilt the
   * claude command inline; that copy drifted from cw-launch and silently
   * restarted the orchestrator into a week-old session.
   */
  it("/restart-session never reconstructs a claude launch command", async () => {
    existingSessions.add(TMUX_SESSION);
    await post("/restart-session");
    const issued = [...execCalls, ...execFileCalls.flatMap((c) => [c.cmd, ...c.args])].join(" ");
    expect(issued).not.toContain("kill-session");
    expect(issued).not.toContain("new-session");
    expect(issued).not.toContain("claude-plugins-official");
    expect(issued).not.toContain("--continue");
  });

  it("/restart-session cold-starts detached via the launcher when the session is gone", async () => {
    // existingSessions empty → has-session fails → no pane can be tagged.
    const { status, body } = await post("/restart-session");
    expect(status).toBe(200);
    expect(body.path).toBe("cold-started-fresh");
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.cmd.endsWith("cw-launch")).toBe(true);
    // Detached + unref'd, or the request stays tethered to cw-boot-confirm's
    // 300s loop; and create-only — a cold start must never kill anything.
    expect(spawnCalls[0]?.opts?.detached).toBe(true);
    expect(spawnCalls[0]?.unrefCalled).toBe(true);
    expect(execFileCalls.some((c) => ["respawn-pane", "kill-session", "kill-pane"].includes(c.args[0]!))).toBe(false);
  });

  // Deliberately outlasts COLD_START_CONFIRM_MS (5s): this test exercises the
  // real confirm poll expiring, so it needs more headroom than vitest's default.
  it("/restart-session reports 500 when the launcher never starts anything", async () => {
    launcherOutcome = "fails";
    const { status, body } = await post("/restart-session");
    expect(status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/did not produce an orchestrator pane/);
  }, 15_000);

  /**
   * Confirming a cold start on SESSION existence would report a phantom
   * success here: cw-launch is attach-or-start, so an occupied session with no
   * orchestrator makes it no-op and start nothing — while `has-session` says
   * true the whole time. Observed live before the confirm was tightened:
   * `{"path":"cold-started-fresh"}` with no orchestrator pane in existence.
   * The confirm must check the TAGGED PANE, and this case must fail loudly.
   */
  it("/restart-session does not report a phantom cold start when the session is occupied but orchestrator-less", async () => {
    existingSessions.add(TMUX_SESSION);
    sessionPanes = [["%77", ""]];      // SSH tab holding the session open
    launcherOutcome = "noop-session-occupied";

    const { status, body } = await post("/restart-session");
    expect(status).toBe(500);
    expect(body.error).toMatch(/did not produce an orchestrator pane/);
    // Never kills the bystander to force a cold start.
    expect(execFileCalls.some((c) => ["respawn-pane", "kill-session", "kill-pane"].includes(c.args[0]!))).toBe(false);
  }, 15_000);
});
