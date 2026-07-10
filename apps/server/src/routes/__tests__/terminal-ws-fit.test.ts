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
 *      invalid message never reaches `execFile` and gets a `fit-error`
 *      reply instead; the legacy `resize` message type remains a no-op.
 *   3. Auth guard — an unauthenticated (no token) or disallowed-user
 *      socket must never reach `execFile` even if a well-formed `fit`
 *      message arrives on it. This is the regression coverage a prior
 *      review round found missing (PR #284 review, 2026-07-07): the
 *      `if (!authResult.ok) return;` guard in `onMessage` was correct on
 *      inspection but had zero test proof.
 */

const TEST_USER_ID = "999222";
const INTRUDER_ID = "888333";

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
  (...fnArgs: unknown[]) => {
    const cmd = fnArgs[0] as string;
    const args = fnArgs[1] as string[];
    // execFile's real signature is (file, args, options?, callback) — find
    // the callback by type instead of assuming a fixed arg position, since
    // callers pass options (e.g. { timeout }) or not. Round-2 review
    // (PR #299): applyFitResize and getPaneDimensions both now pass a
    // timeout option, which previously wasn't the case for every call this
    // mock had to handle.
    const callback = fnArgs.find((a) => typeof a === "function") as
      | ((err: Error | null, stdout?: string, stderr?: string) => void)
      | undefined;
    // getPaneDimensions' background "display-message" dims poll goes
    // through this same mock too (round-2 review, PR #299 converted it
    // from execFileSync to execFileAsync) — it fires once per
    // connectAuthenticatedWs() call as a side effect of onOpen starting the
    // 500ms poll loop, unrelated to the "fit" flow this file asserts on.
    // Exclude it from execFileCalls so the fit-specific length/index
    // assertions below stay meaningful; still answer the call so the background
    // poll's promise resolves instead of hanging.
    if (args?.[0] !== "display-message") {
      execFileCalls.push({ cmd, args });
    }
    callback?.(null, "", "");
    return { kill: () => {} } as any;
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

/**
 * Build a `terminalWsRoute` for a socket that should NOT be authorized —
 * either no token at all, or a token for a user outside the allowlist.
 * Deliberately does NOT call `onOpen` (which would close the socket) so
 * these tests can assert the `onMessage` guard independently catches the
 * case where a message arrives before (or instead of) that close landing —
 * exactly the race the guard's own comment describes.
 */
function connectUnauthenticatedWs(token = "") {
  const c = makeMockContext(token ? { token } : {}, { origin: "https://cpc.claude.do" });
  const handlers = terminalWsRoute(c);
  const ws = makeMockWs();
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
    await Promise.resolve();

    expect(execFileCalls[0].cmd).toBe("tmux");
    expect(execFileCalls[0].args).toEqual([
      "resize-window", "-t", "test-session", "-x", "92", "-y", "40",
    ]);

    (ws as any)._cleanup?.();
  });

  it("releases the manual-size latch with 'set-option window-size latest' AFTER the resize (incident: Liam msg 585 — resize-window sticks the session on manual, clamping every later attached client)", async () => {
    const { handlers, ws } = connectAuthenticatedWs();

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 92, rows: 40 }) } as any, ws as any);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(execFileCalls).toHaveLength(2);
    expect(execFileCalls[1].cmd).toBe("tmux");
    expect(execFileCalls[1].args).toEqual([
      "set-option", "-t", "test-session", "window-size", "latest",
    ]);

    (ws as any)._cleanup?.();
  });

  it("sends a fit-ack over the socket once tmux resize-window succeeds", async () => {
    const { handlers, ws } = connectAuthenticatedWs();

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 100, rows: 30 }) } as any, ws as any);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const acks = ws._sent.map((s) => JSON.parse(s)).filter((m) => m.type === "fit-ack");
    expect(acks).toEqual([{ type: "fit-ack", cols: 100, rows: 30 }]);

    (ws as any)._cleanup?.();
  });

  it("never calls tmux and replies with fit-error for an out-of-bounds fit request", async () => {
    const { handlers, ws } = connectAuthenticatedWs();
    ws._sent.length = 0; // drop the initial "dimensions"/"pane" sends from onOpen

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 5000, rows: 40 }) } as any, ws as any);
    await Promise.resolve();

    expect(execFileCalls).toHaveLength(0);
    const errors = ws._sent.map((s) => JSON.parse(s)).filter((m) => m.type === "fit-error");
    expect(errors).toHaveLength(1);

    (ws as any)._cleanup?.();
  });

  it("never calls tmux and replies with fit-error for a malformed fit request (non-numeric rows)", async () => {
    const { handlers, ws } = connectAuthenticatedWs();
    ws._sent.length = 0; // drop the initial "dimensions"/"pane" sends from onOpen

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 80, rows: "24" }) } as any, ws as any);
    await Promise.resolve();

    expect(execFileCalls).toHaveLength(0);
    // Aligned with the out-of-bounds test above (previously only asserted
    // the execFile-empty half of this, per review finding).
    const errors = ws._sent.map((s) => JSON.parse(s)).filter((m) => m.type === "fit-error");
    expect(errors).toHaveLength(1);

    (ws as any)._cleanup?.();
  });

  it("reports a distinct loud fit-error (resized:true) when the resize succeeds but the latch-release call fails — never the generic 'Failed to resize' message (round-1 review finding: silent-latch-stuck incident could reproduce itself)", async () => {
    const { handlers, ws } = connectAuthenticatedWs();
    ws._sent.length = 0; // drop the initial "dimensions"/"pane" sends from onOpen

    // First execFile call (resize-window) succeeds; second (set-option
    // window-size latest) fails, simulating the release call throwing
    // after the resize already applied.
    mockExecFile
      .mockImplementationOnce((...fnArgs: unknown[]) => {
        const cmd = fnArgs[0] as string;
        const args = fnArgs[1] as string[];
        const callback = fnArgs.find((a) => typeof a === "function") as (err: Error | null) => void;
        execFileCalls.push({ cmd, args });
        callback(null);
        return { kill: () => {} } as any;
      })
      .mockImplementationOnce((...fnArgs: unknown[]) => {
        const cmd = fnArgs[0] as string;
        const args = fnArgs[1] as string[];
        const callback = fnArgs.find((a) => typeof a === "function") as (err: Error | null) => void;
        execFileCalls.push({ cmd, args });
        callback(new Error("no server running on /tmp/tmux-0/default"));
        return { kill: () => {} } as any;
      });

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 92, rows: 40 }) } as any, ws as any);
    // The extra try/catch wrapping the release call inside applyFitResize
    // adds one more microtask hop than the plain-success path above —
    // flush a couple extra ticks to be safe.
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
    }

    // Both tmux calls were attempted — the resize really did apply.
    expect(execFileCalls).toHaveLength(2);

    // No fit-ack (the overall fit request did not cleanly succeed)...
    const acks = ws._sent.map((s) => JSON.parse(s)).filter((m) => m.type === "fit-ack");
    expect(acks).toHaveLength(0);

    // ...but a distinct fit-error that says the resize DID apply and the
    // latch may still be engaged, not the generic "Failed to resize tmux
    // window" message a plain resize-window failure would produce.
    const errors = ws._sent.map((s) => JSON.parse(s)).filter((m) => m.type === "fit-error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).not.toBe("Failed to resize tmux window");
    expect(errors[0].message).toMatch(/latch/i);
    expect(errors[0].resized).toBe(true);

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

// ---------------------------------------------------------------------------
// Auth guard on "fit" — the regression coverage the review flagged as
// missing. `onMessage` reads the same `authResult` closure variable that
// `onOpen` uses to decide whether to close the socket (4001); these tests
// prove that even without `onOpen` having run (or having already closed the
// socket), a `fit` message on an unauthenticated/disallowed connection can
// never reach `applyFitResize`/`execFile`.
// ---------------------------------------------------------------------------

describe("terminalWsRoute onMessage: fit auth guard", () => {
  afterEach(() => {
    vi.clearAllMocks();
    execFileCalls.length = 0;
  });

  it("drops a fit message with no token at all — never calls tmux", () => {
    const { handlers, ws } = connectUnauthenticatedWs("");

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 92, rows: 40 }) } as any, ws as any);

    expect(execFileCalls).toHaveLength(0);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("drops a fit message from a disallowed (non-allowlisted) user's session token — never calls tmux", () => {
    const token = createSession({ id: Number(INTRUDER_ID), first_name: "Intruder" });
    const { handlers, ws } = connectUnauthenticatedWs(token);

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 92, rows: 40 }) } as any, ws as any);

    expect(execFileCalls).toHaveLength(0);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("still drops the fit message even after onOpen has already closed the unauthorized socket", () => {
    const token = createSession({ id: Number(INTRUDER_ID), first_name: "Intruder" });
    const { handlers, ws } = connectUnauthenticatedWs(token);

    // Simulate onOpen having run first (the normal case) — it should close
    // with 4001 and send the auth error, never touching tmux.
    handlers.onOpen(new Event("open"), ws as any);
    expect(ws.close).toHaveBeenCalledWith(4001, "Unauthorized");

    // A message that still arrives afterward (the race the guard's comment
    // describes) must be dropped too.
    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 92, rows: 40 }) } as any, ws as any);

    expect(execFileCalls).toHaveLength(0);
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it("control case: the same fit message DOES call tmux on an authenticated, allowlisted socket", async () => {
    const { handlers, ws } = connectAuthenticatedWs();

    handlers.onMessage({ data: JSON.stringify({ type: "fit", cols: 92, rows: 40 }) } as any, ws as any);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(execFileCalls).toHaveLength(2);
    (ws as any)._cleanup?.();
  });
});
