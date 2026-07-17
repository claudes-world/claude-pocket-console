import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `GET /api/terminal/sessions` (multi-session terminal,
 * world-os#218; metadata extension WORLD-416). Covers:
 *
 *   1. `parseSessions` — the pure parser/sorter: infra-session filtering,
 *      allowlist-regex filtering, first-pane pid+command mapping, alive
 *      detection, writable flag, harness mapping, name-convention tg
 *      fallback, and the "default first, then most recent activity" sort.
 *   2. Route behavior — happy path shape (host + environ-walk tg upgrade,
 *      panePid never serialized), and the tmux-server-down error path
 *      (500 + ok:false so the client can fall back to the default session
 *      instead of rendering an empty picker).
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
      "_tmux-server-keepalive|10|sh",
      "claudes-world|101|claude",
      // Two panes for lane-a — the FIRST row must win.
      "do-box--lane-a|102|claude",
      "do-box--lane-a|103|bash",
      "do-box--lane-b|104|bash",
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

// The environ walk needs a live /proc — mock the resolver (its own unit
// tests run against fixture trees) and keep the pure parsers real.
const resolveLaneBindingsMock = vi.fn(async (pids: number[]) => {
  const map = new Map<number, unknown>();
  for (const pid of pids) map.set(pid, null);
  // Pane 101 (claudes-world) carries a real environ binding — proves the
  // walk result overrides the name fallback (claudes-world parses to none)
  // and that agent survives to the response.
  if (map.has(101)) map.set(101, { agent: "pm-dobot", group: "do-box", topic: "orch" });
  return map;
});
vi.mock("../../lib/lane-binding.js", async () => {
  const actual = await vi.importActual<typeof import("../../lib/lane-binding.js")>("../../lib/lane-binding.js");
  return { ...actual, resolveLaneBindings: resolveLaneBindingsMock };
});

const { parseSessions, sessionsRoute } = await import("../terminal/sessions.js");

beforeEach(() => {
  execFileCalls.length = 0;
  execFileMock.mockClear();
  resolveLaneBindingsMock.mockClear();
  tmuxFails = false;
});

describe("parseSessions", () => {
  const LIST = [
    "claudes-world|1|100",
    "do-box--lane-a|0|300",
    "do-box--lane-b|0|200",
  ].join("\n");
  const PANES = [
    "claudes-world|101|claude",
    "do-box--lane-a|102|claude",
    "do-box--lane-b|103|bash",
  ].join("\n");

  it("maps fields, marks the default writable, sorts default-first then activity desc", () => {
    const sessions = parseSessions(LIST, PANES, "claudes-world", "do-box");
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
      host: "do-box",
      harness: "claude",
      tg: null, // no "--" in the name, no environ walk at parse level
      panePid: 101,
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
      "s1|11|claude\ns1|12|bash",
      "claudes-world",
    );
    expect(sessions[0].command).toBe("claude");
    expect(sessions[0].alive).toBe(true);
    expect(sessions[0].panePid).toBe(11);
  });

  it("maps harness from the pane command and null for unknown commands", () => {
    const sessions = parseSessions(
      "a|0|3\nb|0|2\nc|0|1",
      "a|1|claude\nb|2|codex\nc|3|vim",
      "none",
    );
    expect(sessions.map((s) => [s.name, s.harness])).toEqual([
      ["a", "claude"],
      ["b", "codex"],
      ["c", null],
    ]);
  });

  it("derives a tg fallback from <group>--<topic> names with agent null", () => {
    const sessions = parseSessions(LIST, PANES, "claudes-world");
    const laneA = sessions.find((s) => s.name === "do-box--lane-a");
    expect(laneA?.tg).toEqual({ agent: null, group: "do-box", topic: "lane-a" });
    expect(sessions.find((s) => s.name === "claudes-world")?.tg).toBeNull();
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
      "real|11|bash",
      "claudes-world",
    );
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ name: "real", attached: false, activity: 100 });
  });

  it("keeps the real pid+command when its pane row precedes a pipe-name impostor", () => {
    const sessions = parseSessions(
      "real|0|100",
      "real|11|bash\nreal|x|12|claude",
      "claudes-world",
    );
    expect(sessions[0].command).toBe("bash");
    expect(sessions[0].panePid).toBe(11);
  });

  it("nulls the pane pid on a non-numeric pid field instead of trusting it", () => {
    const sessions = parseSessions("real|0|100", "real|x|claude", "claudes-world");
    expect(sessions[0].panePid).toBeNull();
    expect(sessions[0].command).toBe("claude");
  });

  it("ignores pane rows whose first-split name fails the allowlist", () => {
    const sessions = parseSessions("real|0|100", "real;garbage|11|claude", "claudes-world");
    expect(sessions[0].command).toBe("");
    expect(sessions[0].panePid).toBeNull();
  });

  it("treats a session with no pane rows as not alive", () => {
    const sessions = parseSessions("ghost|0|1", "", "claudes-world");
    expect(sessions[0].alive).toBe(false);
    expect(sessions[0].command).toBe("");
    expect(sessions[0].panePid).toBeNull();
  });

  it("uses a printable locale-safe separator and preserves separators in pane commands", () => {
    // "|" is outside SESSION_NAME_RE's allowed charset, while pane commands
    // are unconstrained and therefore must keep every "|" after the pid field.
    const sessions = parseSessions("safe-name|0|1", "safe-name|11|command|with|pipes", "claudes-world");
    expect(sessions[0].command).toBe("command|with|pipes");
    expect(sessions[0].panePid).toBe(11);
  });
});

describe("GET /sessions", () => {
  it("returns the parsed roster, default session, host, and walked tg bindings", async () => {
    const res = await sessionsRoute.request("/sessions");
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.ok).toBe(true);
    expect(body.default).toBe("claudes-world");
    expect(typeof body.host).toBe("string");
    expect(body.host.length).toBeGreaterThan(0);
    expect(body.sessions.map((s: any) => s.name)).toEqual([
      "claudes-world",
      "do-box--lane-a",
      "do-box--lane-b",
    ]);
    // Charset-failing and _-prefixed names never reach the client.
    expect(body.sessions.map((s: any) => s.name)).not.toContain("bad;name");
    expect(body.sessions.map((s: any) => s.name)).not.toContain("_tmux-server-keepalive");

    const [orch, laneA, laneB] = body.sessions;
    // Environ-walk result (pid 101) overrides the (absent) name fallback.
    expect(orch.tg).toEqual({ agent: "pm-dobot", group: "do-box", topic: "orch" });
    // No walk hit -> name-convention fallback with agent null.
    expect(laneA.tg).toEqual({ agent: null, group: "do-box", topic: "lane-a" });
    expect(laneB.tg).toEqual({ agent: null, group: "do-box", topic: "lane-b" });
    expect(orch.harness).toBe("claude");
    expect(laneB.harness).toBeNull();
    // Per-session host mirrors the top-level one; pane pids stay internal.
    expect(body.sessions.every((s: any) => s.host === body.host)).toBe(true);
    expect(body.sessions.every((s: any) => !("panePid" in s))).toBe(true);

    // The walk was asked about exactly the visible sessions' pane pids.
    expect(resolveLaneBindingsMock).toHaveBeenCalledWith([101, 102, 104]);

    // argv discipline: both tmux calls go through execFile with arrays.
    expect(execFileCalls.map((c) => c.args[0]).sort()).toEqual(["list-panes", "list-sessions"]);
    const formats = execFileCalls.map((c) => c.args.at(-1));
    expect(formats.every((format) => format?.includes("|") && !format.includes("\t"))).toBe(true);
    // The pane query must carry the pid between name and command.
    const paneFormat = execFileCalls.find((c) => c.args[0] === "list-panes")?.args.at(-1);
    expect(paneFormat).toBe("#{session_name}|#{pane_pid}|#{pane_current_command}");
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
