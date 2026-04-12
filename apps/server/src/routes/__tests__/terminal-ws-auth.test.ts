import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createSession } from "../../auth.js";

/**
 * terminal-ws session-token allowlist enforcement tests (issue #162).
 *
 * The WebSocket route `terminalWsRoute` has three auth paths:
 *   1. initData (mini app) — already checks allowlist via `checkAuth`
 *   2. session token        — was MISSING allowlist check (the bug)
 *   3. JWT token            — already checks allowlist
 *
 * Strategy: call `terminalWsRoute(mockContext)` with a valid session token,
 * then invoke the returned `onOpen` with a mock WebSocket. If auth failed,
 * `onOpen` sends `{ type: "error" }` and closes with code 4001. If auth
 * succeeded, it attempts to spawn tmux (which will fail in CI, but we only
 * care about whether it *tried* — meaning auth passed).
 */

const TEST_USER_ID = "999111";
const INTRUDER_ID = "777888";

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

// Mock child_process so tmux spawn/exec doesn't actually run.
// Must spread the real module so `exec`, `execFile`, etc. are still available
// for transitive imports (e.g. utils.ts uses `exec`/`execFile`).
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: vi.fn(() => ({
      stdout: { on: vi.fn() },
      on: vi.fn(),
    })),
    execSync: vi.fn(() => "80x24"),
  };
});

// Mock utils to avoid tmux session validation at import time
vi.mock("../utils.js", async () => {
  const actual = await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return { ...actual, TMUX_SESSION: "test-session" };
});

const { terminalWsRoute } = await import("../terminal-ws.js");

function makeMockContext(query: Record<string, string>) {
  return {
    req: {
      query: (key: string) => query[key] || "",
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

describe("terminalWsRoute session-token allowlist (issue #162)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts a session token for an allowed user", () => {
    const token = createSession({ id: Number(TEST_USER_ID), first_name: "Allowed" });
    const c = makeMockContext({ token });
    const handlers = terminalWsRoute(c);
    const ws = makeMockWs();

    handlers.onOpen(new Event("open"), ws as any);

    // Should NOT have sent an error or closed with 4001
    expect(ws.close).not.toHaveBeenCalledWith(4001, "Unauthorized");
    const errorMessages = ws._sent.filter((s) => {
      try { return JSON.parse(s).type === "error"; } catch { return false; }
    });
    expect(errorMessages).toHaveLength(0);

    // Clean up the setInterval started by onOpen to prevent timer leaks
    (ws as any)._cleanup?.();
  });

  it("rejects a session token for a non-allowed user", () => {
    const token = createSession({ id: Number(INTRUDER_ID), first_name: "Intruder" });
    const c = makeMockContext({ token });
    const handlers = terminalWsRoute(c);
    const ws = makeMockWs();

    handlers.onOpen(new Event("open"), ws as any);

    // Should have sent error and closed
    expect(ws.close).toHaveBeenCalledWith(4001, "Unauthorized");
    expect(ws._sent.length).toBeGreaterThan(0);
    const errorMsg = JSON.parse(ws._sent[0]);
    expect(errorMsg.type).toBe("error");
    expect(errorMsg.message).toBe("Unauthorized");
  });
});
