import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `GET /api/terminal/sessions` (multi-session terminal,
 * world-os#218). Covers:
 *
 *   1. `parseSessions` — the pure parser/sorter: infra-session filtering,
 *      allowlist-regex filtering, first-pane command mapping, alive
 *      detection, writable flag, and the "default first, then most recent
 *      activity" sort.
 *   2. Route behavior — happy path shape, and the tmux-server-down error
 *      path (500 + ok:false so the client can fall back to the default
 *      session instead of rendering an empty picker).
 */

const execFileCalls: { cmd: string; args: string[] }[] = [];
let tmuxFails = false;

const execFileMock = vi.fn((...fnArgs: any[]) => {
  const cmd = fnArgs[0] as string;
  const args = fnArgs[1] as string[];
  const callback = fnArgs.find((a) => typeof a === "function");
  execFileCalls.push({ cmd, args });
  if (tmuxFails) {
    callback?.(new Error("no server running on /tmp/tmux-1000/default"));
    return { kill: () => {} } as any;
  }
  let stdout = "";
  if (args[0] === "list-sessions") {
    stdout = [
      "_tmux-server-keepalive|0|1751900000",
      "claudes-world|1|1751900100",
      "do-box--lane-a|0|1751900300",
      "do-box--lane-b|0|1751900200",
      "bad;name|0|1751900400",
    ].join("\n") + "\n";
  } else if (args[0] === "list-panes") {
    stdout = [
      "_tmux-server-keepalive|sh",
      "claudes-world|claude",
      // Two panes for lane-a — the FIRST row must win.
      "do-box--lane-a|claude",
      "do-box--lane-a|bash",
      "do-box--lane-b|bash",
    ].join("\n") + "\n";
  }
  callback?.(null, { stdout, stderr: "" });
  return { kill: () => {} } as any;
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return { ...actual, execFile: execFileMock };
});

// Pin the default session so assertions don't depend on host env.
vi.mock("../utils.js", async () => {
  const actual = await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return { ...actual, TMUX_SESSION: "claudes-world" };
});

const { parseSessions, sessionsRoute } = await import("../terminal/sessions.js");

beforeEach(() => {
  execFileCalls.length = 0;
  execFileMock.mockClear();
  tmuxFails = false;
});

describe("parseSessions", () => {
  const LIST = [
    "claudes-world|1|100",
    "do-box--lane-a|0|300",
    "do-box--lane-b|0|200",
  ].join("\n");
  const PANES = [
    "claudes-world|claude",
    "do-box--lane-a|claude",
    "do-box--lane-b|bash",
  ].join("\n");

  it("maps fields, marks the default writable, sorts default-first then activity desc", () => {
    const sessions = parseSessions(LIST, PANES, "claudes-world");
    expect(sessions.map((s) => s.name)).toEqual([
      "claudes-world", // writable default pinned first despite lowest activity
      "do-box--lane-a", // activity 300
      "do-box--lane-b", // activity 200
    ]);
    expect(sessions[0]).toEqual({
      name: "claudes-world",
      attached: true,
      activity: 100,
      command: "claude",
      alive: true,
      writable: true,
    });
    expect(sessions[1].writable).toBe(false);
  });

  it("flags a bare-shell first pane as not alive", () => {
    const sessions = parseSessions(LIST, PANES, "claudes-world");
    const laneB = sessions.find((s) => s.name === "do-box--lane-b");
    expect(laneB?.alive).toBe(false);
    expect(laneB?.command).toBe("bash");
  });

  it("uses the FIRST pane row per session (lowest window/pane index)", () => {
    const sessions = parseSessions(
      "s1|0|1",
      "s1|claude\ns1|bash",
      "claudes-world",
    );
    expect(sessions[0].command).toBe("claude");
    expect(sessions[0].alive).toBe(true);
  });

  it("hides _-prefixed infra sessions", () => {
    const sessions = parseSessions("_keepalive|0|1\nreal|0|2", "", "claudes-world");
    expect(sessions.map((s) => s.name)).toEqual(["real"]);
  });

  it("drops names that fail the session-name allowlist", () => {
    // A name we'd refuse to poll must never be offered to the client.
    const sessions = parseSessions("bad;name|0|1\nok-name|0|2", "", "claudes-world");
    expect(sessions.map((s) => s.name)).toEqual(["ok-name"]);
  });

  it("drops list rows with extra fields instead of spoofing a real session", () => {
    const sessions = parseSessions(
      "real|0|100\nreal|1|9999999999|0|100",
      "real|bash",
      "claudes-world",
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ name: "real", attached: false, activity: 100 });
  });

  it("keeps the real command when its pane row precedes a pipe-name impostor", () => {
    const sessions = parseSessions(
      "real|0|100",
      "real|bash\nreal|x|claude",
      "claudes-world",
    );
    expect(sessions[0].command).toBe("bash");
  });

  it("ignores pane rows whose first-split name fails the allowlist", () => {
    const sessions = parseSessions("real|0|100", "real;garbage|claude", "claudes-world");
    expect(sessions[0].command).toBe("");
  });

  it("treats a session with no pane rows as not alive", () => {
    const sessions = parseSessions("ghost|0|1", "", "claudes-world");
    expect(sessions[0].alive).toBe(false);
    expect(sessions[0].command).toBe("");
  });

  it("uses a printable locale-safe separator and preserves separators in pane commands", () => {
    // "|" is outside SESSION_NAME_RE's allowed charset, while pane commands
    // are unconstrained and therefore must be split on the first "|" only.
    const sessions = parseSessions("safe-name|0|1", "safe-name|command|with|pipes", "claudes-world");
    expect(sessions[0].command).toBe("command|with|pipes");
  });
});

describe("GET /sessions", () => {
  it("returns the parsed roster and the default session name", async () => {
    const res = await sessionsRoute.request("/sessions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.default).toBe("claudes-world");
    expect(body.sessions.map((s: any) => s.name)).toEqual([
      "claudes-world",
      "do-box--lane-a",
      "do-box--lane-b",
    ]);
    // Charset-failing and _-prefixed names never reach the client.
    expect(body.sessions.map((s: any) => s.name)).not.toContain("bad;name");
    expect(body.sessions.map((s: any) => s.name)).not.toContain("_tmux-server-keepalive");
    // argv discipline: both tmux calls go through execFile with arrays.
    expect(execFileCalls.map((c) => c.args[0]).sort()).toEqual(["list-panes", "list-sessions"]);
    const formats = execFileCalls.map((c) => c.args.at(-1));
    expect(formats.every((format) => format?.includes("|") && !format.includes("\t"))).toBe(true);
  });

  it("returns 500 ok:false when tmux has no server running", async () => {
    tmuxFails = true;
    const res = await sessionsRoute.request("/sessions");
    expect(res.status).toBe(500);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });
});
