import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../../auth.js";

/**
 * "Fit screen" WS message tests (manual resize action, issue: CPC tmux
 * terminal sizing QoL fix).
 *
 * Covers:
 *   1. `validateFitDimensions` — bounds/type checks in isolation (no tmux
 *      involved), since this is the untrusted input surface (WebView).
 *   2. `onMessage` wiring — a valid `{ type: "fit", cols, rows }` message
 *      calls `tmux resize-window -t <session> -x <cols> -y <rows>` via
 *      `execFile` (argv array, no shell) and acks over the socket; an
 *      invalid message never reaches `execFile` and gets an error reply
 *      instead; the legacy `resize` message type remains a no-op.
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

// Capture every execFile invocation so we can assert on the exact argv used
// for the tmux resize-window call, without ever spawning a real process.
const execFileCalls: { cmd: string; args: string[] }[] = [];
const mockExecFile = vi.fn(
  (cmd: string, args: string[], callback: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    execFileCalls.push({ cmd, args });
    callback(null, "", "");
  },
);

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => ({
      stdout: { on: vi.fn() },
      on: vi.fn(),
    })),
    execSync: vi.fn(() => "80x24"),
    execFile: mockExecFile,
  };
});

// Mock utils to avoid tmux session validation at import time (same pattern
// as terminal-ws-auth.test.ts).
vi.mock("../utils.js", async () => {
  const actual = await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return { ...actual, TMUX_SESSION: "test-session" };
});

const { terminalWsRoute, validateFitDimensions } = await import("../terminal-ws.js");

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

function connectAuthenticatedWs() {
  const token = createSession({ id: Number(TEST_USER_ID), first_name: "Allowed" });
  const c = makeMockContext({ token }, { origin: "https://cpc.claude.do" });
  const handlers = terminalWsRoute(c);
  const ws = makeMockWs();
  handlers.onOpen(new Event("open"), ws as any);
  return { handlers, ws };
}

// ---------------------------------------------------------------------------
// validateFitDimensions — pure bounds/type validation
// ---------------------------------------------------------------------------

describe("validateFitDimensions", () => {
  it("accepts a sane cols/rows pair", () => {
    expect(validateFitDimensions({ cols: 92, rows: 40 })).toEqual({ ok: true, cols: 92, rows: 40 });
  });

  it("accepts the boundary values", () => {
    expect(validateFitDimensions({ cols: 20, rows: 5 })).toEqual({ ok: true, cols: 20, rows: 5 });
    expect(validateFitDimensions({ cols: 500, rows: 300 })).toEqual({ ok: true, cols: 500, rows: 300 });
  });

  it("rejects cols below the minimum", () => {
    const result = validateFitDimensions({ cols: 19, rows: 24 });
    expect(result.ok).toBe(false);
  });

  it("rejects cols above the maximum", () => {
    const result = validateFitDimensions({ cols: 501, rows: 24 });
    expect(result.ok).toBe(false);
  });

  it("rejects rows below the minimum", () => {
    const result = validateFitDimensions({ cols: 80, rows: 4 });
    expect(result.ok).toBe(false);
  });

  it("rejects rows above the maximum", () => {
    const result = validateFitDimensions({ cols: 80, rows: 301 });
    expect(result.ok).toBe(false);
  });

  it("rejects non-integer cols/rows (floats)", () => {
    expect(validateFitDimensions({ cols: 80.5, rows: 24 }).ok).toBe(false);
    expect(validateFitDimensions({ cols: 80, rows: 24.5 }).ok).toBe(false);
  });

  it("rejects string cols/rows (a WebView could send anything)", () => {
    expect(validateFitDimensions({ cols: "80", rows: 24 }).ok).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(validateFitDimensions({ cols: 80 }).ok).toBe(false);
    expect(validateFitDimensions({}).ok).toBe(false);
  });

  it("rejects non-object input", () => {
    expect(validateFitDimensions(null).ok).toBe(false);
    expect(validateFitDimensions("80x24").ok).toBe(false);
    expect(validateFitDimensions(42).ok).toBe(false);
  });

  it("rejects NaN/Infinity smuggled in as numbers", () => {
    expect(validateFitDimensions({ cols: NaN, rows: 24 }).ok).toBe(false);
    expect(validateFitDimensions({ cols: 80, rows: Infinity }).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// onMessage wiring — "fit" applies a bounded tmux resize-window call
// ---------------------------------------------------------------------------

describe("terminalWsRoute onMessage: fit", () => {
  afterEach(() => {
    vi.clearAllMocks();
    execFileCalls.length = 0;
  });

  it("calls tmux resize-window with the exact validated argv on a valid fit request", async () => {
    const { handlers, ws } = connectAuthenticatedWs();

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 92, rows: 40 }) } as any, ws as any);
    // applyFitResize resolves via a microtask (promisified execFile) — flush it.
    await Promise.resolve();
    await Promise.resolve();

    expect(execFileCalls).toHaveLength(1);
    expect(execFileCalls[0].cmd).toBe("tmux");
    expect(execFileCalls[0].args).toEqual([
      "resize-window", "-t", "test-session", "-x", "92", "-y", "40",
    ]);

    (ws as any)._cleanup?.();
  });

  it("sends a fit-ack over the socket once tmux resize-window succeeds", async () => {
    const { handlers, ws } = connectAuthenticatedWs();

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 100, rows: 30 }) } as any, ws as any);
    await Promise.resolve();
    await Promise.resolve();

    const acks = ws._sent.map((s) => JSON.parse(s)).filter((m) => m.type === "fit-ack");
    expect(acks).toEqual([{ type: "fit-ack", cols: 100, rows: 30 }]);

    (ws as any)._cleanup?.();
  });

  it("never calls tmux and replies with an error for an out-of-bounds fit request", async () => {
    const { handlers, ws } = connectAuthenticatedWs();
    ws._sent.length = 0; // drop the initial "dimensions"/"pane" sends from onOpen

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 5000, rows: 40 }) } as any, ws as any);
    await Promise.resolve();

    expect(execFileCalls).toHaveLength(0);
    const errors = ws._sent.map((s) => JSON.parse(s)).filter((m) => m.type === "error");
    expect(errors).toHaveLength(1);

    (ws as any)._cleanup?.();
  });

  it("never calls tmux for a malformed fit request (non-numeric rows)", async () => {
    const { handlers, ws } = connectAuthenticatedWs();

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 80, rows: "24" }) } as any, ws as any);
    await Promise.resolve();

    expect(execFileCalls).toHaveLength(0);

    (ws as any)._cleanup?.();
  });

  it("legacy 'resize' message type remains a no-op (does not call tmux)", async () => {
    const { handlers, ws } = connectAuthenticatedWs();

    handlers.onMessage({ data: JSON.stringify({ type: "resize", cols: 92, rows: 40 }) } as any, ws as any);
    await Promise.resolve();

    expect(execFileCalls).toHaveLength(0);

    (ws as any)._cleanup?.();
  });

  it("ignores non-JSON messages without throwing", () => {
    const { handlers, ws } = connectAuthenticatedWs();
    expect(() => handlers.onMessage({ data: "not-json{{{" } as any, ws as any)).not.toThrow();
    (ws as any)._cleanup?.();
  });
});
