import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../../auth.js";

/**
 * Multi-session WS tests (world-os#218): the `?session=` query param on
 * /ws/terminal. Covers:
 *
 *   1. `resolveRequestedSession` — charset fence on the client-controlled
 *      param; absent = default session.
 *   2. onOpen wiring — an invalid name closes 4004 without any tmux call;
 *      a valid non-default name is existence-checked (`tmux has-session -t
 *      =<name>`) BEFORE polling starts, and capture-pane targets the
 *      exact-match `=<name>`; an unknown session closes 4004 after the
 *      probe; the default session starts polling with no probe (legacy
 *      restart-tolerance).
 *   3. onMessage "fit" — the single sanctioned session-scoped write
 *      resizes the viewed session; the default session keeps its existing
 *      behavior. Every other WS write-shaped message remains inert.
 */

const TEST_USER_ID = "999222";

let savedBotToken: string | undefined;
let savedAllowed: string | undefined;

beforeAll(() => {
  savedBotToken = process.env.TELEGRAM_BOT_TOKEN;
  savedAllowed = process.env.ALLOWED_TELEGRAM_USERS;
  process.env.TELEGRAM_BOT_TOKEN = "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11";
  process.env.ALLOWED_TELEGRAM_USERS = TEST_USER_ID;
});

afterAll(() => {
  if (savedBotToken === undefined) {
    delete process.env.TELEGRAM_BOT_TOKEN;
  } else {
    process.env.TELEGRAM_BOT_TOKEN = savedBotToken;
  }
  if (savedAllowed === undefined) {
    delete process.env.ALLOWED_TELEGRAM_USERS;
  } else {
    process.env.ALLOWED_TELEGRAM_USERS = savedAllowed;
  }
});

const execFileCalls: { cmd: string; args: string[] }[] = [];
const spawnCalls: { cmd: string; args: string[] }[] = [];
/** Session names `tmux has-session` should report as existing. */
let existingSessions = new Set<string>();

/**
 * Fake capture-pane child processes, one per spawn() call, so tests can
 * drive the "close" handler directly (simulating a normal exit, a
 * SIGTERM-from-timeout null code, or a real nonzero failure) without
 * shelling out to a real tmux. Mirrors the H3 (server #299) poll shape:
 * `capture.stdout.on("data", ...)` then `capture.on("close", (code) => ...)`.
 */
type FakeCaptureChild = {
  emitData: (chunk: string) => void;
  emitClose: (code: number | null) => void;
};
let spawnedCaptures: FakeCaptureChild[] = [];

const mockExecFile = vi.fn((...fnArgs: any[]) => {
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
  callback?.(null, { stdout: "", stderr: "" });
  return { kill: () => {} } as any;
});

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn((cmd: string, args: string[]) => {
      spawnCalls.push({ cmd, args });
      const dataHandlers: ((chunk: Buffer) => void)[] = [];
      const closeHandlers: ((code: number | null) => void)[] = [];
      const child = {
        stdout: {
          on: vi.fn((event: string, cb: (chunk: Buffer) => void) => {
            if (event === "data") dataHandlers.push(cb);
          }),
        },
        on: vi.fn((event: string, cb: (code: number | null) => void) => {
          if (event === "close") closeHandlers.push(cb);
        }),
      };
      spawnedCaptures.push({
        emitData: (chunk: string) => dataHandlers.forEach((cb) => cb(Buffer.from(chunk))),
        emitClose: (code: number | null) => closeHandlers.forEach((cb) => cb(code)),
      });
      return child;
    }),
    execFileSync: vi.fn(() => "80x24"),
    execFile: mockExecFile,
  };
});

// Mock utils to pin the default session (same pattern as
// terminal-ws-auth.test.ts / terminal-ws-fit.test.ts).
vi.mock("../utils.js", async () => {
  const actual = await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return { ...actual, TMUX_SESSION: "test-session" };
});

const { terminalWsRoute, resolveRequestedSession } = await import("../terminal-ws.js");

function makeMockContext(query: Record<string, string>, headers: Record<string, string> = {}) {
  return {
    req: {
      query: (key: string) => query[key] || "",
      header: (key: string) => headers[key.toLowerCase()],
    },
  };
}

function makeMockWs() {
  const sent: string[] = [];
  return {
    send: vi.fn((data: string) => sent.push(data)),
    close: vi.fn(),
    _sent: sent,
  };
}

/** Open an authenticated socket, optionally viewing a specific session. */
function connectWs(session?: string) {
  const token = createSession({ id: Number(TEST_USER_ID), first_name: "Allowed" });
  const query: Record<string, string> = { token };
  if (session !== undefined) query.session = session;
  const c = makeMockContext(query, { origin: "https://cpc.claude.do" });
  const handlers = terminalWsRoute(c);
  const ws = makeMockWs();
  handlers.onOpen(new Event("open"), ws as any);
  return { handlers, ws };
}

/** Let pending promises (the async has-session gate) settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  execFileCalls.length = 0;
  spawnCalls.length = 0;
  spawnedCaptures = [];
  existingSessions = new Set();
  vi.clearAllMocks();
});

describe("resolveRequestedSession", () => {
  it("falls back to the default session when the param is absent", () => {
    expect(resolveRequestedSession("")).toEqual({ ok: true, session: "test-session" });
  });

  it("accepts a charset-valid session name", () => {
    expect(resolveRequestedSession("do-box--lane_1.a")).toEqual({
      ok: true,
      session: "do-box--lane_1.a",
    });
  });

  it("rejects shell/tmux metacharacters and over-long names", () => {
    for (const bad of ["a;b", "a b", "a$(x)", "a|b", "../x", "a\nb", "a".repeat(65)]) {
      expect(resolveRequestedSession(bad).ok).toBe(false);
    }
  });
});

describe("terminalWsRoute onOpen: session targeting", () => {
  it("closes 4004 on an invalid session name without touching tmux", async () => {
    const { ws } = connectWs("bad;name");
    await flush();
    expect(ws.close).toHaveBeenCalledWith(4004, "Invalid session");
    expect(ws._sent.some((m) => JSON.parse(m).type === "error")).toBe(true);
    expect(execFileCalls).toHaveLength(0);
    expect(spawnCalls).toHaveLength(0);
  });

  it("existence-checks a non-default session before polling, then captures with exact-match target", async () => {
    existingSessions.add("do-box--lane-a");
    const { handlers, ws } = connectWs("do-box--lane-a");
    await flush();
    // has-session probe ran with the exact-match `=` prefix
    const probe = execFileCalls.find((c) => c.args[0] === "has-session");
    expect(probe?.args).toEqual(["has-session", "-t", "=do-box--lane-a"]);
    // capture-pane targets the same exact-match session
    expect(spawnCalls.length).toBeGreaterThan(0);
    expect(spawnCalls[0].args).toEqual(["capture-pane", "-t", "=do-box--lane-a:", "-p", "-e", "-J"]);
    expect(ws.close).not.toHaveBeenCalled();
    handlers.onClose(new Event("close"), ws as any); // clear the poll interval
  });

  it("closes 4004 on an unknown (but charset-valid) session, and never polls it", async () => {
    const { ws } = connectWs("do-box--gone");
    await flush();
    expect(ws.close).toHaveBeenCalledWith(4004, "Unknown session");
    expect(ws._sent.some((m) => {
      const msg = JSON.parse(m);
      return msg.type === "error" && /unknown session/i.test(msg.message);
    })).toBe(true);
    expect(spawnCalls).toHaveLength(0);
  });

  it("starts the default session immediately with no existence probe (legacy restart tolerance)", async () => {
    const { handlers, ws } = connectWs();
    await flush();
    expect(execFileCalls.find((c) => c.args[0] === "has-session")).toBeUndefined();
    expect(spawnCalls[0].args).toEqual(["capture-pane", "-t", "=test-session:", "-p", "-e", "-J"]);
    handlers.onClose(new Event("close"), ws as any);
  });
});

describe("terminalWsRoute capture-pane poll: null (timeout) exit code is transient (server #299 H3)", () => {
  it("does NOT disconnect a non-default session on a null (SIGTERM/timeout) exit code", async () => {
    existingSessions.add("do-box--lane-a");
    const { handlers, ws } = connectWs("do-box--lane-a");
    await flush();
    expect(spawnedCaptures).toHaveLength(1);

    // Simulate the TMUX_TIMEOUT_MS SIGTERM path: spawn's `timeout` option
    // kills the child and Node reports a null exit code, not a real tmux
    // failure signaling the session is gone.
    spawnedCaptures[0].emitData("partial, truncated frame");
    spawnedCaptures[0].emitClose(null);
    await flush();

    expect(ws.close).not.toHaveBeenCalled();
    // The truncated partial output must NOT be sent as a real frame.
    expect(ws._sent.some((m) => JSON.parse(m).type === "pane")).toBe(false);
    handlers.onClose(new Event("close"), ws as any);
  });

  it("still disconnects a non-default session on a real nonzero exit code", async () => {
    existingSessions.add("do-box--lane-a");
    const { handlers, ws } = connectWs("do-box--lane-a");
    await flush();
    expect(spawnedCaptures).toHaveLength(1);

    spawnedCaptures[0].emitClose(1);
    await flush();

    expect(ws.close).toHaveBeenCalledWith(4010, "Session ended");
    expect(ws._sent.some((m) => {
      const msg = JSON.parse(m);
      return msg.type === "error" && /session .* ended/i.test(msg.message);
    })).toBe(true);
  });

  it("sends a real frame and never disconnects on a normal code 0 exit", async () => {
    existingSessions.add("do-box--lane-a");
    const { handlers, ws } = connectWs("do-box--lane-a");
    await flush();
    expect(spawnedCaptures).toHaveLength(1);

    spawnedCaptures[0].emitData("hello pane");
    spawnedCaptures[0].emitClose(0);
    await flush();

    expect(ws.close).not.toHaveBeenCalled();
    const paneMsg = ws._sent.map((m) => JSON.parse(m)).find((m) => m.type === "pane");
    expect(paneMsg?.content).toBe("hello pane");
    handlers.onClose(new Event("close"), ws as any);
  });
});

describe("terminalWsRoute onMessage: fit targets the viewed session", () => {
  it("applies fit to a non-default session with an exact-match target", async () => {
    existingSessions.add("do-box--lane-a");
    const { handlers, ws } = connectWs("do-box--lane-a");
    await flush();
    handlers.onMessage(
      { data: JSON.stringify({ type: "fit", cols: 100, rows: 40 }) } as unknown as MessageEvent,
      ws as any,
    );
    await flush();
    const resize = execFileCalls.find((c) => c.args[0] === "resize-window");
    expect(resize?.args).toEqual(["resize-window", "-t", "=do-box--lane-a:", "-x", "100", "-y", "40"]);
    const release = execFileCalls.find((c) => c.args[0] === "set-option");
    expect(release?.args).toEqual(["set-option", "-t", "=do-box--lane-a:", "window-size", "latest"]);
    expect(ws._sent.map((m) => JSON.parse(m)).some((m) => m.type === "fit-ack")).toBe(true);
    handlers.onClose(new Event("close"), ws as any);
  });

  it("still applies fit on the default session", async () => {
    const { handlers, ws } = connectWs();
    await flush();
    handlers.onMessage(
      { data: JSON.stringify({ type: "fit", cols: 100, rows: 40 }) } as unknown as MessageEvent,
      ws as any,
    );
    await flush();
    const resize = execFileCalls.find((c) => c.args[0] === "resize-window");
    expect(resize?.args).toEqual(["resize-window", "-t", "=test-session:", "-x", "100", "-y", "40"]);
    expect(ws._sent.map((m) => JSON.parse(m)).some((m) => m.type === "fit-ack")).toBe(true);
    handlers.onClose(new Event("close"), ws as any);
  });

  it("still rejects malformed fit dimensions on a non-default session without a tmux write", async () => {
    existingSessions.add("do-box--lane-a");
    const { handlers, ws } = connectWs("do-box--lane-a");
    await flush();
    handlers.onMessage(
      { data: JSON.stringify({ type: "fit", cols: 100, rows: "40" }) } as unknown as MessageEvent,
      ws as any,
    );
    await flush();
    expect(execFileCalls.some((c) => c.args[0] === "resize-window" || c.args[0] === "set-option")).toBe(false);
    expect(ws._sent.map((m) => JSON.parse(m)).some((m) => m.type === "fit-error")).toBe(true);
    handlers.onClose(new Event("close"), ws as any);
  });

  it("keeps every other WS write path inert for a non-default session", async () => {
    existingSessions.add("do-box--lane-a");
    const { handlers, ws } = connectWs("do-box--lane-a");
    await flush();
    handlers.onMessage(
      { data: JSON.stringify({ type: "resize", cols: 100, rows: 40 }) } as unknown as MessageEvent,
      ws as any,
    );
    handlers.onMessage(
      { data: JSON.stringify({ type: "send-keys", keys: "C-c" }) } as unknown as MessageEvent,
      ws as any,
    );
    await flush();
    expect(execFileCalls.some((c) => c.args[0] === "resize-window" || c.args[0] === "set-option" || c.args[0] === "send-keys")).toBe(false);
    handlers.onClose(new Event("close"), ws as any);
  });
});
