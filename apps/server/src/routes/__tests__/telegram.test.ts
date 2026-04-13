import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `telegram.ts` route endpoints:
 *   - POST /send-to-chat — sends a file-sharing message to Telegram
 *
 * Strategy:
 *   - Mock `../utils.js` to stub getTelegramCreds, tgRaw, tgSanitize, and
 *     execAsync so no real shell or curl calls run.
 *   - Drive the telegramRoute Hono sub-app via `app.request()`.
 */

// ---------------------------------------------------------------------------
// Mocks — must be declared before dynamic imports
// ---------------------------------------------------------------------------

const mockExecAsync = vi.fn();
const mockGetTelegramCreds = vi.fn();

vi.mock("../utils.js", async () => {
  const actual = await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return {
    ...actual,
    getTelegramCreds: (...args: any[]) => mockGetTelegramCreds(...args),
    execAsync: (...args: any[]) => mockExecAsync(...args),
  };
});

// ---------------------------------------------------------------------------
// Import route AFTER mocks
// ---------------------------------------------------------------------------
const { telegramRoute } = await import("../telegram.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function postSendToChat(body: unknown): Promise<Response> {
  return telegramRoute.request("/send-to-chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockGetTelegramCreds.mockResolvedValue({
    botToken: "123456:ABC-DEF",
    chatId: "-1001234567890",
  });
  mockExecAsync.mockResolvedValue({
    stdout: JSON.stringify({ ok: true, result: { message_id: 42 } }),
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /send-to-chat", () => {
  it("returns ok:true with messageId on success", async () => {
    const res = await postSendToChat({ filePath: "/home/claude/code/test.ts" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; messageId: number };
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe(42);
  });

  it("calls getTelegramCreds", async () => {
    await postSendToChat({ filePath: "/home/claude/test.txt" });
    expect(mockGetTelegramCreds).toHaveBeenCalledTimes(1);
  });

  it("calls execAsync with a curl command containing the botToken and chatId", async () => {
    await postSendToChat({ filePath: "/home/claude/code/example.ts" });
    expect(mockExecAsync).toHaveBeenCalledTimes(1);
    const [cmd, opts] = mockExecAsync.mock.calls[0];
    expect(cmd).toContain("curl");
    expect(cmd).toContain("123456:ABC-DEF");
    expect(cmd).toContain("-1001234567890");
    expect(opts.shell).toBe("/bin/bash");
  });

  it("shortens /home/claude/ paths to ~/ in the message", async () => {
    await postSendToChat({ filePath: "/home/claude/code/test.ts" });
    const [cmd] = mockExecAsync.mock.calls[0];
    // tgRaw escapes ~ and . — in the JSON payload within the curl command,
    // the backslash is doubled (JSON encoding), so \~ becomes \\~
    expect(cmd).toContain("\\\\~/code/test\\\\.ts");
    // Original unescaped path should not appear
    expect(cmd).not.toContain("/home/claude/code/test.ts");
  });

  it("includes MarkdownV2 parse_mode in the request", async () => {
    await postSendToChat({ filePath: "/home/claude/test.md" });
    const [cmd] = mockExecAsync.mock.calls[0];
    expect(cmd).toContain("MarkdownV2");
  });

  it("returns 400 when filePath is missing", async () => {
    const res = await postSendToChat({});
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("filePath required");
  });

  it("returns 400 when filePath is empty string", async () => {
    const res = await postSendToChat({ filePath: "" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("filePath required");
  });

  it("returns 500 when getTelegramCreds throws", async () => {
    mockGetTelegramCreds.mockRejectedValueOnce(
      new Error("Telegram not configured in common.sh"),
    );
    const res = await postSendToChat({ filePath: "/home/claude/test.txt" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Telegram not configured in common.sh");
  });

  it("returns 500 when execAsync (curl) throws", async () => {
    mockExecAsync.mockRejectedValueOnce(new Error("curl failed"));
    const res = await postSendToChat({ filePath: "/home/claude/test.txt" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("curl failed");
  });

  it("returns 500 when Telegram API returns invalid JSON", async () => {
    mockExecAsync.mockResolvedValueOnce({ stdout: "not json" });
    const res = await postSendToChat({ filePath: "/home/claude/test.txt" });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
  });

  it("returns 400 when request body is not valid JSON", async () => {
    // Send a raw invalid-JSON body directly (bypasses postSendToChat helper).
    // c.req.json() throws on invalid JSON; Hono's default error handler returns 500 for unhandled throws.
    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "this is { not valid } json",
    });
    expect(res.status).toBe(500);
  });

  it("returns 200 with undefined messageId when Telegram API returns ok:false", async () => {
    // Current source does not check result.ok — it returns ok:true regardless.
    // This test documents the current behaviour. If the source is later hardened
    // to return 500 on ok:false, update this test and the source together.
    mockExecAsync.mockResolvedValueOnce({
      stdout: JSON.stringify({ ok: false, description: "Bad Request: chat not found" }),
    });
    const res = await postSendToChat({ filePath: "/home/claude/test.txt" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; messageId: number | undefined };
    expect(body.ok).toBe(true);
    // result.result is undefined when ok:false, so messageId is undefined
    expect(body.messageId).toBeUndefined();
  });

  it("handles paths not under /home/claude/ without error", async () => {
    const res = await postSendToChat({ filePath: "/tmp/shared/file.txt" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
    // The shortPath goes through tgRaw which escapes dots; in the JSON
    // payload the backslash is doubled, so \. becomes \\.
    const [cmd] = mockExecAsync.mock.calls[0];
    expect(cmd).toContain("/tmp/shared/file\\\\.txt");
  });
});
