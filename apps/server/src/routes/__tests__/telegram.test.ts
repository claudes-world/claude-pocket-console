import { resolve } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Tests for the /send-to-chat endpoint in telegram.ts.
 *
 * Covers:
 *   1. Missing filePath returns 400
 *   2. Disallowed filePath returns 403 (path validation)
 *   3. Happy path: allowed path triggers fetch to Telegram API, returns messageId
 *   4. Telegram API failure surfaces as 500
 */

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock path-allowed: allow only paths starting with /home/claude/code
// Uses resolve() to normalize traversals (e.g. /../..) like the real impl.
vi.mock("../../lib/path-allowed.js", () => ({
  ALLOWED_FILE_ROOTS: ["/home/claude/code"],
  isPathAllowed: async (candidate: string, _roots: string[]) => {
    const resolved = resolve(candidate);
    return resolved.startsWith("/home/claude/code/");
  },
}));

// Mock getTelegramCreds so we don't need real secrets
vi.mock("../utils.js", async () => {
  const real = await vi.importActual<typeof import("../utils.js")>("../utils.js");
  return {
    ...real,
    getTelegramCreds: async () => ({
      botToken: "test-bot-token",
      chatId: "12345",
    }),
  };
});

// We need to mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { telegramRoute } = await import("../telegram.js");

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// POST /send-to-chat
// ---------------------------------------------------------------------------
describe("POST /send-to-chat", () => {
  it("returns 400 when filePath is missing", async () => {
    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("filePath required");
  });

  it("returns 403 for a disallowed filePath", async () => {
    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "/etc/passwd" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Access denied");
  });

  it("returns 403 for path traversal attempt", async () => {
    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "/home/claude/code/../../../etc/shadow" }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("Access denied");
  });

  it("sends message via fetch and returns messageId on success", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true, result: { message_id: 42 } }),
    });

    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "/home/claude/code/test-file.ts" }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; messageId: number };
    expect(body.ok).toBe(true);
    expect(body.messageId).toBe(42);

    // Verify fetch was called with the right URL and payload
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bottest-bot-token/sendMessage");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Content-Type"]).toBe("application/json");
    const payload = JSON.parse(opts.body);
    expect(payload.chat_id).toBe("12345");
    expect(payload.parse_mode).toBe("MarkdownV2");
    // The text should contain the shortened path
    expect(payload.text).toContain("~/code/test\\-file\\.ts");
  });

  it("does not call fetch when path is disallowed", async () => {
    await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "/tmp/evil" }),
    });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns 500 when fetch throws", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network failure"));

    const res = await telegramRoute.request("/send-to-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filePath: "/home/claude/code/test-file.ts" }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { ok: boolean; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("network failure");
  });
});
