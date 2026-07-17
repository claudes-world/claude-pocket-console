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
 * they ignore a `session` field entirely (never retarget). /restart-session
 * does probe the DEFAULT session, to pick between respawning its live pane
 * and cold-starting via cw-launch (WORLD-415); that probe never touches a
 * client-supplied name.
 */

const execFileCalls: { cmd: string; args: string[] }[] = [];
const execCalls: string[] = [];
/** Session names `tmux has-session` should report as existing. */
let existingSessions = new Set<string>();

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
  // Mirrors real tmux: `list-panes -F '#{session_name}:#{window_index}.#{pane_index}'`
  // prints one target line per matching pane (base-index is 1 on this host).
  if (args[0] === "list-panes") {
    const target = (args[args.indexOf("-t") + 1] || "").replace(/^=/, "");
    callback?.(null, { stdout: `${target}:1.1\n`, stderr: "" });
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

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, execFile: execFileMock, exec: execMock };
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
  execFileMock.mockClear();
  execMock.mockClear();
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

  it("/restart-session never retargets, and respawns the default session's own pane", async () => {
    existingSessions.add(TMUX_SESSION);
    const { status } = await post("/restart-session", { session: "do-box--lane-a" });
    expect(status).toBe(200);
    // The probe is the default session's own liveness check — never the client's.
    expect(probeCalls().map((c) => c.args)).toEqual([["has-session", "-t", `=${TMUX_SESSION}`]]);
    expect(execFileCalls.some((c) => c.args.some((a) => a.includes("do-box--lane-a")))).toBe(false);
    expect(execFileCalls.find((c) => c.args[0] === "respawn-pane")?.args).toEqual([
      "respawn-pane", "-k", "-t", `${TMUX_SESSION}:1.1`,
    ]);
    // Pin the lookup argv: without `-f #{pane_active}` a multi-pane session
    // lists every pane and we would respawn whichever sorted first.
    expect(execFileCalls.find((c) => c.args[0] === "list-panes")?.args).toEqual([
      "list-panes",
      "-t", `=${TMUX_SESSION}`,
      "-F", "#{session_name}:#{window_index}.#{pane_index}",
      "-f", "#{pane_active}",
    ]);
  });

  /**
   * WORLD-415 regression. The old handler killed the session and rebuilt the
   * claude command inline; that copy drifted from cw-launch and silently
   * restarted the orchestrator into a week-old session. Respawning the pane
   * re-runs the pane's OWN start command, so CPC never holds launch config.
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

  it("/restart-session falls back to the canonical launcher when the session is gone", async () => {
    // existingSessions is empty → `has-session` fails → nothing to respawn.
    const { status } = await post("/restart-session");
    expect(status).toBe(200);
    expect(execFileCalls.some((c) => c.cmd.endsWith("cw-launch"))).toBe(true);
    expect(execFileCalls.some((c) => c.args[0] === "respawn-pane")).toBe(false);
  });
});
